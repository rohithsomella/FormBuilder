/**
 * Loading overlay gate.
 * =====================
 *
 * Holds #appLoader (markup and styles live in index.html, inlined there so it paints on
 * the first frame) until every gate below reports in, so the builder is never revealed
 * half-drawn. Gates call AppLoader.done(name).
 *
 * Defined at the very top of this file, before any other statement, so that a failure
 * further down - a missing Formio, a bad API response - still leaves the overlay with a
 * working escape hatch rather than stranding the user behind a spinner.
 */
window.AppLoader = (function () {
    'use strict';

    var GATES = ['assets', 'builder'];
    var LABELS = {
        assets: 'Loading assets…',
        builder: 'Preparing workspace…'
    };
    var MIN_VISIBLE_MS = 300;
    var MAX_WAIT_MS = 12000;

    var pending = {};
    var remaining = GATES.length;
    var definedAt = Date.now();
    var finished = false;

    GATES.forEach(function (gate) { pending[gate] = true; });

    /**
     * Milliseconds since the navigation started - not since this file ran. main.js is the
     * last script on the page, so the two are far apart, and it is the page's age that
     * decides whether the overlay would flash by on a warm cache.
     */
    function pageAge() {
        if (window.performance && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now() - definedAt;
    }

    function paint() {
        var bar = document.getElementById('appLoaderBar');
        var status = document.getElementById('appLoaderStatus');
        var label = 'Ready';

        for (var i = 0; i < GATES.length; i++) {
            if (pending[GATES[i]]) { label = LABELS[GATES[i]]; break; }
        }

        if (bar) bar.style.width = Math.round(((GATES.length - remaining) / GATES.length) * 100) + '%';
        if (status) status.textContent = label;
    }

    function dismiss() {
        var overlay = document.getElementById('appLoader');
        if (!overlay) return;

        overlay.classList.add('is-hidden');
        setTimeout(function () {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 280);
    }

    function finish() {
        if (finished) return;
        finished = true;
        paint();

        // Let the bar visibly reach 100%, and never flash by on a warm cache.
        setTimeout(dismiss, Math.max(120, MIN_VISIBLE_MS - pageAge()));
    }

    function done(gate) {
        if (finished || !pending[gate]) return;

        delete pending[gate];
        remaining--;
        paint();

        if (remaining <= 0) finish();
    }

    if (document.readyState === 'complete') {
        done('assets');
    } else {
        window.addEventListener('load', function () { done('assets'); });
    }

    // Never trap the user behind the overlay if a gate never reports.
    setTimeout(function () {
        GATES.forEach(function (gate) { done(gate); });
    }, MAX_WAIT_MS);

    return { done: done };
})();

console.log("Loaded:", Formio);

// Initialize Bootstrap tooltips
$(function() {
    $('[data-toggle="tooltip"]').tooltip();
    
    // Reinitialize tooltips for dynamically created buttons
    $(document).on('DOMNodeInserted', function() {
        $('[data-toggle="tooltip"]').not('[data-toggle="tooltip"].bs-tooltip-auto').tooltip();
    });
    
    // Watch for changes in formsTableBody (for existingForms.html) and reinitialize tooltips
    var tableBody = document.getElementById('formsTableBody');
    if (tableBody) {
        var observer = new MutationObserver(function() {
            $('[data-toggle="tooltip"]').tooltip('dispose');
            $('[data-toggle="tooltip"]').tooltip();
        });
        
        observer.observe(tableBody, {
            childList: true,
            subtree: true
        });
    }
});

let builderInstance = null;

// Move history tracking OUTSIDE the Formio.builder callback
// so it persists across builder recreations (undo/redo)
let formHistory = [];
let historyIndex = -1;
let isSavingState = false;

// Form details tracking
let currentFormName = 'Untitled Form';
let formTags = [];
let formMetadata = {
    title: '',
    tags: [],
    formKey: ''
};

function clearPreviewSessionStorage() {
    sessionStorage.removeItem('submissionData');
    sessionStorage.removeItem('previewFormId');
    sessionStorage.removeItem('previewFormSchema');
    console.log('✅ Cleared preview session storage keys');
}

//
// Reusable function to load form JSON into builder
//
function loadFormJsonIntoBuilder(formJson) {
    console.log('Loading form JSON into builder...');
    console.log('Input schema:', formJson);
    
    try {
        // Reset metadata for fresh start
        formMetadata = {
            title: '',
            tags: [],
            formKey: ''
        };
        
        // Store original JSON for metadata extraction
        let extractedFormMetadata = null;
        
        // Handle multiple JSON formats
        if (formJson.forms && typeof formJson.forms === 'object' && !Array.isArray(formJson.forms)) {
            console.log('Detected FormIO form definition with forms object');
            const formsArray = Object.values(formJson.forms);
            if (formsArray.length > 0) {
                const firstForm = formsArray[0];
                console.log('First form from object:', {
                    title: firstForm.title,
                    tags: firstForm.tags,
                    hasComponents: !!firstForm.components
                });
                // Extract metadata from the forms node
                extractedFormMetadata = {
                    title: firstForm.title || '',
                    tags: (firstForm.tags && Array.isArray(firstForm.tags)) ? firstForm.tags : [],
                    formKey: Object.keys(formJson.forms)[0]
                };
                console.log('📋 Extracted form metadata:', extractedFormMetadata);
                formJson = { components: firstForm.components || [] };
            }
        }
        else if (formJson.forms && Array.isArray(formJson.forms) && formJson.forms.length > 0) {
            console.log('Detected FormIO form definition with forms array');
            const firstForm = formJson.forms[0];
            console.log('First form from array:', {
                title: firstForm.title,
                tags: firstForm.tags,
                hasComponents: !!firstForm.components
            });
            // Extract metadata from the forms node
            extractedFormMetadata = {
                title: firstForm.title || '',
                tags: (firstForm.tags && Array.isArray(firstForm.tags)) ? firstForm.tags : [],
                formKey: firstForm.name || ''
            };
            console.log('📋 Extracted form metadata:', extractedFormMetadata);
            formJson = { components: firstForm.components || [] };
        }
        else if (Array.isArray(formJson)) {
            console.log('Detected array of components');
            formJson = { components: formJson };
        }
        else if (formJson.type) {
            console.log('Detected single component format');
            if (formJson.components && Array.isArray(formJson.components)) {
                formJson = { components: formJson.components };
            } else {
                formJson = { components: [formJson] };
            }
        }
        else if (!formJson.components) {
            console.log('No components found, creating empty schema');
            formJson = { components: [] };
        }

        console.log('Final schema for builder:', {
            componentCount: formJson.components ? formJson.components.length : 0,
            hasComponents: !!formJson.components
        });

        // Store metadata to be used after builder loads
        if (extractedFormMetadata) {
            formMetadata = extractedFormMetadata;
        }

        return Formio.builder(
            document.getElementById('builder'),
            formJson
        );
    } catch (ex) {
        console.error('Error loading form JSON:', ex);
        alert('Invalid form JSON');
        throw ex;
    }
}

// Save form state to history
const saveFormState = function() {
    if (isSavingState || !builderInstance) {
        console.log('Skipping save: isSavingState=', isSavingState, 'builderInstance=', !!builderInstance);
        return;
    }
    
    const schema = builderInstance.schema;
    console.log('saveFormState called. Schema components:', schema?.components?.length || 0);
    
    if (schema) {
        // Remove future history if we're not at the end
        formHistory = formHistory.slice(0, historyIndex + 1);
        // Add new state
        const schemaStr = JSON.stringify(schema);
        formHistory.push(schemaStr);
        historyIndex++;
        console.log('✓ Form state saved. History length:', formHistory.length, 'Index:', historyIndex);
    }
};

//
// Populate form details from extracted metadata
//
function populateFormDetails() {
    console.log('🔧 Populating form details from metadata...');
    console.log('Current formTags:', formTags);
    console.log('formMetadata:', formMetadata);
    if (typeof $ === 'undefined') return;
    
    try {
        // Only populate from metadata if not already set from editing data
        if (!currentFormName || currentFormName === 'Untitled Form') {
            if (formMetadata.title) {
                console.log('Setting form name to:', formMetadata.title);
                currentFormName = formMetadata.title;
            }
        }
        
        // Populate form title input (now the primary field)
        
        $('.form-name-input').val(currentFormName);
        $('#formTitleInput').val(currentFormName);
        
        // Merge tags: prioritize existing formTags, then add metadata tags
        let tagsToDisplay = [];
        
        // Add existing formTags
        if (formTags && Array.isArray(formTags) && formTags.length > 0) {
            tagsToDisplay = formTags.slice(); // Copy existing tags
            console.log('Using existing formTags:', tagsToDisplay);
        }
        
        // Add metadata tags if not already present
        if (formMetadata.tags && Array.isArray(formMetadata.tags) && formMetadata.tags.length > 0) {
            console.log('Found metadata tags:', formMetadata.tags);
            formMetadata.tags.forEach(function(metaTag) {
                if (metaTag && !tagsToDisplay.includes(metaTag)) {
                    tagsToDisplay.push(metaTag);
                    console.log('Added metadata tag:', metaTag);
                }
            });
        }
        
        // Update formTags with merged result
        formTags = tagsToDisplay;
        console.log('Final tags to render:', formTags);
        
        // Render tags
        $('#tagContainer').empty();
        if (formTags && formTags.length > 0) {
            console.log('🏷️ Rendering', formTags.length, 'tags');
            formTags.forEach(function(tag) {
                const cleanTag = tag.trim();
                if (cleanTag) {
                    const tagEl = document.createElement('span');
                    tagEl.className = 'tag-chip';
                    const closeBtn = document.createElement('button');
                    closeBtn.className = 'tag-remove';
                    closeBtn.type = 'button';
                    closeBtn.innerHTML = '&times;';
                    
                    tagEl.innerHTML = cleanTag;
                    tagEl.appendChild(closeBtn);
                    
                    closeBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        formTags = formTags.filter(t => t.trim() !== cleanTag);
                        tagEl.remove();
                    });
                    document.getElementById('tagContainer').appendChild(tagEl);
                    console.log('✓ Tag rendered:', cleanTag);
                }
            });
        } else {
            console.log('No tags to render');
        }
        console.log('✓ Form details populated');
    } catch (e) {
        console.error('Error populating form details:', e);
    }
}

