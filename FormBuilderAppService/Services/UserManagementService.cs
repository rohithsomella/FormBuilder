using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;
using FormBuilderAppService.Models.DTOs.Auth;
using FormBuilderAppService.Models.DTOs.Users;
using FormBuilderAppService.Models.Identity;
using FormBuilderAppService.Repositories.Interfaces;
using FormBuilderAppService.Services.Interfaces;
using Microsoft.AspNetCore.Identity;

namespace FormBuilderAppService.Services
{
    /// <summary>
    /// User administration. All the rules about what makes an acceptable new account
    /// live here; the repository only reads and writes, and the controller only turns
    /// the outcome into a status code.
    /// </summary>
    public class UserManagementService : IUserManagementService
    {
        /// <summary>
        /// Identity's default User.AllowedUserNameCharacters, plus a length bound. The
        /// pre-check exists so the dialog can say "that character is not allowed" instead
        /// of surfacing Identity's InvalidUserName error after a round trip; Identity
        /// still validates on create, so this cannot let a bad name through.
        /// </summary>
        private static readonly Regex UserNamePattern =
            new(@"^[A-Za-z0-9._@+\-]{3,50}$", RegexOptions.Compiled);

        private static readonly EmailAddressAttribute EmailValidator = new();

        private readonly IUserRepository _userRepository;
        private readonly ILogger<UserManagementService> _logger;

        public UserManagementService(
            IUserRepository userRepository,
            ILogger<UserManagementService> logger)
        {
            _userRepository = userRepository;
            _logger = logger;
        }

        public async Task<List<UserListItemDto>> GetUsersAsync(Guid currentUserId)
        {
            var users = await _userRepository.GetUsersAsync(currentUserId);
            var rolesByUserId = await _userRepository.GetRoleNamesByUserIdAsync();

            return users.Select(user => ToListItem(
                user,
                rolesByUserId.TryGetValue(user.Id, out var roles) ? roles : new List<string>()))
                .ToList();
        }

        public async Task<List<RoleOptionDto>> GetAssignableRolesAsync()
        {
            // AspNetRoles is the source of truth, not a list compiled into the assembly:
            // a role added by SQL shows up here with no rebuild, and one that is
            // soft-deleted disappears (GetRolesAsync already filters IsDeleted).
            // Ordered by name so the dropdown is stable between calls.
            var existingRoles = await _userRepository.GetRolesAsync();

            return existingRoles
                .Where(role => !string.IsNullOrWhiteSpace(role.Name))
                .OrderBy(role => role.Name)
                .Select(role => new RoleOptionDto
                {
                    Name = role.Name!,
                    Description = role.Description
                })
                .ToList();
        }

        public async Task<UserNameAvailabilityDto> CheckUserNameAsync(
            string? userName, Guid? excludeUserId = null)
        {
            var candidate = userName?.Trim() ?? string.Empty;

            var formatError = ValidateUserNameFormat(candidate);

            if (formatError is not null)
            {
                return new UserNameAvailabilityDto
                {
                    UserName = candidate,
                    IsAvailable = false,
                    Message = formatError
                };
            }

            var existing = await _userRepository.FindByUserNameAsync(candidate);

            // The account being edited is not a clash with itself. Same rule the update
            // path applies before it saves, so Verify and Save cannot disagree about
            // whether a name is usable.
            if (existing is not null && excludeUserId.HasValue && existing.Id == excludeUserId.Value)
            {
                return new UserNameAvailabilityDto
                {
                    UserName = candidate,
                    IsAvailable = true,
                    Message = $"'{candidate}' is this user's current username."
                };
            }

            if (existing is null)
            {
                return new UserNameAvailabilityDto
                {
                    UserName = candidate,
                    IsAvailable = true,
                    Message = $"'{candidate}' is available."
                };
            }

            // Matches what CreateUserAsync would say. A name held by a soft-deleted row
            // is genuinely unavailable, but for a reason the admin cannot see in the list.
            return new UserNameAvailabilityDto
            {
                UserName = candidate,
                IsAvailable = false,
                Message = existing.IsDeleted
                    ? $"'{candidate}' belonged to a deleted account and is still reserved."
                    : $"'{candidate}' is already taken."
            };
        }

