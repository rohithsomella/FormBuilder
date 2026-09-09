using FormBuilderAppService.Models.DTOs.Auth;
using FormBuilderAppService.Models.DTOs.Users;
using FormBuilderAppService.Models.Identity;
using FormBuilderAppService.Services.Interfaces;
using Microsoft.AspNetCore.Identity;

namespace FormBuilderAppService.Services
{
    /// <summary>
    /// Authentication logic. Password hashing, verification and role lookup are all
    /// delegated to ASP.NET Core Identity - this class only decides whether the supplied
    /// identifier is an email or a username, and turns a successful sign-in into a token.
    /// </summary>
    public class AuthService : IAuthService
    {
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly SignInManager<ApplicationUser> _signInManager;
        private readonly IJwtTokenService _jwtTokenService;

        /// <summary>
        /// Used for one thing only: the username rules. A user renaming themselves must
        /// be held to exactly the same standard as an admin renaming them, and the way to
        /// guarantee that is to call the same method rather than write a second copy of
        /// it here.
        /// </summary>
        private readonly IUserManagementService _userManagementService;

        private readonly ILogger<AuthService> _logger;

        public AuthService(
            UserManager<ApplicationUser> userManager,
            SignInManager<ApplicationUser> signInManager,
            IJwtTokenService jwtTokenService,
            IUserManagementService userManagementService,
            ILogger<AuthService> logger)
        {
            _userManager = userManager;
            _signInManager = signInManager;
            _jwtTokenService = jwtTokenService;
            _userManagementService = userManagementService;
            _logger = logger;
        }

        public async Task<LoginResponse?> LoginAsync(LoginRequest request)
        {
            var identifier = request.LoginIdentifier?.Trim();

            if (string.IsNullOrWhiteSpace(identifier) || string.IsNullOrEmpty(request.Password))
            {
                return null;
            }

            var user = await FindByIdentifierAsync(identifier);

            if (user is null)
            {
                // Still log at debug only: the caller returns the same generic message
                // whether or not the account exists.
                _logger.LogDebug("Login failed: no account matched the supplied identifier.");
                return null;
            }

            // Identity verifies the hash, honours lockout, and never exposes the stored
            // password. lockoutOnFailure: true so failed attempts are recorded against
            // the account for the V2 lockout work.
            var result = await _signInManager.CheckPasswordSignInAsync(
                user, request.Password, lockoutOnFailure: true);

            if (!result.Succeeded)
            {
                _logger.LogWarning(
                    "Login failed for user {UserId}. LockedOut={LockedOut}, NotAllowed={NotAllowed}.",
                    user.Id, result.IsLockedOut, result.IsNotAllowed);
                return null;
            }

            // Deliberately checked AFTER the password, not before.
            //
            // Identity's sign-in only verifies the hash and the lockout counter - it knows
            // nothing about these two columns, so without this a suspended or soft-deleted
            // account still receives a fully valid token and keeps working until it
            // expires. The account also disappears from the admin User Details table
            // (UserRepository.GetUsersAsync filters IsDeleted), so the screen would say
            // access was revoked while it demonstrably was not.
            //
            // Running the hash comparison first costs one wasted verification on an
            // account that is going to be refused anyway, and buys a uniform response
            // time: rejecting before the hash check would make "this account is disabled"
            // measurably faster than "wrong password", which is exactly the distinction
            // the single InvalidCredentialsMessage in AuthController exists to prevent.
            if (!IsUsable(user))
            {
                _logger.LogWarning(
                    "Login refused for user {UserId}: IsActive={IsActive}, IsDeleted={IsDeleted}.",
                    user.Id, user.IsActive, user.IsDeleted);
                return null;
            }

            return await BuildLoginResponseAsync(user);
        }

        public async Task<CurrentUserDto?> GetUserByIdAsync(Guid userId)
        {
            var user = await _userManager.FindByIdAsync(userId.ToString());

            // Same rule as login, applied to an already-issued token. Tokens are stateless
            // and live for Jwt:ExpirationMinutes, so without this an account suspended a
            // minute ago would keep answering /api/auth/me until its token expired.
            //
            // Returning null makes the endpoint answer 401, which the frontend already
            // treats as "the session is over": auth.js clears local state and returns to
            // the login page. Suspending an account therefore signs it out on the next
            // page load rather than up to an hour later.
            if (user is null || !IsUsable(user))
            {
                return null;
            }

            var roles = await _userManager.GetRolesAsync(user);
            return ToDto(user, roles);
        }

