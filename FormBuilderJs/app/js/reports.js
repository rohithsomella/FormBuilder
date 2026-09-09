/**
 * Reports Page - JavaScript functionality
 * Handles report generation, data export, and submission selection
 */

/**
 * Escape HTML to prevent XSS attacks
 * @param {String} text - Text to escape
 * @returns {String} Escaped HTML text
 */
function escapeHtml(text) {
    var map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
}

function clearPreviewSessionStorage() {
    sessionStorage.removeItem('submissionData');
    sessionStorage.removeItem('previewFormId');
    sessionStorage.removeItem('previewFormSchema');
    console.log('✅ Cleared preview session storage keys');
}

// Initialize report page
document.addEventListener('DOMContentLoaded', function() {
    // Update heading with tenant name if present
    var urlParams = new URLSearchParams(window.location.search);
    var tenantName = urlParams.get('tenantName');
    if (tenantName) {
        var heading = document.getElementById('pageHeading');
        if (heading) {
            heading.innerHTML = 'Reports <span style="color: #6c757d;font-size:22px">' + decodeURIComponent(tenantName) + '</span>';
        }
    }

    // Load reports table when page loads
    FormBuilderApi.loadReportsTable();

    // Handle Export to JSON button
    var exportJsonBtn = document.getElementById('exportJsonBtn');
    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', function() {
            var reportModal = document.getElementById('reportModal');
            if (reportModal && reportModal.submissionsData) {
                var selectedSubmissions = getSelectedSubmissions();

                // Requirement Check: Alert if no report is selected
                if (selectedSubmissions.length === 0) {
                    alert('Select one report');
                    return;
                }

                exportToJson(selectedSubmissions, reportModal.formName);
            }
        });
    }

    // Handle Export to CSV button
    var exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', function() {
            var reportModal = document.getElementById('reportModal');
            if (reportModal && reportModal.submissionsData) {
                var selectedSubmissions = getSelectedSubmissions();

                // Requirement Check: Alert if no report is selected
                if (selectedSubmissions.length === 0) {
                    alert('Select one report');
                    return;
                }

                exportToCsv(selectedSubmissions, reportModal.formName);
            }
        });
    }

    // Handle Download as PDF button
    var downloadPdfBtn = document.getElementById('downloadPdfBtn');
    if (downloadPdfBtn) {
        downloadPdfBtn.addEventListener('click', function() {
            var reportModal = document.getElementById('reportModal');
            if (reportModal && reportModal.submissionsData) {
                var selectedSubmissions = getSelectedSubmissions();

                // Requirement Check: Alert if no report is selected
                if (selectedSubmissions.length === 0) {
                    alert('Select one report');
                    return;
                }

                downloadPdf(selectedSubmissions);
            }
        });
    }

    // Reset checkboxes when modal closes
    $('#reportModal').on('hidden.bs.modal', function() {
        document.getElementById('selectAllCheckbox').checked = false;
        document.querySelectorAll('.submission-checkbox').forEach(cb => cb.checked = false);
    });
});

/**
 * Generate report for a form
 * @param {String} formId - The form ID
 */
function generateReport(formId) {
    if (!formId) {
        console.error('Form ID is required');
        return;
    }

    console.log('Generating report for form ID:', formId);

    // Get form details first
    FormBuilderApi.getFormById(formId, 
        function(form) {
            console.log('Form loaded:', form);
            // Fetch submissions
            FormBuilderApi.getFormSubmissions(formId,
                function(submissions) {
                    console.log('Submissions loaded:', submissions);
                    displayReportDialog(form, submissions);
                },
                function(error, statusCode) {
                    console.error('Failed to load submissions:', error);
                    showReportError(error);
                }
            );
        },
        function(error, statusCode) {
            console.error('Failed to load form:', error);
            showReportError(error);
        }
    );
}

/**
 * Display the report dialog with submissions
 * @param {Object} form - The form object
 * @param {Array} submissions - Array of submission objects
 */