// Undo functionality
const performUndo = function() {
    console.log('performUndo called. History length:', formHistory.length, 'Current index:', historyIndex);
    
    if (historyIndex > 0) {
        historyIndex--;
        const previousSchema = JSON.parse(formHistory[historyIndex]);
        
        console.log('✓ Performing undo to index:', historyIndex, 'Components:', previousSchema?.components?.length || 0);
        
        // Clear the builder and recreate with previous schema
        const builderContainer = document.getElementById('builder');
        builderContainer.innerHTML = '';
        
        // Set flag to prevent auto-save during undo
        isSavingState = true;
        
        // Recreate the builder with previous schema
        Formio.builder(builderContainer, previousSchema)
            .then(function(newBuilder) {
                builderInstance = newBuilder;
                console.log('✓ Builder recreated for undo');
                
                // Re-attach the change listener
                if (builderInstance) {
                    console.log('📡 Attaching change listener after undo');
                    builderInstance.on('change', function(schema) {
                        console.log('📢 Change event fired after undo! Components:', schema?.components?.length || 0);
                        saveFormState();
                    });
                }
                
                isSavingState = false;
                console.log('✓ Undo completed. Form restored to index:', historyIndex);
            })
            .catch(function(err) {
                isSavingState = false;
                console.error('✗ Error during undo:', err);
            });
    } else {
        console.log('✗ Nothing to undo (index is at start)');
    }
};

// Redo functionality
const performRedo = function() {
    console.log('performRedo called. History length:', formHistory.length, 'Current index:', historyIndex);
    
    if (historyIndex < formHistory.length - 1) {
        historyIndex++;
        const nextSchema = JSON.parse(formHistory[historyIndex]);
        
        console.log('✓ Performing redo to index:', historyIndex, 'Components:', nextSchema?.components?.length || 0);
        
        // Clear the builder and recreate with next schema
        const builderContainer = document.getElementById('builder');
        builderContainer.innerHTML = '';
        
        // Set flag to prevent auto-save during redo
        isSavingState = true;
        
        // Recreate the builder with next schema
        Formio.builder(builderContainer, nextSchema)
            .then(function(newBuilder) {
                builderInstance = newBuilder;
                console.log('✓ Builder recreated for redo');
                
                // Re-attach the change listener
                if (builderInstance) {
                    console.log('📡 Attaching change listener after redo');
                    builderInstance.on('change', function(schema) {
                        console.log('📢 Change event fired after redo! Components:', schema?.components?.length || 0);
                        saveFormState();
                    });
                }
                
                isSavingState = false;
                console.log('✓ Redo completed. Form restored to index:', historyIndex);
            })
            .catch(function(err) {
                isSavingState = false;
                console.error('✗ Error during redo:', err);
            });
    } else {
        console.log('✗ Nothing to redo (index is at end)');
    }
};