        public async Task<CreateUserResult> CreateUserAsync(CreateUserRequest request, string createdBy)
        {
            if (request is null)
            {
                return CreateUserResult.Failure("No user details were supplied.");
            }

            var firstName = request.FirstName?.Trim() ?? string.Empty;
            var lastName = request.LastName?.Trim() ?? string.Empty;
            var userName = request.UserName?.Trim() ?? string.Empty;
            var email = request.Email?.Trim() ?? string.Empty;

            var errors = new List<string>();

            ValidateProfileFields(firstName, lastName, userName, errors);

            if (string.IsNullOrWhiteSpace(email))
            {
                errors.Add("Email is required.");
            }
            else if (!EmailValidator.IsValid(email))
            {
                errors.Add($"'{email}' is not a valid email address.");
            }

            // Loaded per request rather than cached: an admin who inserts a role in SQL
            // can assign it on the next call, without restarting the API.
            var assignableRoles = (await _userRepository.GetRolesAsync())
                .Select(role => role.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name!)
                .ToList();

            var roles = ResolveRoles(request.Roles, assignableRoles, errors);

            if (errors.Count > 0)
            {
                return CreateUserResult.Failure(errors);
            }

            // Checked before the insert so the dialog gets a sentence it can show, rather
            // than Identity's DuplicateUserName/DuplicateEmail codes. The unique indexes
            // on AspNetUsers remain the actual guarantee.
            // A soft-deleted account keeps its row, and with it the unique indexes on
            // UserName and Email - so those values stay reserved by somebody who is no
            // longer in the list. "Already taken" on its own would send the admin looking
            // for a user they cannot see.
            var nameHolder = await _userRepository.FindByUserNameAsync(userName);

            if (nameHolder is not null)
            {
                return CreateUserResult.Failure(nameHolder.IsDeleted
                    ? $"Username '{userName}' belonged to a deleted account and is still reserved."
                    : $"Username '{userName}' is already taken.");
            }

            var emailHolder = await _userRepository.FindByEmailAsync(email);

            if (emailHolder is not null)
            {
                return CreateUserResult.Failure(emailHolder.IsDeleted
                    ? $"Email '{email}' belonged to a deleted account and is still reserved."
                    : $"Email '{email}' is already registered.");
            }

            // One timestamp for both columns rather than two DateTime.Now calls, so a row
            // never looks as though it was modified a tick after it was created.
            var now = DateTime.Now;
            var actor = string.IsNullOrWhiteSpace(createdBy) ? "System" : createdBy.Trim();

            var user = new ApplicationUser
            {
                UserName = userName,
                Email = email,
                FirstName = firstName,
                LastName = lastName,
                FullName = $"{firstName} {lastName}".Trim(),

                Created = now,
                CreatedBy = actor,

                // Updated/UpdatedBy mirror the create rather than staying empty, so
                // "who last touched this row" is answerable from the moment it exists.
                Updated = now,
                UpdatedBy = actor,

                IsDeleted = false,
                IsActive = true,

                // There is no mail sender in this version, so requiring a confirmation
                // click would make every created account unusable.
                EmailConfirmed = true
            };

            var temporaryPassword = TemporaryPasswordGenerator.Generate();

            var createResult = await _userRepository.CreateAsync(user, temporaryPassword);

            if (!createResult.Succeeded)
            {
                _logger.LogWarning(
                    "Failed to create user '{UserName}': {Errors}",
                    userName, Describe(createResult));

                return CreateUserResult.Failure(createResult.Errors.Select(e => e.Description));
            }

            var roleResult = await _userRepository.AddToRolesAsync(user, roles);

            if (!roleResult.Succeeded)
            {
                // A user with no roles can sign in but can do nothing, and the admin gets
                // an error implying nothing was created. Removing the row keeps those two
                // stories consistent - the create either fully happened or did not.
                _logger.LogError(
                    "Assigning roles to new user '{UserName}' failed ({Errors}); removing the account.",
                    userName, Describe(roleResult));

                await _userRepository.DeleteAsync(user);

                return CreateUserResult.Failure(roleResult.Errors.Select(e => e.Description));
            }

            _logger.LogInformation(
                "Created user '{UserName}' ({UserId}) with roles [{Roles}].",
                userName, user.Id, string.Join(", ", roles));

            return CreateUserResult.Success(new CreateUserResponse
            {
                User = ToListItem(user, roles),
                TemporaryPassword = temporaryPassword
            });
        }

