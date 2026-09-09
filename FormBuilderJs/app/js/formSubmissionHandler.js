/**
 * Shared Form Submission Handler
 * Handles form submission, error/success messages, and dynamicSelectionPanels transformation
 */

// Show Success Message
function showSuccessMessage(container, submissionId) {
    console.log('✅ showSuccessMessage called with container:', container, 'ID:', submissionId);
    
    // Create or get messages container
    let messagesContainer = document.getElementById('formMessagesContainer');
    if (!messagesContainer) {
        messagesContainer = document.createElement('div');
        messagesContainer.id = 'formMessagesContainer';
        messagesContainer.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            width: 90%;
            max-width: 600px;
            z-index: 9999;
        `;
        document.body.appendChild(messagesContainer);
        console.log('✅ Created new messages container');
    }
    
    var successMsg = document.createElement('div');
    successMsg.style.cssText = `
        padding: 20px;
        margin: 10px 0;
        border-radius: 6px;
        background-color: #d4edda;
        border: 2px solid #28a745;
        color: #155724;
        font-size: 16px;
        font-weight: 500;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        display: flex;
        align-items: center;
        gap: 12px;
    `;
    successMsg.innerHTML = '<i class="bi bi-check-circle" style="font-size: 24px;"></i> <div><strong>Form submitted successfully!</strong><br><small>Submission ID: ' + submissionId + '</small></div>';
    messagesContainer.appendChild(successMsg);
    console.log('✅ Success message inserted into DOM');
    
    // Auto-hide after 5 seconds
    setTimeout(function() {
        if (successMsg.parentNode) {
            successMsg.remove();
            console.log('✅ Success message removed after 5 seconds');
        }
    }, 5000);
}

// Show Error Message
function showErrorMessage(container, error) {
    console.log('❌ showErrorMessage called with error:', error);
    
    // Create or get messages container
    let messagesContainer = document.getElementById('formMessagesContainer');
    if (!messagesContainer) {
        messagesContainer = document.createElement('div');
        messagesContainer.id = 'formMessagesContainer';
        messagesContainer.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            width: 90%;
            max-width: 600px;
            z-index: 9999;
        `;
        document.body.appendChild(messagesContainer);
        console.log('✅ Created new messages container');
    }
    
    var errorMsg = document.createElement('div');
    errorMsg.style.cssText = `
        padding: 20px;
        margin: 10px 0;
        border-radius: 6px;
        background-color: #f8d7da;
        border: 2px solid #dc3545;
        color: #721c24;
        font-size: 16px;
        font-weight: 500;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        display: flex;
        align-items: center;
        gap: 12px;
    `;
    errorMsg.innerHTML = '<i class="bi bi-exclamation-circle" style="font-size: 24px;"></i> <div><strong>Error submitting form:</strong><br><small>' + error + '</small></div>';
    messagesContainer.appendChild(errorMsg);
    console.log('❌ Error message inserted into DOM');
}

// Transform dynamicSelectionPanels data
function transformDynamicSelectionPanels(data, formInstance, depth) {
    depth = depth || 0;
    if (depth > 10) return; // Prevent infinite recursion
    
    if (!data || typeof data !== 'object') return;
    
    for (var key in data) {
        if (data.hasOwnProperty(key)) {
            var value = data[key];
            
            // Found dynamicSelectionPanels
            if (key === 'dynamicSelectionPanels' && value && value.selectSections !== undefined) {
                console.log('🔍 Found dynamicSelectionPanels at level', depth, ', transforming...');
                
                // Get the component instance
                var dynamicPanelsComponent = formInstance.getComponent('dynamicSelectionPanels');
                
                if (dynamicPanelsComponent && typeof dynamicPanelsComponent.getSelectSectionsData === 'function') {
                    console.log('✅ Got dynamicPanelsComponent, calling getSelectSectionsData()');
                    var selectSectionsData = dynamicPanelsComponent.getSelectSectionsData();
                    value.selectSections = selectSectionsData;
                    console.log('✅ Transformed selectSections to:', selectSectionsData);
                } else {
                    console.warn('⚠️ Could not find dynamicPanelsComponent or getSelectSectionsData method');
                }
            }
            
            // Recursively check nested objects
            if (typeof value === 'object' && value !== null) {
                transformDynamicSelectionPanels(value, formInstance, depth + 1);
            }
        }
    }
}

// Normalize an id that may have round-tripped through sessionStorage.
// sessionStorage.setItem(key, undefined) stores the literal string "undefined",
// which is truthy on read and silently poisons submission.form.
function sanitizeFormId(value) {
    if (value === null || value === undefined) return null;
    var id = String(value).trim();
    if (!id || id === 'undefined' || id === 'null') return null;
    return id;
}