        // ----------------------------------------------------------------- own profile

        public Task<UserNameAvailabilityDto> CheckOwnUserNameAsync(
            string? userName, Guid currentUserId) =>
            // currentUserId comes from the token and is passed as excludeUserId, so the
            // caller's own name never reads as taken. This is the same method the admin
            // dialog's Verify button calls, which is why Verify and Save cannot disagree.
            //
            // revealReservedReason: false is the default, and is passed anyway. Any
            // signed-in user can call this, so it must not distinguish "taken" from
            // "belonged to a deleted account" - that turns the Verify button into a way
            // to enumerate accounts that were deleted in order to stop being visible.
            // Stating it means this guarantee is visible at the call site rather than
            // resting on a default somebody could later flip. UsersController opts in.
            _userManagementService.CheckUserNameAsync(
                userName, currentUserId, revealReservedReason: false);

        public async Task<UpdateProfileResult> UpdateProfileAsync(
            Guid userId, UpdateProfileRequest request, string updatedBy)
        {
            if (request is null)
            {
                return UpdateProfileResult.Failure("No profile details were supplied.");
            }

            var user = await _userManager.FindByIdAsync(userId.ToString());

            // Same rule as GetUserByIdAsync. A token for a suspended or deleted account
            // is already refused at validation, so this is belt and braces - but an edit
            // is a write, and a write is the wrong place to start trusting that.
            if (user is null || !IsUsable(user))
            {
                return UpdateProfileResult.Missing();
            }

            var firstName = request.FirstName?.Trim() ?? string.Empty;
            var lastName = request.LastName?.Trim() ?? string.Empty;
            var userName = request.UserName?.Trim() ?? string.Empty;

            var errors = new List<string>();

            UserManagementService.ValidateNameFields(firstName, lastName, errors);

            // Covers both halves of "is this username usable" - the format rules and
            // whether anybody else holds it - and hands back the same sentence the Verify
            // button showed, so Save cannot contradict what the dialog just said.
            var availability = await CheckOwnUserNameAsync(userName, userId);

            if (!availability.IsAvailable)
            {
                errors.Add(availability.Message);
            }

            if (errors.Count > 0)
            {
                return UpdateProfileResult.Failure(errors);
            }

            var actor = string.IsNullOrWhiteSpace(updatedBy) ? "System" : updatedBy.Trim();

            user.FirstName = firstName;
            user.LastName = lastName;
            user.FullName = $"{firstName} {lastName}".Trim();
            user.UserName = userName;

            user.Updated = DateTime.Now;
            user.UpdatedBy = actor;

            // UpdateAsync rather than SaveChanges: this is what rewrites
            // NormalizedUserName, and login looks the account up by that column. Saving
            // the entity directly would rename the user out of their own sign-in.
            var updateResult = await _userManager.UpdateAsync(user);

            if (!updateResult.Succeeded)
            {
                _logger.LogWarning(
                    "Failed to update the profile for user {UserId}: {Errors}",
                    userId, Describe(updateResult));

                return UpdateProfileResult.Failure(
                    updateResult.Errors.Select(e => e.Description));
            }

            //
            // Deliberately does NOT rotate the security stamp, which is the one place
            // this path parts company with UserManagementService.UpdateUserAsync.
            //
            // That method rotates because an admin renaming SOMEBODY ELSE has no way to
            // hand them a corrected token - their browser is holding one that says they
            // are still called the old name, and the only remedy is to stop honouring it.
            //
            // Here the person being renamed is the person making the call, so there is a
            // better remedy: mint the replacement and give it to them in the response.
            // Rotating as well would revoke the very token this reply is about to make
            // valid again, for no gain - nothing about what the account may DO has
            // changed, only what it is called.
            //
            // Minting it is not optional, though. ClaimTypes.Name is fixed at issue time
            // and is what User.Identity?.Name returns, which is what every UpdatedBy
            // column on this API is stamped from - so a user carrying their pre-rename
            // token would sign the rest of their session with a username that no longer
            // exists.
            //
            var session = await BuildLoginResponseAsync(user);

            _logger.LogInformation(
                "User {UserId} updated their own profile; username is now '{UserName}'.",
                userId, user.UserName);

            return UpdateProfileResult.Success(session);
        }