// Setup keyboard shortcuts (outside builder callback to prevent duplicate listeners)
document.addEventListener('keydown', function(e) {
    // Check if Ctrl key is pressed and focus is not in an input field
    if ((e.ctrlKey || e.metaKey) && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        // Undo: Ctrl+Z
        if (e.key === 'z' || e.key === 'Z') {
            e.preventDefault();
            performUndo();
        }
        // Redo: Ctrl+Y
        if (e.key === 'y' || e.key === 'Y') {
            e.preventDefault();
            performRedo();
        }
    }
});

// Setup button click handlers (attach directly, not in DOMContentLoaded)
// because this script runs at end of HTML after DOM is already loaded
try {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    console.log('=== UNDO/REDO SETUP ===');
    console.log('Undo button found:', !!undoBtn);
    console.log('Redo button found:', !!redoBtn);

    if (undoBtn) {
        undoBtn.addEventListener('click', function(e) {
            console.log('Undo button clicked! History:', formHistory.length, 'Index:', historyIndex);
            e.preventDefault();
            e.stopPropagation();
            performUndo();
        });
        console.log('Undo event listener attached');
    }

    if (redoBtn) {
        redoBtn.addEventListener('click', function(e) {
            console.log('Redo button clicked! History:', formHistory.length, 'Index:', historyIndex);
            e.preventDefault();
            e.stopPropagation();
            performRedo();
        });
        console.log('Redo event listener attached');
    }
} catch (err) {
    console.error('Error setting up undo/redo buttons:', err);
}

// Check if we're editing a form from existingForms.html
var initialFormSchema = {};
var editingFormData = null;
var isCopyingForm = false;

try {
    const editingFormDataStr = sessionStorage.getItem('editingFormData');
    console.log('📋 Checking editing form data... Found:', !!editingFormDataStr);
    if (editingFormDataStr) {
        editingFormData = JSON.parse(editingFormDataStr);
        
        // Ensure tenantId from editingFormData is also stored in sessionStorage for updateForm calls
        // This handles both cases: when tenantId came from form AND when it came from URL context
        if (editingFormData.tenantId) {
            sessionStorage.setItem('editingFormTenantId', editingFormData.tenantId);
            console.log('✅ TenantId synced to sessionStorage:', editingFormData.tenantId);
        } else {
            console.log('⚠️ Warning: editingFormData.tenantId is empty. SessionStorage tenantId:', sessionStorage.getItem('editingFormTenantId'));
        }
        
        // Store the form name and tags from editing data
        currentFormName = editingFormData.title || 'Untitled Form';
        formTags = (editingFormData.tags && Array.isArray(editingFormData.tags)) ? editingFormData.tags : [];
        console.log('Tags from editing data:', {
            parsed: formTags,
            count: formTags.length
        });
        
        // Parse the components
        if (editingFormData.components) {
            try {
                initialFormSchema = typeof editingFormData.components === 'string' 
                    ? JSON.parse(editingFormData.components) 
                    : editingFormData.components;
                console.log('✓ Form components parsed successfully. Components:', initialFormSchema.components?.length || (Array.isArray(initialFormSchema) ? initialFormSchema.length : 0));
            } catch (e) {
                console.error('Error parsing form components:', e);
                initialFormSchema = {};
            }
        }
    } else {
        // Check for copy form data
        const copyingFormDataStr = sessionStorage.getItem('copyingFormData');
        console.log('📋 Checking copying form data... Found:', !!copyingFormDataStr);
        if (copyingFormDataStr) {
            const copyingFormData = JSON.parse(copyingFormDataStr);
            console.log('📋 Loading form for copying (schema only)');
            isCopyingForm = true;
            
            // Parse the components - but DON'T populate form details
            if (copyingFormData.components) {
                try {
                    initialFormSchema = typeof copyingFormData.components === 'string' 
                        ? JSON.parse(copyingFormData.components) 
                        : copyingFormData.components;
                    console.log('✓ Form components parsed successfully for copy. Components:', initialFormSchema.components?.length || (Array.isArray(initialFormSchema) ? initialFormSchema.length : 0));
                } catch (e) {
                    console.error('Error parsing form components for copy:', e);
                    initialFormSchema = {};
                }
            }
        } else {
            console.log('🆕 No editing or copying data found - starting with empty form');
        }
    }
} catch (e) {
    console.error('Error loading form data:', e);
}

