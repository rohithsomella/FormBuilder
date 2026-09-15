/**
 * User Details - the "Add New User" and "Edit User" dialogs.
 *
 * Owns everything behind the two buttons in the users table: loading the assignable
 * roles, verifying a username, creating an account and showing the one-time password the
 * API generates, and saving edits to an existing one. The surrounding page keeps its own
 * table, search, sort and pagination.
 *
 *   UserDetailsHandler.init({ onUserCreated: fn, onUserUpdated: fn })
 *   UserDetailsHandler.openAddUserDialog()      ->  open a blank Add dialog
 *   UserDetailsHandler.openEditUserDialog(user) ->  open the Edit dialog on one row
 *
 * Roles are fetched from the API rather than hard-coded here, so neither dropdown can
 * offer something the API would reject. This file draws UI only - the API decides on its
 * own whether the caller is allowed to create or change anybody.
 */
var UserDetailsHandler = (function () {
    'use strict';

    var state = {
        // [{ name, description }] as returned by GET /api/users/roles. Shared by both
        // dialogs, so opening either one after the first load costs no request.
        roles: [],

        isSubmitting: false,

        // The table row the Edit dialog is currently open on, or null. Its id is what the
        // save is aimed at, so the dialog can never write to a different account than the
        // one whose Edit button was pressed.
        editingUser: null,
        isSavingEdit: false,

        // Whether the Change Password panel is showing. The password itself is never
        // held here - it is read out of the inputs at save time and forgotten again.
        isChangingPassword: false,

        onUserCreated: null,
        onUserUpdated: null
    };

    /**
     * Describes one "Verify" button and the box it belongs to, so the check itself is
     * written once and told which one it is working on - the same shape as
     * createRoleDropdown below.
     *
     * Each instance keeps its own verdict. The Add and Edit dialogs ask the same question
     * about different boxes, and a tick earned in one must never read as a verdict on the
     * other.
     *
     * @param ids.input     id of the username box
     * @param ids.feedback  id of the element the verdict is written into
     * @param ids.excludes  optional () => userId to ignore when looking for a clash. The
     *                      Edit dialog returns the account being edited, so leaving a
     *                      username untouched is not reported as taken by its own owner.
     */
    function createUserNameVerifier(ids) {
        return {
            inputId: ids.input,
            feedbackId: ids.feedback,
            excludes: ids.excludes || function () { return null; },

            // The exact username string that last came back as available, and the one
            // that came back as taken. Compared against what is currently typed, so
            // editing the box after verifying clears the verdict.
            verifiedUserName: null,
            takenUserName: null
        };
    }

    var addUserNameCheck = createUserNameVerifier({
        input: 'addUserUserName',
        feedback: 'userNameFeedback'
    });

    var editUserNameCheck = createUserNameVerifier({
        input: 'editUserName',
        feedback: 'editUserNameFeedback',
        excludes: function () {
            return state.editingUser ? state.editingUser.id : null;
        }
    });

    /**
     * The two role multi-selects on this page. They render from the same state.roles but
     * hold their own selection, so the render/summary/open code below is written once and
     * told which one it is working on.
     */
    function createRoleDropdown(ids) {
        return {
            containerId: ids.container,
            toggleId: ids.toggle,
            labelId: ids.label,
            menuId: ids.menu,
            selected: []
        };
    }

    var addRoles = createRoleDropdown({
        container: 'roleDropdown',
        toggle: 'roleDropdownToggle',
        label: 'roleDropdownLabel',
        menu: 'roleDropdownMenu'
    });

    var editRoles = createRoleDropdown({
        container: 'editRoleDropdown',
        toggle: 'editRoleDropdownToggle',
        label: 'editRoleDropdownLabel',
        menu: 'editRoleDropdownMenu'
    });

    /** The Edit dialog's four lockable cells, in the order they are laid out. */
    var EDIT_FIELD_IDS = [
        'editFieldFirstName',
        'editFieldLastName',
        'editFieldUserName',
        'editFieldRoles'
    ];

    function escapeHtml(text) {
        var map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, function (m) {
            return map[m];
        });
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function on(id, event, handler) {
        var el = byId(id);
        if (el) el.addEventListener(event, handler);
    }

    // ---------------------------------------------------------------- setup

    function init(options) {
        state.onUserCreated = (options && options.onUserCreated) || null;
        state.onUserUpdated = (options && options.onUserUpdated) || null;

        on('btnVerifyUserName', 'click', function () {
            verifyUserName(addUserNameCheck);
        });
        on('btnCancelAddUser', 'click', closeAddUserDialog);
        on('btnSaveNewUser', 'click', submitNewUser);
        on('btnCloseNewUserPassword', 'click', finishAndRefresh);
        on('btnCopyNewUserPassword', 'click', copyTemporaryPassword);

        on('roleDropdownToggle', 'click', function (e) {
            toggleRoleDropdown(addRoles, e);
        });

        // Typing invalidates a previous verification - otherwise the tick from
        // "alice" would still be showing after the box was changed to "alicia".
        on('addUserUserName', 'input', function () {
            forceLowerCase('addUserUserName');
            clearUserNameFeedback(addUserNameCheck);
        });

        initEditDialog();

        var overlay = byId('addUserModal');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeAddUserDialog();
            });
        }

        // Clicking anywhere else closes the role dropdowns, which is what a native
        // <select> would do.
        document.addEventListener('click', function (e) {
            [addRoles, editRoles].forEach(function (dropdown) {
                var container = byId(dropdown.containerId);
                if (container && !container.contains(e.target)) {
                    setRoleDropdownOpen(dropdown, false);
                }
            });
        });

        loadRoles();
    }

    function loadRoles() {
        FormBuilderApi.getAssignableRoles(
            function (roles) {
                state.roles = Array.isArray(roles) ? roles : [];
                renderRoleOptions(addRoles);
                renderRoleOptions(editRoles);
            },
            function (error) {
                console.error('Could not load roles:', error);
                state.roles = [];
                renderRoleOptions(addRoles, error);
                renderRoleOptions(editRoles, error);
            }
        );
    }

    // ---------------------------------------------------------------- dialog

    function openAddUserDialog() {
        resetDialog();

        // A failed role load leaves the dropdown empty and the dialog unusable, so try
        // again each time it is opened rather than only once on page load.
        if (!state.roles.length) {
            loadRoles();
        }

        var modal = byId('addUserModal');
        if (modal) modal.classList.add('active');

        var firstNameInput = byId('addUserFirstName');
        if (firstNameInput) firstNameInput.focus();
    }

    function closeAddUserDialog() {
        var modal = byId('addUserModal');
        if (modal) modal.classList.remove('active');
    }

    function resetDialog() {
        setValue('addUserFirstName', '');
        setValue('addUserLastName', '');
        setValue('addUserUserName', '');
        setValue('addUserEmail', '');

        addRoles.selected = [];
        state.isSubmitting = false;

        clearUserNameFeedback(addUserNameCheck);
        hideError();
        setRoleDropdownOpen(addRoles, false);
        renderRoleOptions(addRoles);

        // Back to the form, in case the dialog was last left on the password screen.
        showSection('addUserFormSection');

        var saveButton = byId('btnSaveNewUser');
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = 'Save';
        }
    }

    /** The dialog has two faces: the form, and the one-time password afterwards. */
    function showSection(sectionId) {
        ['addUserFormSection', 'newUserPasswordSection'].forEach(function (id) {
            var section = byId(id);
            if (section) section.style.display = (id === sectionId) ? 'block' : 'none';
        });
    }

    // ---------------------------------------------------------------- roles

    function renderRoleOptions(dropdown, loadError) {
        var menu = byId(dropdown.menuId);
        if (!menu) return;

        if (!state.roles.length) {
            menu.innerHTML = '<div class="role-dropdown-empty">' +
                escapeHtml(loadError || 'No roles available') + '</div>';
            updateRoleSummary(dropdown);
            return;
        }

        menu.innerHTML = state.roles.map(function (role) {
            var checked = dropdown.selected.indexOf(role.name) !== -1;

            return '<label class="role-option" title="' + escapeHtml(role.description || role.name) + '">' +
                '<input type="checkbox" class="role-checkbox" value="' + escapeHtml(role.name) + '"' +
                (checked ? ' checked' : '') + '>' +
                '<span>' + escapeHtml(role.name) + '</span>' +
                '</label>';
        }).join('');

        Array.prototype.forEach.call(menu.querySelectorAll('.role-checkbox'), function (checkbox) {
            checkbox.addEventListener('change', function (e) {
                onRoleCheckboxChange(dropdown, e);
            });
        });

        updateRoleSummary(dropdown);
    }

    function onRoleCheckboxChange(dropdown, e) {
        var roleName = e.target.value;
        var index = dropdown.selected.indexOf(roleName);

        if (e.target.checked && index === -1) {
            dropdown.selected.push(roleName);
        } else if (!e.target.checked && index !== -1) {
            dropdown.selected.splice(index, 1);
        }

        updateRoleSummary(dropdown);

        // Clear whichever dialog's error banner this dropdown belongs to, so a
        // "select at least one role" message goes away as soon as one is ticked.
        if (dropdown === editRoles) {
            hideEditError();
        } else {
            hideError();
        }
    }

    function updateRoleSummary(dropdown) {
        var label = byId(dropdown.labelId);
        if (!label) return;

        if (!dropdown.selected.length) {
            label.textContent = 'Select role(s)';
            label.classList.add('placeholder');
            return;
        }

        // Kept in the order the API listed them rather than the order they were ticked,
        // so the same set of roles always reads the same way.
        //
        // Roles the account holds that are no longer in AspNetRoles would vanish from
        // this summary, so they are appended rather than silently dropped - the Edit
        // dialog must not misreport what a user currently has.
        var known = state.roles
            .map(function (role) { return role.name; })
            .filter(function (name) { return dropdown.selected.indexOf(name) !== -1; });

        var unknown = dropdown.selected.filter(function (name) {
            return known.indexOf(name) === -1;
        });

        label.textContent = known.concat(unknown).join(', ');
        label.classList.remove('placeholder');
    }

    function toggleRoleDropdown(dropdown, e) {
        e.preventDefault();
        e.stopPropagation();

        var menu = byId(dropdown.menuId);
        setRoleDropdownOpen(dropdown, !(menu && menu.classList.contains('open')));
    }

    function setRoleDropdownOpen(dropdown, open) {
        var menu = byId(dropdown.menuId);
        var toggle = byId(dropdown.toggleId);

        // A locked field's dropdown must stay shut - its toggle is disabled, so there
        // would be no way to close one that had been opened behind its back.
        if (toggle && toggle.disabled) open = false;

        if (menu) menu.classList.toggle('open', open);
        if (toggle) toggle.classList.toggle('open', open);
    }

    // ---------------------------------------------------------------- username

    /**
     * Runs the availability check for one username box and writes the verdict beside it.
     *
     * Shared by the Add and Edit dialogs. Everything that differs between them - which
     * box to read, where to put the answer, and whose account to ignore when looking for
     * a clash - comes from the verifier passed in, so there is one copy of this logic
     * rather than one per dialog.
     *
     * @param {Object} verifier - from createUserNameVerifier
     */
    function verifyUserName(verifier) {
        var userName = getValue(verifier.inputId);

        if (!userName) {
            setUserNameFeedback(verifier, 'Enter a username to verify.', 'error');
            return;
        }

        setUserNameFeedback(verifier, 'Checking...', 'checking');

        FormBuilderApi.checkUserName(
            userName,
            function (result) {
                if (result.isAvailable) {
                    verifier.verifiedUserName = userName;
                    verifier.takenUserName = null;
                    setUserNameFeedback(verifier, result.message, 'ok');
                } else {
                    verifier.verifiedUserName = null;
                    verifier.takenUserName = userName;
                    setUserNameFeedback(verifier, result.message, 'error');
                }
            },
            function (error) {
                verifier.verifiedUserName = null;
                verifier.takenUserName = null;
                setUserNameFeedback(verifier, error, 'error');
            },
            verifier.excludes()
        );
    }

    function setUserNameFeedback(verifier, message, kind) {
        var feedback = byId(verifier.feedbackId);
        if (!feedback) return;

        feedback.textContent = message || '';
        feedback.className = 'username-feedback' + (kind ? ' ' + kind : '');
    }

    function clearUserNameFeedback(verifier) {
        verifier.verifiedUserName = null;
        verifier.takenUserName = null;
        setUserNameFeedback(verifier, '', null);
    }

    // ---------------------------------------------------------------- submit

    function submitNewUser() {
        if (state.isSubmitting) return;

        var newUser = {
            firstName: getValue('addUserFirstName'),
            lastName: getValue('addUserLastName'),
            userName: getValue('addUserUserName'),
            email: getValue('addUserEmail'),
            roles: addRoles.selected.slice()
        };

        var validationError = validate(newUser);
        if (validationError) {
            showError(validationError);
            return;
        }

        setSubmitting(true);
        hideError();

        FormBuilderApi.createUser(
            newUser,
            function (response) {
                setSubmitting(false);
                showTemporaryPassword(response);
            },
            function (error) {
                setSubmitting(false);
                showError(error);
            }
        );
    }

    /**
     * Front-line checks only, so the obvious mistakes are caught without a round trip.
     * The API validates all of this again and is the one that decides.
     */
    function validate(newUser) {
        if (!newUser.firstName) return 'First name is required.';
        if (!newUser.lastName) return 'Last name is required.';
        if (!newUser.userName) return 'Username is required.';
        if (!newUser.email) return 'Email is required.';
        if (!newUser.roles.length) return 'Select at least one role.';

        // Only blocks on a username Verify actually reported as taken. Not verifying at
        // all is allowed - the API rejects a duplicate either way.
        if (addUserNameCheck.takenUserName && addUserNameCheck.takenUserName === newUser.userName) {
            return 'Username \'' + newUser.userName + '\' is already taken.';
        }

        return null;
    }

    function setSubmitting(isSubmitting) {
        state.isSubmitting = isSubmitting;

        var saveButton = byId('btnSaveNewUser');
        if (saveButton) {
            saveButton.disabled = isSubmitting;
            saveButton.textContent = isSubmitting ? 'Saving...' : 'Save';
        }
    }

    // ---------------------------------------------------------------- result

    /**
     * The API generates the password and stores only its hash, so this response is the
     * only time it can be read. The dialog therefore switches to a screen the admin has
     * to dismiss deliberately, instead of closing and losing it.
     */
    function showTemporaryPassword(response) {
        var user = (response && response.user) || {};
        var password = (response && response.temporaryPassword) || '';

        setText('newUserSummaryName', user.fullName || '');
        setText('newUserSummaryUserName', user.userName || '');
        setText('newUserSummaryEmail', user.email || '');
        setText('newUserSummaryRoles', (user.roles || []).join(', '));
        setText('newUserPasswordValue', password);

        var copyButton = byId('btnCopyNewUserPassword');
        if (copyButton) copyButton.textContent = 'Copy';

        showSection('newUserPasswordSection');
    }

    function copyTemporaryPassword() {
        var password = byId('newUserPasswordValue');
        var copyButton = byId('btnCopyNewUserPassword');
        if (!password) return;

        var done = function () {
            if (copyButton) copyButton.textContent = 'Copied';
        };

        // navigator.clipboard needs a secure context, which a plain http:// page opened
        // from a file server is not, so fall back to selecting the text for the admin.
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(password.textContent).then(done, selectPassword);
        } else {
            selectPassword();
        }
    }

    function selectPassword() {
        var password = byId('newUserPasswordValue');
        if (!password || !window.getSelection) return;

        var range = document.createRange();
        range.selectNodeContents(password);

        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    /** Closes the dialog and lets the page reload the table from the API. */
    function finishAndRefresh() {
        closeAddUserDialog();

        if (state.onUserCreated) {
            state.onUserCreated();
        }
    }

    // ------------------------------------------------------------- edit dialog

    function initEditDialog() {
        on('btnCancelEditUser', 'click', closeEditUserDialog);
        on('btnSaveEditUser', 'click', submitEditUser);
        on('btnVerifyEditUserName', 'click', function () {
            verifyUserName(editUserNameCheck);
        });

        // Typing invalidates a previous verification, the same way the Add dialog's box
        // does - a tick earned by one name must not still be showing under another.
        on('editUserName', 'input', function () {
            forceLowerCase('editUserName');
            clearUserNameFeedback(editUserNameCheck);
        });

        on('editRoleDropdownToggle', 'click', function (e) {
            toggleRoleDropdown(editRoles, e);
        });

        on('btnToggleChangePassword', 'click', function () {
            setChangePasswordOpen(!state.isChangingPassword);
        });

        // The eye beside each box. One listener per button, wired once.
        Array.prototype.forEach.call(
            document.querySelectorAll('#editModal .btn-password-reveal'),
            function (button) {
                button.addEventListener('click', function (e) {
                    e.preventDefault();
                    togglePasswordReveal(button);
                });
            });

        ['editNewPassword', 'editConfirmPassword'].forEach(function (id) {
            on(id, 'input', clearPasswordFeedback);
        });

        // The toggle has no pencil - it is live from the moment the dialog opens - so the
        // only thing to do here is keep the word beside it honest.
        on('editIsActive', 'change', function () {
            var checkbox = byId('editIsActive');
            setActiveLabel(!!(checkbox && checkbox.checked));
        });

        // One listener per pencil, wired once. data-unlock names the cell it opens, so
        // adding a field to the dialog needs no change here.
        Array.prototype.forEach.call(
            document.querySelectorAll('#editModal .btn-field-edit'),
            function (button) {
                button.addEventListener('click', function (e) {
                    e.preventDefault();

                    // Without this the document-level listener that closes the role
                    // dropdowns would fire straight after, shutting the one this click
                    // just opened.
                    e.stopPropagation();

                    unlockEditField(button.getAttribute('data-unlock'));
                });
            });

        var overlay = byId('editModal');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeEditUserDialog();
            });
        }
    }

    /**
     * Opens the dialog on one row of the users table.
     *
     * `user` is the row the page already holds, so nothing is re-fetched to open it. The
     * save goes to that row's id, and the table is reloaded from the API afterwards - so
     * what ends up on screen is what the server actually stored, not what was typed.
     */
    function openEditUserDialog(user) {
        if (!user) return;

        state.editingUser = user;
        state.isSavingEdit = false;

        // The dialog is titled with the account it is about, so a stack of screenshots
        // or a half-remembered click is still identifiable.
        setText('editUserTitle', displayName(user));

        setValue('editFirstName', user.firstName || '');
        setValue('editLastName', user.lastName || '');
        setValue('editUserName', user.username || '');

        editRoles.selected = (user.roles || []).slice();

        setText('editCreatedBy', user.createdBy || '-');
        setText('editCreated', formatDateTime(user.created));
        setText('editUpdatedBy', user.updatedBy || '-');
        setText('editUpdated', formatDateTime(user.updated));

        setActive(user.isActive !== false);

        lockAllEditFields();
        hideEditError();
        clearUserNameFeedback(editUserNameCheck);
        setChangePasswordOpen(false);
        renderRoleOptions(editRoles);

        // A failed or still-running role load would leave the dropdown empty and the
        // dialog unable to describe what the user has, so try again on open.
        if (!state.roles.length) {
            loadRoles();
        }

        setSavingEdit(false);

        var modal = byId('editModal');
        if (modal) modal.classList.add('active');
    }

    function closeEditUserDialog() {
        var modal = byId('editModal');
        if (modal) modal.classList.remove('active');

        setRoleDropdownOpen(editRoles, false);

        // Closes the password panel and blanks its inputs. A dismissed dialog must not
        // leave a typed password sitting in the DOM for the next person to open it.
        setChangePasswordOpen(false);

        state.editingUser = null;
    }

    // ------------------------------------------------------- edit field locks

    /**
     * Locking a cell disables its control and puts the class back that greys it out. The
     * dialog opens with every cell locked, so reading somebody's details cannot turn into
     * editing them by accident.
     */
    function setEditFieldLocked(fieldId, locked) {
        var field = byId(fieldId);
        if (!field) return;

        field.classList.toggle('locked', locked);

        // Covers the plain inputs, the role dropdown's toggle, and the username's Verify
        // button - there is nothing to verify while the box cannot be typed in.
        var controls = field.querySelectorAll('.modal-input, .role-dropdown-toggle, .btn-verify');

        Array.prototype.forEach.call(controls, function (control) {
            control.disabled = locked;
        });
    }

    function lockAllEditFields() {
        EDIT_FIELD_IDS.forEach(function (fieldId) {
            setEditFieldLocked(fieldId, true);
        });

        setRoleDropdownOpen(editRoles, false);
    }

    function unlockEditField(fieldId) {
        if (!fieldId) return;

        setEditFieldLocked(fieldId, false);

        var field = byId(fieldId);
        if (!field) return;

        // Land the caret in the field that was just unlocked. For roles there is no text
        // box to focus, so open the menu instead - that is the equivalent gesture.
        var input = field.querySelector('.modal-input');

        if (input) {
            input.focus();
            input.select();
        } else if (fieldId === 'editFieldRoles') {
            setRoleDropdownOpen(editRoles, true);
        }
    }


    // ---------------------------------------------------- edit change password

    function setChangePasswordOpen(open) {
        state.isChangingPassword = !!open;

        // 'grid', not 'block': the panel lays its two boxes out in the same two columns
        // as the detail grid above it.
        var panel = byId('editPasswordFields');
        if (panel) panel.style.display = open ? 'grid' : 'none';

        var label = byId('btnToggleChangePasswordLabel');
        if (label) label.textContent = open ? 'Cancel Password Change' : 'Change Password';

        var button = byId('btnToggleChangePassword');
        if (button) button.classList.toggle('open', !!open);

        // Closing discards whatever was typed. Leaving a password sitting in a hidden
        // input would mean a Save the admin thought was cancelled still carried one.
        if (!open) {
            clearPasswordInputs();
        } else {
            var newPassword = byId('editNewPassword');
            if (newPassword) newPassword.focus();
        }
    }

    /**
     * Empties both boxes and puts them back to masked. Called whenever the panel closes
     * and whenever the dialog opens, so a password can never survive into a later edit
     * of a different account.
     */
    function clearPasswordInputs() {
        ['editNewPassword', 'editConfirmPassword'].forEach(function (id) {
            var input = byId(id);
            if (!input) return;

            input.value = '';
            input.type = 'password';
        });

        Array.prototype.forEach.call(
            document.querySelectorAll('#editModal .btn-password-reveal'),
            function (button) {
                var icon = button.querySelector('i');
                if (icon) icon.className = 'bi bi-eye';

                button.setAttribute('aria-label', 'Show password');
                button.setAttribute('title', 'Show password');
            });

        clearPasswordFeedback();
    }

    /** Flips one box between masked and readable, and swaps the eye for a struck eye. */
    function togglePasswordReveal(button) {
        var input = byId(button.getAttribute('data-reveals'));
        if (!input) return;

        var reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';

        var icon = button.querySelector('i');
        if (icon) icon.className = reveal ? 'bi bi-eye-slash' : 'bi bi-eye';

        var description = reveal ? 'Hide password' : 'Show password';
        button.setAttribute('aria-label', description);
        button.setAttribute('title', description);
    }

    /**
     * What the save should send, or null when no password change was asked for.
     *
     * Reads the boxes without trimming: spaces are legitimate password characters, and
     * silently stripping them would set a password other than the one that was typed.
     */
    function getPasswordChange() {
        if (!state.isChangingPassword) return null;

        var newPassword = rawValue('editNewPassword');
        var confirmPassword = rawValue('editConfirmPassword');

        // Panel opened and nothing typed reads as a change of mind, not a mistake worth
        // blocking the rest of the save over.
        if (!newPassword && !confirmPassword) return null;

        return { newPassword: newPassword, confirmPassword: confirmPassword };
    }

    function setPasswordFeedback(message, kind) {
        var feedback = byId('editPasswordFeedback');
        if (!feedback) return;

        feedback.textContent = message || '';
        feedback.className = 'password-feedback' + (kind ? ' ' + kind : '');
    }

    function clearPasswordFeedback() {
        setPasswordFeedback('', null);
    }

    // ------------------------------------------------------------ edit status

    function setActive(isActive) {
        var checkbox = byId('editIsActive');
        if (checkbox) checkbox.checked = !!isActive;

        setActiveLabel(!!isActive);
    }

    function setActiveLabel(isActive) {
        var text = byId('editIsActiveText');
        if (!text) return;

        text.textContent = isActive ? 'Active' : 'Inactive';
        text.className = 'status-text ' + (isActive ? 'active' : 'inactive');
    }

    // ------------------------------------------------------------- edit submit

    function submitEditUser() {
        if (state.isSavingEdit || !state.editingUser) return;

        var checkbox = byId('editIsActive');

        // Every field is read, locked or not: a locked one still holds the value the
        // dialog opened with, which is exactly what should be sent back for it.
        var changes = {
            firstName: getValue('editFirstName'),
            lastName: getValue('editLastName'),
            userName: getValue('editUserName'),
            roles: editRoles.selected.slice(),
            isActive: !!(checkbox && checkbox.checked)
        };

        var passwordChange = getPasswordChange();

        var validationError = validateEdit(changes, passwordChange);
        if (validationError) {
            showEditError(validationError);
            return;
        }

        setSavingEdit(true);
        hideEditError();

        var userId = state.editingUser.id;

        // Two requests, because a password goes to its own endpoint. The details are
        // saved first: if the password is then rejected by Identity's policy, the admin
        // is told precisely that, and retrying re-sends details that are already correct.
        FormBuilderApi.updateUser(
            userId,
            changes,
            function () {
                if (!passwordChange) {
                    finishEditSave();
                    return;
                }

                FormBuilderApi.setUserPassword(
                    userId,
                    passwordChange,
                    finishEditSave,
                    function (error) {
                        setSavingEdit(false);

                        // Says plainly which half succeeded. "Could not save" would be a
                        // lie here - the details are already committed.
                        showEditError('The details were saved, but the password was not changed: ' + error);
                        setPasswordFeedback(error, 'error');
                    }
                );
            },
            function (error) {
                // Left open on the failure, still holding what was typed, so the admin
                // can fix the one thing the API objected to rather than start again.
                setSavingEdit(false);
                showEditError(error);
            }
        );
    }

    function finishEditSave() {
        setSavingEdit(false);
        closeEditUserDialog();

        if (state.onUserUpdated) {
            state.onUserUpdated();
        }
    }

    /**
     * Front-line checks only, so the obvious mistakes are caught without a round trip.
     * The API validates all of this again - including the username clash and the two
     * self-lockout rules it will not let an admin talk it out of - and is the one that
     * decides.
     */
    function validateEdit(changes, passwordChange) {
        if (!changes.firstName) return 'First name is required.';
        if (!changes.lastName) return 'Last name is required.';
        if (!changes.userName) return 'Username is required.';
        if (!changes.roles.length) return 'Select at least one role.';

        // Caught here as well as on the server. A mistyped confirmation is the one error
        // that would otherwise leave an account with a password nobody knows.
        if (passwordChange) {
            if (!passwordChange.newPassword) {
                setPasswordFeedback('Enter a new password.', 'error');
                return 'Enter a new password, or cancel the password change.';
            }

            if (passwordChange.newPassword !== passwordChange.confirmPassword) {
                setPasswordFeedback('The two passwords do not match.', 'error');
                return 'The two passwords do not match.';
            }
        }

        // Only blocks on a username Verify actually reported as taken. Not verifying at
        // all is allowed - the API rejects a duplicate either way.
        if (editUserNameCheck.takenUserName && editUserNameCheck.takenUserName === changes.userName) {
            return 'Username \'' + changes.userName + '\' is already taken.';
        }

        return null;
    }

    function setSavingEdit(isSaving) {
        state.isSavingEdit = isSaving;

        var saveButton = byId('btnSaveEditUser');
        if (saveButton) {
            saveButton.disabled = isSaving;
            saveButton.textContent = isSaving ? 'Saving...' : 'Save';
        }
    }

    function showEditError(message) {
        var banner = byId('editUserError');
        if (!banner) return;

        banner.textContent = message;
        banner.style.display = 'block';
    }

    function hideEditError() {
        var banner = byId('editUserError');
        if (banner) banner.style.display = 'none';
    }

    // ---------------------------------------------------------------- helpers

    function showError(message) {
        var banner = byId('addUserError');
        if (!banner) return;

        banner.textContent = message;
        banner.style.display = 'block';
    }

    function hideError() {
        var banner = byId('addUserError');
        if (banner) banner.style.display = 'none';
    }

    function getValue(id) {
        var el = byId(id);
        return el ? el.value.trim() : '';
    }

    /**
     * Holds a username box to lower case while it is being typed in.
     *
     * The API's username rule is lower case only, so a shifted key is corrected on the
     * spot rather than refused later - the box cannot end up holding a name that Save
     * would come back and reject. Pasting goes through the same 'input' event, so it is
     * covered too.
     *
     * Lower-casing never changes the length, so the caret is put back where it was
     * instead of jumping to the end of the box on every capital typed mid-word.
     */
    function forceLowerCase(id) {
        var el = byId(id);
        if (!el) return;

        var lowered = el.value.toLowerCase();
        if (lowered === el.value) return;

        var start = el.selectionStart;
        var end = el.selectionEnd;

        el.value = lowered;

        // Assigning value drops the selection, so it is restored - but only for the box
        // actually being typed in, since setSelectionRange elsewhere would scroll a
        // box the user is not looking at.
        if (document.activeElement === el && start !== null) {
            el.setSelectionRange(start, end);
        }
    }

    /**
     * Value exactly as typed. Only passwords use this: a leading or trailing space is a
     * legitimate password character, and trimming it would store something other than
     * what the admin is about to hand over.
     */
    function rawValue(id) {
        var el = byId(id);
        return el ? el.value : '';
    }

    function setValue(id, value) {
        var el = byId(id);
        if (el) el.value = value;
    }

    function setText(id, value) {
        var el = byId(id);
        if (el) el.textContent = value;
    }

    /** What to title the Edit dialog with, falling back until something is printable. */
    function displayName(user) {
        var full = (user.fullName || '').trim();

        if (!full) {
            full = ((user.firstName || '') + ' ' + (user.lastName || '')).trim();
        }

        return full || user.username || 'Edit User';
    }

    /**
     * The audit timestamps, for reading rather than sorting.
     *
     * The API sends these as server local time with no zone marker, which is how the
     * columns are stored, so they are parsed and shown as-is rather than shifted.
     */
    function formatDateTime(value) {
        if (!value) return '-';

        var date = new Date(value);
        if (isNaN(date.getTime())) return '-';

        return date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    return {
        init: init,
        openAddUserDialog: openAddUserDialog,
        closeAddUserDialog: closeAddUserDialog,
        openEditUserDialog: openEditUserDialog,
        closeEditUserDialog: closeEditUserDialog
    };
})();
