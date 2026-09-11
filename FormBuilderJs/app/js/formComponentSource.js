/**
 * FormBuilder - nested Form component wired to our API.
 * Redirects formio.js requests from form.io to our own API (/api/forms and /api/forms/{id}).
 * Key differences: auth via data.headers, API returns FormDto, Components is a JSON string.
 * Used in builder (settings dropdown) and preview pages (embedded form rendering).
 * Wrapped via editForm hook and loadSubForm override; includes schema caching.
 */

(function () {
    'use strict';

    var DEFAULT_FORMS_URL = 'http://localhost:5155/api/forms';

    // Larger than any realistic form count. Select treats "fewer rows came back than the
    // limit" as "that was the last page" and switches its infinite scroll off; without
    // it, scrolling the dropdown re-requests the same list and appends duplicates.
    var FORM_LIMIT = 1000000;

    if (typeof Formio === 'undefined' || !Formio.Components || !Formio.Components.components.form) {
        console.warn('Form data source: formio.js is not loaded, leaving the Form dropdown alone.');
        return;
    }

    /** Taken from FormBuilderApi so the API host stays defined in exactly one place. */
    function formsUrl() {
        if (window.FormBuilderApi && FormBuilderApi.config && FormBuilderApi.config.baseUrl) {
            return FormBuilderApi.config.baseUrl;
        }
        return DEFAULT_FORMS_URL;
    }

    function authHeaders() {
        var token = (window.Auth && Auth.getToken) ? Auth.getToken() : null;
        return token ? [{ key: 'Authorization', value: 'Bearer ' + token }] : [];
    }

    function useOurFormsApi(select) {
        select.dataSrc = 'url';
        select.data = { url: formsUrl(), headers: authHeaders() };
        select.valueProperty = 'id';                            // FormDto.Id, not form.io's _id
        select.template = '<span>{{ item.title || item.name }}</span>';
        select.limit = FORM_LIMIT;
        select.searchField = '';    // no server-side filter; Choices.js searches the loaded list
        select.authenticate = false; // data.headers carries the auth, not formio's x-jwt-token
        select.lazyLoad = false;
        select.ignoreCache = true;  // pick up forms added since the page loaded
    }

    // ------------------------------------------------------------ the settings dropdown

    var baseEditForm = Formio.Components.components.form.editForm;

    Formio.Components.components.form.editForm = function () {
        var schema = baseEditForm.apply(this, arguments);
        var select = null;

        // The settings tab holding this dropdown is itself keyed 'form', so match on the
        // select rather than on the key alone.
        Formio.Utils.eachComponent(schema.components, function (component) {
            if (!select && component.key === 'form' && component.type === 'select') {
                select = component;
            }
        }, true);

        if (select) {
            useOurFormsApi(select);
        }
        else {
            console.warn('Form data source: no "form" select found in the edit form; formio.js may have changed.');
        }

        return schema;
    };

    // ------------------------------------------------------------ loading the sub-form

    /**
     * Turns a FormDto into the schema formio.js renders from. Deliberately the same
     * shape FormBuilderApi.launchForm() builds for the preview page, so an embedded
     * form and a previewed one are fed identical input.
     */
    function toFormioForm(dto) {
        var stored = dto.components;

        if (typeof stored === 'string') {
            try {
                stored = JSON.parse(stored);
            }
            catch (err) {
                console.error('Nested form: could not parse the components of form ' + dto.id + '.', err);
                stored = [];
            }
        }

        // Saved either as the builder's whole schema or as a bare component array.
        var schema = Array.isArray(stored) ? { components: stored } : (stored || {});

        return {
            _id: dto.id,
            _vid: dto.versionId || 0,
            type: 'form',
            display: schema.display || 'form',
            title: dto.title || dto.name || 'Untitled Form',
            name: dto.name || 'form',
            settings: schema.settings,
            components: Array.isArray(schema.components) ? schema.components : []
        };
    }

    function fetchFormSchema(formId) {
        return new Promise(function (resolve, reject) {
            if (!window.FormBuilderApi || !FormBuilderApi.getFormById) {
                reject(new Error('FormBuilderApi is not loaded'));
                return;
            }

            FormBuilderApi.getFormById(
                formId,
                function (dto) { resolve(toFormioForm(dto)); },
                function (message, status) { reject(new Error(message + ' (HTTP ' + status + ')')); }
            );
        });
    }

    // A settings dialog re-renders its preview several times while you interact with it,
    // and every render builds a fresh component that reloads the sub-form - opening the
    // dialog once cost six identical requests. Stock formio.js never notices because
    // Formio.makeStaticRequest caches GETs in Formio.cache; the jQuery path we use for
    // the Bearer token does not. Deliberately short-lived rather than page-lifetime like
    // Formio.cache, so a form edited elsewhere shows up without a reload.
    var SCHEMA_CACHE_MS = 30000;
    var schemaCache = {};

    /**
     * formio.js edits the schema it is handed: createSubForm() sets `hidden` on the
     * child's submit button, Webform.setForm() stamps ids onto the component objects,
     * and the already-loaded branch of loadSubForm() writes `config` onto formObj.
     * Sharing one cached object would put every live instance - the six a settings
     * dialog builds, say - on the same object graph, with each outgoing preview's
     * destroy() reaching into the next one's schema. Formio.cache dodges this by
     * returning cloneResponse() per hit rather than the raw entry; this is the same
     * idea. A JSON round-trip is what main.js already uses to copy schemas, and it is
     * lossless here because the schema came out of JSON.parse to begin with.
     */
    function cloneSchema(schema) {
        return JSON.parse(JSON.stringify(schema));
    }

    function loadFormSchema(formId) {
        var cached = schemaCache[formId];

        if (cached && (Date.now() - cached.at) < SCHEMA_CACHE_MS) {
            return cached.promise.then(cloneSchema);
        }

        var promise = fetchFormSchema(formId);

        // Never leave a failure cached, or one blip pins the error for the whole window.
        promise.catch(function () {
            if (schemaCache[formId] && schemaCache[formId].promise === promise) {
                delete schemaCache[formId];
            }
        });

        schemaCache[formId] = { at: Date.now(), promise: promise };
        return promise.then(cloneSchema);
    }

    var proto = Formio.Components.components.form.prototype;
    var baseLoadSubForm = proto.loadSubForm;

    /**
     * Replaces only the fetch. The guards around it are formio.js's own, kept verbatim
     * so that builder mode, hidden components, lazy loading and an already-loaded schema
     * all behave exactly as before - see src/components/form/Form.js.
     */
    proto.loadSubForm = function (fromAttach) {
        // An explicit `src`, or no form chosen at all, is not ours to redirect.
        if (this.component.src || !this.component.form) {
            return baseLoadSubForm.call(this, fromAttach);
        }

        if (this.builderMode || this.isHidden() || (this.isSubFormLazyLoad() && !fromAttach)) {
            return Promise.resolve();
        }

        if (this.hasLoadedForm && !this.isRevisionChanged &&
            !(this.options.pdf && this.component.useOriginalRevision &&
              this.subForm === null && !this.subFormLoading)
        ) {
            // Pass config down to sub forms.
            if (this.root && this.root.form && this.root.form.config && !this.formObj.config) {
                this.formObj.config = this.root.form.config;
            }
            return Promise.resolve(this.formObj);
        }

        var self = this;
        this.subFormLoading = true;

        return loadFormSchema(this.component.form)
            .then(function (formObj) {
                if (self.options.pdf && self.component.useOriginalRevision) {
                    formObj.display = 'form';
                }
                self.formObj = formObj;
                self.subFormLoading = false;
                return formObj;
            })
            .catch(function (err) {
                self.subFormLoading = false;
                console.error('Nested form: could not load form ' + self.component.form + '.', err);
                return null;
            });
    };
})();