// Initialize builder with the form (empty or from editing)
loadFormJsonIntoBuilder(initialFormSchema)
.then(function(builder){
    builderInstance = builder;
    console.log("Builder Loaded", builder);

    // NOTE: Do NOT clear sessionStorage here - we need editingFormData for the Save button!
    // It will be cleared AFTER successful update/save

    // Populate form details from extracted metadata (skip for copy operations)
    if (!isCopyingForm) {
        populateFormDetails();
    } else {
        console.log('⏭️ Skipping form details population for copy operation');
    }

    // Save initial form state
    console.log('💾 Saving initial form state...');
    const initialSchema = builderInstance.schema;
    if (initialSchema) {
        formHistory.push(JSON.stringify(initialSchema));
        historyIndex++;
        console.log('✓ Initial form state saved. History length:', formHistory.length, 'Index:', historyIndex);
    }

    // Listen for form changes to save history
    if (builderInstance) {
        console.log('📡 Attaching change event listener to builder');
        builderInstance.on('change', function(schema) {
            console.log('📢 Change event fired! Components:', schema?.components?.length || 0);
            saveFormState();
        });
    }

    // Load Custom Resources from API
    console.log('🔄 Loading custom resources from API...');
    const apiBaseUrl = 'http://localhost:5155';
    
    fetch(`${apiBaseUrl}/api/resources`)
        .then(r => r.json())
        .catch(e => {
            console.error('Error fetching resources:', e);
            return [];
        })
        .then((allResources) => {
            console.log('✓ Custom resources loaded:', allResources.length);
            
            // Group resources by resourceType in JavaScript
            const resourceGroups = [];
            const groupMap = {};
            
            if (allResources && Array.isArray(allResources)) {
                allResources.forEach(resource => {
                    if (!groupMap[resource.resourceType]) {
                        groupMap[resource.resourceType] = {
                            resourceType: resource.resourceType,
                            componentsList: [],
                            itemCount: 0
                        };
                        resourceGroups.push(groupMap[resource.resourceType]);
                    }
                    groupMap[resource.resourceType].componentsList.push(resource.componentName);
                    groupMap[resource.resourceType].itemCount++;
                });
            }
            
            if (!builderInstance.groups) {
                builderInstance.groups = {};
            }
            
            // Initialize custom resource map for lookup
            if (!builderInstance.customResourcesMap) {
                builderInstance.customResourcesMap = {};
            }
            
            // Build the cache
            if (allResources && Array.isArray(allResources)) {
                allResources.forEach(resource => {
                    const key = `${resource.resourceType}|${resource.componentName}`;
                    builderInstance.customResourcesMap[key] = resource;
                    console.log('✓ Cached resource:', key);
                });
            }
            
            // Create Custom Resource group if not exists
            if (!builderInstance.groups.customResource) {
                builderInstance.groups.customResource = {
                    title: 'Custom Resource',
                    key: 'customResource',
                    weight: 50,
                    subgroups: [],
                    components: {},
                    componentOrder: []
                };
            }
            
            // Add subgroups for each resource type
            if (resourceGroups && Array.isArray(resourceGroups)) {
                resourceGroups.forEach((resourceGroup, groupIndex) => {
                    const resourceType = resourceGroup.resourceType || 'Unknown';
                    const resourceKey = `customResource-${resourceType.replace(/\s+/g, '-')}`;
                    
                    const subgroup = {
                        key: resourceKey,
                        title: resourceType,
                        components: {},
                        componentOrder: [],
                        default: groupIndex === 0,
                    };
                    
                    // Parse components list
                    let componentsList = [];
                    if (typeof resourceGroup.componentsList === 'string') {
                        componentsList = resourceGroup.componentsList.split(',').map(c => c.trim());
                    } else if (Array.isArray(resourceGroup.componentsList)) {
                        componentsList = resourceGroup.componentsList;
                    }
                    
                    // Add each component
                    componentsList.forEach((componentName) => {
                        if (!componentName) return;
                        
                        const componentKey = `component-${componentName.replace(/\s+/g, '-')}`;
                        subgroup.componentOrder.push(componentKey);
                        subgroup.components[componentKey] = {
                            title: componentName,
                            key: componentKey,
                            icon: 'fa fa-cube',
                            schema: {
                                type: 'panel',
                                title: componentName,
                                key: componentKey,
                                label: componentName,
                                components: [],
                                isNew: true,
                                resourceType: resourceType,
                                componentName: componentName
                            },
                            group: 'customResource',
                            subgroup: resourceKey
                        };
                    });
                    
                    builderInstance.groups.customResource.subgroups.push(subgroup);
                    console.log('✓ Added subgroup:', resourceKey);
                });
                
                // Patch getComponentInfo to handle custom resources
                const originalGetComponentInfo = builderInstance.getComponentInfo;
                if (originalGetComponentInfo && typeof originalGetComponentInfo === 'function') {
                    builderInstance.getComponentInfo = function(key, group) {
                        let info;
                        
                        // Handle custom resources
                        if (group && group.indexOf('customResource-') === 0) {
                            const customResourceGroups = this.groups.customResource.subgroups;
                            const customResourceGroup = customResourceGroups.find(g => g.key === group);
                            
                            if (customResourceGroup && customResourceGroup.components[key]) {
                                const componentDef = customResourceGroup.components[key];
                                const resourceType = customResourceGroup.title;
                                const componentName = componentDef.title;
                                
                                // Look up the actual resourceJson from cache
                                if (this.customResourcesMap) {
                                    const cacheKey = `${resourceType}|${componentName}`;
                                    const resourceData = this.customResourcesMap[cacheKey];
                                    
                                    if (resourceData && resourceData.resourceJson) {
                                        try {
                                            // Parse the resourceJson and use it as the schema
                                            info = typeof resourceData.resourceJson === 'string' 
                                                ? JSON.parse(resourceData.resourceJson) 
                                                : resourceData.resourceJson;
                                            console.log('✓ Using resourceJson for component:', componentName);
                                        } catch (e) {
                                            console.error('✗ Error parsing resourceJson:', e);
                                            info = JSON.parse(JSON.stringify(componentDef.schema));
                                        }
                                    } else {
                                        info = JSON.parse(JSON.stringify(componentDef.schema));
                                    }
                                } else {
                                    info = JSON.parse(JSON.stringify(componentDef.schema));
                                }
                                
                                if (info) {
                                    info.key = this.generateKey ? this.generateKey(info) : `${componentName}_${Date.now()}`;
                                }
                                return info;
                            }
                        }
                        
                        // Fall back to original implementation
                        return originalGetComponentInfo.call(this, key, group);
                    };
                    console.log('✓ Patched getComponentInfo for custom resources');
                }
                
                // Trigger redraw
                if (typeof builderInstance.triggerRedraw === 'function') {
                    builderInstance.triggerRedraw();
                    console.log('✓ Builder redrawn with custom resources');
                } else if (typeof builderInstance.redraw === 'function') {
                    builderInstance.redraw();
                    console.log('✓ Builder redrawn (using redraw)');
                }
            }
        })
        .catch(error => {
            console.warn('⚠ Could not load custom resources:', error);
        });


    // Wait for sidebar to be rendered, then add toggle button
    setTimeout(function() {
        const sidebar = document.querySelector('.formcomponents');
        if (sidebar && !document.getElementById('sidebarToggle')) {
            // Create toggle button outside sidebar so it doesn't hide
            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'sidebarToggle';
            toggleBtn.className = 'btn btn-light sidebar-toggle-btn';
            toggleBtn.title = 'Toggle Sidebar';
            toggleBtn.innerHTML = '<i class="bi bi-arrow-bar-right"></i>';
            
            // Add to body instead of sidebar
            document.body.insertBefore(toggleBtn, document.body.firstChild);
            
            // Add click handler - query sidebar fresh each time to avoid stale references
            toggleBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const sidebarElement = document.querySelector('.formcomponents');
                if (sidebarElement) {
                    sidebarElement.classList.toggle('hidden');
                    toggleBtn.innerHTML = sidebarElement.classList.contains('hidden') 
                        ? '<i class="bi bi-arrow-bar-right"></i>' 
                        : '<i class="bi bi-arrow-bar-left"></i>';
                }
            });
        }

        if (window.AppLoader) AppLoader.done('builder');
    }, 200);

})
.catch(function(error) {
    console.error('Error loading builder:', error);
    if (window.AppLoader) AppLoader.done('builder');
    alert('Error loading form builder');
});

