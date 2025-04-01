figma.showUI(__html__, { width: 360, height: 580, themeColors: true });

// Get user preferences or set defaults
async function getUserPreferences() {
  let preferences = await figma.clientStorage.getAsync("asterisk-preferences");
  if (!preferences) {
    preferences = {
      theme: "light", // 'light' or 'dark'
      autosave: true, // Whether to autosave notes
      defaultSearchAction: "navigate", // 'navigate' or 'open'
      fieldOrder: ["sourceUrl", "tags", "notes"], // Order of fields in add/edit
      searchFields: {
        showName: true, // Always true, can't be disabled
        showNotes: true,
        showTags: true,
        showUrl: false,
      },
    };
    await figma.clientStorage.setAsync("asterisk-preferences", preferences);
  }

  // Add new properties if they don't exist (for users with existing preferences)
  if (preferences.defaultSearchAction === undefined) {
    preferences.defaultSearchAction = "navigate";
  }

  if (preferences.fieldOrder === undefined) {
    preferences.fieldOrder = ["sourceUrl", "tags", "notes"];
  }

  if (preferences.searchFields === undefined) {
    preferences.searchFields = {
      showName: true,
      showNotes: true,
      showTags: true,
      showUrl: false,
    };
  }

  return preferences;
}

// Helper function to create a context-aware storage key
function getStorageKey(type, nodeId) {
  const fileKey = figma.fileKey || 'local';
  const pageId = figma.currentPage.id;
  return `${type}-${fileKey}-${pageId}-${nodeId}`;
}

// Called when UI is first loaded
async function initializePlugin() {
  const preferences = await getUserPreferences();
  figma.ui.postMessage({
    type: "init-preferences",
    preferences,
  });

  // Send initial file and page context
  figma.ui.postMessage({
    type: "context-info",
    fileKey: figma.fileKey || 'local',
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name
  });
}

initializePlugin();