        public async Task<ProfileActionResult> ChangePasswordAsync(
            Guid userId, ChangePasswordRequest request, string changedBy)
        {
            if (request is null)
            {
                return ProfileActionResult.Failure("No password details were supplied.");
            }

            var user = await _userManager.FindByIdAsync(userId.ToString());

            if (user is null || !IsUsable(user))
            {
                return ProfileActionResult.Missing();
            }

            // None of the three are trimmed. Leading and trailing spaces are legitimate
            // password characters, and quietly removing them would compare - and store -
            // something other than what was typed.
            var currentPassword = request.CurrentPassword ?? string.Empty;
            var newPassword = request.NewPassword ?? string.Empty;
            var confirmPassword = request.ConfirmPassword ?? string.Empty;

            if (string.IsNullOrEmpty(currentPassword))
            {
                return ProfileActionResult.Failure("Enter your current password.");
            }

            //
            // The current password is checked first and on its own, before anything is
            // said about the new one. Somebody who cannot produce the existing password
            // is not entitled to learn this account's password policy one rejection at a
            // time - and it is the order the dialog presents the fields in, so the error
            // lands on the box the user needs to fix.
            //
            // CheckPasswordAsync, not CheckPasswordSignInAsync: this is a deliberate
            // difference from login. Counting failures here towards Identity's lockout
            // would let a handful of typos on your own profile page lock you out of the
            // account entirely, and the attack lockout exists to stop - guessing your way
            // in from outside - is not available to somebody who already holds a valid
            // token for this account.
            //
            if (!await _userManager.CheckPasswordAsync(user, currentPassword))
            {
                _logger.LogWarning(
                    "Password change refused for user {UserId}: the current password did not match.",
                    userId);

                return ProfileActionResult.Failure("Your current password is incorrect.");
            }

            if (string.IsNullOrEmpty(newPassword))
            {
                return ProfileActionResult.Failure("Enter a new password.");
            }

            // Ordinal, not culture-aware: two strings differing by a single byte are
            // different passwords, whatever any locale's collation thinks of them.
            if (!string.Equals(newPassword, confirmPassword, StringComparison.Ordinal))
            {
                return ProfileActionResult.Failure(
                    "The new password and the confirmation do not match.");
            }

            if (string.Equals(newPassword, currentPassword, StringComparison.Ordinal))
            {
                return ProfileActionResult.Failure(
                    "Your new password must be different from your current password.");
            }

            var actor = string.IsNullOrWhiteSpace(changedBy) ? "System" : changedBy.Trim();

            // Identity re-verifies the current password itself, runs the configured
            // password validators, writes the new PasswordHash, and rotates SecurityStamp
            // - which is what ends every session for this account. Assigning PasswordHash
            // by hand would skip all four.
            var changeResult = await _userManager.ChangePasswordAsync(
                user, currentPassword, newPassword);

            if (!changeResult.Succeeded)
            {
                // Describe() prints Identity's codes and descriptions - "PasswordTooShort",
                // "PasswordRequiresDigit" and so on. It never sees the password itself.
                _logger.LogWarning(
                    "Password change rejected for user {UserId}: {Errors}",
                    userId, Describe(changeResult));

                return ProfileActionResult.Failure(
                    changeResult.Errors.Select(e => e.Description));
            }

            user.Updated = DateTime.Now;
            user.UpdatedBy = actor;

            var auditResult = await _userManager.UpdateAsync(user);

            if (!auditResult.Succeeded)
            {
                // The password is already changed and that cannot be undone here.
                // Reporting a failure would tell the user their new password did not take
                // - which is worse than an audit column lagging by one edit - so this is
                // logged and swallowed rather than surfaced.
                _logger.LogError(
                    "Password for user {UserId} was changed but the audit stamp failed: {Errors}",
                    userId, Describe(auditResult));
            }

            // Records only that it happened and to whom. Never the password, and never
            // the old one either.
            _logger.LogInformation(
                "User '{UserName}' ({UserId}) changed their own password. All existing " +
                "tokens for this account are now invalid.",
                user.UserName, userId);

            return ProfileActionResult.Success();
        }

