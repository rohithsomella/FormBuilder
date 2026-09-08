/**
 * FormBuilder - Authentication
 * ============================
 *
 * The single place the frontend deals with authentication. Nothing else should read
 * the token, decide whether a user is signed in, or work out whether they are an admin.
 *
 *   Auth.login(identifier, password)  ->  Promise, resolves with the current user
 *   Auth.logout()                     ->  clears the session and returns to login.html
 *   Auth.getToken()                   ->  raw JWT, or null
 *   Auth.getCurrentUser()             ->  cached user object, or null
 *   Auth.isAuthenticated()            ->  boolean
 *   Auth.isAdmin()                    ->  boolean
 *   Auth.requireAuth()                ->  page guard; call once per protected page
 *   Auth.refreshCurrentUser()         ->  re-reads the user from GET /api/auth/me
 *   Auth.applySession(session)        ->  installs a token+user handed back by the API
 *   Auth.consumeSignOutNotice()       ->  reads and clears the "why you were signed out"
 *
 * Two things this file is NOT:
 *
 *  - It is not security. The role check here decides which UI to draw, nothing more.
 *    Every real decision is made by the API from the signed token it validates itself.
 *  - It does not contain a token. In development the browser asks the API for one
 *    (see resolveSession below); no credential or token is written into this file.
 *
 * This script has no dependencies and can safely be loaded before jQuery.
 */

