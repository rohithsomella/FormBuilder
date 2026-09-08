using FormBuilderAppService.Models.DTOs.Auth;
using FormBuilderAppService.Models.DTOs.Users;

namespace FormBuilderAppService.Services.Interfaces
{
    public interface IAuthService
    {
        /// <summary>
        /// Validates a username-or-email plus password against ASP.NET Core Identity and
        /// issues a JWT. Returns null for every failure - unknown user, wrong password,
        /// locked out - so the caller cannot accidentally leak which one it was.
        /// </summary>
        Task<LoginResponse?> LoginAsync(LoginRequest request);

        /// <summary>
        /// Loads the current user by id, as taken from a validated token.
        /// </summary>
        Task<CurrentUserDto?> GetUserByIdAsync(Guid userId);

        // ------------------------------------------------------------- own profile
        //
        // Everything below is a user acting on their own account. The id is never a
        // parameter the caller supplies - it comes from the validated token - so none of
        // these can be aimed at somebody else's row. That is the entire reason they live
        // here rather than on IUserManagementService, whose controller is Admin-only and
        // whose operations all take "which user" as an argument.

        /// <summary>
        /// Backs the Verify button in the Edit Profile dialog.
        ///
        /// The caller's own account is always excluded from the clash check, so leaving
        /// your username alone and pressing Verify does not report your own name back at
        /// you as taken. Unlike the admin endpoint there is no excludeUserId parameter:
        /// it is taken from the token, because a caller-supplied one would let anybody
        /// exclude any account they liked from a uniqueness check.
        /// </summary>
        Task<UserNameAvailabilityDto> CheckOwnUserNameAsync(string? userName, Guid currentUserId);

        /// <summary>
        /// Saves first name, last name and username for the signed-in user.
        ///
        /// Succeeds with a freshly minted session rather than nothing, so a user who
        /// renames themselves keeps working instead of being signed out by their own
        /// edit. See <see cref="UpdateProfileResult"/>.
        /// </summary>
        Task<UpdateProfileResult> UpdateProfileAsync(
            Guid userId, UpdateProfileRequest request, string updatedBy);

        /// <summary>
        /// Replaces the signed-in user's password, after proving they know the current
        /// one.
        ///
        /// Identity rotates the account's SecurityStamp as part of this, which is checked
        /// on every request - so every token for the account, including the one that made
        /// this call, stops being accepted. The caller must sign in again; that is the
        /// intended behaviour of a credential change, not a side effect to work around.
        /// </summary>
        Task<ProfileActionResult> ChangePasswordAsync(
            Guid userId, ChangePasswordRequest request, string changedBy);

        /// <summary>
        /// Suspends the signed-in user's own account (IsActive = false).
        ///
        /// Not a delete - the row survives, so their forms and submissions keep
        /// resolving. It is one-way from the UI though: login refuses an inactive
        /// account, so only an admin can switch it back on.
        /// </summary>
        Task<ProfileActionResult> DeactivateOwnAccountAsync(Guid userId, string deactivatedBy);
    }
}