/**
 * Display the report dialog with submissions
 * @param {Object} form - The form object
 * @param {Array} submissions - Array of submission objects
 */
function displayReportDialog(form, submissions) {
    var modalLabel = document.getElementById('reportModalLabel');
    var submissionsTableBody = document.getElementById('submissionsTableBody');
    var submissionsTable = document.getElementById('submissionsTable');
    var reportLoadingMessage = document.getElementById('reportLoadingMessage');
    var reportErrorMessage = document.getElementById('reportErrorMessage');
    var reportModal = document.getElementById('reportModal');

    if (!modalLabel || !submissionsTableBody || !submissionsTable || !reportModal) {
        console.error('Report modal elements not found in DOM');
        return;
    }

    // Set modal title
    modalLabel.textContent = form.formName || form.title || 'Form Report';

    // Clear previous content
    submissionsTableBody.innerHTML = '';
    reportLoadingMessage.style.display = 'none';
    reportErrorMessage.style.display = 'none';

    if (!submissions || submissions.length === 0) {
        reportErrorMessage.innerHTML = '<i class="bi bi-info-circle"></i> <strong>No submissions found for this form.</strong>';
        reportErrorMessage.style.display = 'block';
        submissionsTable.style.display = 'none';
    } else {
        // Populate submissions table
        submissions.forEach(function (submission, index) {
            var row = document.createElement('tr');

            // Format dates safely (ONLY DATE, NO TIME)
            var submissionDate = submission.submissionDate || submission.created || submission.createdAt;
            var formattedSubDate = submissionDate ? new Date(submissionDate).toLocaleDateString() : 'N/A';

            var modifiedDate = submission.modifiedDate || submission.modified || submission.updatedAt;
            var formattedModDate = modifiedDate ? new Date(modifiedDate).toLocaleDateString() : 'N/A';
            var submissionId = submission.submissionId || submission.id || submission._id || '';
            var formVersion = (form && (form.versionId !== undefined && form.versionId !== null ? form.versionId : (form._vid !== undefined && form._vid !== null ? form._vid : 0)));
            var version = (submission.version !== undefined && submission.version !== null)
                ? submission.version
                : (submission._vid !== undefined && submission._vid !== null
                    ? submission._vid
                    : (submission.formVersionId !== undefined && submission.formVersionId !== null
                        ? submission.formVersionId
                        : formVersion));

            row.innerHTML =
                '<td><input type="checkbox" class="submission-checkbox" data-index="' + index + '" title="Select this submission"></td>' +
                '<td>' + escapeHtml(submissionId) + '</td>' +
                '<td>' + escapeHtml(String(version)) + '</td>' +
                '<td>' + escapeHtml(formattedSubDate) + '</td>' +
                '<td>' + escapeHtml(formattedModDate) + '</td>' +
                '<td style="text-align: center;">' +
                '<button class="btn btn-sm btn-outline-secondary view-submission-btn" title="View Submission" data-index="' + index + '">' +
                '<i class="bi bi-eye"></i>' +
                '</button>' +
                '</td>';

            // Row click event (excluding checkbox and action button clicks)
            row.style.cursor = 'pointer';
            row.addEventListener('click', function (event) {
                if (event.target.type === 'checkbox' || event.target.closest('.view-submission-btn')) {
                    return;
                }
                var checkbox = row.querySelector('.submission-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    var changeEvent = new Event('change', { bubbles: true });
                    checkbox.dispatchEvent(changeEvent);
                }
            });

            // Action button click event
            var viewBtn = row.querySelector('.view-submission-btn');
            if (viewBtn) {
                viewBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    viewSubmissionDetails(submission);
                });
            }

            submissionsTableBody.appendChild(row);
        });

        submissionsTable.style.display = 'table';
        try {
            initializeSelectAllCheckbox();
        } catch (error) {
            console.error('Error initializing checkboxes:', error);
        }
    }

    // Store submissions in modal for export functions
    reportModal.submissionsData = submissions;
    reportModal.formName = form.formName || form.title;

    // Show modal
    try {
        if ($('#reportModal').length > 0) {
            $('#reportModal').modal('show');
        } else {
            console.error('Report modal element not found for display');
        }
    } catch (error) {
        console.error('Error showing modal:', error);
    }
}