        public async Task<UpdateUserResult> UpdateUserAsync(
            Guid userId, UpdateUserRequest request, Guid currentUserId, string updatedBy)
        {
            if (request is null)
            {
                return UpdateUserResult.Failure("No user details were supplied.");
            }

            var user = await _userRepository.FindByIdAsync(userId);

            // A soft-deleted account is gone as far as this screen is concerned - it is
            // filtered out of the list, so editing one could only ever be a stale dialog
            // left open across a delete.
            if (user is null || user.IsDeleted)
            {
                return UpdateUserResult.Missing();
            }

            var firstName = request.FirstName?.Trim() ?? string.Empty;
            var lastName = request.LastName?.Trim() ?? string.Empty;
            var userName = request.UserName?.Trim() ?? string.Empty;

            var errors = new List<string>();

            ValidateProfileFields(firstName, lastName, userName, errors);

            var assignableRoles = (await _userRepository.GetRolesAsync())
                .Select(role => role.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name!)
                .ToList();

            var roles = ResolveRoles(request.Roles, assignableRoles, errors);

            if (errors.Count > 0)
            {
                return UpdateUserResult.Failure(errors);
            }

            // Captured here, while user.UserName still holds the stored value - the new
            // one is not assigned until further down, so this is the only point at which
            // the two can be compared. Case-insensitive because that is how Identity's
            // normalisation treats it.
            //
            // Answers two questions with one comparison: whether a uniqueness lookup is
            // worth doing (otherwise every save would find the user's own row and report
            // it as a clash), and further down, whether the token has gone stale.
            var userNameChanged = !string.Equals(
                user.UserName,
                userName,
                StringComparison.OrdinalIgnoreCase);

            if (userNameChanged)
            {
                var existing = await _userRepository.FindByUserNameAsync(userName);

                if (existing is not null && existing.Id != user.Id)
                {
                    return UpdateUserResult.Failure($"Username '{userName}' is already taken.");
                }
            }

            var actor = string.IsNullOrWhiteSpace(updatedBy) ? "System" : updatedBy.Trim();

            // Both of these would lock the admin out of the screen they are standing on,
            // and neither is undoable from the UI afterwards - IsActive false refuses the
            // login outright, and dropping your own Admin role means every endpoint here
            // starts answering 403. Recovering either one needs direct database access.
            //
            // Compared by id, never by username. This very method can rename an account,
            // so an admin who had changed their own username would no longer match
            // themselves by name and would sail through both checks. The id is immutable
            // and comes from the validated token, so neither is true of it.
            var isEditingSelf = user.Id == currentUserId;

            if (isEditingSelf && !request.IsActive)
            {
                return UpdateUserResult.Failure(
                    "You cannot deactivate your own account. Ask another admin to do it.");
            }

            if (isEditingSelf && !roles.Contains(RoleNames.Admin, StringComparer.OrdinalIgnoreCase))
            {
                return UpdateUserResult.Failure(
                    "You cannot remove your own Admin role. Ask another admin to do it.");
            }

            user.FirstName = firstName;
            user.LastName = lastName;
            user.FullName = $"{firstName} {lastName}".Trim();
            user.UserName = userName;
            user.IsActive = request.IsActive;

            user.Updated = DateTime.Now;
            user.UpdatedBy = actor;

            var updateResult = await _userRepository.UpdateAsync(user);

            if (!updateResult.Succeeded)
            {
                _logger.LogWarning(
                    "Failed to update user {UserId}: {Errors}",
                    userId, Describe(updateResult));

                return UpdateUserResult.Failure(updateResult.Errors.Select(e => e.Description));
            }

            var (rolesChanged, roleErrors) = await SyncRolesAsync(user, roles);

            //
            // A JWT is a snapshot. Its role claims and its ClaimTypes.Name are both fixed
            // at the moment it was issued, so changing either in the database does nothing
            // to a token already in someone's browser:
            //
            //   roles    - they keep exercising a role that has been taken away
            //   username - UpdatedBy is written from User.Identity?.Name, so everything
            //              they touch is stamped with a username that no longer exists
            //
            // Rotating the security stamp closes both. OnTokenValidated compares the
            // token's stamp against this column on every request, so the old token starts
            // answering 401, the frontend's heartbeat sees it, and the user is sent back
            // to login to collect a token that matches the row.
            //
            // Only when something actually moved - a save that changed nothing but a
            // surname must not sign anybody out. And only after the writes: an update that
            // failed returned long before this point, so a stale token is never revoked
            // for a change that did not happen. A half-applied role sync does rotate,
            // because what the account can do has already changed.
            //
            if (rolesChanged || userNameChanged)
            {
                var stampResult = await _userRepository.UpdateSecurityStampAsync(user);

                if (!stampResult.Succeeded)
                {
                    // The change is already applied and cannot be unwound here. Logged
                    // loudly rather than reported as a failed save: it did happen, but the
                    // old token is still being honoured until it expires on its own.
                    _logger.LogError(
                        "User {UserId} changed (roles: {RolesChanged}, username: {UserNameChanged}) " +
                        "but the security stamp could not be rotated ({Errors}). Existing tokens " +
                        "stay valid until expiry.",
                        userId, rolesChanged, userNameChanged, Describe(stampResult));
                }
            }

            if (roleErrors is not null)
            {
                // The profile columns are already saved at this point. Reported rather
                // than rolled back: the admin sees exactly which part failed, and
                // reopening the dialog shows the real state of the row either way.
                _logger.LogError(
                    "Updated user {UserId} but could not apply roles [{Roles}]: {Errors}",
                    userId, string.Join(", ", roles), string.Join("; ", roleErrors));

                return UpdateUserResult.Failure(roleErrors);
            }

            _logger.LogInformation(
                "User {UserId} updated by '{Actor}'. Roles now [{Roles}] (changed: {RolesChanged}), " +
                "username changed: {UserNameChanged}, IsActive={IsActive}.",
                userId, actor, string.Join(", ", roles), rolesChanged, userNameChanged, user.IsActive);

            return UpdateUserResult.Success(ToListItem(user, roles));
        }

