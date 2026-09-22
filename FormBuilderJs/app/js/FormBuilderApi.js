/**
 * FormBuilder API - jQuery AJAX Integration
 * This module handles all communication with the FormBuilder API backend
 * Base URL: https://localhost:7286/api/forms
 */

var FormBuilderApi = (function() {
    'use strict';

    // Configuration
    var config = {
        baseUrl: 'http://localhost:5155/api/forms',
        tenantBaseUrl: 'http://localhost:5155/api/tenant',
        userBaseUrl: 'http://localhost:5155/api/users',

        // Self-service profile endpoints. A different controller to userBaseUrl on
        // purpose: /api/users is Admin-only and every route on it names the user being
        // acted on, while these take the account from the token and can only ever touch
        // the caller's own row.
        authBaseUrl: 'http://localhost:5155/api/auth',

        contentType: 'application/json'
    };

    function clearPreviewSessionStorage() {
        sessionStorage.removeItem('submissionData');
        sessionStorage.removeItem('previewFormId');
        sessionStorage.removeItem('previewFormSchema');
        console.log('✅ Cleared preview session storage keys');
    }


    //  get tenants
    function getTenants(onSuccess, onError) {
        console.log('Fetching tenants from:', config.tenantBaseUrl);
        $.ajax({
            url: config.tenantBaseUrl,
            type: 'GET',
            contentType: config.contentType,
            dataType: 'json',
            success: function (response) {
                console.log('Tenants retrieved successfully:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function (xhr, status, error) {
                console.error('Error retrieving tenants:', error);
                console.error('Status Code:', xhr.status);
                console.error('Response:', xhr.responseText);

                var errorMessage = 'Error retrieving tenants';

                if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server at ' + config.tenantBaseUrl + '. Make sure the backend is running.';
                } else if (xhr.status === 404) {
                    errorMessage = 'API endpoint not found. Check the URL: ' + config.tenantBaseUrl;
                } else if (xhr.status === 500) {
                    errorMessage = 'Server error: ' + (xhr.responseJSON ? xhr.responseJSON.message : 'Internal server error');
                } else if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    // update tenant

    function updateTenant(tenantData, onSuccess, onError) {

        if (!tenantData || !tenantData.tenantId) {

            console.error('Tenant data with tenantId is required');

            if (onError) {
                onError('Tenant data with tenantId is required', 400);
            }

            return;
        }

        var payload = {

            tenantId: tenantData.tenantId,

            tenantName: tenantData.tenantName || ''

        };

        $.ajax({

            url: config.tenantBaseUrl + '/' + tenantData.tenantId,

            type: 'PUT',

            contentType: config.contentType,
            dataType: 'json',

            data: JSON.stringify(payload),

            success: function (response) {

                console.log('Tenant updated successfully:', response);

                if (onSuccess) {
                    onSuccess(response);
                }
            },

            error: function (xhr) {

                console.error('Error updating tenant');

                var errorMessage = xhr.responseJSON?.message || xhr.responseText || 'Error updating tenant';
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    // Open tenant

   function getFormsByTenantId(tenantId, onSuccess, onError) {

    $.ajax({
        url: config.baseUrl + "/" + tenantId + "/tenantForms",
        type: "GET",
        contentType: config.contentType,
        dataType: "json",

        success: function (response) {
            if (onSuccess) {
                onSuccess(response);
            }
        },

        error: function (xhr) {

            if (onError) {
                onError(xhr.responseText);
            }
        }
    });
}
    // save tenant
    function saveTenant(tenantData, onSuccess, onError) {

        if (!tenantData) {
            console.error('Tenant data is required');
            if (onError) {
                onError('Tenant data is required', 400);
            }
            return;
        }

        var payload = {
            tenantName: tenantData.tenantName || ''
        };

        $.ajax({
            url: config.tenantBaseUrl,
            type: 'POST',
            contentType: config.contentType,
            dataType: 'json',
            data: JSON.stringify(payload),

            success: function (response) {
                console.log('Tenant saved successfully:', response);

                if (onSuccess) {
                    onSuccess(response);
                }
            },

            error: function (xhr) {

                console.error('Error saving tenant');

                var errorMessage = 'Error saving tenant';

                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }
    // delete form
    function deleteTenant(tenantId, onSuccess, onError) {
        if (!tenantId) {
            console.error('Tenant ID is required for deletion');
            if (onError) onError('Tenant ID is required', 400);
            return;
        }

        $.ajax({
            url: config.tenantBaseUrl + '/' + tenantId,
            type: 'DELETE',
            contentType: config.contentType,
            dataType: 'json',
            success: function (response) {
                console.log('Tenant deleted successfully from database:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function (xhr) {
                console.error('Error deleting tenant on server');
                var errorMessage = 'Error deleting tenant';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }


    // ------------------------------------------------------------------ users
    //
    // Every endpoint below is [Authorize(Roles = "Admin")] on the API. The bearer token
    // is attached by the $.ajaxPrefilter in auth.js, so nothing here handles it - and a
    // non-admin gets a 403 from the server no matter what the page let them click.

    /**
     * Get every user account for the User Details table
     * @param {Function} onSuccess - Callback function on success
     * @param {Function} onError - Callback function on error
     */
    function getUsers(onSuccess, onError) {
        console.log('Fetching users from:', config.userBaseUrl);

        $.ajax({
            url: config.userBaseUrl,
            type: 'GET',
            contentType: config.contentType,
            dataType: 'json',
            success: function (response) {
                console.log('Users retrieved successfully:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function (xhr, status, error) {
                console.error('Error retrieving users:', error);

                var errorMessage = 'Error retrieving users';

                if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server at ' + config.userBaseUrl + '. Make sure the backend is running.';
                } else if (xhr.status === 403) {
                    errorMessage = 'You do not have permission to view users.';
                } else if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Get the roles an admin may assign when creating a user
     * @param {Function} onSuccess - Callback function on success
     * @param {Function} onError - Callback function on error
     */
    function getAssignableRoles(onSuccess, onError) {
        $.ajax({
            url: config.userBaseUrl + '/roles',
            type: 'GET',
            contentType: config.contentType,
            dataType: 'json',
            success: function (response) {
                console.log('Assignable roles retrieved successfully:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function (xhr) {
                console.error('Error retrieving roles');

                var errorMessage = 'Error retrieving roles';

                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Check whether a username is free - backs the "Verify" button in the Add User dialog
     * @param {string} userName - The username to check
     * @param {Function} onSuccess - Callback receiving { userName, isAvailable, message }
     * @param {Function} onError - Callback function on error
     * @param {string} [excludeUserId] - Account to ignore when looking for a clash. The
     *        Edit dialog passes the user being edited, so leaving their username alone
     *        and pressing Verify does not report their own name back as taken.
     */
    function checkUserName(userName, onSuccess, onError, excludeUserId) {
        if (!userName) {
            console.error('Username is required for verification');
            if (onError) {
                onError('Username is required', 400);
            }
            return;
        }

        var url = config.userBaseUrl + '/username-availability?userName=' + encodeURIComponent(userName);

        if (excludeUserId) {
            url += '&excludeUserId=' + encodeURIComponent(excludeUserId);
        }

        $.ajax({
            url: url,
            type: 'GET',
            contentType: config.contentType,
            dataType: 'json',
            success: function (response) {
                console.log('Username availability:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function (xhr) {
                console.error('Error checking username availability');

                var errorMessage = 'Error checking username';

                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Create a user account
     *
     * The response carries a one-time temporaryPassword. It is generated by the API and
     * stored only as a hash, so this response is the only chance to read it - the caller
     * must show it to the admin before the dialog closes.
     *
     * @param {Object} userData - { firstName, lastName, userName, email, roles: [] }
     * @param {Function} onSuccess - Callback receiving { user, temporaryPassword }
     * @param {Function} onError - Callback function on error
     */
    function createUser(userData, onSuccess, onError) {
        if (!userData) {
            console.error('User data is required');
            if (onError) {
                onError('User data is required', 400);
            }
            return;
        }

        var payload = {
            firstName: userData.firstName || '',
            lastName: userData.lastName || '',
            userName: userData.userName || '',
            email: userData.email || '',
            roles: userData.roles || []
        };

        $.ajax({
            url: config.userBaseUrl,
            type: 'POST',
            contentType: config.contentType,
            dataType: 'json',
            data: JSON.stringify(payload),
            success: function (response) {
                console.log('User created successfully:', response && response.user);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function (xhr) {
                console.error('Error creating user');

                var errorMessage = 'Error creating user';

                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 403) {
                    errorMessage = 'You do not have permission to create users.';
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Save the Edit User dialog back to an existing account.
     *
     * Only the fields that dialog can change are sent. The audit columns are not among
     * them - Updated and UpdatedBy are stamped by the API from the caller's token, and
     * Created/CreatedBy are history it will not let anybody rewrite.
     *
     * @param {string} userId - The account's id (AspNetUsers.Id)
     * @param {Object} userData - { firstName, lastName, userName, roles: [], isActive }
     * @param {Function} onSuccess - Callback receiving the updated user
     * @param {Function} onError - Callback function on error
     */
    function updateUser(userId, userData, onSuccess, onError) {
        if (!userId || !userData) {
            console.error('User id and data are required');
            if (onError) {
                onError('User id and data are required', 400);
            }
            return;
        }

        var payload = {
            firstName: userData.firstName || '',
            lastName: userData.lastName || '',
            userName: userData.userName || '',
            roles: userData.roles || [],
            isActive: !!userData.isActive
        };

        $.ajax({
            url: config.userBaseUrl + '/' + encodeURIComponent(userId),
            type: 'PUT',
            contentType: config.contentType,
            dataType: 'json',
            data: JSON.stringify(payload),
            success: function (response) {
                console.log('User updated successfully:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function (xhr) {
                console.error('Error updating user');

                var errorMessage = 'Error updating user';

                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    // See the note in setUserPassword: the API's own "no such user" 404
                    // carries a message, so a bodyless one is a missing route.
                    errorMessage = 'The update endpoint was not found (404). If the API was updated recently, restart it.';
                } else if (xhr.status === 403) {
                    errorMessage = 'You do not have permission to edit users.';
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Set a new password on an account, from the Edit dialog's Change Password panel.
     *
     * The API hashes it and answers 204 with no body - the password is never stored in
     * plain form and never echoed back. Nothing here logs the value, and it must not be
     * added to any console call: this is the one payload on this page that would be a
     * real credential sitting in a browser console.
     *
     * @param {string} userId - The account's id (AspNetUsers.Id)
     * @param {Object} passwords - { newPassword, confirmPassword }
     * @param {Function} onSuccess - Callback function on success (no body is returned)
     * @param {Function} onError - Callback function on error
     */
    function setUserPassword(userId, passwords, onSuccess, onError) {
        if (!userId || !passwords) {
            console.error('User id and password are required');
            if (onError) {
                onError('User id and password are required', 400);
            }
            return;
        }

        var payload = {
            newPassword: passwords.newPassword || '',
            confirmPassword: passwords.confirmPassword || ''
        };

        $.ajax({
            url: config.userBaseUrl + '/' + encodeURIComponent(userId) + '/password',
            type: 'PUT',
            contentType: config.contentType,
            data: JSON.stringify(payload),

            // No dataType, for the same reason as deleteUser: 204 has an empty body and
            // asking jQuery to parse it as JSON turns success into a parsererror.
            success: function () {
                console.log('Password updated for user:', userId);
                if (onSuccess) {
                    onSuccess();
                }
            },
            error: function (xhr) {
                console.error('Error setting password');

                var errorMessage = 'Error setting password';

                // errors carries every policy rule the password missed. Joined so the
                // admin fixes all of them at once instead of one attempt at a time.
                if (xhr.responseJSON && xhr.responseJSON.errors && xhr.responseJSON.errors.length) {
                    errorMessage = xhr.responseJSON.errors.join(' ');
                } else if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    // A 404 here means one of two very different things, and the body is
                    // what separates them. "No such user" comes back with a message and
                    // was handled above; a 404 with no body at all is an unmatched route,
                    // which is what an API still running an older build looks like.
                    errorMessage = 'The password endpoint was not found (404). If the API was updated recently, restart it.';
                } else if (xhr.status === 403) {
                    errorMessage = 'You do not have permission to change passwords.';
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Soft-delete a user account.
     *
     * The API updates the row with IsDeleted = 1 rather than removing it, so anything
     * that already points at this user keeps resolving. The account simply stops being
     * listed - so the caller should reload the table rather than patch it locally.
     *
     * @param {string} userId - The account's id (AspNetUsers.Id)
     * @param {Function} onSuccess - Callback function on success (no body is returned)
     * @param {Function} onError - Callback function on error
     */
    function deleteUser(userId, onSuccess, onError) {
        if (!userId) {
            console.error('User id is required');
            if (onError) {
                onError('User id is required', 400);
            }
            return;
        }

        $.ajax({
            url: config.userBaseUrl + '/' + encodeURIComponent(userId),
            type: 'DELETE',

            // No dataType: the API answers 204 with an empty body, and asking jQuery to
            // parse that as JSON turns a successful delete into a parsererror.
            success: function () {
                console.log('User deleted successfully:', userId);
                if (onSuccess) {
                    onSuccess();
                }
            },
            error: function (xhr) {
                console.error('Error deleting user');

                var errorMessage = 'Error deleting user';

                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    // See the note in setUserPassword: the API's own "no such user" 404
                    // carries a message, so a bodyless one is a missing route.
                    errorMessage = 'The delete endpoint was not found (404). If the API was updated recently, restart it.';
                } else if (xhr.status === 403) {
                    errorMessage = 'You do not have permission to delete users.';
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    // ---------------------------------------------------------------- own profile
    //
    // The Edit Profile dialog on userProfile.html and adminProfile.html. These four are
    // [Authorize] only - any signed-in user may call them - because none of them accept
    // a user id: the account comes from the token, so a request cannot be aimed at
    // somebody else's row. Do not add an id parameter to any of them.

    /**
     * Check whether a username is free - backs the "Verify" button in the Edit Profile
     * dialog.
     *
     * The caller's own account is excluded server-side, so pressing Verify without
     * having changed the box answers "this is your current username" rather than
     * reporting the name back as taken. There is deliberately no excludeUserId argument
     * here, unlike checkUserName above: the API takes it from the token.
     *
     * @param {string} userName - The username to check
     * @param {Function} onSuccess - Callback receiving { userName, isAvailable, message }
     * @param {Function} onError - Callback function on error
     */
    function checkOwnUserName(userName, onSuccess, onError) {
        if (!userName) {
            console.error('Username is required for verification');
            if (onError) {
                onError('Username is required', 400);
            }
            return;
        }

        $.ajax({
            url: config.authBaseUrl + '/username-availability?userName=' + encodeURIComponent(userName),
            type: 'GET',
            contentType: config.contentType,
            dataType: 'json',
            success: function (response) {
                console.log('Username availability:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function (xhr) {
                console.error('Error checking username availability');

                var errorMessage = 'Error checking username';

                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    errorMessage = 'The username check endpoint was not found (404). If the API was updated recently, restart it.';
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Save the signed-in user's own first name, last name and username.
     *
     * The response is a full login payload - { token, expiresAtUtc, user } - not just the
     * updated user. Renaming yourself leaves the name claim in your token stale, and that
     * claim is what the API stamps its audit columns from, so it hands back a token
     * minted from the row as it now stands. The caller MUST install it with
     * Auth.applySession(), or every later request spends the session signing edits under
     * a username that no longer exists.
     *
     * Roles and isActive are not sent and would not be accepted - a user cannot grant
     * themselves a role or re-enable their own account through this.
     *
     * @param {Object} profileData - { firstName, lastName, userName }
     * @param {Function} onSuccess - Callback receiving { token, expiresAtUtc, user }
     * @param {Function} onError - Callback function on error
     */
    function updateOwnProfile(profileData, onSuccess, onError) {
        if (!profileData) {
            console.error('Profile data is required');
            if (onError) {
                onError('Profile data is required', 400);
            }
            return;
        }

        var payload = {
            firstName: profileData.firstName || '',
            lastName: profileData.lastName || '',
            userName: profileData.userName || ''
        };

        $.ajax({
            url: config.authBaseUrl + '/profile',
            type: 'PUT',
            contentType: config.contentType,
            dataType: 'json',
            data: JSON.stringify(payload),
            success: function (response) {
                console.log('Profile updated successfully for:', response && response.user && response.user.userName);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function (xhr) {
                console.error('Error updating profile');

                var errorMessage = 'Error updating profile';

                // errors carries every field the request got wrong, so all of them are
                // fixed in one go rather than one save attempt at a time.
                if (xhr.responseJSON && xhr.responseJSON.errors && xhr.responseJSON.errors.length) {
                    errorMessage = xhr.responseJSON.errors.join(' ');
                } else if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    // The API's own "your account is gone" 404 carries a message and was
                    // handled above, so a bodyless one is an unmatched route - which is
                    // what an API still running an older build looks like.
                    errorMessage = 'The profile endpoint was not found (404). If the API was updated recently, restart it.';
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Change the signed-in user's own password.
     *
     * currentPassword is what authorises this - holding a token is not enough, because a
     * token is what an unattended browser leaves lying around.
     *
     * The API answers 204 and hands back NO replacement token, unlike updateOwnProfile.
     * Changing a password rotates the account's security stamp, which the API checks on
     * every request, so every token for this account - including the one that made this
     * call - is now refused. The caller must sign the user back in.
     *
     * Nothing here logs the payload, and nothing added to it ever should: this is the one
     * request on these pages carrying real credentials.
     *
     * @param {Object} passwords - { currentPassword, newPassword, confirmPassword }
     * @param {Function} onSuccess - Callback function on success (no body is returned)
     * @param {Function} onError - Callback function on error
     */
    function changeOwnPassword(passwords, onSuccess, onError) {
        if (!passwords) {
            console.error('Password details are required');
            if (onError) {
                onError('Password details are required', 400);
            }
            return;
        }

        var payload = {
            currentPassword: passwords.currentPassword || '',
            newPassword: passwords.newPassword || '',
            confirmPassword: passwords.confirmPassword || ''
        };

        $.ajax({
            url: config.authBaseUrl + '/password',
            type: 'PUT',
            contentType: config.contentType,
            data: JSON.stringify(payload),

            // No dataType: 204 has an empty body, and asking jQuery to parse that as JSON
            // turns a successful change into a parsererror.
            success: function () {
                console.log('Password changed; every existing token for this account is now invalid.');
                if (onSuccess) {
                    onSuccess();
                }
            },
            error: function (xhr) {
                console.error('Error changing password');

                var errorMessage = 'Error changing password';

                // errors carries every policy rule the new password missed.
                if (xhr.responseJSON && xhr.responseJSON.errors && xhr.responseJSON.errors.length) {
                    errorMessage = xhr.responseJSON.errors.join(' ');
                } else if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    errorMessage = 'The password endpoint was not found (404). If the API was updated recently, restart it.';
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Deactivate the signed-in user's own account.
     *
     * Sets IsActive = false. Not a delete - the row stays, so their forms and submissions
     * keep resolving - but it is one-way from the UI: login refuses an inactive account,
     * so only an admin can switch it back on. Confirm before calling.
     *
     * The API refuses this outright for an Admin account and answers 400, because an
     * admin who suspends themselves may be the only person who could have undone it.
     *
     * Answers 204. The account can no longer hold a session, so the caller must sign out.
     *
     * @param {Function} onSuccess - Callback function on success (no body is returned)
     * @param {Function} onError - Callback function on error
     */
    function deactivateOwnAccount(onSuccess, onError) {
        $.ajax({
            url: config.authBaseUrl + '/deactivate',
            type: 'PUT',

            // No dataType: 204 has an empty body. See changeOwnPassword.
            success: function () {
                console.log('Account deactivated; this session is over.');
                if (onSuccess) {
                    onSuccess();
                }
            },
            error: function (xhr) {
                console.error('Error deactivating account');

                var errorMessage = 'Error deactivating account';

                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    errorMessage = 'The deactivate endpoint was not found (404). If the API was updated recently, restart it.';
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }

                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    //  * Get all forms
    //  * @param {Function} onSuccess - Callback function on success
    //  * @param {Function} onError - Callback function on error
    //  */
    function getAllForms(onSuccess, onError) {
        console.log('Fetching forms from:', config.baseUrl);
        $.ajax({
            url: config.baseUrl,
            type: 'GET',
            contentType: config.contentType,
            dataType: 'json',
            success: function(response) {
                console.log('Forms retrieved successfully:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function(xhr, status, error) {
                console.error('Error retrieving forms:', error);
                console.error('Status Code:', xhr.status);
                console.error('Response:', xhr.responseText);
                console.error('Status Text:', xhr.statusText);
                
                var errorMessage = 'Error retrieving forms';
                
                if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server at ' + config.baseUrl + '. Make sure the backend is running.';
                } else if (xhr.status === 404) {
                    errorMessage = 'API endpoint not found. Check the URL: ' + config.baseUrl;
                } else if (xhr.status === 500) {
                    errorMessage = 'Server error: ' + (xhr.responseJSON ? xhr.responseJSON.message : 'Internal server error');
                } else if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }
                
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Get form by ID
     * @param {String} formId - The form ID (GUID)
     * @param {Function} onSuccess - Callback function on success
     * @param {Function} onError - Callback function on error
     */
    function getFormById(formId, onSuccess, onError) {
        if (!formId) {
            console.error('Form ID is required');
            if (onError) {
                onError('Form ID is required', 400);
            }
            return;
        }

        $.ajax({
            url: config.baseUrl + '/' + formId,
            type: 'GET',
            contentType: config.contentType,
            dataType: 'json',
            success: function(response) {
                console.log('Form retrieved successfully:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function(xhr, status, error) {
                console.error('Error retrieving form:', error);
                var errorMessage = 'Error retrieving form';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Save a new form
     * @param {Object} formData - The form data object
     * @param {String} formData.Name - Form name
     * @param {String} formData.Title - Form title
     * @param {Array} formData.Tags - Form tags
     * @param {Object} formData.Components - Form JSON configuration
     * @param {Function} onSuccess - Callback function on success
     * @param {Function} onError - Callback function on error
     */
    function saveForm(formData, onSuccess, onError) {
        if (!formData) {
            if (onError) {
                onError('Form data is required', 400);
            }
            return;
        }

        // Get tenantId - send as-is
        var tenantId = formData.tenantId || sessionStorage.getItem('editingFormTenantId') || null;

        // Prepare the request payload
        var payload = {
            name: formData.name || '',
            title: formData.title || '',
            tags: (formData.tags || []).map(function(t) { return t.toUpperCase(); }),
            // Ensure components is a string (JSON stringified)
            components: typeof formData.components === 'string' ? formData.components : JSON.stringify(formData.components || {}),
            versionId: formData.versionId || 0,
            tenantId: tenantId
        };

        $.ajax({
            url: config.baseUrl,
            type: 'POST',
            contentType: config.contentType,
            dataType: 'json',
            data: JSON.stringify(payload),
            success: function(response) {
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function(xhr, status, error) {
                var errorMessage = 'Error saving form';
                try {
                    if (xhr.responseJSON && xhr.responseJSON.message) {
                        errorMessage = xhr.responseJSON.message;
                    }
                } catch (e) {
                    if (xhr.status === 0) {
                        errorMessage = 'Network error: Cannot reach the backend at ' + config.baseUrl;
                    } else if (xhr.status === 400) {
                        errorMessage = 'Bad request: Invalid form data';
                    } else if (xhr.status === 404) {
                        errorMessage = 'API endpoint not found: ' + config.baseUrl;
                    } else if (xhr.status === 500) {
                        errorMessage = 'Server error: ' + (xhr.responseText || 'Internal server error');
                    }
                }
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Update form configuration (uses UpdateForm endpoint)
     * @param {Object} formData - The form data object
     * @param {String} formData.id - Form ID (MongoDB ObjectId)
     * @param {String} formData.name - Form name
     * @param {String} formData.title - Form title
     * @param {Array} formData.tags - Form tags
     * @param {Object} formData.components - Form JSON configuration
     * @param {Function} onSuccess - Callback function on success
     * @param {Function} onError - Callback function on error
     */
    function updateForm(formData, onSuccess, onError) {
        if (!formData || !formData.id) {
            if (onError) {
                onError('Form data with id is required', 400);
            }
            return;
        }

        // Get tenantId - send as-is
        var tenantId = formData.tenantId || sessionStorage.getItem('editingFormTenantId') || null;

        // Prepare the request payload
        var payload = {
            id: formData.id,
            name: formData.name || '',
            title: formData.title || '',
            tags: (formData.tags || []).map(function(t) { return t.toUpperCase(); }),
            // Ensure components is a string (JSON stringified)
            components: typeof formData.components === 'string' ? formData.components : JSON.stringify(formData.components || {}),
            versionId: formData.versionId || 0,
            // Include tenantId
            tenantId: tenantId
        };

        console.log('📤 PUT payload tenantId:', payload.tenantId);

        var updateUrl = config.baseUrl + '/' + formData.id;

        $.ajax({
            url: updateUrl,
            type: 'PUT',
            contentType: config.contentType,
            dataType: 'json',
            data: JSON.stringify(payload),
            success: function(response) {
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function(xhr, status, error) {
                var errorMessage = 'Error updating form';
                try {
                    if (xhr.responseJSON && xhr.responseJSON.message) {
                        errorMessage = xhr.responseJSON.message;
                    }
                } catch (e) {
                    if (xhr.status === 0) {
                        errorMessage = 'Network error: Cannot reach the backend at ' + updateUrl;
                    } else if (xhr.status === 400) {
                        errorMessage = 'Bad request: Invalid form data';
                    } else if (xhr.status === 404) {
                        errorMessage = 'Form not found or endpoint not found: ' + updateUrl;
                    } else if (xhr.status === 500) {
                        errorMessage = 'Server error: ' + (xhr.responseText || 'Internal server error');
                    }
                }
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Escape HTML to prevent XSS attacks
     * @param {String} text - Text to escape
     * @returns {String} Escaped HTML text
     */
    function escapeHtml(text) {
        var map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, function (m) { return map[m]; });
    }


    //  * Load and display forms in a table (for existingForms.html)
    //  * Detects if a tenantId parameter is present in the URL query string.
    //  */
    function loadFormsTable() {
     
        var urlParams = new URLSearchParams(window.location.search);
        var tenantId = urlParams.get('tenantId');

        if (tenantId) {
            console.log("Tenant ID detected in URL:", tenantId);
            
            // Store tenant ID in sessionStorage so it's available when editing forms
            // This ensures tenant context is preserved even if form doesn't have project field
            sessionStorage.setItem('editingFormTenantId', tenantId);
            console.log('✅ Tenant ID stored in sessionStorage for editing context');

            // Show the tenant-specific action buttons
            var tenantActions = document.getElementById('tenantFormActions');
            if (tenantActions) tenantActions.style.display = 'flex';
            
            getFormsByTenantId(tenantId, 
                function(tenantForms) {
                    populateFormsTable(tenantForms);
                },
                function(error) {
                    console.error('Failed to load forms for tenant:', error);
                    showNoFormsMessage(error || 'Failed to fetch forms for this tenant.');
                }
            );
            return;
        }

        console.log("No tenant ID in URL. Fetching all forms...");
        getAllForms(
            function(forms) {
                populateFormsTable(forms);
            },
            function(error, statusCode) {
                console.error('Failed to load forms:', error);
                showNoFormsMessage(error);
            }
        );
    }
    /**
     * Populate the forms table with data
     * @param {Array} forms - Array of form objects
     */
    function populateFormsTable(forms) {
        var tableBody = document.getElementById('formsTableBody');
        var loadingMessage = document.getElementById('formsLoadingMessage');
        var formsTable = document.getElementById('formsTable');
        var tableControls = document.getElementById('tableControls');
        var paginationControls = document.getElementById('paginationControls');

        if (!tableBody || !loadingMessage || !formsTable) {
            console.error('Required table elements not found in DOM');
            return;
        }

        tableBody.innerHTML = '';

        if (!forms || forms.length === 0) {
            showNoFormsMessage('No forms available');
            if (tableControls) tableControls.style.display = 'none';
            if (paginationControls) paginationControls.style.display = 'none';
            return;
        }

        // Store forms and initialize pagination
        paginationState.allForms = forms;
        paginationState.filteredForms = forms;
        paginationState.currentPage = 1;
        paginationState.currentPageSet = 1;

        loadingMessage.style.display = 'none';
        formsTable.style.display = 'table';
        if (tableControls) tableControls.style.display = 'flex';
        if (paginationControls) paginationControls.style.display = 'flex';

        // Initialize controls and display
        initializeSearchAndFilter();
        displayPaginatedForms();
        renderPaginationControls();
    }

    /**
     * Show no forms message
     * @param {String} message - Message to display
     */
    function showNoFormsMessage(message) {
        var loadingMessage = document.getElementById('formsLoadingMessage');
        var formsTable = document.getElementById('formsTable');

        if (!loadingMessage || !formsTable) {
            console.error('Required message elements not found in DOM');
            return;
        }

        formsTable.style.display = 'none';
        loadingMessage.style.display = 'block';
        loadingMessage.innerHTML = '<i class="bi bi-exclamation-circle"></i> <strong>' + escapeHtml(message) + '</strong>';
        loadingMessage.className = 'alert alert-warning';
    }

    /**
     * Edit form - navigate to form builder
     * @param {String} formId - The form ID to edit
     */
    function editForm(formId) {
        console.log('Edit form:', formId);
        
        // Find the form from already loaded forms instead of fetching again
        var form = paginationState.allForms.find(function(f) {
            return f.id === formId;
        });
        
        if (!form) {
            console.error('Form not found in loaded forms:', formId);
            alert('Form not found');
            return;
        }
        
        console.log('Form found for editing:', form);
        console.log('Form object keys:', Object.keys(form));
        console.log('Form.tenantId:', form.tenantId);
        console.log('Form.project:', form.project);
        
        // Store form data in sessionStorage
        sessionStorage.setItem('editingFormId', formId);
        console.log('Final tenantId being stored:', form.tenantId);
        
        sessionStorage.setItem('editingFormData', JSON.stringify({
            id: form.id,
            name: form.name,
            title: form.title,
            tags: form.tags,
            components: form.components,
            versionId: form.versionId,
            tenantId: form.tenantId  // Include tenant ID in the stored data
        }));
        // Redirect to builder
        window.location.href = 'index.html';
    }

    /**
     * View form - navigate to form viewer
     * @param {String} formId - The form ID to view
     */
    function viewForm(formId) {
        console.log('View form:', formId);
        if (!formId) {
            alert('Form ID is required');
            return;
        }
        // Fetch form and open preview page
        launchForm(formId);
    }

    /**
     * Copy form - duplicate an existing form
     * @param {String} formId - The form ID to copy
     */
    function copyForm(formId) {
        console.log('Copy form:', formId);
        
        // Find the form from already loaded forms instead of fetching again
        var form = paginationState.allForms.find(function(f) {
            return f.id === formId;
        });
        
        if (!form) {
            console.error('Form not found in loaded forms:', formId);
            alert('Form not found');
            return;
        }
        
        console.log('Form found for copying:', form);
        // Store only the form schema (components) in sessionStorage for copy mode
        // Do NOT store id, name, title, tags - this prevents form details from populating
        sessionStorage.setItem('copyingFormData', JSON.stringify({
            components: form.components
        }));
        sessionStorage.removeItem('editingFormId');
        sessionStorage.removeItem('editingFormData');
        // Redirect to builder
        window.location.href = 'index.html';
    }

    /**
     * Launch form - open form preview in new window
     * @param {String} formId - The form ID to launch
     */
    function launchForm(formId) {
        console.log('Launch form:', formId);
        
        // Clear any old preview/submission state before launching preview.
        clearPreviewSessionStorage();
        
        if (!formId) {
            alert('Form ID is required');
            return;
        }
        
        // Find the form from already loaded forms instead of fetching again
        var form = paginationState.allForms.find(function(f) {
            // Try both 'id' and '_id' fields
            return f.id === formId || f._id === formId;
        });
        
        if (!form) {
            console.error('Form not found in loaded forms:', formId);
            console.log('Available forms:', paginationState.allForms);
            alert('Form not found');
            return;
        }
        
        console.log('Form found for preview:', form);
        console.log('Form keys:', Object.keys(form));
        console.log('Form._id:', form._id);
        console.log('Form.id:', form.id);
        
        // Parse components if it's a string (from API)
        let components = form.components;
        if (typeof components === 'string') {
            try {
                components = JSON.parse(components);
            } catch (e) {
                console.error('Error parsing components:', e);
                components = [];
            }
        }
        
        // Get the correct form ID - use _id if available, otherwise id
        const actualFormId = form._id || form.id;
        console.log('Actual form ID to use:', actualFormId);
        
        // The API returns the form's version as `versionId` (FormDto); raw Mongo docs use `_vid`.
// This value becomes the submission's `_fvid`, so it must be the real version.
	const formVersion = (form.versionId !== undefined && form.versionId !== null)
	    ? form.versionId
	    : (form._vid !== undefined && form._vid !== null)
	        ? form._vid
	        : 0;

        // Create a proper Formio form schema - INCLUDE THE _id!
        const formSchema = {
            _id: actualFormId,  // ✅ Include the MongoDB ObjectId
            display: 'form',
            type: 'form',
            title: form.title || form.name || 'Untitled Form',
            name: form.name || 'form',
            components: components || [],
            _vid: formVersion  // ✅ Include form version
        };

        console.log('📄 Creating form schema for preview with _id:', actualFormId);
        console.log('📄 Creating form schema with _vid:', formVersion);
        
        // Store form schema in sessionStorage
        sessionStorage.setItem('previewFormSchema', JSON.stringify(formSchema));
        // Also store the form ID in sessionStorage for easy access
        if (actualFormId) {
            sessionStorage.setItem('previewFormId', actualFormId);
            console.log('✅ Stored previewFormId in sessionStorage:', actualFormId);
        }
        // Open preview page in new window
        window.open('previewPage.html', '_blank');
    }

    /**
     * Delete form - remove a form
     * @param {String} formId - The form ID to delete
     */
    function deleteForm(formId) {
        console.log('Delete form:', formId);
        
        if (!formId) {
            alert('Form ID is required');
            return;
        }

        // Confirmation dialog
        if (!confirm('Are you sure you want to delete this form? ')) {
            console.log('Delete cancelled by user');
            return;
        }

        $.ajax({
            url: config.baseUrl + '/' + formId,
            type: 'DELETE',
            contentType: config.contentType,
            dataType: 'json',
            success: function(response) {
                console.log('Form deleted successfully:', response);
                alert('Form deleted successfully!');
                // Refresh the forms table
                loadFormsTable();
            },
            error: function(xhr, status, error) {
                console.error('Error deleting form:', error);
                var errorMessage = 'Error deleting form';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    errorMessage = 'Form not found';
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }
                alert(errorMessage);
            }
        });
    }

    // Pagination state
    var paginationState = {
        allForms: [],
        filteredForms: [],
        currentPage: 1,
        currentPageSet: 1,
        itemsPerPage: 10,
        pagesPerSet: 5
    };

    /**
     * Initialize search and filter event listeners
     */
    function initializeSearchAndFilter() {
        var searchInput = document.getElementById('searchInput');
        var filterSelect = document.getElementById('filterSelect');

        if (searchInput) {
            searchInput.addEventListener('keyup', function() {
                paginationState.currentPage = 1;
                paginationState.currentPageSet = 1;
                applyFiltersAndSearch();
            });
        }

        if (filterSelect) {
            filterSelect.addEventListener('change', function() {
                paginationState.currentPage = 1;
                paginationState.currentPageSet = 1;
                applyFiltersAndSearch();
            });
        }
    }

    /**
     * Apply filters and search to forms
     */
    function applyFiltersAndSearch() {
        var searchInput = document.getElementById('searchInput');
        var filterSelect = document.getElementById('filterSelect');
        var searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        var sortBy = filterSelect ? filterSelect.value : '';

        // Filter by search term
        paginationState.filteredForms = paginationState.allForms.filter(function(form) {
            var title = (form.title || '').toLowerCase();
            var tags = (form.tags || []).join(' ').toLowerCase();
            return title.includes(searchTerm) || tags.includes(searchTerm);
        });

        // Sort forms
        if (sortBy === 'name-asc') {
            paginationState.filteredForms.sort(function(a, b) {
                return (a.title || '').localeCompare(b.title || '');
            });
        } else if (sortBy === 'name-desc') {
            paginationState.filteredForms.sort(function(a, b) {
                return (b.title || '').localeCompare(a.title || '');
            });
        } else if (sortBy === 'date-desc') {
            paginationState.filteredForms.sort(function(a, b) {
                return new Date(b.modified || 0) - new Date(a.modified || 0);
            });
        } else if (sortBy === 'date-asc') {
            paginationState.filteredForms.sort(function(a, b) {
                return new Date(a.modified || 0) - new Date(b.modified || 0);
            });
        }

        displayPaginatedForms();
        renderPaginationControls();
    }

    /**
     * Display forms for current page
     */
   
function displayPaginatedForms() {
    var tableBody = document.getElementById('formsTableBody');
    var formsTable = document.getElementById('formsTable');

    if (!tableBody || !formsTable) {
        return;
    }
    tableBody.innerHTML = '';

    var startIndex = (paginationState.currentPage - 1) * paginationState.itemsPerPage;
    var endIndex = startIndex + paginationState.itemsPerPage;
    var pageItems = paginationState.filteredForms.slice(startIndex, endIndex);

    pageItems.forEach(function (form) {
        var tagsDisplay = (form.tags || []).map(function(t) { return t.toUpperCase(); }).join(', ');
        var dateText = '';

        if (form.modified) {
            dateText = 'Updated: ' + new Date(form.modified).toLocaleString();
        }
        else if (form.created) {
            dateText = 'Created: ' + new Date(form.created).toLocaleString();
        }

        var dateTagsLine = dateText;
        if (tagsDisplay) {
            dateTagsLine += '  |  ' + escapeHtml(tagsDisplay);
        }

        var dropdownId = 'actionDropdown_' + form.id;

        var row = document.createElement('tr');

        row.innerHTML =
            '<td>' +
                '<strong>' + escapeHtml(form.title || '') + '</strong><br>' +
                '<small class="text-muted">' + dateTagsLine + '</small>' +
            '</td>' +

            '<td style="text-align:right;">' +
                '<div class="form-actions d-inline-flex align-items-center">' +

                    '<button class="btn btn-sm btn-outline-primary" title="Edit form details" onclick="FormBuilderApi.editForm(\'' + form.id + '\')">' +
                        '<i class="bi bi-pencil"></i> Edit' +
                    '</button> ' +

                    '<button class="btn btn-sm btn-outline-secondary" title="Copy form schema" onclick="FormBuilderApi.copyForm(\'' + form.id + '\')">' +
                        '<i class="bi bi-copy"></i> Copy' +
                    '</button> ' +

                    '<button class="btn btn-sm btn-outline-info" title="Preview form" onclick="FormBuilderApi.launchForm(\'' + form.id + '\')">' +
                        '<i class="bi bi-box-arrow-up-right"></i> Preview' +
                    '</button> ' +

                    '<div class="dropdown d-inline-block">' +
                        '<button class="btn btn-sm btn-secondary" type="button" id="' + dropdownId + '" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" title="More actions">' +
                            '<i class="bi bi-gear"></i>' +
                        '</button>' +
                        '<ul class="dropdown-menu dropdown-menu-right" aria-labelledby="' + dropdownId + '">' +
                            '<li>' +
                                '<a class="dropdown-item" href="#" onclick="event.preventDefault(); FormBuilderApi.downloadAcroFormPdf(\'' + form.id + '\', this)">' +
                                    '<i class="bi bi-file-earmark-pdf text-success"></i> AcroForm PDF' +
                                '</a>' +
                            '</li>' +
                            '<li>' +
                                '<a class="dropdown-item text-danger" href="#" onclick="event.preventDefault(); FormBuilderApi.deleteForm(\'' + form.id + '\')">' +
                                    '<i class="bi bi-trash"></i> Delete' +
                                '</a>' +
                            '</li>' +
                        '</ul>' +
                    '</div>' +

                '</div>' +
            '</td>';

        tableBody.appendChild(row);
    });

    formsTable.style.display = 'table';
}
    /**
     * Render pagination controls
     */
    function renderPaginationControls() {
        var totalPages = Math.ceil(paginationState.filteredForms.length / paginationState.itemsPerPage);
        var pageNumbersDiv = document.getElementById('pageNumbers');
        var nextPageBtn = document.getElementById('nextPageBtn');
        var prevPageBtn = document.getElementById('prevPageBtn');
        var paginationInfo = document.getElementById('paginationInfo');

        if (!pageNumbersDiv) {
            return;
        }

        pageNumbersDiv.innerHTML = '';

        var startPage = (paginationState.currentPageSet - 1) * paginationState.pagesPerSet + 1;
        var endPage = Math.min(startPage + paginationState.pagesPerSet - 1, totalPages);

        for (var i = startPage; i <= endPage; i++) {
            var btn = document.createElement('button');
            btn.className = 'page-btn' + (i === paginationState.currentPage ? ' active' : '');
            btn.textContent = i;
            btn.onclick = function(page) {
                return function() {
                    paginationState.currentPage = page;
                    displayPaginatedForms();
                    renderPaginationControls();
                };
            }(i);
            pageNumbersDiv.appendChild(btn);
        }

        if (prevPageBtn) {
            prevPageBtn.style.display = startPage > 1 ? 'inline-block' : 'none';
            prevPageBtn.disabled = startPage <= 1;
        }

        if (nextPageBtn) {
            nextPageBtn.style.display = endPage < totalPages ? 'inline-block' : 'none';
        }

        if (paginationInfo) {
            paginationInfo.textContent = 'Page ' + paginationState.currentPage + ' of ' + totalPages;
        }
    }

    /**
     * Go to previous page set
     */
    function previousPage() {
        if (paginationState.currentPageSet > 1) {
            paginationState.currentPageSet--;
            paginationState.currentPage = (paginationState.currentPageSet - 1) * paginationState.pagesPerSet + 1;
            displayPaginatedForms();
            renderPaginationControls();
        }
    }

    /**
     * Go to next page set
     */
    function nextPage() {
        var totalPages = Math.ceil(paginationState.filteredForms.length / paginationState.itemsPerPage);
        var maxPageSet = Math.ceil(totalPages / paginationState.pagesPerSet);
        if (paginationState.currentPageSet < maxPageSet) {
            paginationState.currentPageSet++;
            paginationState.currentPage = (paginationState.currentPageSet - 1) * paginationState.pagesPerSet + 1;
            displayPaginatedForms();
            renderPaginationControls();
        }
    }

    /**
     * Load and populate reports table (reuses forms pagination)
     */
    function loadReportsTable() {
        // Check if tenantId is present in URL parameters
        var urlParams = new URLSearchParams(window.location.search);
        var tenantId = urlParams.get('tenantId');
        
        // If tenantId exists, load only forms for that tenant; otherwise load all forms
        if (tenantId) {
            console.log('Loading reports for tenant ID:', tenantId);
            getFormsByTenantId(tenantId,
                function(forms) {
                    populateReportsTable(forms);
                },
                function(error) {
                    console.error('Failed to load forms for tenant reports:', error);
                    showNoReportsMessage(error);
                }
            );
        } else {
            getAllForms(
                function(forms) {
                    populateReportsTable(forms);
                },
                function(error, statusCode) {
                    console.error('Failed to load forms for reports:', error);
                    showNoReportsMessage(error);
                }
            );
        }
    }

    /**
     * Populate the reports table with form data (reuses forms pagination)
     * @param {Array} forms - Array of form objects
     */
    function populateReportsTable(forms) {
        var tableBody = document.getElementById('reportsTableBody');
        var loadingMessage = document.getElementById('reportsLoadingMessage');
        var reportsTable = document.getElementById('reportsTable');
        var tableControls = document.getElementById('tableControls');
        var paginationControls = document.getElementById('paginationControls');

        if (!tableBody || !loadingMessage || !reportsTable) {
            console.error('Required reports table elements not found in DOM');
            return;
        }

        tableBody.innerHTML = '';

        if (!forms || forms.length === 0) {
            showNoReportsMessage('No forms available');
            if (tableControls) tableControls.style.display = 'none';
            if (paginationControls) paginationControls.style.display = 'none';
            return;
        }

        // Store forms and initialize pagination (reuse existing paginationState)
        paginationState.allForms = forms;
        paginationState.filteredForms = forms;
        paginationState.currentPage = 1;
        paginationState.currentPageSet = 1;

        loadingMessage.style.display = 'none';
        reportsTable.style.display = 'table';
        if (tableControls) tableControls.style.display = 'flex';
        if (paginationControls) paginationControls.style.display = 'flex';

        // Initialize controls and display (reuse existing functions with reports context)
        initializeSearchAndFilter();
        displayReportsPage();
        renderReportsPaginationControls();
    }

    /**
     * Display reports for current page (reports-specific renderer)
     */
    function displayReportsPage() {
        var tableBody = document.getElementById('reportsTableBody');
        var reportsTable = document.getElementById('reportsTable');

        if (!tableBody || !reportsTable) {
            return;
        }

        tableBody.innerHTML = '';

        var startIndex = (paginationState.currentPage - 1) * paginationState.itemsPerPage;
        var endIndex = startIndex + paginationState.itemsPerPage;
        var pageItems = paginationState.filteredForms.slice(startIndex, endIndex);

        pageItems.forEach(function(form) {
            var row = document.createElement('tr');
            row.innerHTML = '<td><strong>' + escapeHtml(form.title || '') + '</strong></td>' +
                '<td style="text-align: right;">' +
                '<button class="btn btn-sm btn-info" title="Generate Report" data-toggle="tooltip" data-placement="bottom" onclick="FormBuilderApi.generateReport(\'' + form.id + '\')">' +
                '<i class="bi bi-file-earmark-pdf"></i> Generate Report' +
                '</button>' +
                '</td>';
            tableBody.appendChild(row);
        });

        reportsTable.style.display = 'table';
    }

    /**
     * Render pagination controls for reports
     */
    function renderReportsPaginationControls() {
        var totalPages = Math.ceil(paginationState.filteredForms.length / paginationState.itemsPerPage);
        var pageNumbersDiv = document.getElementById('pageNumbers');
        var nextPageBtn = document.getElementById('nextPageBtn');
        var prevPageBtn = document.getElementById('prevPageBtn');
        var paginationInfo = document.getElementById('paginationInfo');

        if (!pageNumbersDiv) {
            return;
        }

        pageNumbersDiv.innerHTML = '';

        var startPage = (paginationState.currentPageSet - 1) * paginationState.pagesPerSet + 1;
        var endPage = Math.min(startPage + paginationState.pagesPerSet - 1, totalPages);

        for (var i = startPage; i <= endPage; i++) {
            var btn = document.createElement('button');
            btn.className = 'page-btn' + (i === paginationState.currentPage ? ' active' : '');
            btn.textContent = i;
            btn.onclick = function(page) {
                return function() {
                    paginationState.currentPage = page;
                    displayReportsPage();
                    renderReportsPaginationControls();
                };
            }(i);
            pageNumbersDiv.appendChild(btn);
        }

        if (prevPageBtn) {
            prevPageBtn.style.display = startPage > 1 ? 'inline-block' : 'none';
            prevPageBtn.disabled = startPage <= 1;
        }

        if (nextPageBtn) {
            nextPageBtn.style.display = endPage < totalPages ? 'inline-block' : 'none';
        }

        if (paginationInfo) {
            paginationInfo.textContent = 'Page ' + paginationState.currentPage + ' of ' + totalPages;
        }
    }

    /**
     * Submit a complete Form.io submission document to the backend.
     * The entire submission object (including id, form, data, metadata, etc.) is sent as-is.
     * @param {Object} submission - The complete Form.io submission object with form, data, and other properties
     * @param {Function} onSuccess - Callback function on success
     * @param {Function} onError - Callback function on error
     */
    function submitFormData(submission, onSuccess, onError) {
        // Validate submission is an object
        if (!submission || typeof submission !== 'object') {
            if (onError) {
                onError('Submission must be a valid object', 400);
            }
            return;
        }

        // Validate form property exists and is not empty
        if (!submission.form || (typeof submission.form === 'string' && submission.form.trim() === '')) {
            if (onError) {
                onError('Submission must contain a "form" property with the Form ID', 400);
            }
            return;
        }

        // Validate data property exists - allow empty objects as valid data
        if (submission.data === undefined || submission.data === null) {
            if (onError) {
                onError('Submission must contain form data', 400);
            }
            return;
        }

        var submissionUrl = config.baseUrl.replace('/api/forms', '/api/formsubmissions');
        var payload = submission; // Send the entire submission as-is

        $.ajax({
            url: submissionUrl,
            type: 'POST',
            contentType: 'application/json',
            dataType: 'json',
            data: JSON.stringify(payload),
            success: function(response) {
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function(xhr, status, error) {
                var errorMessage = 'Error submitting form';
                
                try {
                    if (xhr.responseJSON && xhr.responseJSON.message) {
                        errorMessage = xhr.responseJSON.message;
                    }
                } catch (e) {
                    if (xhr.status === 0) {
                        errorMessage = 'Network error: Cannot reach the backend at ' + submissionUrl;
                    } else if (xhr.status === 400) {
                        errorMessage = 'Bad request: ' + (xhr.responseText || 'Invalid form data');
                    } else if (xhr.status === 404) {
                        errorMessage = 'API endpoint not found: ' + submissionUrl;
                    } else if (xhr.status === 500) {
                        errorMessage = 'Server error: ' + (xhr.responseText || 'Internal server error');
                    }
                }
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Show no reports message
     * @param {String} message - Message to display
     */
    function showNoReportsMessage(message) {
        var loadingMessage = document.getElementById('reportsLoadingMessage');
        var reportsTable = document.getElementById('reportsTable');
        
        if (loadingMessage) {
            loadingMessage.className = 'alert alert-warning';
            loadingMessage.innerHTML = '<i class="bi bi-exclamation-circle"></i> <strong>' + escapeHtml(message) + '</strong>';
            loadingMessage.style.display = 'block';
        }
        
        if (reportsTable) {
            reportsTable.style.display = 'none';
        }
    }

    /**
     * Get form submissions for a form
     * @param {String} formId - The form ID
     * @param {Function} onSuccess - Callback function on success
     * @param {Function} onError - Callback function on error
     */
    function getFormSubmissions(formId, onSuccess, onError) {
        if (!formId) {
            console.error('Form ID is required');
            if (onError) {
                onError('Form ID is required', 400);
            }
            return;
        }

        var submissionsUrl = config.baseUrl.replace('/api/forms', '/api/formsubmissions') + '/form/' + formId;
        
        console.log('Fetching submissions from:', submissionsUrl);

        $.ajax({
            url: submissionsUrl,
            type: 'GET',
            contentType: config.contentType,
            dataType: 'json',
            success: function(response) {
                console.log('Form submissions retrieved successfully:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function(xhr, status, error) {
                console.error('Error retrieving form submissions:', error);
                var errorMessage = 'Error retrieving form submissions';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Generate a PDF for one or more submissions.
     * The whole document is rendered by the backend (Playwright + headless Chromium),
     * so the PDF matches the Preview page and the text stays selectable/searchable.
     * @param {Array} submissionIds - Submission IDs to render, in page order
     * @param {Function} onSuccess - Called with (blob, fileName)
     * @param {Function} onError - Called with (message, statusCode)
     * @param {Object} options - Optional overrides (page, headerFooter, fileName, ...)
     */
    function generateSubmissionsPdf(submissionIds, onSuccess, onError, options) {
        if (!submissionIds || !submissionIds.length) {
            console.error('At least one submission ID is required');
            if (onError) {
                onError('At least one submission ID is required', 400);
            }
            return;
        }

        var pdfUrl = config.baseUrl.replace('/api/forms', '/api/pdf') + '/form-submissions';
        var payload = $.extend({ submissionIds: submissionIds }, options || {});

        console.log('Requesting PDF from:', pdfUrl, payload);

        // jQuery's jqXHR wrapper does not expose .response, which is where the error body
        // lives when responseType is 'blob' (jqXHR.responseText is the string
        // "[object Blob]"). Keep a handle on the real XMLHttpRequest to read it back.
        var nativeXhr = null;

        $.ajax({
            url: pdfUrl,
            type: 'POST',
            contentType: config.contentType,
            data: JSON.stringify(payload),
            xhr: function () {
                nativeXhr = new window.XMLHttpRequest();
                return nativeXhr;
            },
            xhrFields: { responseType: 'blob' },
            success: function (blob, status, xhr) {
                var fileName = xhr.getResponseHeader('X-Pdf-Filename') || 'form-submissions.pdf';
                console.log('PDF generated:', fileName, blob.size + ' bytes');
                if (onSuccess) {
                    onSuccess(blob, fileName);
                }
            },
            error: function (xhr, status, error) {
                console.error('Error generating PDF:', error, xhr.status);

                var errorMessage = 'Error generating PDF';
                if (xhr.status === 0) {
                    errorMessage = 'Network error: cannot reach the API at ' + pdfUrl;
                } else if (xhr.status === 404) {
                    errorMessage = 'The selected submission(s) could not be found.';
                }

                function report(message) {
                    if (onError) {
                        onError(message, xhr.status);
                    }
                }

                // The API reports failures as JSON, but responseType is 'blob', so the body
                // arrives as a Blob on the native xhr and has to be read back as text.
                var body = nativeXhr && nativeXhr.response;
                if (body instanceof Blob && body.size > 0) {
                    var reader = new FileReader();
                    reader.onload = function () {
                        try {
                            var parsed = JSON.parse(reader.result);
                            // The API reports its own failures as { message }; ASP.NET's model
                            // validation replies with ProblemDetails, where the text is in title.
                            if (parsed && (parsed.message || parsed.title)) {
                                errorMessage = parsed.message || parsed.title;
                            }
                        } catch (e) {
                            // Not JSON - keep the generic message.
                        }
                        report(errorMessage);
                    };
                    reader.onerror = function () { report(errorMessage); };
                    reader.readAsText(body);
                    return;
                }

                report(errorMessage);
            }
        });
    }

    /**
     * Generate a fillable AcroForm PDF for a form definition.
     *
     * The backend renders the same document the read-only PDF produces (Playwright +
     * headless Chromium + the Preview page stylesheets) and then lays a real, editable PDF
     * form field over every control, so the file looks exactly like the Preview page but can
     * be filled in and saved in Adobe Reader.
     *
     * @param {String} formId - The form to render
     * @param {Function} onSuccess - Called with (blob, fileName)
     * @param {Function} onError - Called with (message, statusCode)
     * @param {Object} options - Optional overrides (page, headerFooter, fileName, ...)
     */
    function generateAcroFormPdf(formId, onSuccess, onError, options) {
        if (!formId) {
            console.error('A form ID is required');
            if (onError) {
                onError('A form ID is required', 400);
            }
            return;
        }

        var pdfUrl = config.baseUrl.replace('/api/forms', '/api/pdf') + '/acroform';
        var payload = $.extend({ formId: formId }, options || {});

        console.log('Requesting AcroForm PDF from:', pdfUrl, payload);

        // jQuery's jqXHR wrapper does not expose .response, which is where the error body
        // lives when responseType is 'blob'. Keep a handle on the real XMLHttpRequest.
        var nativeXhr = null;

        $.ajax({
            url: pdfUrl,
            type: 'POST',
            contentType: config.contentType,
            data: JSON.stringify(payload),
            xhr: function () {
                nativeXhr = new window.XMLHttpRequest();
                return nativeXhr;
            },
            xhrFields: { responseType: 'blob' },
            success: function (blob, status, xhr) {
                var fileName = xhr.getResponseHeader('X-Pdf-Filename') || 'form.pdf';
                console.log('AcroForm PDF generated:', fileName, blob.size + ' bytes');
                if (onSuccess) {
                    onSuccess(blob, fileName);
                }
            },
            error: function (xhr, status, error) {
                console.error('Error generating AcroForm PDF:', error, xhr.status);

                var errorMessage = 'Error generating the AcroForm PDF';
                if (xhr.status === 0) {
                    errorMessage = 'Network error: cannot reach the API at ' + pdfUrl;
                } else if (xhr.status === 404) {
                    errorMessage = 'The form could not be found.';
                } else if (xhr.status === 503) {
                    errorMessage = 'The PDF service is busy. Please try again shortly.';
                }

                function report(message) {
                    if (onError) {
                        onError(message, xhr.status);
                    }
                }

                // The API reports failures as JSON, but responseType is 'blob', so the body
                // arrives as a Blob on the native xhr and has to be read back as text.
                var body = nativeXhr && nativeXhr.response;
                if (body instanceof Blob && body.size > 0) {
                    var reader = new FileReader();
                    reader.onload = function () {
                        try {
                            var parsed = JSON.parse(reader.result);
                            if (parsed && (parsed.message || parsed.title)) {
                                errorMessage = parsed.message || parsed.title;
                            }
                        } catch (e) {
                            // Not JSON - keep the generic message.
                        }
                        report(errorMessage);
                    };
                    reader.onerror = function () { report(errorMessage); };
                    reader.readAsText(body);
                    return;
                }

                report(errorMessage);
            }
        });
    }

    /**
     * Forms table action: download the form as a fillable AcroForm PDF.
     *
     * Rendering takes a few seconds, so the button shows a spinner and is disabled until the
     * file is saved - a second click would queue another full render.
     *
     * @param {String} formId - The form to download
     * @param {Element} button - The clicked button, used for the busy state
     */
    function downloadAcroFormPdf(formId, button) {
        var originalHtml = button ? button.innerHTML : null;

        function restore() {
            if (button) {
                button.innerHTML = originalHtml;
                button.disabled = false;
            }
        }

        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="bi bi-hourglass-split"></i>';
        }

        generateAcroFormPdf(formId,
            function (blob, fileName) {
                saveBlobAsFile(blob, fileName || 'form.pdf');
                restore();
            },
            function (message) {
                restore();
                alert(message);
            }
        );
    }

    /**
     * Save a generated file to disk through a temporary object URL.
     * @param {Blob} blob - The file contents
     * @param {String} fileName - Name suggested by the backend
     */
    function saveBlobAsFile(blob, fileName) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Generate report for a form - wrapper that delegates to reports.js
     * @param {String} formId - The form ID
     */
    function generateReport(formId) {
        if (typeof window.generateReport === 'function') {
            window.generateReport(formId);
        } else {
            console.error('generateReport function not found in reports.js');
        }
    }

    /**
     * Save a custom resource from Add Resource page
     * @param {Object} resourceData - The resource data object
     * @param {String} resourceData.resourceType - Resource type
     * @param {String} resourceData.componentName - Component name
     * @param {String} resourceData.description - Description (optional)
     * @param {String} resourceData.json - Component JSON
     * @param {Function} onSuccess - Callback function on success
     * @param {Function} onError - Callback function on error
     */
    function saveResource(resourceData, onSuccess, onError) {
        if (!resourceData) {
            console.error('Resource data is required');
            if (onError) {
                onError('Resource data is required', 400);
            }
            return;
        }

        var resourceUrl = config.baseUrl.replace('/api/forms', '/api/resources');
        
        var payload = {
            resourceType: resourceData.resourceType || resourceData.type,
            componentName: resourceData.componentName,
            description: resourceData.description || null,
            resourceJson: resourceData.json
        };

        $.ajax({
            url: resourceUrl,
            type: 'POST',
            contentType: config.contentType,
            dataType: 'json',
            data: JSON.stringify(payload),
            success: function(response) {
                console.log('Resource saved successfully:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function(xhr, status, error) {
                console.error('Error saving resource:', error);
                var errorMessage = 'Error saving resource';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Get all resources
     * @param {String} resourceType - Optional resource type filter
     * @param {Function} onSuccess - Callback function on success
     * @param {Function} onError - Callback function on error
     */
    function getAllResources(resourceType, onSuccess, onError) {
        var resourceUrl = config.baseUrl.replace('/api/forms', '/api/resources');
        if (resourceType) {
            resourceUrl += '?resourceType=' + encodeURIComponent(resourceType);
        }

        $.ajax({
            url: resourceUrl,
            type: 'GET',
            contentType: config.contentType,
            dataType: 'json',
            success: function(response) {
                console.log('Resources retrieved successfully:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function(xhr, status, error) {
                console.error('Error retrieving resources:', error);
                var errorMessage = 'Error retrieving resources';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }

    /**
     * Get all resources grouped by resource type
     * @param {Function} onSuccess - Callback function on success
     * @param {Function} onError - Callback function on error
     */
    function getResourcesList(onSuccess, onError) {
        var resourceUrl = config.baseUrl.replace('/api/forms', '/api/resources') + '/grouped/list';

        $.ajax({
            url: resourceUrl,
            type: 'GET',
            contentType: config.contentType,
            dataType: 'json',
            success: function(response) {
                console.log('Grouped resources retrieved successfully:', response);
                if (onSuccess) {
                    onSuccess(response);
                }
            },
            error: function(xhr, status, error) {
                console.error('Error retrieving grouped resources:', error);
                var errorMessage = 'Error retrieving grouped resources';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                } else if (xhr.status === 0) {
                    errorMessage = 'Network error: Cannot reach the API server. Make sure the backend is running.';
                }
                if (onError) {
                    onError(errorMessage, xhr.status);
                }
            }
        });
    }
// for adding newform button in tenants
    function addNewFormForTenant() {
        var urlParams = new URLSearchParams(window.location.search);
        var tenantId = urlParams.get('tenantId');
        if (tenantId) {
            sessionStorage.setItem('editingFormTenantId', tenantId);
        }
        sessionStorage.removeItem('editingFormId');
        sessionStorage.removeItem('editingFormData');
        window.location.href = 'index.html';
    }

    function viewTenantReports() {
        var urlParams = new URLSearchParams(window.location.search);
        var tenantId = urlParams.get('tenantId');
        var tenantName = urlParams.get('tenantName');
        var url = 'reports.html';
        if (tenantId) {
            url += '?tenantId=' + encodeURIComponent(tenantId);
            if (tenantName) url += '&tenantName=' + encodeURIComponent(tenantName);
        }
        window.location.href = url;
    }

    // Public API
    return {
        getAllForms: getAllForms,
        getTenants: getTenants,
        saveTenant: saveTenant,
        updateTenant: updateTenant,
        getFormsByTenantId: getFormsByTenantId,
        deleteTenant: deleteTenant,
        getUsers: getUsers,
        getAssignableRoles: getAssignableRoles,
        checkUserName: checkUserName,
        createUser: createUser,
        updateUser: updateUser,
        setUserPassword: setUserPassword,
        deleteUser: deleteUser,
        checkOwnUserName: checkOwnUserName,
        updateOwnProfile: updateOwnProfile,
        changeOwnPassword: changeOwnPassword,
        deactivateOwnAccount: deactivateOwnAccount,
        getFormById: getFormById,
        saveForm: saveForm,
        updateForm: updateForm,
        loadFormsTable: loadFormsTable,
        loadReportsTable: loadReportsTable,
        editForm: editForm,
        viewForm: viewForm,
        copyForm: copyForm,
        launchForm: launchForm,
        deleteForm: deleteForm,
        generateReport: generateReport,
        getFormSubmissions: getFormSubmissions,
        generateSubmissionsPdf: generateSubmissionsPdf,
        generateAcroFormPdf: generateAcroFormPdf,
        downloadAcroFormPdf: downloadAcroFormPdf,
        previousPage: previousPage,
        nextPage: nextPage,
        submitFormData: submitFormData,
        saveResource: saveResource,
        getAllResources: getAllResources,
        getResourcesList: getResourcesList,
        addNewFormForTenant: addNewFormForTenant,
        viewTenantReports: viewTenantReports,
        config: config
    };

})();