//
// Clear Builder Function
//
function ClearBuilder() {
    console.log("Opening new edit workspace");
    
    // Clear session storage
    console.log('🧹 Clearing session storage...');
    sessionStorage.removeItem('editingFormId');
    sessionStorage.removeItem('editingFormData');
    sessionStorage.removeItem('copyingFormData');
    console.log('✓ Session storage cleared');
    
    // Reset builder and history
    formHistory = [];
    historyIndex = -1;
    
    // Reset form details
    if (typeof $ !== 'undefined') {
        console.log('🧹 Clearing form details...');
        currentFormName = 'Untitled Form';
        formTags = [];
        $('#formNameInput').val('');
        $('#formTitleInput').val('');
        $('#formVersionInput').val(0);
        $('#tagContainer').empty();
        $('#tagInput').val('');
        console.log('✓ Form details cleared');
    }
    
    // Reset the form name in navbar
    $('.form-name-input').val('Untitled Form');
    console.log('✓ Navbar form name reset to "Untitled Form"');
    
    // Close menu if open
    const menu = document.getElementById('dropdownMenu');
    const overlay = document.getElementById('menuOverlay');
    if (menu) {
        menu.classList.remove('show');
    }
    if (overlay) {
        overlay.classList.remove('show');
    }
    
    // Reset builder
    Formio.builder(
        document.getElementById('builder'),
        {}
    )
    .then(function(builder){
        builderInstance = builder;
        console.log("New Builder Loaded");
        
        // Save initial state
        console.log('💾 Saving new builder initial state...');
        const newSchema = builderInstance.schema;
        if (newSchema) {
            formHistory.push(JSON.stringify(newSchema));
            historyIndex++;
            console.log('✓ New builder state saved. History length:', formHistory.length, 'Index:', historyIndex);
        }
        
        // Attach change listener
        if (builderInstance) {
            console.log('📡 Attaching change event listener to new builder');
            builderInstance.on('change', function(schema) {
                console.log('📢 Change event fired! Components:', schema?.components?.length || 0);
                saveFormState();
            });
        }
    });
}

//
// New Edit Button - Check if form is empty
//
try {
    const newEditBtn = document.getElementById('newEdit');
    if (newEditBtn) {
        newEditBtn.addEventListener('click', function(){
            // Check if drag-and-drop area is empty
            const dragDropAlert = document.querySelector('.drag-and-drop-alert');
            const hasComponents = dragDropAlert && dragDropAlert.querySelector('.builder-component');
            
            if (!hasComponents) {
                // Show confirmation popup
                showConfirmationPopup(
                    "Form is not saved yet, do you want to open new edit workspace?",
                    function() {
                        ClearBuilder();
                    },
                    function() {
                        console.log("Cancelled new edit workspace");
                    }
                );
            } else {
                console.log("Form has components, proceed normally");
            }
        });
    } else {
        console.log('Warning: newEdit button not found');
    }
} catch (err) {
    console.error('Error setting up newEdit button:', err);
}