        public async Task<DeleteUserResult> DeleteUserAsync(
            Guid userId, Guid currentUserId, string deletedBy)
        {
            var user = await _userRepository.FindByIdAsync(userId);

            // Already-deleted reads the same as never-existed. Deleting twice is not an
            // error worth reporting differently - the caller wanted it gone, and it is.
            if (user is null || user.IsDeleted)
            {
                return DeleteUserResult.Missing();
            }

            var actor = string.IsNullOrWhiteSpace(deletedBy) ? "System" : deletedBy.Trim();

            // Same reasoning as the two guards in UpdateUserAsync, and compared the same
            // way - by immutable id, not by username: an admin who deletes their own
            // account is locked out with no way back through the UI, and this one cannot
            // even be undone by another admin without database access, because the row
            // disappears from the only screen that lists users.
            if (user.Id == currentUserId)
            {
                return DeleteUserResult.Failure(
                    "You cannot delete your own account. Ask another admin to do it.");
            }

            user.IsDeleted = true;

            // IsActive is deliberately left alone. It is the reversible suspension and
            // this is the soft delete - two separate facts. Clearing the delete flag
            // later should hand the account back in the state it was in, not silently
            // suspended as well.
            user.Updated = DateTime.Now;
            user.UpdatedBy = actor;

            var result = await _userRepository.UpdateAsync(user);

            if (!result.Succeeded)
            {
                _logger.LogWarning(
                    "Failed to delete user {UserId}: {Errors}", userId, Describe(result));

                return DeleteUserResult.Failure(result.Errors.Select(e => e.Description));
            }

            // Logged at Information with the actor: this is the one action on this
            // screen that removes an account from everybody else's view.
            _logger.LogInformation(
                "User '{UserName}' ({UserId}) soft-deleted by '{Actor}'.",
                user.UserName, userId, actor);

            return DeleteUserResult.Success();
        }

