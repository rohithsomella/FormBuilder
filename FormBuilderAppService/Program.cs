using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using FormBuilderAppService.Data;
using FormBuilderAppService.Models.DTOs.Auth;
using FormBuilderAppService.Models.Identity;
using FormBuilderAppService.Pdf;
using FormBuilderAppService.Repositories;
using FormBuilderAppService.Repositories.Interfaces;
using FormBuilderAppService.Services;
using FormBuilderAppService.Services.Interfaces;
using FormBuilderAppService.Settings;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using MongoDB.Driver;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Version = "v1",
        Title = "FormBuilder API",
        Description = "API for managing forms using .NET 8 with Dapper and SQL Server"
    });

    // "Authorize" button in Swagger UI, so protected endpoints can be exercised there.
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Paste the token returned by POST /api/auth/login."
    });

    options.AddSecurityRequirement(document => new OpenApiSecurityRequirement
    {
        { new OpenApiSecuritySchemeReference("Bearer", document), new List<string>() }
    });
});

// Add CORS support
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", builder =>
    {
        builder.AllowAnyOrigin()
               .AllowAnyMethod()
               .AllowAnyHeader()
               // Let the browser read the generated PDF's file name.
               .WithExposedHeaders("Content-Disposition", "X-Pdf-Filename", "X-Pdf-Document-Count",
                                   "X-Pdf-Request-Id", "Retry-After");
    });
});

// MongoDB Configuration
builder.Services.Configure<MongoDbSettings>(
    builder.Configuration.GetSection("MongoDbSettings"));

builder.Services.AddSingleton<IMongoClient>(sp =>
{
    var settings = sp.GetRequiredService<IOptions<MongoDbSettings>>().Value;
    return new MongoClient(settings.ConnectionString);
});

builder.Services.AddSingleton<MongoDbContext>();

// ---------------------------------------------------------------------------
// Authentication: ASP.NET Core Identity (SQL Server) + JWT bearer tokens.
//
// Identity owns users, password hashing and roles. MongoDB is untouched by this and
// continues to own Forms, FormSubmissions and Resources.
// ---------------------------------------------------------------------------

builder.Services.Configure<JwtSettings>(builder.Configuration.GetSection("Jwt"));
builder.Services.Configure<IdentitySeedSettings>(builder.Configuration.GetSection("IdentitySeed"));

var identityConnectionString = builder.Configuration.GetConnectionString("PracticeDB")
    ?? throw new InvalidOperationException("Connection string 'PracticeDB' not found.");

builder.Services.AddDbContext<AppIdentityDbContext>(options =>
    options.UseSqlServer(identityConnectionString));

builder.Services
    .AddIdentity<ApplicationUser, ApplicationRole>(options =>
    {
        // V1 keeps Identity's defaults deliberately - advanced password policy and
        // lockout tuning are V2 items. Only uniqueness is asserted, because login
        // accepts an email as the identifier and must resolve to one account.
        options.User.RequireUniqueEmail = true;
    })
    .AddEntityFrameworkStores<AppIdentityDbContext>()
    .AddDefaultTokenProviders();

var jwtSettings = builder.Configuration.GetSection("Jwt").Get<JwtSettings>() ?? new JwtSettings();

// Fail here, before the application starts serving, if the signing key is missing or
// too short.
//
// JwtTokenService performs the same two checks in its constructor, but it is registered
// AddScoped: that constructor does not run until the first login request, and because
// the service is resolved while the controller is being activated, the try/catch inside
// AuthController.Login never sees the exception. The SymmetricSecurityKey built below
// has the same problem from the other direction - it throws on a zero-length key the
// first time a token is validated, not at startup.
//
// The result without this block is the worst kind of failure: appsettings.json ships
// SecretKey = "" by design, so a deployment that forgets JWT__SECRETKEY starts cleanly,
// reports itself healthy, and then answers every login and every authenticated request
// with an unexplained 500. Crashing at startup makes the cause impossible to miss.
if (string.IsNullOrWhiteSpace(jwtSettings.SecretKey))
{
    throw new InvalidOperationException(
        "Jwt:SecretKey is not configured. Set it in appsettings.Development.json, " +
        "user-secrets, or the JWT__SECRETKEY environment variable.");
}

if (Encoding.UTF8.GetByteCount(jwtSettings.SecretKey) < JwtTokenService.MinimumSecretKeyBytes)
{
    throw new InvalidOperationException(
        $"Jwt:SecretKey must be at least {JwtTokenService.MinimumSecretKeyBytes} bytes " +
        "(32 ASCII characters) to sign tokens with HMAC-SHA256.");
}

builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            // Guaranteed non-empty and long enough by the checks above.
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwtSettings.SecretKey)),

            ValidateIssuer = true,
            ValidIssuer = jwtSettings.Issuer,

            ValidateAudience = true,
            ValidAudience = jwtSettings.Audience,

            ValidateLifetime = true,

            // Default is 5 minutes of leeway, which lets an "expired" token keep working.
            ClockSkew = TimeSpan.Zero
        };

        //
        // Everything above validates the token as a document: correctly signed, right
        // issuer and audience, not expired. None of it asks whether the account behind
        // it is still one we want to serve - a JWT carries no such link, which is why a
        // password change, a deactivation or a delete would otherwise have no effect
        // until the token expired on its own.
        //
        // This hook adds that link. It costs one primary-key lookup per authenticated
        // request, which is the price of being able to end a session on demand.
        //
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var userManager = context.HttpContext.RequestServices
                    .GetRequiredService<UserManager<ApplicationUser>>();

                var userId = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);

                if (!Guid.TryParse(userId, out var id))
                {
                    context.Fail("Token carries no usable user id.");
                    return;
                }

                var user = await userManager.FindByIdAsync(id.ToString());

                // Covers both "deactivated" and "deleted" in one comparison - the same
                // IsUsable rule AuthService applies at login, now applied on every
                // request. An admin flipping either flag ends the session immediately;
                // no security stamp rotation is needed for those two because this check
                // already refuses the token outright.
                if (user is null || user.IsDeleted || !user.IsActive)
                {
                    context.Fail("This account is no longer active.");
                    return;
                }

                // Covers "the password was changed". Identity rotates SecurityStamp
                // inside ResetPasswordAsync, so a token minted beforehand carries the
                // old value and stops matching here.
                var tokenStamp = context.Principal?.FindFirstValue(
                    JwtTokenService.SecurityStampClaimType);

                // Either side missing means this token cannot be checked against
                // anything - a token issued before this claim existed, or a row created
                // outside Identity, which always writes a stamp. Refused deliberately
                // and with its own reason, rather than falling through to the comparison
                // below and being reported as a password change that never happened.
                if (string.IsNullOrEmpty(tokenStamp) || string.IsNullOrEmpty(user.SecurityStamp))
                {
                    context.Fail("This session cannot be verified. Sign in again.");
                    return;
                }

                if (!string.Equals(tokenStamp, user.SecurityStamp, StringComparison.Ordinal))
                {
                    context.Fail("The credentials for this account have changed.");
                    return;
                }
            }
        };
    });

builder.Services.AddAuthorization();

// ---------------------------------------------------------------------------
// Rate limiting for the self-service endpoints on AuthController.
//
// Why this exists: AuthService.ChangePasswordAsync verifies the current password with
// CheckPasswordAsync rather than CheckPasswordSignInAsync, deliberately, so that typos
// on your own profile page cannot lock you out of your own account. The cost of that
// choice is that failures count towards nothing at all - and CurrentPassword is the one
// thing standing between a STOLEN TOKEN and taking the account over outright. Without a
// throttle, whoever holds that token can grind the password at full request rate.
//
// This is deliberately NOT Identity's lockout. Being refused here must never make the
// login path unusable, or an attacker with a token could lock the real owner out just by
// guessing badly - which is exactly the outcome CheckPasswordAsync was chosen to avoid.
//
// Two known limits, neither of which is worth more machinery at this size:
//   - The state is in-memory, so the budget is per process. A multi-instance deployment
//     would need a distributed store to be exact; until then each instance enforces its
//     own copy, which still bounds the total.
//   - A window limiter counts successful calls as well as failed ones. For endpoints a
//     human touches a handful of times a day that is fine, and it avoids a second,
//     hand-rolled failure counter that would have to be kept correct on its own.
// ---------------------------------------------------------------------------
// Ten attempts per window for both. Generous for somebody mistyping a password they
// know, or pressing Verify on a few candidate names; useless for working through a word
// list. Declared here rather than inline because OnRejected below needs them too - the
// Retry-After it sends has to be the window the caller is actually waiting out.
var passwordWindow = TimeSpan.FromMinutes(15);
var userNameWindow = TimeSpan.FromMinutes(1);

