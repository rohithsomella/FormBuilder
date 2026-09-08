/**
 * Profile pages - shared behaviour for userProfile.html and adminProfile.html.
 *
 * The two pages are separate documents on purpose: only one of them is ever open, so
 * there is no hidden section left over from a previous session to leak into the next
 * one. Each page declares which role it is for via data-profile-role on <body>, and
 * this script sends the user to the other page if they do not match.
 *
 * The role always comes from Auth (i.e. from the API's token), never from the URL and
 * never from anything the user can type. It decides which screen to draw and nothing
 * more - the API enforces roles independently.
 */
(function () {
    'use strict';

    /**
     * The account the page is currently showing, and the only thing the Edit Profile
     * dialog opens with. Assigned by render(), so a save that re-renders also updates
     * what a second Edit click will show.
     */
    var currentUser = null;

    /**
     * What the Verify button was last told about the username box, so Save can refuse a
     * name the API has already said is taken instead of spending a round trip on it.
     *
     * Both are cleared the moment the box is edited: a verdict about "jdoe" says nothing
     * about "jdoe2", and a stale tick beside a different name is worse than no tick.
     */
    var userNameCheck = {
        verifiedUserName: null,
        takenUserName: null
    };

    /** Guards against a second submit while one is already in flight. */
    var isSaving = false;

    document.addEventListener('DOMContentLoaded', function () {
        Auth.requireAuth().then(function (user) {
            if (!user) return; // guard is redirecting or reloading

            // Re-check against the API so a refresh reflects the real account rather
            // than whatever happens to be cached in this browser.
            Auth.refreshCurrentUser().then(function (freshUser) {
                var current = freshUser || user;

                if (!routeToCorrectProfile(current)) return;

                render(current);
                wireActions();
                Auth.showPage();
            });
        });
    });

    /**
     * Sends the user to the profile page for their role. Returns false when a redirect
     * is under way, so the caller stops rendering the wrong page.
     */
    function routeToCorrectProfile(user) {
        var pageRole = document.body.getAttribute('data-profile-role'); // "Admin" | "User"
        var isAdminPage = pageRole === 'Admin';

        if (isAdminPage === !!user.isAdmin) return true;

        window.location.replace(user.isAdmin ? 'adminProfile.html' : 'userProfile.html');
        return false;
    }

    function render(user) {
        // The single place currentUser is set. It used to be assigned by a wrapper that
        // reassigned render() at the bottom of this file; that worked on first paint but
        // meant nothing else could re-render, so the dialog went on offering the values
        // the page was loaded with even after a save had changed them.
        currentUser = user;

        setText('profileAvatar', getInitials(user.name));
        setText('fieldName', user.name || user.userName || '-');
        setText('fieldRole', (user.role || 'User').toUpperCase());
        setText('fieldEmail', user.email || '-');
        setText('fieldUserName', user.userName || '-');

        // Admin page only: prove the Admin role really is honoured by the API rather
        // than just displayed by the browser.
        if (document.getElementById('adminApiStatus')) {
            verifyAdminApiAccess();
        }
    }

    /**
     * Calls an endpoint protected by [Authorize(Roles = "Admin")]. A user who edited
     * their local storage to look like an admin gets 403 here, which is the point.
     */
    function verifyAdminApiAccess() {
        var status = document.getElementById('adminApiStatus');
        status.textContent = 'Checking...';
        status.className = 'admin-api-status checking';

        $.ajax({
            url: FormBuilderApiRoot() + '/auth/admin-check',
            type: 'GET',
            dataType: 'json'
        }).done(function () {
            status.textContent = 'Verified by API';
            status.className = 'admin-api-status ok';
        }).fail(function (xhr) {
            status.textContent = xhr.status === 403
                ? 'Denied by API (403)'
                : 'Unavailable (' + xhr.status + ')';
            status.className = 'admin-api-status failed';
        });
    }

    function FormBuilderApiRoot() {
        return (window.FormBuilderApi && FormBuilderApi.config)
            ? FormBuilderApi.config.baseUrl.replace(/\/forms\/?$/, '')
            : 'http://localhost:5155/api';
    }

    function wireActions() {
        // The menu button is not wired here on purpose. It opens the shared dropdown
        // via toggleMenu() in CommonItems.js, exactly like every other page - and that
        // menu already contains a Home link. Attaching a redirect here would swallow
        // the click and send the user straight home instead of showing the menu.
        on('btnSignOut', confirmSignOut);
        on('btnEditProfile', openEditProfileModal);
        on('btnAdminSettings', function () { window.location.href = 'userDetails.html'; });
        // Edit Profile Modal Events
        on('cancelEditProfile', closeEditProfileModal);
        on('btnChangePassword', togglePasswordSection);
        on('btnDeactivateUser', deactivateUser);
        on('verifyUsername', verifyUsername);
        on('toggleEditFirstName', toggleEditFirstName);
        on('toggleEditLastName', toggleEditLastName);
        on('toggleEditUserName', toggleEditUserName);

        // Form submissions
        var editForm = document.getElementById('editProfileForm');
        if (editForm) {
            editForm.addEventListener('submit', function (e) {
                e.preventDefault();
                saveEditProfile();
            });
        }

        // Editing the box after verifying clears the verdict - see userNameCheck.
        var userNameInput = document.getElementById('editUserName');
        if (userNameInput) {
            userNameInput.addEventListener('input', clearUserNameFeedback);
        }

        // The eye on each of the three password boxes. One listener per button, wired
        // once here rather than per open, so the buttons keep working for the life of
        // the page however many times the dialog is opened and closed.
        Array.prototype.forEach.call(
            document.querySelectorAll('#editProfileForm .btn-password-reveal'),
            function (button) {
                button.addEventListener('click', function (e) {
                    e.preventDefault();
                    togglePasswordReveal(button);
                });
            });

        // Close modals when clicking overlay
        var editOverlay = document.getElementById('editProfileOverlay');
        if (editOverlay) {
            editOverlay.addEventListener('click', closeEditProfileModal);
        }
    }

    function openEditProfileModal() {
        var modal = document.getElementById('editProfileModal');
        var overlay = document.getElementById('editProfileOverlay');
        
        if (modal && overlay && currentUser) {
            // The stored columns, not a guess. Splitting the full name on its first space
            // - which is what this did before there was an endpoint to save to - reads
            // "Mary Jane Watson" as first "Mary", last "Jane Watson", and Save now writes
            // back exactly what these boxes hold. The split is kept only as a fallback for
            // a user object cached by an older build, and the /api/auth/me call on page
            // load replaces that within the first second anyway.
            var firstName = currentUser.firstName || (currentUser.name || '').split(' ')[0] || '';
            var lastName = currentUser.lastName
                || (currentUser.name || '').split(' ').slice(1).join(' ') || '';

            document.getElementById('editFirstName').value = firstName;
            document.getElementById('editLastName').value = lastName;
            document.getElementById('editUserName').value = currentUser.userName || '';

            // Nothing left over from the last time this dialog was open.
            hideEditProfileError();
            clearUserNameFeedback();
            setSaving(false);

            // Disable fields by default (read-only mode)
            document.getElementById('editFirstName').disabled = true;
            document.getElementById('editLastName').disabled = true;
            document.getElementById('editUserName').disabled = true;
            
            // Disable verify button by default
            var verifyBtn = document.getElementById('verifyUsername');
            if (verifyBtn) {
                verifyBtn.disabled = true;
            }
            
            // Hide password section by default
            var passwordSection = document.getElementById('passwordSection');
            if (passwordSection) {
                passwordSection.style.display = 'none';
                // Clear password fields
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('confirmPassword').value = '';
            }
            
            // Reset Change Password button text
            var changePasswordBtn = document.getElementById('btnChangePassword');
            if (changePasswordBtn) {
                changePasswordBtn.textContent = 'Change Password';
            }
            
            // Update title with user name
            var title = document.getElementById('editModalTitle');
            if (title) {
                title.textContent = currentUser.name || currentUser.userName || 'User';
            }
            
            modal.classList.add('active');
            overlay.classList.add('active');
        }
    }

    function closeEditProfileModal() {
        var modal = document.getElementById('editProfileModal');
        var overlay = document.getElementById('editProfileOverlay');
        
        if (modal && overlay) {
            modal.classList.remove('active');
            overlay.classList.remove('active');

            // Disable fields when modal is closed
            document.getElementById('editFirstName').disabled = true;
            document.getElementById('editLastName').disabled = true;
            document.getElementById('editUserName').disabled = true;

            // Disable verify button
            var verifyBtn = document.getElementById('verifyUsername');
            if (verifyBtn) {
                verifyBtn.disabled = true;
            }

            // The password boxes do not survive the dialog closing. Leaving them filled
            // would keep two real credentials sitting in the DOM for the rest of the
            // session, readable by anything that can reach the page.
            clearPasswordFields();
            hidePasswordSection();

            hideEditProfileError();
            clearUserNameFeedback();
        }
    }

    /**
     * Whether the panel is open is what tells Save to attempt a password change at all -
     * see saveEditProfile. Closing it is therefore a cancel, and has to discard what was
     * typed rather than just hiding it.
     */
    function togglePasswordSection() {
        if (isPasswordSectionOpen()) {
            hidePasswordSection();
            clearPasswordFields();
            return;
        }

        var passwordSection = document.getElementById('passwordSection');
        var changePasswordBtn = document.getElementById('btnChangePassword');

        if (!passwordSection) return;

        passwordSection.style.display = 'block';

        if (changePasswordBtn) {
            changePasswordBtn.textContent = 'Cancel Password';
        }

        document.getElementById('currentPassword').focus();
    }

    function isPasswordSectionOpen() {
        var passwordSection = document.getElementById('passwordSection');
        return !!passwordSection && passwordSection.style.display !== 'none';
    }

    function hidePasswordSection() {
        var passwordSection = document.getElementById('passwordSection');
        if (passwordSection) {
            passwordSection.style.display = 'none';
        }

        var changePasswordBtn = document.getElementById('btnChangePassword');
        if (changePasswordBtn) {
            changePasswordBtn.textContent = 'Change Password';
        }
    }

    /**
     * Empties the three boxes and re-masks them.
     *
     * Re-masking is not cosmetic. A box left as type="text" would still be readable the
     * next time the panel is opened, so a password typed later would be on screen from
     * the first keystroke without anybody having asked for it.
     */
    function clearPasswordFields() {
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;

            el.value = '';
            el.type = 'password';
        });

        // Put the eyes back to matching the boxes they describe.
        Array.prototype.forEach.call(
            document.querySelectorAll('#editProfileForm .btn-password-reveal'),
            function (button) {
                setRevealButtonState(button, false);
            });
    }

    /** Flips one box between masked and readable, and swaps the eye for a struck eye. */
    function togglePasswordReveal(button) {
        var input = document.getElementById(button.getAttribute('data-reveals'));
        if (!input) return;

        var reveal = input.type === 'password';

        input.type = reveal ? 'text' : 'password';
        setRevealButtonState(button, reveal);
    }

    function setRevealButtonState(button, revealed) {
        var icon = button.querySelector('i');
        if (icon) icon.className = revealed ? 'bi bi-eye-slash' : 'bi bi-eye';

        // The label has to say what the button will DO next, not what the box is now.
        var description = revealed ? 'Hide password' : 'Show password';
        button.setAttribute('aria-label', description);
        button.setAttribute('title', description);
    }

    function toggleEditFirstName() {
        toggleInputEdit('editFirstName');
    }

    function toggleEditLastName() {
        toggleInputEdit('editLastName');
    }

    function toggleEditUserName() {
        toggleInputEdit('editUserName');
    }

    function toggleInputEdit(inputId) {
        var input = document.getElementById(inputId);
        if (input) {
            // Toggle disabled state
            input.disabled = !input.disabled;
            
            // If enabling the field, focus on it
            if (!input.disabled) {
                input.focus();
            }
            
            // Handle verify button for username field
            if (inputId === 'editUserName') {
                var verifyBtn = document.getElementById('verifyUsername');
                if (verifyBtn) {
                    verifyBtn.disabled = input.disabled; // Verify button matches input disabled state
                }
            }
        }
    }

    function confirmSignOut() {
        if (confirm('Are you sure you want to sign out?')) {
            // Clears the token and the cached user, then returns to login.html. Nothing
            // from this session survives into the next one.
            Auth.logout();
        }
    }

    /**
     * The Verify button beside the username box.
     *
     * The API excludes the caller's own account from the clash check - it takes the id
     * from the token - so pressing this without having changed the box answers "this is
     * your current username" rather than reporting your own name back as taken.
     */
    function verifyUsername() {
        var userName = getValue('editUserName');

        if (!userName) {
            setUserNameFeedback('Enter a username to verify.', 'error');
            return;
        }

        setUserNameFeedback('Checking...', 'checking');

        FormBuilderApi.checkOwnUserName(
            userName,
            function (result) {
                if (result.isAvailable) {
                    userNameCheck.verifiedUserName = userName;
                    userNameCheck.takenUserName = null;
                    setUserNameFeedback(result.message, 'ok');
                } else {
                    userNameCheck.verifiedUserName = null;
                    userNameCheck.takenUserName = userName;
                    setUserNameFeedback(result.message, 'error');
                }
            },
            function (error) {
                // A check that could not be made is not a verdict. Both are cleared so
                // Save does not act on a stale one either way.
                userNameCheck.verifiedUserName = null;
                userNameCheck.takenUserName = null;
                setUserNameFeedback(error, 'error');
            }
        );
    }

    /**
     * The dialog's Save button. Can carry two independent changes, and the order they go
     * in is not a preference:
     *
     *   1. the profile fields, then
     *   2. the password, but only if the Change Password panel is open
     *
     * The password MUST go second. Changing it rotates the account's security stamp,
     * which the API compares on every request, so the moment it succeeds this token is
     * refused - a profile save queued behind it would come back 401 and the user would be
     * bounced to the login page having silently lost their name change.
     *
     * The profile call the other way round is harmless: it hands back a replacement token
     * that the password call then uses.
     */
    function saveEditProfile() {
        if (isSaving) return;

        hideEditProfileError();

        var firstName = getValue('editFirstName');
        var lastName = getValue('editLastName');
        var userName = getValue('editUserName');

        var wantsPasswordChange = isPasswordSectionOpen();

        // Read exactly as typed. A leading or trailing space is a legitimate password
        // character, and trimming would send something other than what was entered.
        var currentPassword = wantsPasswordChange ? rawValue('currentPassword') : '';
        var newPassword = wantsPasswordChange ? rawValue('newPassword') : '';
        var confirmPassword = wantsPasswordChange ? rawValue('confirmPassword') : '';

        var validationError = validateProfileFields(firstName, lastName, userName)
            || (wantsPasswordChange
                ? validatePasswordFields(currentPassword, newPassword, confirmPassword)
                : null);

        if (validationError) {
            showEditProfileError(validationError);
            return;
        }

        setSaving(true);

        FormBuilderApi.updateOwnProfile(
            { firstName: firstName, lastName: lastName, userName: userName },
            function (session) {
                // Installed before anything else happens. The reply carries a token minted
                // from the row as it now stands, and the old one names a user who may no
                // longer exist under that name - including for the password call below.
                var updated = Auth.applySession(session);

                render(updated || currentUser);

                if (!wantsPasswordChange) {
                    setSaving(false);
                    closeEditProfileModal();
                    return;
                }

                changeUserPassword(currentPassword, newPassword, confirmPassword);
            },
            function (error) {
                setSaving(false);
                showEditProfileError(error);
            }
        );
    }

    /**
     * Second half of a save that included a password change.
     *
     * Success ends the session on purpose and there is no way around it: the API rotates
     * the account's security stamp, so every token issued for this account - this one
     * included - stops being accepted. Signing back in with the new password is the
     * point of having changed it.
     */
    function changeUserPassword(currentPassword, newPassword, confirmPassword) {
        FormBuilderApi.changeOwnPassword(
            {
                currentPassword: currentPassword,
                newPassword: newPassword,
                confirmPassword: confirmPassword
            },
            function () {
                // Clear the boxes before navigating rather than trusting the page to go
                // away, and say why on the login screen so this does not look like a
                // session that expired on its own.
                clearPasswordFields();

                Auth.logout({
                    notice: 'Your password was changed. Please sign in with your new password.'
                });
            },
            function (error) {
                setSaving(false);

                // The profile half already succeeded and cannot be unwound here. Saying so
                // is the difference between the user retyping their password and the user
                // retyping their name as well.
                showEditProfileError(
                    'Your name and username were saved, but the password was not changed. ' + error);
            }
        );
    }

    /**
     * Suspends the signed-in user's own account.
     *
     * One-way from here: the API refuses a login for an inactive account, so only an
     * administrator can undo it - hence the wording on the confirm. An admin cannot do
     * this to themselves at all and the API answers 400, which lands in the error banner.
     */
    function deactivateUser() {
        if (isSaving) return;

        hideEditProfileError();

        var confirmed = confirm(
            'Deactivate your account?\n\n' +
            'You will be signed out immediately and will not be able to sign in again. ' +
            'Only an administrator can reactivate your account.');

        if (!confirmed) return;

        setSaving(true);

        FormBuilderApi.deactivateOwnAccount(
            function () {
                Auth.logout({
                    notice: 'Your account has been deactivated. ' +
                            'Contact an administrator if you need it reactivated.'
                });
            },
            function (error) {
                setSaving(false);
                showEditProfileError(error);
            }
        );
    }

    // ---------------------------------------------------------------- validation

    /**
     * The checks worth making before spending a round trip. The API validates all of this
     * again and is the authority - these exist so an empty box does not need one.
     */
    function validateProfileFields(firstName, lastName, userName) {
        if (!firstName) return 'Enter your first name.';
        if (!lastName) return 'Enter your last name.';
        if (!userName) return 'Enter your username.';

        // Only blocks on a name Verify actually reported as taken. Not having verified at
        // all is fine - the API checks again on save, and that is the check that counts.
        if (userNameCheck.takenUserName &&
            userNameCheck.takenUserName.toLowerCase() === userName.toLowerCase()) {
            return 'That username is already taken. Choose a different one.';
        }

        return null;
    }

    /**
     * Deliberately does not check the password's length or composition. Those rules are
     * Identity's, configured on the API, and it answers with every rule a password missed
     * in one go - a copy of them here would be a second set of rules to keep in step, and
     * the moment the two disagreed this one would be refusing passwords the server would
     * have accepted.
     */
    function validatePasswordFields(currentPassword, newPassword, confirmPassword) {
        if (!currentPassword) return 'Enter your current password.';
        if (!newPassword) return 'Enter a new password.';
        if (!confirmPassword) return 'Re-enter your new password to confirm it.';

        if (newPassword !== confirmPassword) {
            return 'The new password and the confirmation do not match.';
        }

        if (newPassword === currentPassword) {
            return 'Your new password must be different from your current password.';
        }

        return null;
    }

    // ---------------------------------------------------------------- dialog feedback

    function setSaving(busy) {
        isSaving = busy;

        var saveBtn = document.querySelector('#editProfileForm .btn-save');
        if (saveBtn) {
            saveBtn.disabled = busy;
            saveBtn.textContent = busy ? 'Saving...' : 'Save';
        }
    }

    function showEditProfileError(message) {
        var banner = document.getElementById('editProfileError');
        if (!banner) return;

        banner.textContent = message;
        banner.style.display = 'block';
    }

    function hideEditProfileError() {
        var banner = document.getElementById('editProfileError');
        if (banner) banner.style.display = 'none';
    }

    function setUserNameFeedback(message, kind) {
        var feedback = document.getElementById('editProfileUserNameFeedback');
        if (!feedback) return;

        feedback.textContent = message || '';
        feedback.className = 'username-feedback' + (kind ? ' ' + kind : '');
    }

    function clearUserNameFeedback() {
        userNameCheck.verifiedUserName = null;
        userNameCheck.takenUserName = null;
        setUserNameFeedback('', null);
    }

    function getValue(id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    /** Value exactly as typed. Only the password boxes use this - see saveEditProfile. */
    function rawValue(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }


    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function on(id, handler) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    }

    function getInitials(name) {
        if (!name) return 'U';
        return name.trim().split(/\s+/).slice(0, 2).map(function (n) { return n[0]; })
            .join('').toUpperCase();
    }

})();