//
// Confirmation Popup Function
//
function showConfirmationPopup(message, onConfirm, onCancel) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    // Create popup
    const popup = document.createElement('div');
    popup.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        min-width: 400px;
        text-align: center;
    `;

    // Message
    const messageEl = document.createElement('p');
    messageEl.textContent = message;
    messageEl.style.cssText = `
        font-size: 16px;
        margin-bottom: 30px;
        color: #333;
    `;

    // Button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 10px;
        justify-content: center;
    `;

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.style.cssText = `
        padding: 10px 24px;
        border: 1px solid #6c757d;
        background: #f8f9fa;
        color: #333;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    `;
    cancelBtn.addEventListener('click', function() {
        overlay.remove();
        if (onCancel) onCancel();
    });

    // OK button
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.className = 'btn btn-primary';
    okBtn.style.cssText = `
        padding: 10px 24px;
        border: none;
        background: #007bff;
        color: white;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    `;
    okBtn.addEventListener('click', function() {
        overlay.remove();
        if (onConfirm) onConfirm();
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(okBtn);

    popup.appendChild(messageEl);
    popup.appendChild(buttonContainer);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
}

//
// Load JSON file into edit mode
//
try {
    const jsonFileInput = document.getElementById('jsonFile');
    if (jsonFileInput) {
        jsonFileInput.addEventListener('change', function(e){

    const file = e.target.files[0];

    if(!file){
        return;
    }

    const reader = new FileReader();

    reader.onload = function(event){
        try{
            let formJson = JSON.parse(event.target.result);

            console.log('Raw JSON loaded:', {
                hasForms: !!formJson.forms,
                formsIsArray: Array.isArray(formJson.forms),
                formsType: typeof formJson.forms,
                formsKeys: formJson.forms ? Object.keys(formJson.forms).slice(0, 5) : []
            });

            loadFormJsonIntoBuilder(formJson)
            .then(function(builder){
                builderInstance = builder;
                console.log("JSON Loaded successfully");
                
                // Populate form details from extracted metadata
                populateFormDetails();
                
                // Save loaded form state to history
                console.log('💾 Saving loaded JSON form state...');
                const loadedSchema = builderInstance.schema;
                if (loadedSchema) {
                    formHistory.push(JSON.stringify(loadedSchema));
                    historyIndex++;
                    console.log('✓ JSON form state saved. History length:', formHistory.length, 'Index:', historyIndex);
                }
                
                // Attach change listener
                if (builderInstance) {
                    console.log('📡 Attaching change event listener to loaded builder');
                    builderInstance.on('change', function(schema) {
                        console.log('📢 Change event fired! Components:', schema?.components?.length || 0);
                        saveFormState();
                    });
                }
            });
        }
        catch(ex){
            alert("Invalid JSON file");
            console.error(ex);
        }
    };

    reader.readAsText(file);
        });
    } else {
        console.log('Warning: jsonFile input not found');
    }
} catch (err) {
    console.error('Error setting up jsonFile listener:', err);
}

//
// Download JSON Button
//
try {
    const downloadJsonBtn = document.getElementById('downloadJson');
    if (downloadJsonBtn) {
        downloadJsonBtn.addEventListener('click', function(){

    if (!builderInstance) {
        alert('Builder not loaded yet');
        return;
    }

    // Get the form schema from builder
    const formSchema = builderInstance.schema;
    
    if (!formSchema || Object.keys(formSchema).length === 0) {
        alert('No form created yet. Please add components first.');
        return;
    }

    // Prompt user for filename
    const formName = $('#formTitleInput').val().trim();
    const defaultName = (formName && formName !== 'Untitled Form' ? formName + '.json' : 'form-' + new Date().getTime() + '.json');
    const fileName = prompt('Enter filename for the JSON file:', defaultName);

    if (!fileName) {
        return;
    }

    // Convert to JSON string with formatting
    const jsonString = JSON.stringify(formSchema, null, 2);

    // Create blob from JSON
    const blob = new Blob([jsonString], { type: 'application/json' });

    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;

    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log('Form downloaded as JSON');
        });
    } else {
        console.log('Warning: downloadJson button not found');
    }
} catch (err) {
    console.error('Error setting up downloadJson button:', err);
}

//
// Shared Preview Form Function (Dialog or Page Mode)
//
function PreviewFormWithMode(mode) {
    console.log('PreviewFormWithMode called with mode:', mode);

    // Always clear old preview/submission state before opening a new preview.
    clearPreviewSessionStorage();
    
    if (!builderInstance) {
        alert('Builder not loaded yet');
        return;
    }

    // Get the form schema from builder
    const formSchema = builderInstance.schema;
    
    if (!formSchema || !formSchema.components || formSchema.components.length === 0) {
        alert('No form created yet. Please add components first.');
        return;
    }

    if (mode === 'page') {
        // Store schema in sessionStorage and open new page
        console.log('📄 Opening form preview in new page');
        
        // Get the form ID if the form has been saved.
        // Guard against the literal string "undefined"/"null" left behind by a
        // sessionStorage.setItem() call that was handed an undefined value.
        const rawEditingFormId = sessionStorage.getItem('editingFormId');
        const editingFormId = (rawEditingFormId && rawEditingFormId !== 'undefined' && rawEditingFormId !== 'null')
            ? rawEditingFormId
            : null;
        if (rawEditingFormId && !editingFormId) {
            console.warn('⚠️ Discarding invalid editingFormId in sessionStorage:', rawEditingFormId);
            sessionStorage.removeItem('editingFormId');
        }
        
        // Ensure formSchema includes the _id
        if (editingFormId && !formSchema._id) {
            formSchema._id = editingFormId;
            console.log('✅ Added editingFormId to schema._id:', editingFormId);
        }
        
        sessionStorage.setItem('previewFormSchema', JSON.stringify(formSchema));
        
        if (editingFormId) {
            console.log('✅ Storing formId for preview:', editingFormId);
            sessionStorage.setItem('previewFormId', editingFormId);
        }
        
        window.open('previewPage.html', '_blank');
        return;
    }

    // Dialog mode (default)
    console.log('Opening form preview in modal:', formSchema);

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'previewOverlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        overflow: auto;
    `;

    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        max-width: 1400px;
        width: 95%;
        max-height: 90vh;
        overflow-y: auto;
        position: relative;
    `;

    // Create header with close button
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 20px;
        border-bottom: 1px solid #e9ecef;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: sticky;
        top: 0;
        background: white;
        z-index: 10001;
    `;

    const title = document.createElement('h3');
    title.textContent = 'Form Preview';
    title.style.cssText = 'margin: 0; color: #333;';

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
        background: none;
        border: none;
        font-size: 32px;
        cursor: pointer;
        color: #666;
        padding: 0;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    closeBtn.addEventListener('click', function() {
        overlay.remove();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Create form container
    const formContainer = document.createElement('div');
    formContainer.id = 'previewFormContainer';
    formContainer.style.cssText = 'padding: 20px;';

    // Add Formio_Template.css to head if not already there
    // Path is relative to the HTML file location (app/html/)
    const cssPath = '../css/Formio_Template.css';
    if (!document.querySelector(`link[href="${cssPath}"]`)) {
        const cssLink = document.createElement('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = cssPath;
        document.head.appendChild(cssLink);
        console.log('✓ Added Formio_Template.css to head');
    }

    // Assemble modal
    modal.appendChild(header);
    modal.appendChild(formContainer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Load form using existing Formio object   
    Formio.createForm(formContainer, formSchema)
        .then(function(form) {
            console.log('✓ Form preview loaded successfully in modal');
            console.log('Form instance:', form);
            console.log('FormBuilderApi available?', typeof FormBuilderApi !== 'undefined');

            // Try multiple event names to find the right one
            var eventHandlers = {
                'submitForm': function() {
                    console.log('✓ submitForm event handler attached');
                },
                'submit': function() {
                    console.log('✓ submit event handler attached');
                },
                'formSubmit': function() {
                    console.log('✓ formSubmit event handler attached');
                }
            };

            // Handle form submission - try the primary event
            form.on('submitForm', function(submission) {
                console.log('🔔 SUBMITFORM EVENT FIRED!', submission);
                handleFormSubmission(submission, form, formContainer);
            });

            // Also try alternative events
            form.on('submit', function(submission) {
                console.log('🔔 SUBMIT EVENT FIRED!', submission);
                handleFormSubmission(submission, form, formContainer);
            });

            // Also listen for form errors
            form.on('error', function(error) {
                console.error('Form error:', error);
            });
        })
        .catch(function(error) {
            console.error('Error loading form preview:', error);
            formContainer.innerHTML = '<p style="color: red; padding: 20px;">Error loading form: ' + error.message + '</p>';
        });

    // Close modal when clicking outside
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}

//
// Preview Form Button Handler (Dialog Mode)
//
try {
    const previewFormBtn = document.getElementById('previewForm');
    if (previewFormBtn) {
        previewFormBtn.addEventListener('click', function(){
            PreviewFormWithMode('dialog');
        });
    } else {
        console.log('Warning: previewForm button not found');
    }
} catch (err) {
    console.error('Error setting up previewForm button:', err);
}

//
// Preview Form Page Button Handler (New Page Mode)
//
try {
    const previewFormPageBtn = document.getElementById('previewFormPage');
    if (previewFormPageBtn) {
        previewFormPageBtn.addEventListener('click', function(){
            PreviewFormWithMode('page');
        });
    } else {
        console.log('Warning: previewFormPage button not found');
    }
} catch (err) {
    console.error('Error setting up previewFormPage button:', err);
}

//
// Save Button Handler
//
try {
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function(){
            if (!builderInstance) {
                alert('Builder not loaded yet');
                return;
            }

            const formSchema = builderInstance.schema;
            
            if (!formSchema || !formSchema.components || formSchema.components.length === 0) {
                alert('No form created yet. Please add components first.');
                return;
            }

            // Validate and auto-fix duplicate API keys before saving
            var errorDuplicates = validateAndAutoFixKeys(builderInstance);
            if (errorDuplicates) {
                showDuplicateKeyError(errorDuplicates, builderInstance);
                return;
            }

            // Re-fetch schema in case auto-fix modified keys
            const finalSchema = builderInstance.schema;
            
            console.log("Form saved:", finalSchema);
            
            // Check if we're editing an existing form
            var editingFormDataStr = sessionStorage.getItem('editingFormData');
            var hasSeenUpdateModal = sessionStorage.getItem('hasSeenUpdateModal');
            
            console.log('Save button clicked - editingFormData exists:', !!editingFormDataStr, 'hasSeenUpdateModal:', hasSeenUpdateModal);
            
            if (editingFormDataStr && hasSeenUpdateModal === 'true') {
                // QUICK UPDATE MODE - Skip modal, direct update
                console.log('✓ Quick update - skipping modal, direct update');
                try {
                    var editingFormData = JSON.parse(editingFormDataStr);
                    var updateData = {
                        id: editingFormData.id,
                        name: editingFormData.name,
                        title: $('#formTitleInput').val() || currentFormName,
                        tags: formTags,
                        components: JSON.stringify(finalSchema),
                        // Include tenant ID if this form belongs to a tenant
                        tenantId: editingFormData.tenantId || sessionStorage.getItem('editingFormTenantId')
                    };
                    
                    FormBuilderApi.updateForm(updateData,
                        function(response) {
                            console.log('Form updated successfully:', response);
                            alert('Form updated successfully!');
                        },
                        function(error) {
                            console.error('Error updating form:', error);
                            alert('Error updating form: ' + error);
                        }
                    );
                } catch (e) {
                    console.error('Error parsing editing form data:', e);
                    alert('Error updating form');
                }
            } else if (editingFormDataStr && hasSeenUpdateModal !== 'true') {
                // FIRST UPDATE - Show modal with disabled fields
                console.log('First update - showing modal with disabled fields');
                sessionStorage.setItem('hasSeenUpdateModal', 'true');
                $('#formDetailsModal').modal('show');
            } else {
                // NEW FORM MODE - Show modal for details
                console.log('New form - showing modal for form details');
                $('#formDetailsModal').modal('show');
            }
        });
    } else {
        console.log('Warning: saveBtn button not found');
    }
} catch (err) {
    console.error('Error setting up saveBtn button:', err);
}

try {
    const themeBtn = document.getElementById("themeToggle");
    const themeCss = document.getElementById("themeStylesheet");
    const builderElement = document.getElementById("builder");
    
    // Only set background color if builder element exists (not all pages have it)
    if (builderElement) {
        builderElement.style.backgroundColor = "white";
    }
    
    if (themeBtn && themeCss) {
        let darkMode = false;

        themeBtn.addEventListener("click", function () {

            darkMode = !darkMode;

            if (darkMode) {

                themeCss.href =
                "https://cdn.jsdelivr.net/npm/bootswatch@4.6.2/dist/darkly/bootstrap.min.css";

                document.body.classList.add("dark-mode");
                document.getElementById("builder").style.backgroundColor = "#1e1e1e";
                themeBtn.innerHTML =
                '<i class="bi bi-sun-fill"></i>';
            }
            else {

                themeCss.href =
                "https://cdn.jsdelivr.net/npm/bootswatch@4.6.2/dist/flatly/bootstrap.min.css";

                document.body.classList.remove("dark-mode");

                themeBtn.innerHTML =
                '<i class="bi bi-moon-fill"></i>';
                document.getElementById("builder").style.backgroundColor = "white";
            }

        });
    } else {
        console.log('Warning: themeToggle or themeStylesheet not found');
    }
} catch (err) {
    console.error('Error setting up theme toggle:', err);
}

// Form Details Modal - Wait for jQuery to be available
console.log('=== Checking jQuery availability ===');
console.log('typeof $:', typeof $);
console.log('jQuery available:', typeof $ !== 'undefined');

if (typeof $ !== 'undefined') {
    try {
        console.log('✓ jQuery is available, initializing modal...');

        $('.edit-form-btn').click(function () {
            console.log('✓✓ Edit button clicked!');
            // Populate modal with current form name/title
            $('#formTitleInput').val(currentFormName);
            // Generate camelCase automatically for form name
            let camelCase = currentFormName
                .toLowerCase()
                .replace(/(?:^\w|[A-Z]|\b\w)/g,
                    (word, index) => index === 0
                        ? word.toLowerCase()
                        : word.toUpperCase())
                .replace(/\s+/g, '');
            $('#formNameInput').val(camelCase);
            
            // Repopulate tags from current formTags array
            $('#tagContainer').empty();
            $('#tagInput').val('');
            console.log('🏷️ Rendering', formTags.length, 'tags in modal');
            if (formTags && formTags.length > 0) {
                formTags.forEach(function(tag) {
                    const cleanTag = tag.trim();
                    if (cleanTag) {
                        $('#tagContainer').append(
                            `<span class="tag-chip">
                                ${cleanTag}
                                <i class="bi bi-x tag-remove"></i>
                            </span>`
                        );
                    }
                });
            }
            
            // Populate version if editing
            var editingFormDataStr = sessionStorage.getItem('editingFormData');
            if (editingFormDataStr) {
                try {
                    var editingFormData = JSON.parse(editingFormDataStr);
                    if (editingFormData.versionId !== undefined && editingFormData.versionId !== null) {
                        $('#formVersionInput').val(editingFormData.versionId);
                        console.log('✓ Version populated:', editingFormData.versionId);
                    } else {
                        $('#formVersionInput').val(0);
                    }
                } catch (e) {
                    console.error('Error parsing version from editing data:', e);
                    $('#formVersionInput').val(0);
                }
            } else {
                $('#formVersionInput').val(0);
            }
            
            // Check if in edit mode
            if (editingFormDataStr) {
                // EDIT MODE - Disable form title/name but keep tags editable
                $('#formNameInput').prop('disabled', true);
                $('#formTitleInput').prop('disabled', true);
                $('#tagInput').prop('disabled', false);
                $('#saveFormDetails').text('Update').removeClass('btn-primary').addClass('btn-success');
                console.log('✓ Edit mode: Form title/name disabled, tags editable, button changed to Update');
            } else {
                // NEW FORM MODE - Enable form details fields and set button to Save
                $('#formNameInput').prop('disabled', false);
                $('#formNameInput').prop('disabled', false);
                $('#tagInput').prop('disabled', false);
                $('#saveFormDetails').text('Save').removeClass('btn-success').addClass('btn-primary');
                console.log('✓ Create mode: Form details enabled, button set to Save');
            }
            
            console.log('✓ Modal populated with form data');
            $('#formDetailsModal').modal('show');
            console.log('✓ Modal opened');
        });

        $('#formTitleInput').on('input', function () {

            let value = $(this).val();

            let camelCase = value
                .toLowerCase()
                .replace(/(?:^\w|[A-Z]|\b\w)/g,
                    (word, index) => index === 0
                        ? word.toLowerCase()
                        : word.toUpperCase())
                .replace(/\s+/g, '');

            $('#formNameInput').val(camelCase);
        });

        $('#tagInput').keydown(function (e) {

            if (e.key === ' ') {

                e.preventDefault();

                let tag = $(this)
                    .val()
                    .trim()
                    .toUpperCase();

                if (!tag)
                    return;

                formTags.push(tag);

                $('#tagContainer').append(
                    `<span class="tag-chip">
                        ${tag}
                        <i class="bi bi-x tag-remove"></i>
                    </span>`
                );

                $(this).val('');
            }
        });

        // Version Input Validation (whole numbers only)
        $('#formVersionInput').on('keypress', function (e) {
            // Only allow digits 0-9
            let char = String.fromCharCode(e.which);
            if (!/[0-9]/.test(char)) {
                e.preventDefault();
                return false;
            }
        });

        $('#formVersionInput').on('input', function (e) {
            let value = $(this).val();
            // Remove any non-numeric characters
            let cleanValue = value.replace(/[^0-9]/g, '');

            // Update if value changed
            if (cleanValue !== value) {
                $(this).val(cleanValue);
            }
        });

        $('#formVersionInput').on('paste', function (e) {
            e.preventDefault();
            let pastedText = (e.originalEvent || e).clipboardData.getData('text');
            let cleanValue = pastedText.replace(/[^0-9]/g, '');
            $(this).val(cleanValue);
        });

        $('#formVersionInput').on('blur', function () {
            let value = $(this).val();
            // Ensure value is a whole number or default to 0
            if (!/^\d+$/.test(value)) {
                $(this).val('0');
            }
        });

        $(document).on('click', '.tag-remove', function () {

            $(this).parent().remove();
            // Also remove from formTags array
            const tagText = $(this).parent().text().trim();
            const index = formTags.indexOf(tagText);
            if (index > -1) {
                formTags.splice(index, 1);
            }

        });

        // Save Form Details Button Handler
        $('#saveFormDetails').click(function () {
            const newFormName = $('#formTitleInput').val().trim();
            
            if (!newFormName) {
                alert('Form name cannot be empty');
                return;
            }
            
            if (!builderInstance) {
                alert('Builder not loaded yet');
                return;
            }

            const formSchema = builderInstance.schema;
            
            if (!formSchema || !formSchema.components || formSchema.components.length === 0) {
                alert('No form created yet. Please add components first.');
                return;
            }

            // Validate and auto-fix duplicate API keys before saving
            var errorDuplicates = validateAndAutoFixKeys(builderInstance);
            if (errorDuplicates) {
                showDuplicateKeyError(errorDuplicates, builderInstance);
                $(this).prop('disabled', false).text('Save');
                return;
            }

            // Re-fetch schema in case auto-fix modified keys
            const finalSchema = builderInstance.schema;
            
            const selectedVersion = parseInt($('#formVersionInput').val(), 10) || 0;
            $('#formVersionInput').val(selectedVersion);

            // Update the current form name
            currentFormName = newFormName;
            
            // Update the form name in the navbar
            $('.form-name-input').val(newFormName);
            
            console.log('✓ Form details prepared:', {
                formName: newFormName,
                formTitle: $('#formTitleInput').val(),
                tags: formTags,
                schema: finalSchema
            });
            
            // Disable the save button while saving
            $(this).prop('disabled', true).text('Saving...');
            const self = this;
            
            // Check if we're updating an existing form
            var editingFormDataStr = sessionStorage.getItem('editingFormData');
            
            if (editingFormDataStr) {
                // Update existing form
                try {
                    var editingFormData = JSON.parse(editingFormDataStr);
                    console.log('Updating existing form:', editingFormData.id);
                    
                    var updateData = {
                        id: editingFormData.id,
                        name: editingFormData.name,
                        title: $('#formTitleInput').val() || currentFormName,
                        tags: formTags,
                        components: JSON.stringify(finalSchema),
                        versionId: selectedVersion,
                        // Include tenant ID if this form belongs to a tenant
                        tenantId: editingFormData.tenantId || sessionStorage.getItem('editingFormTenantId')
                    };
                    
                    FormBuilderApi.updateForm(updateData,
                        function(response) {
                            console.log('Form updated successfully:', response);
                        
                            $('#formDetailsModal').modal('hide');
                            alert('Form updated successfully!');
                            $(self).prop('disabled', false).text('Update');
                        },
                        function(error) {
                            console.error('Error updating form:', error);
                            alert('Error updating form: ' + error);
                            $(self).prop('disabled', false).text('Update');
                        }
                    );
                } catch (e) {
                    console.error('Error parsing editing form data:', e);
                    alert('Error updating form');
                    $(self).prop('disabled', false).text('Update');
                }
            } else {
                // Save new form
                var saveData = {
                    name: newFormName.replace(/\s+/g, '-').toLowerCase(),
                    title: newFormName,
                    tags: formTags,
                    components: JSON.stringify(finalSchema),
                    versionId: selectedVersion,
                    // Include tenant ID if this form is being created for a tenant
                    tenantId: sessionStorage.getItem('editingFormTenantId') || null
                };
                
                FormBuilderApi.saveForm(saveData,
                    function(response) {
                        console.log('Form saved successfully:', response);
                        
                        // Store the new form as editing data for next updates
                        let formId = response.formId || response.id || response.Id;
                        
                        if (!formId || formId === '00000000-0000-0000-0000-000000000000') {
                            // Generate a GUID on the frontend as fallback
                            formId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                                var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                                return v.toString(16);
                            });
                        }
                        
                        const editingData = {
                            id: formId,
                            name: saveData.name,
                            title: saveData.title,
                            tags: saveData.tags,
                            components: saveData.components,
                            versionId: selectedVersion
                        };
                        
                        sessionStorage.setItem('editingFormData', JSON.stringify(editingData));
                        // Also store the editing form ID for preview and submission
                        sessionStorage.setItem('editingFormId', formId);
                        sessionStorage.setItem('hasSeenUpdateModal', 'true'); // Already seen modal on first save
                        
                        // Close modal
                        $('#formDetailsModal').modal('hide');
                        alert('Form saved successfully!');
                        // Clear form name input and reset
                        $('#formTitleInput').val('');
                        formTags = [];
                        $('#tagContainer').empty();
                        // Re-enable the button
                        $(self).prop('disabled', false).text('Save');
                    },
                    function(error) {
                        console.error('Error saving form:', error);
                        alert('Error saving form: ' + error);
                        // Re-enable the button
                        $(self).prop('disabled', false).text('Save');
                    }
                );
            }
        });

        console.log('✓ jQuery modal and form details initialized');
    } catch (err) {
        console.error('Error initializing jQuery components:', err);
    }
} else {
    console.log('Warning: jQuery not available for modal initialization');
}

 // Page-specific initialization

document.addEventListener('DOMContentLoaded', function () {
    // Existing Forms Page
    if (document.getElementById('formsTable')) {
        var params = new URLSearchParams(window.location.search);
        var tenantName = params.get('tenantName');

        if (tenantName) {
            var heading = document.getElementById('pageHeading');
            if (heading) {
                heading.innerHTML = ' Forms <span style="color: #6c757d;font-size:22px">' + decodeURIComponent(tenantName) + '</span>';
            }
        }
        FormBuilderApi.loadFormsTable();
    }

    if (document.getElementById('tenantsTable')) {
        TenantHandler.loadTenantsTable();
    }
    
    // Load reports table for reports.html page
    if (document.getElementById('reportsTable')) {
        FormBuilderApi.loadReportsTable();
    }
});