        public async Task<ProfileActionResult> DeactivateOwnAccountAsync(
            Guid userId, string deactivatedBy)
        {
            var user = await _userManager.FindByIdAsync(userId.ToString());

            if (user is null || user.IsDeleted)
            {
                return ProfileActionResult.Missing();
            }

            // Nothing to do, and not worth an error: a token for an inactive account is
            // already refused at validation, so this can only be reached by a request
            // that raced itself.
            if (!user.IsActive)
            {
                return ProfileActionResult.Success();
            }

            var roles = await _userManager.GetRolesAsync(user);

            // The same self-lockout guard UserManagementService applies, for the same
            // reason and with more force. Login refuses an inactive account, so the only
            // way back is another admin flipping the flag - and an admin who suspends
            // themselves may well be the only admin there is, in which case nobody can.
            if (roles.Contains(RoleNames.Admin, StringComparer.OrdinalIgnoreCase))
            {
                return ProfileActionResult.Failure(
                    "You cannot deactivate your own Admin account. Ask another admin to do it.");
            }

            var actor = string.IsNullOrWhiteSpace(deactivatedBy) ? "System" : deactivatedBy.Trim();

            user.IsActive = false;

            // IsDeleted is deliberately left alone. This is the reversible suspension,
            // not the soft delete - the account can be switched back on by an admin, and
            // should come back in the state it was in rather than as a deleted row.
            user.Updated = DateTime.Now;
            user.UpdatedBy = actor;

            var result = await _userManager.UpdateAsync(user);

            if (!result.Succeeded)
            {
                _logger.LogWarning(
                    "Failed to deactivate account {UserId}: {Errors}", userId, Describe(result));

                return ProfileActionResult.Failure(result.Errors.Select(e => e.Description));
            }

            // No security stamp rotation needed. OnTokenValidated refuses a token whose
            // account has IsActive false outright, before it ever looks at the stamp - so
            // this write has already ended every session for the account.
            _logger.LogInformation(
                "User '{UserName}' ({UserId}) deactivated their own account.",
                user.UserName, userId);

            return ProfileActionResult.Success();
        }

        /// <summary>
        /// Whether an account may hold a session at all, independent of its password.
        ///
        /// IsActive is the reversible suspension and IsDeleted is the soft delete; the row
        /// survives either way so submissions and audit trails still resolve to a real
        /// account. Both are set on create (UserManagementService, IdentitySeeder) and
        /// this is the single place the authentication path reads them.
        /// </summary>
        private static bool IsUsable(ApplicationUser user) => user.IsActive && !user.IsDeleted;

        /// <summary>
        /// Resolves one login box to one Identity user.
        ///
        /// The '@' test picks the likely lookup, then the other lookup is tried as a
        /// fallback so an account whose username happens to contain '@' (or an email
        /// stored without one) still resolves.
        /// </summary>
        private async Task<ApplicationUser?> FindByIdentifierAsync(string identifier)
        {
            if (string.IsNullOrWhiteSpace(identifier))
            {
                return null;
            }

            if (identifier.Contains('@'))
            {
                return await _userManager.FindByEmailAsync(identifier)
                       ?? await _userManager.FindByNameAsync(identifier);
            }

            return await _userManager.FindByNameAsync(identifier)
                   ?? await _userManager.FindByEmailAsync(identifier);
        }

        private async Task<LoginResponse> BuildLoginResponseAsync(ApplicationUser user)
        {
            var roles = await _userManager.GetRolesAsync(user);
            var (token, expiresAtUtc) = _jwtTokenService.CreateToken(user, roles);

            _logger.LogInformation(
                "Issued token for user {UserId} with roles [{Roles}].",
                user.Id, string.Join(", ", roles));

            return new LoginResponse
            {
                Token = token,
                ExpiresAtUtc = expiresAtUtc,
                User = ToDto(user, roles)
            };
        }

        private static CurrentUserDto ToDto(ApplicationUser user, IEnumerable<string> roles)
        {
            var fullName = !string.IsNullOrWhiteSpace(user.FullName)
                ? user.FullName!
                : $"{user.FirstName} {user.LastName}".Trim();

            // Same fallback UserManagementService.ToListItem applies, and the same method
            // rather than a second copy of the rule: an account seeded before the
            // FirstName/LastName columns existed has only FullName, and the Edit Profile
            // dialog must not open with two blank boxes it is about to save.
            var (fallbackFirst, fallbackLast) = UserManagementService.SplitFullName(fullName);

            return new CurrentUserDto
            {
                UserId = user.Id,
                UserName = user.UserName ?? string.Empty,
                Email = user.Email ?? string.Empty,
                FullName = fullName,
                FirstName = user.FirstName ?? fallbackFirst,
                LastName = user.LastName ?? fallbackLast,
                Roles = roles.ToList()
            };
        }

        /// <summary>
        /// Identity's failure reasons as one log line - the codes as well as the
        /// descriptions, because "PasswordRequiresNonAlphanumeric" is what a search
        /// finds. Never sees a password: IdentityResult carries only verdicts.
        /// </summary>
        private static string Describe(IdentityResult result) =>
            string.Join("; ", result.Errors.Select(e => $"{e.Code}: {e.Description}"));
    }
}