/**
 * Handle viewing individual submission details when clicking the Eye icon
 * Opens the preview page with the submission data populated in the form
 */
function viewSubmissionDetails(submission) {
    if (!submission) {
        alert('Error: No submission data available');
        return;
    }

    // Extract formId from submission
    const formId = submission.formId || submission.form || submission._formId;
    
    if (!formId) {
        alert('Error: Form ID not found in submission data');
        return;
    }

    // Fetch the form schema from the database
    FormBuilderApi.getFormById(formId,
        function(form) {
            clearPreviewSessionStorage();

            // Store both form schema and submission data in sessionStorage
            sessionStorage.setItem('previewFormSchema', JSON.stringify(form));
            sessionStorage.setItem('submissionData', JSON.stringify(submission));
            
            // Open preview page in a new window
            window.open('previewPage.html?mode=viewSubmission', '_blank', 'width=1000,height=800');
        },
        function(error, statusCode) {
            console.error('Failed to load form:', error);
            alert('Error: Failed to load form schema. ' + error);
        }
    );
}

/**
 * Initialize select all checkbox functionality
 */
function initializeSelectAllCheckbox() {
    var selectAllCheckbox = document.getElementById('selectAllCheckbox');
    var submissionCheckboxes = document.querySelectorAll('.submission-checkbox');

    if (!selectAllCheckbox) {
        return;
    }

    // Handle select all checkbox
    selectAllCheckbox.addEventListener('change', function() {
        var isChecked = this.checked;
        submissionCheckboxes.forEach(function(checkbox) {
            checkbox.checked = isChecked;
        });
    });

    // Handle individual submission checkboxes
    submissionCheckboxes.forEach(function(checkbox) {
        checkbox.addEventListener('change', function() {
            // Update select all checkbox state
            var allChecked = Array.from(submissionCheckboxes).every(function(cb) {
                return cb.checked;
            });
            var someChecked = Array.from(submissionCheckboxes).some(function(cb) {
                return cb.checked;
            });

            selectAllCheckbox.checked = allChecked;
            selectAllCheckbox.indeterminate = someChecked && !allChecked;
        });
    });
}

/**
 * Get selected submissions
 * @returns {Array} Array of selected submission objects
 */
function getSelectedSubmissions() {
    var submissionCheckboxes = document.querySelectorAll('.submission-checkbox:checked');
    var reportModal = document.getElementById('reportModal');
    var selectedSubmissions = [];

    submissionCheckboxes.forEach(function(checkbox) {
        var index = parseInt(checkbox.getAttribute('data-index'));
        if (reportModal.submissionsData && reportModal.submissionsData[index]) {
            selectedSubmissions.push(reportModal.submissionsData[index]);
        }
    });

    return selectedSubmissions;
}

/**
 * Show error message in report dialog
 * @param {String} message - Error message to display
 */
function showReportError(message) {
    var reportErrorMessage = document.getElementById('reportErrorMessage');
    var submissionsTable = document.getElementById('submissionsTable');
    var reportLoadingMessage = document.getElementById('reportLoadingMessage');

    if (reportErrorMessage) {
        reportErrorMessage.innerHTML = '<i class="bi bi-exclamation-circle"></i> <strong>' + escapeHtml(message) + '</strong>';
        reportErrorMessage.style.display = 'block';
    }

    if (submissionsTable) {
        submissionsTable.style.display = 'none';
    }

    if (reportLoadingMessage) {
        reportLoadingMessage.style.display = 'none';
    }

    var reportModal = document.getElementById('reportModal');
    if (reportModal) {
        $('#reportModal').modal('show');
    }
}

/**
 * Export submissions to JSON
 * @param {Array} submissions - Array of submission objects
 * @param {String} formName - Name of the form
 */