        public async Task<SetPasswordResult> SetPasswordAsync(
            Guid userId, SetUserPasswordRequest request, string changedBy)
        {
            if (request is null)
            {
                return SetPasswordResult.Failure("No password was supplied.");
            }

            var user = await _userRepository.FindByIdAsync(userId);

            if (user is null || user.IsDeleted)
            {
                return SetPasswordResult.Missing();
            }

            // Not trimmed. Leading and trailing spaces are legitimate password characters,
            // and quietly removing them would set a password different from the one the
            // admin typed and is about to hand over.
            var newPassword = request.NewPassword ?? string.Empty;
            var confirmPassword = request.ConfirmPassword ?? string.Empty;

            if (string.IsNullOrEmpty(newPassword))
            {
                return SetPasswordResult.Failure("A new password is required.");
            }

            // Ordinal, not a culture-aware comparison: two strings that differ by a single
            // byte are different passwords, whatever any locale's collation thinks.
            if (!string.Equals(newPassword, confirmPassword, StringComparison.Ordinal))
            {
                return SetPasswordResult.Failure("The two passwords do not match.");
            }

            var actor = string.IsNullOrWhiteSpace(changedBy) ? "System" : changedBy.Trim();

            // The token path rather than assigning PasswordHash: this is what runs the
            // configured validators and rotates the security stamp.
            var token = await _userRepository.GeneratePasswordResetTokenAsync(user);

            var resetResult = await _userRepository.ResetPasswordAsync(user, token, newPassword);

            if (!resetResult.Succeeded)
            {
                // Describe() prints Identity's codes and descriptions - "PasswordTooShort",
                // "PasswordRequiresDigit" and so on. It never sees the password itself.
                _logger.LogWarning(
                    "Password reset rejected for user {UserId}: {Errors}",
                    userId, Describe(resetResult));

                return SetPasswordResult.Failure(resetResult.Errors.Select(e => e.Description));
            }

            user.Updated = DateTime.Now;
            user.UpdatedBy = actor;

            var stampResult = await _userRepository.UpdateAsync(user);

            if (!stampResult.Succeeded)
            {
                // The password itself is already changed and that cannot be undone here.
                // Reporting a failure would tell the admin the reset did not happen, which
                // is worse than an audit column lagging by one edit - so this is logged
                // and swallowed rather than surfaced.
                _logger.LogError(
                    "Password for user {UserId} was reset but the audit stamp failed: {Errors}",
                    userId, Describe(stampResult));
            }

            // Deliberately records only that it happened, by whom, and to whom.
            _logger.LogInformation(
                "Password for user '{UserName}' ({UserId}) was reset by '{Actor}'.",
                user.UserName, userId, actor);

            return SetPasswordResult.Success();
        }

