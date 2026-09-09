using FormBuilderAppService.Models.DTOs.Users;

namespace FormBuilderAppService.Services.Interfaces
{
    /// <summary>
    /// Administration of user accounts: listing them for the User Details table and
    /// creating new ones from the "Add New User" dialog.
    ///
    /// Kept separate from IAuthService on purpose. That one answers "who is calling and
    /// are they who they say they are"; this one is an admin managing other people's
    /// accounts. Mixing them would put an account-creation path inside the class that
    /// handles anonymous login requests.
    /// </summary>
    public interface IUserManagementService
    {
        /// <summary>
        /// Every account with its roles, newest first, except the caller's own.
        /// </summary>
        /// <param name="currentUserId">
        /// The signed-in admin. Excluded by the database query, not filtered out here -
        /// an admin has no business editing or deleting themselves from this screen, and
        /// the surest way to prevent it is for their row never to arrive.
        /// </param>
        Task<List<UserListItemDto>> GetUsersAsync(Guid currentUserId);

        /// <summary>
        /// The roles the dialog may offer: every non-deleted row in AspNetRoles. Roles
        /// are data, not a compiled list, so one added by SQL is assignable immediately.
        /// </summary>
        Task<List<RoleOptionDto>> GetAssignableRolesAsync();

        /// <summary>
        /// Backs the "Verify" button beside the username box. Reports both "that is not a
        /// usable username" and "somebody already has it".
        /// </summary>
        /// <param name="excludeUserId">
        /// An account to ignore when looking for a clash. The Edit dialog passes the user
        /// being edited: without it, verifying a username the admin has not changed would
        /// find that user's own row and report their existing name as taken.
        /// </param>
        /// <param name="revealReservedReason">
        /// Whether a name held by a soft-deleted account may be reported as such, rather
        /// than as plainly taken.
        ///
        /// Defaults to FALSE, so forgetting the argument discloses nothing. Only the
        /// Admin-only endpoint on UsersController opts in, where the deleted row is not
        /// on screen and the refusal would otherwise look like a bug; every other caller
        /// - including the self-service endpoint any signed-in user can reach - must not
        /// confirm that a deleted account ever existed.
        /// </param>
        Task<UserNameAvailabilityDto> CheckUserNameAsync(
            string? userName, Guid? excludeUserId = null, bool revealReservedReason = false);

        /// <summary>
        /// Validates the request, creates the account in AspNetUsers with a generated
        /// password, and assigns the requested roles. Returns the reasons rather than
        /// throwing when the request is rejected.
        /// </summary>
        /// <param name="createdBy">
        /// Username of the admin performing the create, recorded in AspNetUsers.CreatedBy.
        /// Taken from the validated token by the controller - never from the request body,
        /// which would let a caller claim somebody else made the account.
        /// </param>
        Task<CreateUserResult> CreateUserAsync(CreateUserRequest request, string createdBy);

        /// <summary>
        /// Applies the Edit User dialog's changes to an existing account: name, username,
        /// role assignments and the active flag. Returns the reasons rather than throwing
        /// when the request is rejected.
        /// </summary>
        /// <param name="currentUserId">
        /// The signed-in admin's own id, from the token. Compared against the target's id
        /// to enforce the self-protection rules. Deliberately not the username: this
        /// method can change usernames, so a name-based comparison would stop matching
        /// the moment an admin renamed themselves.
        /// </param>
        /// <param name="updatedBy">
        /// Username of the admin making the change, recorded in AspNetUsers.UpdatedBy and
        /// taken from the validated token - the request body has no say in it, or an edit
        /// could be attributed to somebody who never made it. A display value only; never
        /// used to decide anything.
        /// </param>
        Task<UpdateUserResult> UpdateUserAsync(
            Guid userId, UpdateUserRequest request, Guid currentUserId, string updatedBy);

        /// <summary>
        /// Soft-deletes an account: the AspNetUsers row is UPDATEd with IsDeleted = 1,
        /// never removed. Submissions, audit columns and CreatedBy/UpdatedBy strings all
        /// keep resolving to a real row, and the account can be brought back by clearing
        /// the flag. GetUsersAsync already filters these out, so it leaves the table.
        /// </summary>
        /// <param name="currentUserId">
        /// The signed-in admin's own id, from the token. Compared against the target's id
        /// to refuse a self-delete.
        /// </param>
        /// <param name="deletedBy">
        /// Username of the admin performing the delete, recorded in UpdatedBy. Taken from
        /// the validated token, like every other actor on this interface. A display value
        /// only; never used to decide anything.
        /// </param>
        Task<DeleteUserResult> DeleteUserAsync(Guid userId, Guid currentUserId, string deletedBy);

        /// <summary>
        /// Sets a new password on an account, on an admin's behalf.
        ///
        /// The value is hashed by Identity and the plain one is never stored, logged or
        /// returned. Identity's configured password policy decides whether it is strong
        /// enough, and its complaints are passed back verbatim so the dialog can show
        /// the admin exactly which rule was missed.
        /// </summary>
        /// <param name="changedBy">
        /// Username of the admin performing the reset, recorded in UpdatedBy. From the
        /// validated token, like every other actor here.
        /// </param>
        Task<SetPasswordResult> SetPasswordAsync(
            Guid userId, SetUserPasswordRequest request, string changedBy);
    }
}