var windowByPolicy = new Dictionary<string, TimeSpan>
{
    [RateLimitPolicies.SelfServicePassword] = passwordWindow,
    [RateLimitPolicies.SelfServiceUserName] = userNameWindow
};

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.OnRejected = async (context, cancellationToken) =>
    {
        // Tell the caller how long to wait rather than leaving them to guess. CORS
        // already exposes Retry-After (see AddCors above), so the browser can read it.
        //
        // The limiter is asked first, but the window limiters do not always attach
        // RetryAfter metadata to a rejected lease - verified against this build, where a
        // 429 arrived with no header at all. The policy's own window is the fallback: it
        // is the longest the caller could possibly have to wait, so it is never an
        // under-estimate that sends them back too early.
        var wait = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
            ? retryAfter
            : LookUpWindow(context.HttpContext);

        if (wait > TimeSpan.Zero)
        {
            context.HttpContext.Response.Headers.RetryAfter =
                ((int)Math.Ceiling(wait.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
        }

        // Same shape as every other error body on this API, so the frontend's existing
        // error handling reports it instead of falling back to "something went wrong".
        await context.HttpContext.Response.WriteAsJsonAsync(
            new { message = "Too many attempts. Wait a few minutes and try again." },
            cancellationToken);
    };

    options.AddPolicy(RateLimitPolicies.SelfServicePassword, httpContext =>
        RateLimitPartition.GetSlidingWindowLimiter(
            SelfServicePartitionKey(httpContext),
            _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = passwordWindow,
                SegmentsPerWindow = 3,

                // Reject immediately. Queueing would hold the request open and hand the
                // caller a slow drip of attempts instead of a refusal.
                QueueLimit = 0
            }));

    options.AddPolicy(RateLimitPolicies.SelfServiceUserName, httpContext =>
        RateLimitPartition.GetSlidingWindowLimiter(
            SelfServicePartitionKey(httpContext),
            _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = userNameWindow,
                SegmentsPerWindow = 2,
                QueueLimit = 0
            }));

    // Which policy refused this request, taken from the [EnableRateLimiting] attribute on
    // the action that was about to run. Zero when the endpoint carries no policy, which
    // leaves the header off rather than inventing a number.
    TimeSpan LookUpWindow(HttpContext httpContext)
    {
        var policyName = httpContext.GetEndpoint()?.Metadata
            .GetMetadata<EnableRateLimitingAttribute>()?.PolicyName;

        return policyName is not null && windowByPolicy.TryGetValue(policyName, out var window)
            ? window
            : TimeSpan.Zero;
    }
});

// The budget belongs to an ACCOUNT, not a connection: the endpoints these policies guard
// are [Authorize], and the thing being rate limited is what one token may attempt. Keying
// on the id also means one user cannot spend anybody else's allowance.
//
// The address fallbacks cannot normally be reached - UseRateLimiter runs after
// UseAuthentication, so the principal is already established - but a partition key must
// never be null, and a single shared bucket for the unidentified would let one caller
// exhaust it for everyone.
static string SelfServicePartitionKey(HttpContext httpContext) =>
    httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
    ?? httpContext.Connection.RemoteIpAddress?.ToString()
    ?? "unidentified";

builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IUserManagementService, UserManagementService>();
builder.Services.AddScoped<IdentitySeeder>();

// Register Repositories and Services
builder.Services.AddScoped<IFormRepository, FormRepository>();
builder.Services.AddScoped<IFormService, FormService>();
builder.Services.AddScoped<IFormSubmissionRepository, FormSubmissionRepository>();
builder.Services.AddScoped<IFormSubmissionService, FormSubmissionService>();
builder.Services.AddScoped<IResourceRepository, ResourceRepository>();
builder.Services.AddScoped<IResourceService, ResourceService>();
builder.Services.AddScoped<ITenantRepository, TenantRepository>();
builder.Services.AddScoped<ITenantService, TenantService>();

// Reusable PDF generation module (Playwright + headless Chromium)
builder.Services.AddPdfRenderer(builder.Configuration);

var app = builder.Build();

// Bring the Identity schema up to date, then ensure the roles and seed accounts exist.
// Both run before the app serves a request, so a fresh database is immediately usable.
//
// Database.MigrateAsync() applies whatever migrations the database is missing and does
// nothing when it is already current. That makes the AspNet* tables create-if-not-exist
// on startup: a new machine only has to point at a database and run - no separate
// "Update-Database" or "dotnet ef database update" step. It runs exactly the same
// migrations from FormBuilderAppService/Migrations, so the schema is identical either
// way, and running the CLI/PMC commands by hand still works.
using (var scope = app.Services.CreateScope())
{
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    try
    {
        var db = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();

        var pending = (await db.Database.GetPendingMigrationsAsync()).ToList();
        if (pending.Count > 0)
        {
            logger.LogInformation(
                "Applying {Count} Identity migration(s): {Migrations}",
                pending.Count, string.Join(", ", pending));

            await db.Database.MigrateAsync();

            logger.LogInformation("Identity schema is up to date.");
        }

        var seeder = scope.ServiceProvider.GetRequiredService<IdentitySeeder>();
        await seeder.SeedAsync();
    }
    catch (Exception ex)
    {
        // An unreachable database must not stop the whole API from starting. Token
        // validation needs no database at all, and the MongoDB-backed endpoints are
        // unaffected, so the rest of the application still works. Logins will fail
        // until SQL Server is reachable - which this log makes obvious, instead of the
        // process dying at startup with an unhandled SqlException.
        logger.LogError(ex,
            "Identity database setup failed. Check ConnectionStrings:PracticeDB. " +
            "Authentication will not work until this is resolved.");
    }
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Enable CORS - must be before UseHttpsRedirection
app.UseCors("AllowAll");

app.UseHttpsRedirection();

// Order matters: authentication establishes who the caller is, authorization then
// decides what they may do. Swapping these leaves every [Authorize] endpoint open.
app.UseAuthentication();
app.UseAuthorization();

// Must come after UseAuthentication: the policies above partition on the caller's user
// id claim, and before authentication has run there is no principal to read it from -
// every request would land in the same fallback bucket and share one budget.
app.UseRateLimiter();

app.MapControllers();

app.Run();