        /// <summary>
        /// Brings the user's role assignments to exactly <paramref name="roles"/>.
        ///
        /// Only the difference is written, so a save that did not touch the dropdown does
        /// not churn AspNetUserRoles. Removals go first: doing it the other way round
        /// would briefly leave the account holding both the old and the new set.
        /// </summary>
        /// <returns>The failure reasons, or null when the roles now match.</returns>
        /// <returns>
        /// Changed says whether AspNetUserRoles was actually written to, and drives
        /// whether the caller rotates the security stamp. It is reported separately from
        /// success on purpose: a remove that lands followed by an add that fails has still
        /// changed what the account can do, and that token must stop being accepted.
        ///
        /// Errors is null when the roles now match.
        /// </returns>
        private async Task<(bool Changed, List<string>? Errors)> SyncRolesAsync(
            ApplicationUser user, List<string> roles)
        {
            var current = await _userRepository.GetRolesForUserAsync(user);

            var toRemove = current
                .Where(existing => !roles.Contains(existing, StringComparer.OrdinalIgnoreCase))
                .ToList();

            var toAdd = roles
                .Where(wanted => !current.Contains(wanted, StringComparer.OrdinalIgnoreCase))
                .ToList();

            // Nothing to do. Reported as unchanged so a save that only touched a name
            // does not sign the user out for no reason.
            if (toRemove.Count == 0 && toAdd.Count == 0)
            {
                return (false, null);
            }

            var changed = false;

            if (toRemove.Count > 0)
            {
                var removeResult = await _userRepository.RemoveFromRolesAsync(user, toRemove);

                if (!removeResult.Succeeded)
                {
                    return (changed, removeResult.Errors.Select(e => e.Description).ToList());
                }

                changed = true;
            }

            if (toAdd.Count > 0)
            {
                var addResult = await _userRepository.AddToRolesAsync(user, toAdd);

                if (!addResult.Succeeded)
                {
                    // changed may already be true from the removals above - deliberately
                    // returned as-is rather than reset, so a half-applied change still
                    // invalidates the token.
                    return (changed, addResult.Errors.Select(e => e.Description).ToList());
                }

                changed = true;
            }

            return (true, null);
        }

        /// <summary>
        /// The three fields create and edit both accept. Shared so the two paths cannot
        /// drift into disagreeing about what a valid name is.
        /// </summary>
        private static void ValidateProfileFields(
            string firstName, string lastName, string userName, List<string> errors)
        {
            ValidateNameFields(firstName, lastName, errors);

            var userNameError = ValidateUserNameFormat(userName);

            if (userNameError is not null)
            {
                errors.Add(userNameError);
            }
        }

        /// <summary>
        /// Just the two name fields, without the username.
        ///
        /// Public and split out for AuthService's self-service profile edit, which
        /// validates its username through <see cref="CheckUserNameAsync"/> instead - that
        /// call already applies <see cref="ValidateUserNameFormat"/> and then goes on to
        /// check the name is free, so running the format rules here as well would report
        /// the same problem twice.
        ///
        /// Shared rather than reimplemented so "what is an acceptable name" has exactly
        /// one definition: an admin creating an account, an admin editing one, and a user
        /// editing their own profile all answer that question the same way.
        /// </summary>
        public static void ValidateNameFields(
            string firstName, string lastName, List<string> errors)
        {
            if (string.IsNullOrWhiteSpace(firstName))
            {
                errors.Add("First name is required.");
            }
            else if (firstName.Length > 100)
            {
                errors.Add("First name cannot be longer than 100 characters.");
            }

            if (string.IsNullOrWhiteSpace(lastName))
            {
                errors.Add("Last name is required.");
            }
            else if (lastName.Length > 100)
            {
                errors.Add("Last name cannot be longer than 100 characters.");
            }
        }

