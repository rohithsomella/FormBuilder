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
    public class AuthController : ControllerBase
    {
        /// <summary>
        /// The one message returned for every kind of failed login. Deliberately does not
        /// distinguish "no such user" from "wrong password".
        /// </summary>
        private const string InvalidCredentialsMessage = "Invalid username or password.";

        private readonly IAuthService _authService;
        private readonly ILogger<AuthController> _logger;

        public AuthController(
            IAuthService authService,
            ILogger<AuthController> logger)
        {
            _authService = authService;
            _logger = logger;
        }

        /// <summary>
        /// The caller's own account id, read from the validated token's NameIdentifier
        /// claim - written by JwtTokenService as ApplicationUser.Id.
        ///
        /// Every self-service endpoint below takes "which account" from here and nowhere
        /// else. There is no id in any of their routes or bodies, so a request cannot aim
        /// a profile edit, a password change or a deactivation at somebody else's row -
        /// not because the service checks, but because there is no way to ask.
        /// </summary>
        private Guid? CurrentUserId =>
            Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
                ? id
                : null;

        /// <summary>
        /// The single login endpoint. Accepts a username or an email in LoginIdentifier;
        /// the role in the returned token is whatever Identity says it is.
        /// </summary>
        [AllowAnonymous]
        [HttpPost("login")]
        [ProducesResponseType(typeof(LoginResponse), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            if (request is null ||
                string.IsNullOrWhiteSpace(request.LoginIdentifier) ||
                string.IsNullOrEmpty(request.Password))
            {
                // Same 401 and same message as a bad password. A missing field must not
                // be distinguishable from a wrong one.
                return Unauthorized(new { message = InvalidCredentialsMessage });
            }

            try
            {
                var response = await _authService.LoginAsync(request);

                if (response is null)
                {
                    return Unauthorized(new { message = InvalidCredentialsMessage });
                }

                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error during login.");
                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while processing your request." });
            }
        }

        /// <summary>
        /// The authoritative "who am I". Requires a valid token and reads the user id
        /// from it, so a client cannot ask about somebody else by changing a parameter.
        /// </summary>
        [Authorize]
        [HttpGet("me")]
        [ProducesResponseType(typeof(CurrentUserDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        public async Task<IActionResult> Me()
        {
            var userIdClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);

            if (!Guid.TryParse(userIdClaim, out var userId))
            {
                return Unauthorized(new { message = "Invalid token." });
            }

            var user = await _authService.GetUserByIdAsync(userId);

            if (user is null)
            {
                // Token is validly signed but the account is gone - treat as unauthenticated.
                return Unauthorized(new { message = "Invalid token." });
            }

            return Ok(user);
        }

        /// <summary>
        /// Logout. With stateless JWTs the token is discarded by the client; this exists
        /// so the frontend has one endpoint to call and so V2 can add server-side
        /// revocation here without changing the client.
        /// </summary>
        [Authorize]
        [HttpPost("logout")]
        public IActionResult Logout()
        {
            _logger.LogInformation(
                "User {UserId} logged out.", User.FindFirstValue(ClaimTypes.NameIdentifier));

            return Ok(new { message = "Logged out." });
        }

        // ------------------------------------------------------------- own profile
        //
        // The Edit Profile dialog on userProfile.html and adminProfile.html. These are
        // [Authorize] and nothing more - any signed-in user may edit their own account,
        // which is exactly why none of them accept a user id. The Admin-only equivalents
        // for editing OTHER people live on UsersController.

        /// <summary>
        /// Backs the Verify button beside the username box in the Edit Profile dialog.
        ///
        /// Always 200 - "that name is taken" is a successful answer to the question, not
        /// a failed request. The body carries the verdict.
        ///
        /// Note there is no excludeUserId parameter, unlike the admin endpoint. The
        /// account to ignore is the caller's own and is taken from the token: a
        /// caller-supplied one would let anybody exclude any account they liked from a
        /// uniqueness check and then be told a name in use was free.
        /// </summary>
        [Authorize]
        [HttpGet("username-availability")]
        [ProducesResponseType(typeof(UserNameAvailabilityDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        public async Task<IActionResult> CheckOwnUserName([FromQuery] string? userName)
        {
            if (CurrentUserId is not { } currentUserId)
            {
                return Unauthorized(new { message = "Your session could not be identified. Sign in again." });
            }

            try
            {
                var availability = await _authService.CheckOwnUserNameAsync(userName, currentUserId);

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
        /// Saves the Edit Profile dialog's first name, last name and username.
        ///
        /// Answers with a full <see cref="LoginResponse"/>, not just the user. Renaming
        /// yourself makes the name claim in your token stale, and that claim is what
        /// stamps every audit column you touch afterwards - so the reply carries a token
        /// minted from the row as it now stands and the client swaps it in. The session
        /// continues; nobody is signed out for correcting their own surname.
        /// </summary>
        [Authorize]
        [HttpPut("profile")]
        [ProducesResponseType(typeof(LoginResponse), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequest request)
        {
            if (request is null)
            {
                return BadRequest(new { message = "No profile details were supplied." });
            }

            if (CurrentUserId is not { } currentUserId)
            {
                return Unauthorized(new { message = "Your session could not be identified. Sign in again." });
            }

            try
            {
                // The display name for the UpdatedBy column, which is a different fact
                // from currentUserId: that one is identity and decides which row is
                // written, this one is just what the audit trail records. Read from the
                // token, so it is the name they were called when they made the change.
                var updatedBy = User.Identity?.Name ?? "System";

                var result = await _authService.UpdateProfileAsync(currentUserId, request, updatedBy);

                if (result.NotFound)
                {
                    return NotFound(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "Your account could not be found."
                    });
                }

                if (!result.Succeeded)
                {
                    // message is what the dialog shows; errors carries the rest so a
                    // request that got several things wrong reports all of them.
                    return BadRequest(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "Could not update your profile.",
                        errors = result.Errors
                    });
                }

                return Ok(result.Session);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while updating the profile for user {UserId}.", currentUserId);

                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while updating your profile." });
            }
        }

        /// <summary>
        /// Changes the caller's own password, after they prove they know the current one.
        ///
        /// 204 with no body, and no replacement token - unlike the profile endpoint above.
        /// Identity rotates the account's SecurityStamp as part of the change and that
        /// stamp is compared on every request, so every token for this account is now
        /// refused, including the one that made this call. Handing back a new one would
        /// defeat the point: a password change is meant to end the sessions that were
        /// running under the old password, and this browser has no more claim to an
        /// exemption than any other. The client signs the user back in.
        /// </summary>
        [Authorize]
        [HttpPut("password")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
        {
            if (request is null)
            {
                return BadRequest(new { message = "No password details were supplied." });
            }

            if (CurrentUserId is not { } currentUserId)
            {
                return Unauthorized(new { message = "Your session could not be identified. Sign in again." });
            }

            try
            {
                var changedBy = User.Identity?.Name ?? "System";

                var result = await _authService.ChangePasswordAsync(currentUserId, request, changedBy);

                if (result.NotFound)
                {
                    return NotFound(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "Your account could not be found."
                    });
                }

                if (!result.Succeeded)
                {
                    // errors carries every policy rule the new password missed, so the
                    // dialog can list them instead of revealing one per attempt.
                    return BadRequest(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "Could not change your password.",
                        errors = result.Errors
                    });
                }

                return NoContent();
            }
            catch (Exception ex)
            {
                // The request body is deliberately not included: it holds two passwords.
                _logger.LogError(ex, "Error occurred while changing the password for user {UserId}.", currentUserId);

                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while changing your password." });
            }
        }

        /// <summary>
        /// Suspends the caller's own account, from the dialog's "Deactive Account" button.
        ///
        /// Not a delete: the row stays, so their forms and submissions keep resolving.
        /// One-way from the UI though - login refuses an inactive account, so switching it
        /// back on needs an admin. An admin cannot do this to themselves at all; the
        /// service refuses it, because they may be the only admin able to undo it.
        ///
        /// 204: the account is no longer something the caller should be rendering.
        /// </summary>
        [Authorize]
        [HttpPut("deactivate")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> DeactivateOwnAccount()
        {
            if (CurrentUserId is not { } currentUserId)
            {
                return Unauthorized(new { message = "Your session could not be identified. Sign in again." });
            }

            try
            {
                var deactivatedBy = User.Identity?.Name ?? "System";

                var result = await _authService.DeactivateOwnAccountAsync(currentUserId, deactivatedBy);

                if (result.NotFound)
                {
                    return NotFound(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "Your account could not be found."
                    });
                }

                if (!result.Succeeded)
                {
                    return BadRequest(new
                    {
                        message = result.Errors.FirstOrDefault() ?? "Could not deactivate your account.",
                        errors = result.Errors
                    });
                }

                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while deactivating account {UserId}.", currentUserId);

                return StatusCode(StatusCodes.Status500InternalServerError,
                    new { message = "An error occurred while deactivating your account." });
            }
        }

        /// <summary>
        /// Exists so the Admin-only path is genuinely exercisable: no token gives 401, a
        /// User token gives 403, an Admin token gives 200.
        /// </summary>
        [Authorize(Roles = RoleNames.Admin)]
        [HttpGet("admin-check")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public IActionResult AdminCheck() => Ok(new
        {
            message = "Admin access confirmed.",
            userName = User.Identity?.Name,
            roles = User.FindAll(ClaimTypes.Role).Select(c => c.Value)
        });
    }
}
