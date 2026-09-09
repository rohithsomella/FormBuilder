namespace FormBuilderAppService.Models.DTOs.Auth
{
    /// <summary>
    /// The single login request. There is one login flow: LoginIdentifier accepts either
    /// a username or an email address and the backend works out which it is.
    ///
    /// Deliberately carries no [Required] attributes. With [ApiController], a failed
    /// validation attribute short-circuits into a 400 with field-level detail before the
    /// action runs - which would make "you left the password blank" externally
    /// distinguishable from "that password is wrong". Empty values are checked in the
    /// action instead, so every rejected login looks identical from outside.
    /// </summary>
    public class LoginRequest
    {
        public string LoginIdentifier { get; set; } = string.Empty;

        public string Password { get; set; } = string.Empty;
    }

    /// <summary>
    /// Returned on a successful login. The user block is for rendering the UI only -
    /// every authorization decision is made from the signed token, never from this.
    /// </summary>
    public class LoginResponse
    {
        public string Token { get; set; } = string.Empty;

        public DateTime ExpiresAtUtc { get; set; }

        public CurrentUserDto User { get; set; } = new();
    }

    /// <summary>
    /// The authenticated user as the frontend sees them. Built from the validated token
    /// and Identity, so /api/auth/me is the authoritative answer to "who am I".
    /// </summary>
    public class CurrentUserDto
    {
        public Guid UserId { get; set; }

        public string UserName { get; set; } = string.Empty;

        public string Email { get; set; } = string.Empty;

        public string? FullName { get; set; }

        /// <summary>
        /// The two stored name columns, carried separately as well as joined into
        /// FullName.
        ///
        /// The Edit Profile dialog has a box for each and needs the real values to put in
        /// them. Splitting FullName on the first space instead - which is what the page
        /// did before this endpoint could save - guesses wrong for anyone with a
        /// two-word first name, and once Save actually writes, that guess is stored: a
        /// user called "Mary Jane Watson" would open the dialog, touch nothing, press
        /// Save, and end up with FirstName "Mary" and LastName "Jane Watson".
        /// </summary>
        public string FirstName { get; set; } = string.Empty;

        public string LastName { get; set; } = string.Empty;

        public List<string> Roles { get; set; } = new();

        /// <summary>
        /// Convenience flag for the UI's role check. Derived from Roles - it is not a
        /// separately stored value that could disagree with the token.
        /// </summary>
        public bool IsAdmin =>
            Roles.Any(r => string.Equals(r, RoleNames.Admin, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// What the Edit Profile dialog sends when a user saves their own details.
    ///
    /// Deliberately not <see cref="Users.UpdateUserRequest"/>, even though three of its
    /// fields are the same. That one also carries Roles and IsActive, and the shape of a
    /// request is a promise about what the endpoint will accept: a user editing their own
    /// profile must not be able to grant themselves a role or re-enable a suspended
    /// account, and the surest way to guarantee that is to give those fields nowhere to
    /// bind in the first place.
    ///
    /// No email either. The profile card displays it but the dialog cannot edit it, so a
    /// request that omitted it would otherwise read as "clear my email".
    /// </summary>
    public class UpdateProfileRequest
    {
        public string FirstName { get; set; } = string.Empty;

        public string LastName { get; set; } = string.Empty;

        public string UserName { get; set; } = string.Empty;
    }

    /// <summary>
    /// What the dialog's Change Password panel sends.
    ///
    /// CurrentPassword is the whole difference between this and the admin's
    /// <see cref="Users.SetUserPasswordRequest"/>. An admin resetting somebody else's
    /// password proves their authority with the Admin role; a user changing their own
    /// proves it by knowing the password they are replacing. A valid token is not enough
    /// on its own - a token is exactly what an unattended browser leaves lying around.
    /// </summary>
    public class ChangePasswordRequest
    {
        public string CurrentPassword { get; set; } = string.Empty;

        public string NewPassword { get; set; } = string.Empty;

        /// <summary>
        /// Re-checked on the server even though the dialog compares them first. A typo
        /// caught only by client-side script is not caught at all.
        /// </summary>
        public string ConfirmPassword { get; set; } = string.Empty;
    }

    /// <summary>
    /// Service-layer outcome of a self-service profile edit.
    ///
    /// Session is the point of it, and the reason this does not just return the user.
    /// Renaming yourself changes ClaimTypes.Name, which is what every audit column on
    /// this API is stamped from - so the caller is handed a token minted from the row as
    /// it now stands and carries on working, instead of spending the rest of the session
    /// signing their edits with a username that no longer exists.
    ///
    /// Null on failure: there is no session to hand back for a change that did not happen.
    /// </summary>
    public class UpdateProfileResult
    {
        public bool Succeeded { get; private init; }

        public bool NotFound { get; private init; }

        public LoginResponse? Session { get; private init; }

        public List<string> Errors { get; private init; } = new();

        public static UpdateProfileResult Success(LoginResponse session) => new()
        {
            Succeeded = true,
            Session = session
        };

        public static UpdateProfileResult Missing() => new()
        {
            Succeeded = false,
            NotFound = true,
            Errors = { "Your account could not be found." }
        };

        public static UpdateProfileResult Failure(params string[] errors) => new()
        {
            Succeeded = false,
            Errors = errors.ToList()
        };

        public static UpdateProfileResult Failure(IEnumerable<string> errors) => new()
        {
            Succeeded = false,
            Errors = errors.ToList()
        };
    }

    /// <summary>
    /// Service-layer outcome of the two profile actions that end the session: changing
    /// your own password and deactivating your own account.
    ///
    /// One type for both because there is genuinely nothing to return from either. The
    /// password has been hashed and must never be echoed back, and a deactivated account
    /// is not something the caller should still be rendering. Both leave every token
    /// issued for the account unusable, so the only screen either one can lead to is the
    /// login page.
    /// </summary>
    public class ProfileActionResult
    {
        public bool Succeeded { get; private init; }

        public bool NotFound { get; private init; }

        public List<string> Errors { get; private init; } = new();

        public static ProfileActionResult Success() => new()
        {
            Succeeded = true
        };

        public static ProfileActionResult Missing() => new()
        {
            Succeeded = false,
            NotFound = true,
            Errors = { "Your account could not be found." }
        };

        public static ProfileActionResult Failure(params string[] errors) => new()
        {
            Succeeded = false,
            Errors = errors.ToList()
        };

        public static ProfileActionResult Failure(IEnumerable<string> errors) => new()
        {
            Succeeded = false,
            Errors = errors.ToList()
        };
    }

    /// <summary>
    /// The roles C# refers to by name. Constants rather than literals so a typo in an
    /// [Authorize(Roles = ...)] attribute is a compile error, not a silent 403.
    ///
    /// A role belongs here ONLY if code names it: "Admin" is referenced by
    /// [Authorize(Roles = RoleNames.Admin)] and by CurrentUserDto.IsAdmin. Every other
    /// role lives purely as a row in AspNetRoles and is never mentioned in C#. Those
    /// still work everywhere it matters: the JWT's role claims are built from
    /// AspNetUserRoles, so authorization, /api/auth/me and the User Details table all
    /// resolve them without any constant.
    ///
    /// This is NOT the list of roles that may be assigned. That comes from AspNetRoles
    /// (see UserManagementService), so a new role is an INSERT rather than a rebuild.
    /// All exists only so IdentitySeeder can guarantee the roles the code depends on
    /// exist on a fresh database.
    /// </summary>
    public static class RoleNames
    {
        public const string Admin = "Admin";
        public const string User = "User";

        /// <summary>
        /// Roles the seeder creates if missing, because C# depends on them existing.
        /// Anything else is expected to be inserted into AspNetRoles directly.
        /// </summary>
        public static readonly string[] All = { Admin, User };
    }

    /// <summary>
    /// Names of the rate-limiting policies configured in Program.cs. Constants for the
    /// same reason as RoleNames: [EnableRateLimiting] takes a string, and a policy name
    /// that does not exist throws at request time rather than at build time.
    /// </summary>
    public static class RateLimitPolicies
    {
        /// <summary>
        /// PUT /api/auth/password. Guards the current-password check, which is what
        /// makes a stolen token insufficient to take an account over.
        /// </summary>
        public const string SelfServicePassword = "self-service-password";

        /// <summary>
        /// GET /api/auth/username-availability. Any signed-in user can call it and it
        /// answers "does this account exist", so it is worth slowing down.
        /// </summary>
        public const string SelfServiceUserName = "self-service-username";
    }
}