var Auth = (function () {
    'use strict';

    // fb_currentUser is the key the pre-existing pages already read, so anything not yet
    // migrated to Auth.getCurrentUser() keeps working.
    var KEYS = {
        token: 'fb_token',
        expiresAt: 'fb_tokenExpiresAt',
        user: 'fb_currentUser'
    };

    var DEFAULT_API_ROOT = 'http://localhost:5155/api';

    // ---------------------------------------------------------------- endpoints

    /**
     * Derived from FormBuilderApi's own configuration when that file is loaded, so the
     * API host is defined in one place. homePage.html and login.html do not load it,
     * hence the fallback.
     */
    function apiRoot() {
        if (window.FormBuilderApi && FormBuilderApi.config && FormBuilderApi.config.baseUrl) {
            return FormBuilderApi.config.baseUrl.replace(/\/forms\/?$/, '');
        }
        return DEFAULT_API_ROOT;
    }

    function authUrl(path) {
        return apiRoot() + '/auth' + path;
    }

    function apiOrigin() {
        var a = document.createElement('a');
        a.href = apiRoot();
        return a.protocol + '//' + a.host;
    }

    // ---------------------------------------------------------------- paths

    /** Relative prefix that gets back to the FormBuilderJs root from the current page. */
    function pathToRoot() {
        var path = window.location.pathname;
        if (path.indexOf('/app/html/') !== -1) return '../../';
        if (path.indexOf('/app/') !== -1) return '../';
        return '';
    }

    function loginUrl() { return pathToRoot() + 'app/html/login.html'; }
    function homeUrl() { return pathToRoot() + 'homePage.html'; }

    function isLoginPage() {
        return /login\.html$/i.test(window.location.pathname);
    }

    // ---------------------------------------------------------------- session state

    function getToken() {
        return localStorage.getItem(KEYS.token);
    }

    function getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem(KEYS.user) || 'null');
        } catch (e) {
            return null;
        }
    }

    /**
     * A locally-expired token is treated as no token at all. This is a convenience check
     * to avoid pointless requests - the API validates lifetime itself and is the only
     * thing that matters.
     */
    function isAuthenticated() {
        if (!getToken()) return false;

        var expiresAt = localStorage.getItem(KEYS.expiresAt);
        if (!expiresAt) return true;

        return new Date(expiresAt).getTime() > Date.now();
    }

    function isAdmin() {
        var user = getCurrentUser();
        return !!(user && user.isAdmin);
    }

    /**
     * Normalises the API's user block into what the UI stores. `name` and `role` are
     * compatibility aliases for pages written before this file existed.
     */
    function toStoredUser(user) {
        var roles = user.roles || [];
        var admin = !!user.isAdmin;

        return {
            userId: user.userId,
            userName: user.userName,
            email: user.email,
            fullName: user.fullName,

            // Carried separately as well as inside fullName, because the Edit Profile
            // dialog has a box for each. Splitting fullName on the first space instead
            // guesses wrong for a two-word first name, and the dialog saves what it shows.
            firstName: user.firstName || '',
            lastName: user.lastName || '',

            roles: roles,
            isAdmin: admin,

            name: user.fullName || user.userName,
            role: admin ? 'Admin' : (roles[0] || 'User')
        };
    }

    function storeSession(loginResponse) {
        localStorage.setItem(KEYS.token, loginResponse.token);
        localStorage.setItem(KEYS.expiresAt, loginResponse.expiresAtUtc);
        localStorage.setItem(KEYS.user, JSON.stringify(toStoredUser(loginResponse.user)));
    }

    /**
     * Installs a session that came back from something other than login.
     *
     * PUT /api/auth/profile returns one: a token minted from the row as it now stands,
     * because renaming yourself leaves the name claim in your old token stale and that
     * claim is what the API stamps its audit columns from. Swapping it in here is what
     * lets a user rename themselves without being signed out by their own edit.
     *
     * Refuses anything that is not a complete session rather than half-applying one -
     * writing a user without its matching token would leave the page showing a profile
     * the token no longer describes.
     *
     * @param {Object} session - { token, expiresAtUtc, user }
     * @returns {Object|null} the stored user, or the existing one if nothing was applied
     */
    function applySession(session) {
        if (!session || !session.token || !session.user) return getCurrentUser();

        storeSession(session);
        return getCurrentUser();
    }

    /**
     * Wipes every trace of the session. Called on sign-out and whenever the API rejects
     * our token, so a stale profile can never survive into the next login.
     */
    function clearSession() {
        localStorage.removeItem(KEYS.token);
        localStorage.removeItem(KEYS.expiresAt);
        localStorage.removeItem(KEYS.user);
    }

    // ---------------------------------------------------------------- API calls

    function postJson(url, body) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
    }

    /**
     * Signs in with a username OR an email - the API decides which it is. Rejects with a
     * single generic message for every failure, matching what the API returns.
     */
    function login(loginIdentifier, password) {
        return postJson(authUrl('/login'), {
            loginIdentifier: loginIdentifier,
            password: password
        }).then(function (response) {
            if (!response.ok) {
                return response.json()
                    .catch(function () { return {}; })
                    .then(function (body) {
                        throw new Error(body.message || 'Invalid username or password.');
                    });
            }
            return response.json();
        }).then(function (data) {
            storeSession(data);
            return getCurrentUser();
        });
    }

    /**
     * Why the user is looking at the login page when they did not ask to sign out.
     *
     * sessionStorage, not localStorage, for two reasons: clearSession() wipes the
     * localStorage keys and would take this with it, and a notice is about this tab's
     * journey to the login page - it has no business appearing in another tab.
     */
    var NOTICE_KEY = 'fb_signOutNotice';

    /** Reads the pending notice and clears it, so a refresh does not show it twice. */
    function consumeSignOutNotice() {
        try {
            var notice = sessionStorage.getItem(NOTICE_KEY);
            sessionStorage.removeItem(NOTICE_KEY);
            return notice;
        } catch (e) {
            return null; // private mode
        }
    }

    /**
     * Signs out. The API call is best-effort - with stateless tokens the session ends
     * when the client forgets the token - but clearing local state is not optional.
     *
     * @param {Object} [options]
     * @param {boolean} [options.redirect] - false to stay on the current page
     * @param {string}  [options.notice] - shown on the login page. For sign-outs the user
     *        did not ask for: changing your own password invalidates every token for the
     *        account, so the page they land on should say why rather than looking like a
     *        session that expired on its own.
     */
    function logout(options) {
        var redirect = !options || options.redirect !== false;
        var token = getToken();

        if (options && options.notice) {
            try {
                sessionStorage.setItem(NOTICE_KEY, options.notice);
            } catch (e) { /* private mode - the redirect still happens */ }
        }

        var done = function () {
            // clearSession() removes the token from localStorage, which is shared by
            // every tab of this origin. Signing out therefore ends the session
            // everywhere, not just in the tab the button was clicked in.
            clearSession();

            if (redirect) {
                window.location.href = loginUrl();
            }
        };

        if (!token) {
            done();
            return Promise.resolve();
        }

        return fetch(authUrl('/logout'), {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
        }).catch(function () {
            // An unreachable API must not trap the user in a signed-in state.
        }).then(done);
    }

    /** Re-reads the user from the API. This, not localStorage, is the authority. */
    function refreshCurrentUser() {
        var token = getToken();
        if (!token) return Promise.resolve(null);

        return fetch(authUrl('/me'), {
            headers: { 'Authorization': 'Bearer ' + token }
        }).then(function (response) {
            if (!response.ok) {
                clearSession();
                return null;
            }
            return response.json();
        }).then(function (user) {
            if (!user) return null;

            localStorage.setItem(KEYS.user, JSON.stringify(toStoredUser(user)));
            return getCurrentUser();
        }).catch(function () {
            // Offline API: keep the cached user rather than bouncing the user out.
            return getCurrentUser();
        });
    }

    // ---------------------------------------------------------------- page guard

    /**
     * Protects a page. One rule, no exceptions, in every environment:
     *
     *     no valid token  ->  login.html
     *
     * There is no development shortcut and no mode switch. An earlier version let the
     * guard silently fetch a token from a development-only endpoint, which meant a
     * signed-out user who opened any protected URL in a NEW TAB was handed a fresh Admin
     * token and let straight in. Signing in with a username and password is now the only
     * way to obtain a session.
     *
     * This runs synchronously - no config lookup, no network call - so when it is
     * reached from <head> the redirect happens before the body is parsed and no
     * protected content is ever rendered.
     */
    function requireAuth() {
        if (isLoginPage()) return Promise.resolve(getCurrentUser());

        if (isAuthenticated()) {
            return Promise.resolve(getCurrentUser());
        }

        // Covers every failing case identically: no token, expired token, tampered
        // token, and a user who has signed out in this or any other tab.
        clearSession();
        hidePage();
        goToLogin();

        return Promise.resolve(null);
    }

    function goToLogin() {
        // Come back to this page once signed in.
        try {
            sessionStorage.setItem('fb_returnTo', window.location.href);
        } catch (e) { /* private mode */ }

        window.location.replace(loginUrl());
    }

    function consumeReturnUrl() {
        var target = sessionStorage.getItem('fb_returnTo');
        sessionStorage.removeItem('fb_returnTo');

        // Never bounce back to the login page itself.
        if (target && !/login\.html/i.test(target)) return target;
        return homeUrl();
    }

    function hidePage() {
        var style = document.createElement('style');
        style.id = 'fb-auth-guard';
        style.textContent = 'html{visibility:hidden!important}';
        (document.head || document.documentElement).appendChild(style);

        // Safety net: never leave the page permanently blank if something goes wrong.
        setTimeout(showPage, 5000);
    }

    function showPage() {
        var style = document.getElementById('fb-auth-guard');
        if (style && style.parentNode) style.parentNode.removeChild(style);
    }

    // ---------------------------------------------------------------- request wiring

    /**
     * Attaches the token to every jQuery request aimed at our API. Doing it here means
     * FormBuilderApi.js needs no changes at all, and no page can forget the header.
     */
    function installJQueryHooks() {
        if (!window.jQuery) return false;

        var $ = window.jQuery;

        $.ajaxPrefilter(function (options) {
            if (!isOurApi(options.url)) return;

            var token = getToken();
            if (!token) return;

            options.headers = options.headers || {};
            options.headers.Authorization = 'Bearer ' + token;
        });

        $(document).ajaxError(function (event, xhr, settings) {
            if (xhr.status === 401) handleUnauthorized(settings && settings.url);
        });

        return true;
    }

    /**
     * Same treatment for native fetch, which main.js uses in one place. Only requests to
     * our own API origin are touched, so no token is ever sent to a CDN.
     */
    function installFetchHook() {
        if (!window.fetch || window.fetch.__fbAuthWrapped) return;

        var nativeFetch = window.fetch.bind(window);

        var wrapped = function (input, init) {
            var url = (typeof input === 'string') ? input : (input && input.url);

            if (isOurApi(url) && getToken()) {
                init = init || {};

                var headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
                if (!headers.has('Authorization')) {
                    headers.set('Authorization', 'Bearer ' + getToken());
                }
                init.headers = headers;
            }

            return nativeFetch(input, init).then(function (response) {
                if (response.status === 401 && isOurApi(url)) handleUnauthorized(url);
                return response;
            });
        };

        wrapped.__fbAuthWrapped = true;
        window.fetch = wrapped;
    }

    function isOurApi(url) {
        if (!url) return false;

        var a = document.createElement('a');
        a.href = url; // resolves relative URLs against the current page
        return (a.protocol + '//' + a.host) === apiOrigin();
    }

    /**
     * The API rejected our token: it expired, was tampered with, or the account is gone.
     * A rejected login attempt is not this - that is the login form's own business.
     */
    function handleUnauthorized(url) {
        if (url && /\/auth\/login/i.test(url)) return;

        clearSession();

        if (!isLoginPage()) {
            goToLogin();
        }
    }

    // ---------------------------------------------------------------- heartbeat

    /**
     * How often an open page checks that its session is still good.
     *
     * The API now refuses a token whose account has been deactivated, deleted, or had
     * its password changed - but only when that token is actually presented. A page
     * nobody is touching presents nothing, so without this a suspended user could sit on
     * an open screen indefinitely and only discover it on their next click.
     */
    var HEARTBEAT_MS = 30000;

    var heartbeatTimer = null;

    /**
     * One beat. GET /api/auth/me goes through the wrapped fetch, so a 401 is handled by
     * handleUnauthorized on the way back - session cleared, redirected to login - and
     * nothing here has to deal with the response at all.
     */
    function heartbeat() {
        // A background tab has nobody looking at it, and waking every tab on a timer is
        // how a quiet page turns into steady API traffic.
        if (document.hidden) return;

        if (isLoginPage() || !isAuthenticated()) return;

        refreshCurrentUser();
    }

    function startHeartbeat() {
        if (heartbeatTimer || isLoginPage()) return;

        heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);

        // Returning to a tab is exactly when its session is most likely to be stale - a
        // laptop that slept through the change would otherwise wait out the interval.
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) heartbeat();
        });
    }

    // ---------------------------------------------------------------- bootstrap

    installFetchHook();

    if (!installJQueryHooks()) {
        // jQuery is loaded after this file on some pages.
        document.addEventListener('DOMContentLoaded', installJQueryHooks);
    }

    /*
     * THE GUARD RUNS HERE, AUTOMATICALLY.
     *
     * Including this file is what protects a page - nothing else has to be remembered.
     * Previously the guard only ran if some page script happened to call requireAuth(),
     * which came via CommonItems.js on most pages. previewPage.html loads neither
     * CommonItems.js nor a script that guards, so it had auth.js loaded and was still
     * completely unprotected. Making protection a property of the include removes that
     * whole category of mistake.
     *
     * Because this executes while <head> is being parsed, an unauthenticated visitor is
     * redirected before the body exists.
     *
     * A page that must stay public opts out explicitly:
     *     <script src="../js/auth.js" data-no-guard></script>
     * login.html does not need it - isLoginPage() already exempts it.
     */
    (function autoGuard() {
        var self = document.currentScript;
        if (self && self.hasAttribute('data-no-guard')) return;

        requireAuth();

        // Only a guarded page polls. A public one has no session to lose, and login.html
        // is exempted inside startHeartbeat.
        startHeartbeat();
    })();

    return {
        login: login,
        logout: logout,
        getToken: getToken,
        getCurrentUser: getCurrentUser,
        refreshCurrentUser: refreshCurrentUser,
        applySession: applySession,
        consumeSignOutNotice: consumeSignOutNotice,
        isAuthenticated: isAuthenticated,
        isAdmin: isAdmin,
        requireAuth: requireAuth,
        clearSession: clearSession,
        consumeReturnUrl: consumeReturnUrl,
        loginUrl: loginUrl,
        homeUrl: homeUrl,
        showPage: showPage
    };
})();
