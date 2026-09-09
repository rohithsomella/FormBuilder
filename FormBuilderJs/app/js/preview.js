/**
 * Preview Page - JavaScript functionality
 * Handles form preview and submission viewer
 */

// Escape untrusted text before inserting it into innerHTML.
// Defined locally: FormBuilderApi.js keeps its own escapeHtml private to its IIFE,
// and the global ones in reports.js/addResource.js are not loaded on this page.
function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Initialize preview page when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initializePreview();
});

/**
 * Initialize the preview page
 */
function initializePreview() {
    // Get form schema from sessionStorage
    const previewFormSchema = sessionStorage.getItem('previewFormSchema');
    let previewFormId = sanitizeFormId(sessionStorage.getItem('previewFormId'));
    const submissionData = sessionStorage.getItem('submissionData');
    const isViewingSubmission = submissionData !== null;
    const formContainer = document.getElementById('previewFormContent');
    const previewTitle = document.getElementById('previewTitle');
    const closeViewerBtn = document.getElementById('closeViewerBtn');

    console.log('=== previewPage.html loaded ===');
    console.log('previewFormSchema available:', !!previewFormSchema);
    console.log('previewFormId from sessionStorage:', previewFormId);
    console.log('submissionData available:', !!submissionData);
    console.log('isViewingSubmission:', isViewingSubmission);

    // Update title if viewing submission
    if (isViewingSubmission) {
        previewTitle.textContent = 'Form Submission Preview';
        closeViewerBtn.style.display = 'inline-block';
    }

    if (!previewFormSchema) {
        formContainer.innerHTML = '<div class="error-message"><i class="bi bi-exclamation-circle"></i> <strong>Error:</strong> No form schema found. Please open the form preview from the builder.</div>';
    } else {
        try {
            let formSchema = JSON.parse(previewFormSchema);
            console.log('📄 Loading form schema in preview page');
            console.log('📋 Full form schema:', formSchema);

            // Handle various possible form schema structures from database
            // Sometimes the form might be wrapped in a 'form' property
            if (formSchema.form && typeof formSchema.form === 'object') {
                console.log('ℹ️ Unwrapping form from form property');
                formSchema = formSchema.form;
            }

            // Handle Components as JSON string (from .NET backend)
            if (formSchema.components && typeof formSchema.components === 'string') {
                console.log('ℹ️ Components is a JSON string, parsing it');
                try {
                    formSchema.components = JSON.parse(formSchema.components);
                    console.log('✅ Components parsed from string:', formSchema.components);
                } catch (e) {
                    console.warn('⚠️ Failed to parse components string:', e);
                    formSchema.components = [];
                }
            }

            // Ensure components is an array and validate structure
            if (!formSchema.components) {
                console.warn('⚠️ No components found, initializing empty array');
                formSchema.components = [];
            } else if (!Array.isArray(formSchema.components)) {
                console.warn('⚠️ Components is not an array, attempting to convert:', typeof formSchema.components);
                if (typeof formSchema.components === 'object') {
                    formSchema.components = Object.values(formSchema.components);
                } else {
                    formSchema.components = [];
                }
            }

            // Validate and clean components
            console.log('📦 Validating components array, length:', formSchema.components.length);
            formSchema.components = formSchema.components.filter(comp => {
                if (!comp || typeof comp !== 'object') {
                    console.warn('⚠️ Skipping invalid component:', comp);
                    return false;
                }
                if (!comp.type) {
                    console.warn('⚠️ Component missing type property:', comp);
                    // Try to infer type or skip
                    if (comp.input) comp.type = 'textfield';
                    else return false;
                }
                return true;
            });

            // Use the formId from sessionStorage (set by launchForm) or from schema
            if (previewFormId) {
                console.log('✅ Using previewFormId from sessionStorage:', previewFormId);
            } else if (sanitizeFormId(formSchema._id) || sanitizeFormId(formSchema.id)) {
                // Fallback to schema._id or schema.id
                previewFormId = sanitizeFormId(formSchema._id) || sanitizeFormId(formSchema.id);
                sessionStorage.setItem('previewFormId', previewFormId);
                console.log('✅ Using schema id as previewFormId:', previewFormId);
            } else {
                console.warn('⚠️ FormId not found in sessionStorage or schema');
            }

            // Ensure formSchema has required properties
            if (!formSchema.display) {
                formSchema.display = 'form';
            }

            // Parse submission data if viewing a submission
            let populatedSubmissionData = null;
            if (isViewingSubmission) {
                try {
                    const parsedSubmission = JSON.parse(submissionData);
                    // Extract form data from submission (could be in data, submissionData, formData, or root level)
                    if (parsedSubmission.data) {
                        populatedSubmissionData = { data: parsedSubmission.data };
                    } else if (parsedSubmission.submissionData) {
                        populatedSubmissionData = { data: parsedSubmission.submissionData };
                    } else if (parsedSubmission.formData) {
                        populatedSubmissionData = { data: parsedSubmission.formData };
                    } else {
                        // Assume submission object itself contains the form data
                        populatedSubmissionData = { data: parsedSubmission };
                    }
                    console.log('📝 Submission data parsed:', populatedSubmissionData);
                } catch (e) {
                    console.error('Error parsing submission data:', e);
                }
            }

            // Create form with read-only option if viewing submission
            const formOptions = isViewingSubmission ? { readOnly: true } : {};

            console.log('📐 Creating form with options:', formOptions);
            console.log('📐 Final formSchema components count:', formSchema.components.length);
            console.log('📐 First component:', formSchema.components[0]);

            // Load form using Formio
            Formio.createForm(formContainer, formSchema, formOptions)
                .then(function(form) {
                    console.log('✓ Form preview loaded successfully in page');
                    console.log('FormBuilderApi available?', typeof FormBuilderApi !== 'undefined');
                    console.log('📋 Final previewFormId:', previewFormId);

                    // Populate form with submission data if viewing submission
                    if (isViewingSubmission && populatedSubmissionData) {
                        form.submission = populatedSubmissionData;
                        console.log('✅ Form populated with submission data');
                    }

                    // Store formId in sessionStorage for form submission handler
                    if (previewFormId) {
                        sessionStorage.setItem('previewFormId', previewFormId);
                    }

                    // Handle form submission (only if not viewing submission in read-only mode)
                    if (!isViewingSubmission) {
                        form.on('submitForm', function(submission) {
                            console.log('🔔 SUBMITFORM EVENT FIRED!', submission);
                            handleFormSubmission(submission, form, formContainer, previewFormId);
                        });

                        // Also try alternative events
                        form.on('submit', function(submission) {
                            console.log('🔔 SUBMIT EVENT FIRED!', submission);
                            handleFormSubmission(submission, form, formContainer, previewFormId);
                        });
                    }

                    // Also listen for form errors
                    form.on('error', function(error) {
                        console.error('Form error:', error);
                    });
                })
                .catch(function(error) {
                    console.error('Error loading form preview:', error);
                    console.error('Error stack:', error.stack);
                    formContainer.innerHTML = '<div class="error-message"><i class="bi bi-exclamation-circle"></i> <strong>Error loading form:</strong> ' + escapeHtml(error.message) + '</div>';
                });
        } catch (error) {
            console.error('Error parsing form schema:', error);
            console.error('Error stack:', error.stack);
            formContainer.innerHTML = '<div class="error-message"><i class="bi bi-exclamation-circle"></i> <strong>Error:</strong> Invalid form schema. ' + escapeHtml(error.message) + '</div>';
        }
    }

    // Clean up submission data from sessionStorage when window closes
    window.addEventListener('beforeunload', function() {
        if (isViewingSubmission) {
            sessionStorage.removeItem('submissionData');
        }
    });
}