// Called when a message is received from the UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === "save-metadata") {
    if (figma.currentPage.selection.length === 0) {
      figma.ui.postMessage({
        type: "save-failed",
        message: "Please select an element first to save Asterisk"
      });
      return;
    }

    const node = figma.currentPage.selection[0];
    const storageKey = getStorageKey("asterisk", node.id);

    try {
      // Save the metadata to the node
      await figma.clientStorage.setAsync(storageKey, {
        sourceUrl: msg.sourceUrl,
        tags: msg.tags,
        notes: msg.notes,
        lastModified: Date.now(),
        fileKey: figma.fileKey || 'local',
        pageId: figma.currentPage.id,
        pageName: figma.currentPage.name
      });

      // Delete draft after successful save
      await figma.clientStorage.deleteAsync(getStorageKey("draft", node.id));

      figma.ui.postMessage({
        type: "save-success",
        message: "Note saved successfully!"
      });
      
      figma.notify("Note saved successfully!");
    } catch (error) {
      figma.ui.postMessage({
        type: "save-failed",
        message: "Failed to save note. Please try again."
      });
    }
  }

  if (msg.type === "edit-element") {
    const node = findNodeById(msg.nodeId);
    if (node) {
      // If selectNode flag is true, select the node
      if (msg.selectNode) {
        figma.currentPage.selection = [node];
      }
      
      // Load the metadata
      const storageKey = getStorageKey("asterisk", node.id);
      const metadata = await figma.clientStorage.getAsync(storageKey);

      if (metadata) {
        figma.ui.postMessage({
          type: "metadata-loaded",
          data: metadata,
          nodeName: node.name || "Unnamed Layer",
          nodeId: node.id,
        });
      } else {
        figma.ui.postMessage({
          type: "new-element",
          message: "Add metadata to this element",
          nodeName: node.name || "Unnamed Layer",
          nodeId: node.id,
        });
      }
    } else {
      figma.ui.postMessage({
        type: "element-not-found",
        message: "The selected element could not be found"
      });
    }
  }

  if (msg.type === "save-draft") {
    if (figma.currentPage.selection.length === 0) {
      return;
    }

    const node = figma.currentPage.selection[0];
    const storageKey = getStorageKey("draft", node.id);

    // Save draft metadata
    await figma.clientStorage.setAsync(storageKey, {
      sourceUrl: msg.sourceUrl,
      tags: msg.tags,
      notes: msg.notes,
      lastModified: Date.now(),
      fileKey: figma.fileKey || 'local',
      pageId: figma.currentPage.id
    });
  }

  if (msg.type === "get-metadata") {
    if (figma.currentPage.selection.length === 0) {
      figma.ui.postMessage({
        type: "no-selection",
        message: "Select an element to view or edit its metadata",
      });
      return;
    }

    const node = figma.currentPage.selection[0];

    // Check for draft first
    const draftKey = getStorageKey("draft", node.id);
    const draft = await figma.clientStorage.getAsync(draftKey);
    
    if (draft) {
      figma.ui.postMessage({
        type: "draft-loaded",
        data: draft,
        nodeName: node.name || "Unnamed Layer",
        nodeId: node.id,
        message: "Continuing from your unsaved draft",
      });
      return;
    }

    // Then check for saved metadata
    const storageKey = getStorageKey("asterisk", node.id);
    const metadata = await figma.clientStorage.getAsync(storageKey);

    if (metadata) {
      figma.ui.postMessage({
        type: "metadata-loaded",
        data: metadata,
        nodeName: node.name || "Unnamed Layer",
        nodeId: node.id,
      });
    } else {
      figma.ui.postMessage({
        type: "new-element",
        message: "Add metadata to this element",
        nodeName: node.name || "Unnamed Layer",
        nodeId: node.id,
      });
    }
  }

  if (msg.type === "get-all-tags") {
    // Get all unique tags across all elements for current file and page
    const allKeys = await figma.clientStorage.keysAsync();
    const fileKey = figma.fileKey || 'local';
    const pageId = figma.currentPage.id;
    
    // Filter keys to only include asterisks from the current file and page
    const metadataKeys = allKeys.filter(key => 
      key.startsWith(`asterisk-${fileKey}-${pageId}-`)
    );

    const tagsMap = new Map(); // Map to store tag counts

    for (const key of metadataKeys) {
      const metadata = await figma.clientStorage.getAsync(key);
      if (metadata && metadata.tags) {
        metadata.tags.forEach((tag) => {
          tagsMap.set(tag, (tagsMap.get(tag) || 0) + 1);
        });
      }
    }

    // Convert map to array of objects with tag and count
    // Then sort first by count (descending), then alphabetically
    const tagsWithCount = Array.from(tagsMap.entries())
      .map(([tag, count]) => ({
        tag,
        count,
      }))
      .sort((a, b) => {
        // First sort by count
        const countDiff = b.count - a.count;
        if (countDiff !== 0) return countDiff;

        // Then sort alphabetically
        return a.tag.localeCompare(b.tag);
      });

    figma.ui.postMessage({
      type: "all-tags",
      tags: tagsWithCount,
    });
  }

  if (msg.type === "get-all-elements") {
    // Get all elements with metadata in the current file and page
    const allKeys = await figma.clientStorage.keysAsync();
    const fileKey = figma.fileKey || 'local';
    const pageId = figma.currentPage.id;
    
    // Filter keys to only include asterisks from the current file and page
    const metadataKeys = allKeys.filter(key => 
      key.startsWith(`asterisk-${fileKey}-${pageId}-`)
    );

    // Build the elements array with metadata
    const elements = [];

    for (const key of metadataKeys) {
      const nodeId = key.split('-').pop(); // Get the node ID from the key
      const metadata = await figma.clientStorage.getAsync(key);

      // Try to find the node in the document
      const node = findNodeById(nodeId);

      if (node && metadata) {
        elements.push({
          nodeId: nodeId,
          nodeName: node.name || "Unnamed Layer",
          sourceUrl: metadata.sourceUrl || "",
          tags: metadata.tags || [],
          notes: metadata.notes || "",
          lastModified: metadata.lastModified || null,
        });
      }
    }

    figma.ui.postMessage({
      type: "all-elements",
      elements: elements,
    });
  }

  if (msg.type === "update-preferences") {
    await figma.clientStorage.setAsync("asterisk-preferences", msg.preferences);
  }

  // Handle resize requests from the UI
  if (msg.type === "resize") {
    figma.ui.resize(
      Math.max(350, Math.min(800, msg.width)),
      Math.max(500, Math.min(800, msg.height))
    );
  }

  // Handle navigation to node
  if (msg.type === "navigate-to-node") {
    const node = findNodeById(msg.nodeId);
    if (node) {
      // Select the node
      figma.currentPage.selection = [node];

      // Scroll and zoom into view
      figma.viewport.scrollAndZoomIntoView([node]);

      // Notify the user
      figma.notify(`Navigated to "${node.name}"`);
    } else {
      figma.notify("Element not found in the current document", {
        error: true,
      });
    }
  }

  // Delete an asterisk
  if (msg.type === "delete-asterisk") {
    const nodeId = msg.nodeId;

    // Delete the metadata from client storage
    await figma.clientStorage.deleteAsync(getStorageKey("asterisk", nodeId));

    // Also delete any drafts
    await figma.clientStorage.deleteAsync(getStorageKey("draft", nodeId));

    figma.notify("Note deleted");

    // Refresh the UI
    figma.ui.postMessage({ type: "selection-changed" });
  }
};

// Find a node by ID in the document
function findNodeById(id) {
  return figma.currentPage.findOne((node) => node.id === id);
}

// Listen for selection changes
figma.on("selectionchange", () => {
  figma.ui.postMessage({ type: "selection-changed" });
});

// Listen for page changes to update context
figma.on("currentpagechange", () => {
  figma.ui.postMessage({
    type: "context-changed", 
    fileKey: figma.fileKey || 'local',
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name
  });
});