        /// <summary>
        /// Matches the submitted role names against the roles that actually exist in
        /// AspNetRoles and rejects anything else. This is what stops a hand-crafted
        /// request from assigning a role nobody defined - the check is against the
        /// table rather than a compiled list, so it covers roles added by SQL too.
        ///
        /// Matching is case-insensitive and returns the spelling stored in the table,
        /// so "dev" and "DEV" both resolve to whatever AspNetRoles actually holds.
        /// </summary>
        private static List<string> ResolveRoles(
            IEnumerable<string>? requestedRoles,
            IReadOnlyCollection<string> assignableRoles,
            List<string> errors)
        {
            var roles = new List<string>();
            var sawUnknownRole = false;

            foreach (var requested in requestedRoles ?? Enumerable.Empty<string>())
            {
                var match = assignableRoles.FirstOrDefault(
                    r => string.Equals(r, requested?.Trim(), StringComparison.OrdinalIgnoreCase));

                if (match is null)
                {
                    errors.Add($"'{requested}' is not a valid role.");
                    sawUnknownRole = true;
                    continue;
                }

                if (!roles.Contains(match))
                {
                    roles.Add(match);
                }
            }

            // "Select at least one role" would be misleading on a request that did pick
            // roles and simply got the names wrong - it has already been told that.
            if (roles.Count == 0 && !sawUnknownRole)
            {
                errors.Add("At least one role must be selected.");
            }

            return roles;
        }

        private static string? ValidateUserNameFormat(string userName)
        {
            if (string.IsNullOrWhiteSpace(userName))
            {
                return "Username is required.";
            }

            if (!UserNamePattern.IsMatch(userName))
            {
                return "Username must be 3-50 characters and may only contain letters, " +
                       "digits and . _ - @ +";
            }

            return null;
        }

        private static UserListItemDto ToListItem(ApplicationUser user, IEnumerable<string> roles)
        {
            var fullName = !string.IsNullOrWhiteSpace(user.FullName)
                ? user.FullName!
                : $"{user.FirstName} {user.LastName}".Trim();

            return new UserListItemDto
            {
                UserId = user.Id,
                UserName = user.UserName ?? string.Empty,

                // Accounts that pre-date the FirstName/LastName columns - the seeded ones -
                // only have FullName, so the table would otherwise show a blank name.
                FirstName = user.FirstName ?? SplitFullName(fullName).FirstName,
                LastName = user.LastName ?? SplitFullName(fullName).LastName,

                FullName = fullName,
                Email = user.Email ?? string.Empty,
                Roles = roles.ToList(),
                IsActive = user.IsActive,

                // The Edit User dialog shows all four of these side by side. Rows that
                // pre-date the audit columns have them null, and the dialog would rather
                // print nothing than the word "null".
                Created = user.Created,
                CreatedBy = user.CreatedBy ?? string.Empty,
                Updated = user.Updated,
                UpdatedBy = user.UpdatedBy ?? string.Empty
            };
        }

        /// <summary>
        /// Best guess at the two name parts of a stored FullName, for accounts that
        /// pre-date the FirstName/LastName columns - the seeded ones have only FullName,
        /// and a dialog bound to two blank boxes would save those blanks over the name
        /// that is actually there.
        ///
        /// Only ever a fallback: whenever the real columns hold a value, that value wins.
        ///
        /// Public because AuthService maps the same account into CurrentUserDto for
        /// /api/auth/me and has to arrive at the same two values. A second copy of this
        /// rule would let the profile card and the User Details table disagree about what
        /// somebody is called.
        /// </summary>
        public static (string FirstName, string LastName) SplitFullName(string fullName)
        {
            var parts = (fullName ?? string.Empty)
                .Split(' ', StringSplitOptions.RemoveEmptyEntries);

            return (
                parts.Length > 0 ? parts[0] : string.Empty,
                parts.Length > 1 ? string.Join(' ', parts.Skip(1)) : string.Empty);
        }

        private static string Describe(IdentityResult result) =>
            string.Join("; ", result.Errors.Select(e => $"{e.Code}: {e.Description}"));
    }
}
