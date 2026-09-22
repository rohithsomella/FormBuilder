using FormBuilderAppService.Data;
using FormBuilderAppService.Models;
using FormBuilderAppService.Models.DTOs;
using FormBuilderAppService.Repositories.Interfaces;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;
using System.Text.Json;

namespace FormBuilderAppService.Repositories
{
    public class FormRepository : IFormRepository
    {
        private readonly IMongoCollection<Form> _forms;
        private readonly ILogger<FormRepository> _logger;

        public FormRepository(
            MongoDbContext context,
            ILogger<FormRepository> logger)
        {
            _forms = context.Forms;
            _logger = logger;
        }

        public async Task<List<FormDto>> GetFormsAsync()
        {
            try
            {
                _logger.LogInformation("Fetching forms with empty or null project from MongoDB.");

                // Filter for forms where project/templateId is null or empty
                var filter = Builders<Form>.Filter.Or(
                    Builders<Form>.Filter.Eq(f => f.TenantId, null),
                    Builders<Form>.Filter.Eq(f => f.TenantId, Guid.Empty)
                );

                var forms = await _forms
                    .Find(filter)
                    .ToListAsync();

                _logger.LogInformation("Successfully fetched {Count} forms with empty/null project.", forms.Count);

                return forms.Select(MapToDto).ToList();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while retrieving forms from MongoDB.");
                throw;
            }
        }

        public async Task<FormDto?> GetFormByIdAsync(string id)
        {
            try
            {
                _logger.LogInformation("Fetching form with Id: {Id}", id);

                // Find form by Id property (which is stored as ObjectId in MongoDB)
                var form = await _forms.Find(f => f.Id == id).FirstOrDefaultAsync();

                if (form == null)
                {
                    _logger.LogWarning("Form not found. Id: {Id}", id);
                    return null;
                }

                _logger.LogInformation("Form found. Id: {Id}", id);

                return MapToDto(form);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while retrieving form. Id: {Id}", id);
                throw;
            }
        }

        public async Task<string> SaveFormAsync(FormDto model)
        {
            try
            {
                _logger.LogInformation("Saving form: {Title}", model.Title);

                var form = MapToDocument(model);

                // Generate MongoDB ObjectId if not provided
                if (string.IsNullOrEmpty(form.Id))
                {
                    form.Id = ObjectId.GenerateNewId().ToString();
                }

                form.Created = DateTime.UtcNow;
                form.Modified = DateTime.UtcNow;

                await _forms.InsertOneAsync(form);

                _logger.LogInformation("Form saved successfully. Id: {Id}", form.Id);

                return form.Id!;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while saving form: {Title}", model.Title);
                throw;
            }
        }

        public async Task UpdateFormAsync(FormDto model)
        {
            try
            {
                _logger.LogInformation("Updating form. Id: {Id}", model.Id);

                // Get the existing form to preserve VersionId if not provided
                var existingForm = await _forms.Find(f => f.Id == model.Id).FirstOrDefaultAsync();
                if (existingForm == null)
                {
                    _logger.LogWarning("No form found to update. Id: {Id}", model.Id);
                    return;
                }

                var form = MapToDocument(model);

                // Preserve the original VersionId if the incoming DTO has 0 (default)
                if (model.VersionId == 0 && existingForm.VersionId > 0)
                {
                    form.VersionId = existingForm.VersionId;
                }

                form.Modified = DateTime.UtcNow;
                // Preserve Created timestamp
                form.Created = existingForm.Created;

                var result = await _forms.ReplaceOneAsync(
                    f => f.Id == form.Id,
                    form);

                if (result.MatchedCount == 0)
                {
                    _logger.LogWarning("No form found to update. Id: {Id}", model.Id);
                }
                else
                {
                    _logger.LogInformation("Form updated successfully. Id: {Id}", model.Id);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while updating form. Id: {Id}", model.Id);
                throw;
            }
        }

        public async Task DeleteFormAsync(string id)
        {
            try
            {
                _logger.LogInformation("Deleting form. Id: {Id}", id);

                var result = await _forms.DeleteOneAsync(f => f.Id == id);

                if (result.DeletedCount == 0)
                {
                    _logger.LogWarning("No form found to delete. Id: {Id}", id);
                }
                else
                {
                    _logger.LogInformation("Form deleted successfully. Id: {Id}", id);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while deleting form. Id: {Id}", id);
                throw;
            }
        }

        private static Form MapToDocument(FormDto dto)
        {
            BsonArray componentsArray = new();
            
            try
            {
                if (!string.IsNullOrEmpty(dto.Components) && dto.Components != "[]")
                {
                    // Try to parse the JSON string as BsonValue first to handle different types
                    var bsonValue = BsonSerializer.Deserialize<BsonValue>(dto.Components);
                    
                    if (bsonValue.IsBsonArray)
                    {
                        componentsArray = bsonValue.AsBsonArray;
                    }
                    else if (bsonValue.IsBsonDocument)
                    {
                        // If it's a document with a components property, extract the array
                        var doc = bsonValue.AsBsonDocument;
                        if (doc.Contains("components") && doc["components"].IsBsonArray)
                        {
                            componentsArray = doc["components"].AsBsonArray;
                        }
                        else
                        {
                            // If no components property, wrap the document as a single component
                            componentsArray = new BsonArray { doc };
                        }
                    }
                    else
                    {
                        // For other types, wrap in array
                        componentsArray = new BsonArray { bsonValue };
                    }
                }
            }
            catch (Exception ex)
            {
                // If deserialization fails, log it and use empty array
                Console.WriteLine($"Error deserializing components: {ex.Message}");
                componentsArray = new BsonArray();
            }

            return new Form
            {
                Id = dto.Id,
                Title = dto.Title,
                Name = dto.Name,
                Components = componentsArray,
                VersionId = dto.VersionId,
                Created = dto.Created,
                Modified = dto.Modified,
                Tags = (dto.Tags ?? new()).Select(t => t.ToUpperInvariant()).ToList(),
                // Normalize TenantId to uppercase for consistent case-insensitive filtering
                TenantId = dto.TenantId.HasValue ? new Guid(dto.TenantId.ToString().ToUpper()) : null
            };
        }

        private static FormDto MapToDto(Form form)
        {
            return new FormDto
            {
                Id = form.Id,
                Title = form.Title,
                Name = form.Name,
                Components = form.Components.ToJson(),
                VersionId = form.VersionId,
                Created = form.Created,
                Modified = form.Modified,
                Tags = form.Tags,
                TenantId = form.TenantId ?? Guid.Empty
            };
        }

        public List<FormDto> GetFormsByTenantId(Guid tenantId)
        {
            try
            {
                _logger.LogInformation("Fetching forms for TenantId: {TenantId}", tenantId);

                // Use case-insensitive regex filter to match GUID regardless of case
                // MongoDB stores GUIDs as strings, which are case-sensitive by default
                var tenantIdString = tenantId.ToString();
                var filter = Builders<Form>.Filter.Regex("project", new BsonRegularExpression(tenantIdString, "i"));
                var forms = _forms.Find(filter).ToList();

                _logger.LogInformation("Successfully fetched {Count} forms for TenantId: {TenantId}", forms.Count, tenantId);

                return forms.Select(MapToDto).ToList();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while retrieving forms for TenantId: {TenantId}", tenantId);
                throw;
            }
        }
    }
}