function exportToJson(submissions, formName) {
    if (!submissions || submissions.length === 0) {
        alert('No data to export');
        return;
    }

    var dataStr = JSON.stringify(submissions, null, 2);
    var dataBlob = new Blob([dataStr], { type: 'application/json' });
    var url = URL.createObjectURL(dataBlob);
    var link = document.createElement('a');
    link.href = url;
    link.download = (formName || 'report') + '_' + new Date().getTime() + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Flatten nested object to get leaf-level keys only
 * @param {Object} obj - Object to flatten
 * @param {String} prefix - Prefix for nested keys
 * @returns {Object} Flattened object with leaf-level keys only
 */
function flattenObject(obj, prefix = '') {
    var flattened = {};
    
    for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
            var value = obj[key];
            var newKey = prefix ? prefix + '.' + key : key;

            // Check if value is an object (but not null, date, or array)
            if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
                // Recursively flatten nested objects
                var nested = flattenObject(value, newKey);
                for (var nestedKey in nested) {
                    if (nested.hasOwnProperty(nestedKey)) {
                        flattened[nestedKey] = nested[nestedKey];
                    }
                }
            } else if (Array.isArray(value)) {
                // Handle arrays by joining with ", " delimiter
                flattened[newKey] = value.map(function(item) {
                    return typeof item === 'object' ? JSON.stringify(item) : String(item);
                }).join(', ');
            } else {
                // Leaf-level value
                flattened[newKey] = value;
            }
        }
    }
    
    return flattened;
}

/**
 * Escape CSV value to handle commas, quotes, and newlines
 * @param {*} value - Value to escape
 * @returns {String} Escaped value for CSV
 */
function escapeCsvValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    
    var stringValue = String(value);

    // If value contains comma, double quote, or newline, wrap in quotes and escape quotes
    if (stringValue.indexOf(',') !== -1 || stringValue.indexOf('"') !== -1 || stringValue.indexOf('\n') !== -1) {
        return '"' + stringValue.replace(/"/g, '""') + '"';
    }
    
    return stringValue;
}

/**
 * Parse submission data - handles both JSON strings and objects
 * @param {*} submissionData - Raw submission data from database
 * @returns {Object} Parsed submission object
 */
function parseSubmissionData(submissionData) {
    if (typeof submissionData === 'string') {
        try {
            return JSON.parse(submissionData);
        } catch (e) {
            console.error('Error parsing submission data:', e);
            return { rawData: submissionData };
        }
    }
    return submissionData;
}

/**
 * Extract form data from submission object
 * Handles various possible structures (data, submissionData, formData, or root level)
 * @param {Object} submission - Submission object
 * @returns {Object} Form data object
 */
function extractFormData(submission) {
    // Check if submission has a specific data field
    if (submission.data) {
        var data = submission.data;
        return typeof data === 'string' ? parseSubmissionData(data) : data;
    }

    // Check for submissionData field
    if (submission.submissionData) {
        var submData = submission.submissionData;
        return typeof submData === 'string' ? parseSubmissionData(submData) : submData;
    }
    // Check for formData field
    if (submission.formData) {
        var formData = submission.formData;
        return typeof formData === 'string' ? parseSubmissionData(formData) : formData;
    }
    // Otherwise, assume root level contains the form data (but exclude metadata fields)
    var formData = {};
    var metadataFields = ['submissionId', 'formId', 'submissionDate', 'id', 'createdAt', 'updatedAt', 'userId'];
    
    for (var key in submission) {
        if (submission.hasOwnProperty(key) && metadataFields.indexOf(key) === -1) {
            var value = submission[key];
            // Try to parse if it's a JSON string
            if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
                try {
                    formData[key] = parseSubmissionData(value);
                } catch (e) {
                    formData[key] = value;
                }
            } else {
                formData[key] = value;
            }
        }
    }
    
    return formData;
}

/**
 * Export submissions to CSV with flattened nested data
 * @param {Array} submissions - Array of submission objects
 * @param {String} formName - Name of the form
 */
