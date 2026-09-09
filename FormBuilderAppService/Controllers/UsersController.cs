using System.Security.Claims;
using FormBuilderAppService.Models.DTOs.Auth;
using FormBuilderAppService.Models.DTOs.Users;
using FormBuilderAppService.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FormBuilderAppService.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    // Managing accounts is an Admin job, and this attribute - not the browser UI - is
    // what enforces it. Hiding the "Add New User" button from a non-admin is a courtesy;
    // a request from one gets 403 here regardless of what their page showed them.
    [Authorize(Roles = RoleNames.Admin)]
    public class UsersController : ControllerBase
    {
        private readonly IUserManagementService _userManagementService;
        private readonly ILogger<UsersController> _logger;

        public UsersController(
            IUserManagementService userManagementService,
            ILogger<UsersController> logger)
        {
            _userManagementService = userManagementService;
            _logger = logger;
        }

        /// <summary>
        /// The caller's own account id, read from the validated token's NameIdentifier
        /// claim - written by JwtTokenService as ApplicationUser.Id.
        ///
        /// This, not the username, is what every self-protection rule below compares. A
        /// username is editable by this very controller: an admin who renamed themselves
        /// mid-session would stop matching their own row and walk straight through the
        /// guards meant to stop them locking themselves out. The id never changes.
        ///
        /// Never read from a query string or request body - a caller-supplied "who I am"
        /// is exactly the input these checks exist to distrust.
        /// </summary>
        private Guid? CurrentUserId =>
            Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
                ? id
                : null;

        /// <summary>
        /// Every account except the caller's own, for the User Details table.
        /// </summary>
        [HttpGet]
        [ProducesResponseType(typeof(List<UserListItemDto>), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetUsers()
        {
            // A validated token that carries no usable id should not be treated as "some
            // user we cannot name" - it fails closed rather than listing everybody.
            if (CurrentUserId is not { } currentUserId)
            {
                return Unauthorized(new { message = "Your session could not be identified. Sign in again." });
            }

            try
            {
                var users = await _userManagementService.GetUsersAsync(currentUserId);

                _logger.LogInformation("Successfully fetched {Count} users.", users.Count);

                return Ok(users);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while fetching users.");

                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while retrieving users." });
            }
        }

        /// <summary>
        /// The roles the "Add New User" dialog offers. Fetched rather than hard-coded in
        /// the page so adding a role to the backend shows up in the dropdown by itself.
        /// </summary>
        [HttpGet("roles")]
        [ProducesResponseType(typeof(List<RoleOptionDto>), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetRoles()
        {
            try
            {
                var roles = await _userManagementService.GetAssignableRolesAsync();
                return Ok(roles);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while fetching assignable roles.");

                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while retrieving roles." });
            }
        }

        /// <summary>
        /// Backs the "Verify" button beside the username box.
        ///
        /// Always 200 - "that name is taken" is a successful answer to the question, not
        /// a failed request. The body carries the verdict.
        /// </summary>
        [HttpGet("username-availability")]
        [ProducesResponseType(typeof(UserNameAvailabilityDto), StatusCodes.Status200OK)]
        public async Task<IActionResult> CheckUserName(
            [FromQuery] string? userName, [FromQuery] Guid? excludeUserId)
        {
            try
            {
                // excludeUserId is optional and only sent by the Edit dialog, so the user
                // being edited does not clash with their own existing username.
                //
                // revealReservedReason is opted into HERE and nowhere else. The default is
                // false so that a caller who forgets it discloses nothing; this endpoint is
                // Admin-only, and an admin refused a username needs to be told the holder
                // is a soft-deleted row - it is absent from the user list, so without the
                // reason the refusal looks like a bug in the dialog.
                var availability = await _userManagementService
                    .CheckUserNameAsync(userName, excludeUserId, revealReservedReason: true);

                return Ok(availability);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while checking username availability.");

                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while checking the username." });
            }
        }

        /// <summary>
        /// Creates an account in AspNetUsers and assigns its roles.
        ///
        /// The 201 body carries the generated one-time password. That is the only time it
        /// is ever readable - it is stored only as a hash - so the dialog must show it to
        /// the admin before they close it.
        /// </summary>
        [HttpPost]
        [ProducesResponseType(typeof(CreateUserResponse), StatusCodes.Status201Created)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> CreateUser([FromBody] CreateUserRequest request)
        {
            if (request is null)
            {
                return BadRequest(new { message = "No user details were supplied." });
            }

            try
            {
                // Read from the validated token, the same way TenantController takes
                // deletedBy. A CreatedBy supplied in the body would be unverifiable.
                var createdBy = User.Identity?.Name ?? "System";

                var result = await _userManagementService.CreateUserAsync(request, createdBy);

                if (!result.Succeeded)
                {
                    // message is what the dialog shows; errors carries the rest so a
                    // request that got several things wrong reports all of them.
                    return BadRequest(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "Could not create the user.",
                        errors = result.Errors
                    });
                }

                var created = result.Created!;

                return CreatedAtAction(
                    nameof(GetUsers),
                    new { id = created.User.UserId },
                    created);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while creating a user.");

                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while creating the user." });
            }
        }

        /// <summary>
        /// Applies the Edit User dialog's changes to one account.
        ///
        /// The id comes from the route, never the body, so a request cannot aim its
        /// payload at a different row than the one it addressed.
        /// </summary>
        [HttpPut("{id:guid}")]
        [ProducesResponseType(typeof(UserListItemDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> UpdateUser(Guid id, [FromBody] UpdateUserRequest request)
        {
            if (request is null)
            {
                return BadRequest(new { message = "No user details were supplied." });
            }

            if (CurrentUserId is not { } currentUserId)
            {
                return Unauthorized(new { message = "Your session could not be identified. Sign in again." });
            }

            try
            {
                // Two different facts about the caller, and they are not interchangeable:
                // currentUserId is identity, used for the self-protection checks;
                // updatedBy is a display name, stored in the UpdatedBy audit column.
                var updatedBy = User.Identity?.Name ?? "System";

                var result = await _userManagementService
                    .UpdateUserAsync(id, request, currentUserId, updatedBy);

                if (result.NotFound)
                {
                    return NotFound(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "That user no longer exists."
                    });
                }

                if (!result.Succeeded)
                {
                    return BadRequest(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "Could not update the user.",
                        errors = result.Errors
                    });
                }

                return Ok(result.Updated);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while updating user {UserId}.", id);

                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while updating the user." });
            }
        }

        /// <summary>
        /// Sets a new password on an account, from the Edit dialog's "Change Password"
        /// panel.
        ///
        /// Its own route rather than part of the update body, so a password is only ever
        /// bound on a request that exists to carry one.
        ///
        /// 204 with no body: there is nothing to return, and the one thing a caller might
        /// expect back - the password - must not be echoed by a server that has just
        /// hashed it.
        /// </summary>
        [HttpPut("{id:guid}/password")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> SetPassword(
            Guid id, [FromBody] SetUserPasswordRequest request)
        {
            if (request is null)
            {
                return BadRequest(new { message = "No password was supplied." });
            }

            try
            {
                var changedBy = User.Identity?.Name ?? "System";

                var result = await _userManagementService.SetPasswordAsync(id, request, changedBy);

                if (result.NotFound)
                {
                    return NotFound(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "That user no longer exists."
                    });
                }

                if (!result.Succeeded)
                {
                    // errors carries every rule the password missed, so the dialog can
                    // list them instead of revealing one per attempt.
                    return BadRequest(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "Could not set the password.",
                        errors = result.Errors
                    });
                }

                return NoContent();
            }
            catch (Exception ex)
            {
                // The request body is not included: it holds the password.
                _logger.LogError(ex, "Error occurred while setting the password for user {UserId}.", id);

                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while setting the password." });
            }
        }

        /// <summary>
        /// Soft-deletes an account.
        ///
        /// The AspNetUsers row is UPDATEd with IsDeleted = 1, not removed - so the
        /// submissions, forms and audit strings that point at this user keep resolving.
        /// It leaves the User Details table because GetUsers filters deleted rows out.
        ///
        /// 204, not 200: there is deliberately no body, because the account is no longer
        /// something a caller should be rendering.
        /// </summary>
        [HttpDelete("{id:guid}")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> DeleteUser(Guid id)
        {
            if (CurrentUserId is not { } currentUserId)
            {
                return Unauthorized(new { message = "Your session could not be identified. Sign in again." });
            }

            try
            {
                var deletedBy = User.Identity?.Name ?? "System";

                var result = await _userManagementService
                    .DeleteUserAsync(id, currentUserId, deletedBy);

                if (result.NotFound)
                {
                    return NotFound(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "That user no longer exists."
                    });
                }

                if (!result.Succeeded)
                {
                    return BadRequest(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "Could not delete the user.",
                        errors = result.Errors
                    });
                }

                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while deleting user {UserId}.", id);

                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while deleting the user." });
            }
        }
    }
}