// Read a form id out of sessionStorage, rejecting poisoned values.
function readStoredFormId(key) {
    var id = sanitizeFormId(sessionStorage.getItem(key));
    if (!id && sessionStorage.getItem(key) !== null) {
        console.warn('⚠️ Discarding invalid ' + key + ' in sessionStorage:', sessionStorage.getItem(key));
        sessionStorage.removeItem(key);
    }
    return id;
}

// Main Form Submission Handler
// formIdOverride: authoritative form id supplied by the caller (the preview page
// knows exactly which form it rendered, so it wins over sessionStorage).
function handleFormSubmission(submission, formInstance, formContainer, formIdOverride) {
    // console.log('='.repeat(60));
    // console.log('📤 HANDLING FORM SUBMISSION');
    // console.log('='.repeat(60));
    // console.log('Full submission object:', submission);
    // console.log('Form instance:', formInstance);
    
    // Get the form ID - try multiple sources (in priority order)
    var editingFormId = readStoredFormId('editingFormId');
    var previewFormId = readStoredFormId('previewFormId');
    var formId = sanitizeFormId(formIdOverride) || editingFormId || previewFormId;
    
    // console.log('🔍 SOURCE 1 - sessionStorage:');
    // console.log('  editingFormId:', editingFormId);
    // console.log('  previewFormId:', previewFormId);
    // console.log('  formId (either):', formId);

    // Try to get formId from submission.form (if Formio set it)
    if (!formId && submission && submission.form) {
        // console.log('🔍 SOURCE 2 - submission.form:');
        // console.log('  submission.form:', submission.form);
        // console.warn('⚠️ FormId not in sessionStorage, using submission.form:', submission.form);
        formId = sanitizeFormId(submission.form);
    }

    // Try to get formId from form schema stored in sessionStorage
    if (!formId) {
        // console.log('🔍 SOURCE 3 - previewFormSchema:');
        try {
            var previewFormSchema = sessionStorage.getItem('previewFormSchema');
            if (previewFormSchema) {
                var schema = JSON.parse(previewFormSchema);
                // console.log('  schema._id:', schema._id);
                // console.log('  schema.form:', schema.form);
                // console.log('  schema.name:', schema.name);
                // console.log('  schema.title:', schema.title);
                formId = sanitizeFormId(schema._id) || sanitizeFormId(schema.form);
            }
        } catch (e) {
            // console.warn('Could not parse previewFormSchema:', e);
        }
    }

    // Try to get formId from the form instance (use actual ID, not name)
    if (!formId && formInstance) {
        // console.log('🔍 SOURCE 4 - formInstance:');
        // console.log('  formInstance._id:', formInstance._id);
        // console.log('  formInstance.form:', formInstance.form);
        // console.log('  formInstance.formId:', formInstance.formId);
        // console.log('  formInstance.url:', formInstance.url);
        
        formId = sanitizeFormId(formInstance._id);
        if (!formId && formInstance.form && typeof formInstance.form === 'object') {
            formId = sanitizeFormId(formInstance.form._id);
        }
    }
    
    console.log('✅ FINAL formId selected:', formId);
    
    if (!formId) {
        console.error('❌ No form ID found in any source');
        alert('Cannot submit form - Form ID is missing. Please reload the form and try again.');
        return false;
    }

    // Get the submission data
    var submissionData = submission.data;
    
    // console.log('📋 Extracted submission data:', submissionData);
    // console.log('Submission data type:', typeof submissionData);
    
    // Validate submissionData
    if (!submissionData || (typeof submissionData === 'object' && Object.keys(submissionData).length === 0)) {
        console.error('❌ Submission data is empty or invalid:', submissionData);
        alert('Form data is empty. Please fill out the form before submitting.');
        return false;
    }
    
    // Start recursive transformation for dynamicSelectionPanels
    transformDynamicSelectionPanels(submissionData, formInstance);

    // console.log('📋 Transformed submission data:', submissionData);

    if (typeof FormBuilderApi === 'undefined') {
        console.error('❌ FormBuilderApi is NOT loaded!');
        alert('FormBuilderApi is not available');
        return false;
    }

    // Ensure the submission object has the correct form ID
    // console.log('📝 SETTING submission.form:');
    // console.log('  BEFORE - submission.form:', submission.form);
    // console.log('  SETTING TO - formId:', formId);
    submission.form = formId;
    // console.log('  AFTER - submission.form:', submission.form);

    // Extract form version ID (_fvid) from form schema
    // console.log('📝 EXTRACTING FORM VERSION ID:');
    try {
        var previewFormSchema = sessionStorage.getItem('previewFormSchema');
        if (previewFormSchema) {
            var schema = JSON.parse(previewFormSchema);
            if (schema._vid !== undefined) {
                submission._fvid = schema._vid;
                // console.log('  ✅ Set _fvid from schema._vid:', submission._fvid);
            } else {
                submission._fvid = 0;
                // console.log('  ℹ️ No _vid in schema, defaulting _fvid to 0');
            }
        } else {
            submission._fvid = 0;
            // console.log('  ℹ️ No previewFormSchema, defaulting _fvid to 0');
        }
    } catch (e) {
        submission._fvid = 0;
        // console.log('  ⚠️ Could not parse previewFormSchema, defaulting _fvid to 0:', e);
    }

    // Ensure submission has all required fields
    // console.log('📝 SETTING SUBMISSION FIELDS:');
    
    // Set project (empty for now)
    if (!submission.project) {
        submission.project = '';
        // console.log('  ✅ Set project to empty string');
    }

    // Set state to "submitted"
    if (!submission.state) {
        submission.state = 'submitted';
        // console.log('  ✅ Set state to "submitted"');
    }

    // Initialize externalIds as empty array
    if (!submission.externalIds) {
        submission.externalIds = [];
        // console.log('  ✅ Initialized externalIds as empty array');
    }

    // Initialize externalTokens as empty array
    if (!submission.externalTokens) {
        submission.externalTokens = [];
        // console.log('  ✅ Initialized externalTokens as empty array');
    }

    // Set version (__v) to 0
    if (submission.__v === undefined) {
        submission.__v = 0;
        // console.log('  ✅ Set __v (version) to 0');
    }
    
    // console.log('✅ FINAL SUBMISSION TO SEND:');
    // console.log('  Form ID:', submission.form);
    // console.log('  Submission ID:', submission._id || '(will be generated)');
    // console.log('  Form Version (_fvid):', submission._fvid);
    // console.log('  Project:', submission.project);
    // console.log('  State:', submission.state);
    // console.log('  Version (__v):', submission.__v);
    // console.log('  externalIds:', submission.externalIds);
    // console.log('  externalTokens:', submission.externalTokens);
    // console.log('  Data keys:', submission.data ? Object.keys(submission.data) : 'none');
    // console.log('  Other properties:', Object.keys(submission).filter(k => !['form', 'data', '_fvid', 'project', 'state', 'externalIds', 'externalTokens', '__v', '_id', 'created', 'modified', 'metadata'].includes(k)));

    // Send COMPLETE submission object to backend (new design)
    // console.log('🚀 Calling FormBuilderApi.submitFormData() with complete submission');
    
    FormBuilderApi.submitFormData(
        submission,  // Pass the complete submission object
        function(response) {
            console.log('✅ Form submission saved successfully:', response.submissionId);
            showSuccessMessage(formContainer, response.submissionId);

            // Hide the loading spinner from the submit button
            setTimeout(function() {
                // Find all submit buttons in the form
                var submitButtons = formContainer.querySelectorAll('button[type="submit"], button.btn-submit');
                submitButtons.forEach(function(btn) {
                    // Remove the loader/spinner icon
                    var loaders = btn.querySelectorAll('.bi-refresh, i[class*="refresh"]');
                    loaders.forEach(function(loader) {
                        loader.remove();
                    });
                    // Also remove the loading class/attribute
                    btn.classList.remove('loading');
                    btn.removeAttribute('data-loading');
                });
                console.log('✅ Loading spinner hidden from submit button');
            }, 100);

            // Keep the form visible with the filled data - don't clear it
            // User can see the submitted data on the form
        },
        function(error, statusCode) {
            console.error('❌ Error submitting form:', error);
            console.log('='.repeat(60));
            showErrorMessage(formContainer, error);

            // Also hide the loading spinner on error
            setTimeout(function() {
                var submitButtons = formContainer.querySelectorAll('button[type="submit"], button.btn-submit');
                submitButtons.forEach(function(btn) {
                    var loaders = btn.querySelectorAll('.bi-refresh, i[class*="refresh"]');
                    loaders.forEach(function(loader) {
                        loader.remove();
                    });
                    btn.classList.remove('loading');
                    btn.removeAttribute('data-loading');
                    btn.removeAttribute('disabled');
                });
                console.log('✅ Loading spinner hidden from submit button after error');
            }, 100);
        }
    );

    // Prevent default submission
    return false;
}