function exportToCsv(submissions, formName) {
    if (!submissions || submissions.length === 0) {
        alert('No data to export');
        return;
    }

    // Collect all unique leaf-level keys from all submissions
    var allKeys = {};
    var flattenedSubmissions = [];

    submissions.forEach(function (submission) {
        // Extract the actual form data from the submission
        var formData = extractFormData(submission);

        // Flatten the form data
        var flattened = flattenObject(formData);
        flattenedSubmissions.push(flattened);

        // Collect all keys
        for (var key in flattened) {
            if (flattened.hasOwnProperty(key)) {
                allKeys[key] = true;
            }
        }
    });
    // Sort keys for consistent column order
    var sortedKeys = Object.keys(allKeys).sort();

    // Extract leaf-only key names for headers (remove path prefixes)
    var leafKeyNames = sortedKeys.map(function (fullKey) {
        // Get the last part after the final dot
        var parts = fullKey.split('.');
        return parts[parts.length - 1];
    });

    // Create header row: Form Name, Form ID, Submission Date, then all other keys (leaf names only)
    var headerRow = ['Form Name', 'Form ID', 'Submission Date'].concat(leafKeyNames);
    var csv = headerRow.map(function (header) {
        return escapeCsvValue(header);
    }).join(',') + '\n';
    // Add data rows
    submissions.forEach(function (submission, index) {
        var flattened = flattenedSubmissions[index];
        var rowValues = [
            formName || '',
            submission.formId || '',
            submission.submissionDate ? new Date(submission.submissionDate).toLocaleString() : ''
        ];
        // Add values for all keys (empty string if key not present in this submission)
        sortedKeys.forEach(function (key) {
            rowValues.push(flattened[key] !== undefined ? flattened[key] : '');
        });
        
        csv += rowValues.map(function(value) {
            return escapeCsvValue(value);
        }).join(',') + '\n';
    });

    var dataBlob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(dataBlob);
    var link = document.createElement('a');
    link.href = url;
    link.download = (formName || 'report') + '_' + new Date().getTime() + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Background PDF job queue.
 *
 * Each generation request runs in the background and is tracked by its own ribbon at the
 * bottom right of the Reports page: transparent blue with an hourglass and a live elapsed
 * timer while it runs, green when the file downloads, red when it fails. Ribbons stack, so
 * the user can keep selecting rows and queueing more PDFs without waiting.
 *
 * Scoped to this page - the container lives in reports.html, so no other page shows them.
 */
var PdfJobQueue = (function() {
    'use strict';

    var SUCCESS_HIDE_MS = 2500;
    var FAILURE_HIDE_MS = 4000;

    var activeJobs = [];   // jobs still running, for the shared elapsed-time ticker
    var ticker = null;

    /**
     * Format elapsed milliseconds as m:ss
     */
    function formatElapsed(ms) {
        var totalSeconds = Math.floor(ms / 1000);
        var minutes = Math.floor(totalSeconds / 60);
        var seconds = totalSeconds % 60;
        return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    }

    /**
     * One interval drives every running ribbon rather than one timer per job
     */
    function startTicker() {
        if (ticker) {
            return;
        }
        ticker = setInterval(function() {
            activeJobs.forEach(function(job) {
                job.metaEl.textContent = job.subtitle + ' · ' + formatElapsed(Date.now() - job.startedAt);
            });
            if (activeJobs.length === 0) {
                clearInterval(ticker);
                ticker = null;
            }
        }, 1000);
    }

    function removeRibbon(job) {
        if (job.removed) {
            return;
        }
        job.removed = true;
        job.element.classList.add('pdf-job-leaving');
        setTimeout(function() {
            if (job.element.parentNode) {
                job.element.parentNode.removeChild(job.element);
            }
        }, 250);
    }

    function finish(job, state, icon, title, meta, hideAfterMs) {
        var index = activeJobs.indexOf(job);
        if (index !== -1) {
            activeJobs.splice(index, 1);
        }

        job.element.setAttribute('data-state', state);
        job.iconEl.className = 'bi ' + icon + ' pdf-job-icon';
        job.titleEl.textContent = title;
        job.metaEl.textContent = meta;
        job.closeEl.style.display = 'block';

        job.hideTimer = setTimeout(function() { removeRibbon(job); }, hideAfterMs);
    }

    /**
     * Add a ribbon and start tracking a job
     * @param {String} title - Form name
     * @param {String} subtitle - e.g. "3 submissions"
     * @returns {Object} handle with succeed(fileName) and fail(message)
     */
    function add(title, subtitle) {
        var container = document.getElementById('pdfJobQueue');
        if (!container) {
            return { succeed: function() {}, fail: function(m) { alert('Error: ' + m); } };
        }

        var element = document.createElement('div');
        element.className = 'pdf-job';
        element.setAttribute('data-state', 'running');
        element.innerHTML =
            '<i class="bi bi-hourglass-split pdf-job-icon"></i>' +
            '<div class="pdf-job-body">' +
                '<div class="pdf-job-title"></div>' +
                '<div class="pdf-job-meta"></div>' +
            '</div>' +
            '<button type="button" class="pdf-job-close" title="Dismiss" style="display:none;">&times;</button>';

        var job = {
            element: element,
            iconEl: element.querySelector('.pdf-job-icon'),
            titleEl: element.querySelector('.pdf-job-title'),
            metaEl: element.querySelector('.pdf-job-meta'),
            closeEl: element.querySelector('.pdf-job-close'),
            subtitle: subtitle,
            startedAt: Date.now(),
            removed: false,
            hideTimer: null
        };

        // textContent, not innerHTML - form names are user supplied
        job.titleEl.textContent = title;
        job.metaEl.textContent = subtitle + ' · 0:00';

        job.closeEl.addEventListener('click', function() {
            clearTimeout(job.hideTimer);
            removeRibbon(job);
        });

        container.appendChild(element);
        activeJobs.push(job);
        startTicker();

        return {
            succeed: function(fileName) {
                finish(job, 'done', 'bi-check-circle-fill', title,
                    'Downloaded · ' + formatElapsed(Date.now() - job.startedAt), SUCCESS_HIDE_MS);
                job.titleEl.title = fileName || '';
            },
            fail: function(message) {
                finish(job, 'failed', 'bi-exclamation-triangle-fill', title + ' — failed',
                    message || 'PDF generation failed', FAILURE_HIDE_MS);
            }
        };
    }

    return { add: add };
})();

/**
 * Download submissions as PDF.
 *
 * Queues the request and returns immediately - the button stays clickable so more PDFs can
 * be started while earlier ones are still rendering. Progress is shown by a ribbon per job.
 *
 * @param {Array} submissions - Array of selected submission objects
 */
function downloadPdf(submissions) {
    if (!submissions || submissions.length === 0) {
        alert('No data to download');
        return;
    }

    // Extract submission IDs from selected submissions
    var submissionIds = submissions.map(function(submission) {
        return submission.submissionId || submission.id || submission._id;
    }).filter(function(id) {
        return id !== null && id !== undefined;
    });

    if (submissionIds.length === 0) {
        alert('No valid submission IDs found');
        return;
    }

    var reportModal = document.getElementById('reportModal');
    var formName = (reportModal && reportModal.formName) || 'Form';
    var countLabel = submissionIds.length === 1
        ? '1 submission'
        : submissionIds.length + ' submissions';

    var job = PdfJobQueue.add(formName, countLabel);

    FormBuilderApi.generateSubmissionsPdf(submissionIds,
        function(blob, fileName) {
            savePdfBlob(blob, fileName);
            job.succeed(fileName);
        },
        function(error) {
            job.fail(error);
        }
    );
}

/**
 * Save a generated PDF to disk
 * @param {Blob} blob - The generated PDF
 * @param {String} fileName - File name suggested by the backend
 */
function savePdfBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'form-submissions.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
