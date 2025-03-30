figma.showUI(__html__, { width: 360, height: 560, themeColors: true });

// Get user preferences or set defaults
async function getUserPreferences() {
  let preferences = await figma.clientStorage.getAsync("asterisk-preferences");
  if (!preferences) {
    preferences = {
      theme: "light", // 'light' or 'dark'
      autosave: true, // Whether to autosave drafts
    };
    await figma.clientStorage.setAsync("asterisk-preferences", preferences);
  }
  return preferences;
}

// Called when UI is first loaded
async function initializePlugin() {
  const preferences = await getUserPreferences();
  figma.ui.postMessage({
    type: "init-preferences",
    preferences,
  });
}

initializePlugin();

// Called when a message is received from the UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === "save-metadata") {
    if (figma.currentPage.selection.length === 0) {
      figma.notify("Please select an element first");
      return;
    }

    const node = figma.currentPage.selection[0];

    // Save the metadata to the node
    await figma.clientStorage.setAsync(`asterisk-${node.id}`, {
      sourceUrl: msg.sourceUrl,
      tags: msg.tags,
      notes: msg.notes,
      lastModified: Date.now(),
    });

    // Delete draft after successful save
    await figma.clientStorage.deleteAsync(`draft-${node.id}`);

    figma.notify("Note saved successfully!");
  }

  if (msg.type === "edit-element") {
    const node = findNodeById(msg.nodeId);
    if (node) {
      // Load the metadata
      const metadata = await figma.clientStorage.getAsync(
        `asterisk-${node.id}`
      );

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
  }

  if (msg.type === "save-draft") {
    if (figma.currentPage.selection.length === 0) {
      return;
    }

    const node = figma.currentPage.selection[0];

    // Save draft metadata
    await figma.clientStorage.setAsync(`draft-${node.id}`, {
      sourceUrl: msg.sourceUrl,
      tags: msg.tags,
      notes: msg.notes,
      lastModified: Date.now(),
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
    const draft = await figma.clientStorage.getAsync(`draft-${node.id}`);
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
    const metadata = await figma.clientStorage.getAsync(`asterisk-${node.id}`);

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
    // Get all unique tags across all elements for autocomplete
    const allKeys = await figma.clientStorage.keysAsync();
    const metadataKeys = allKeys.filter((key) => key.startsWith("asterisk-"));

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
    const tagsWithCount = Array.from(tagsMap.entries())
      .map(([tag, count]) => ({
        tag,
        count,
      }))
      .sort((a, b) => b.count - a.count); // Sort by count in descending order

    figma.ui.postMessage({
      type: "all-tags",
      tags: tagsWithCount,
    });
  }

  if (msg.type === "get-all-elements") {
    // Get all elements with metadata
    const allKeys = await figma.clientStorage.keysAsync();
    const metadataKeys = allKeys.filter((key) => key.startsWith("asterisk-"));

    // Build the elements array with metadata
    const elements = [];

    for (const key of metadataKeys) {
      const nodeId = key.replace("asterisk-", "");
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
      Math.max(280, Math.min(800, msg.width)),
      Math.max(300, Math.min(800, msg.height))
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
};

// Find a node by ID in the document
function findNodeById(id) {
  return figma.currentPage.findOne((node) => node.id === id);
}

// Listen for selection changes
figma.on("selectionchange", () => {
  figma.ui.postMessage({ type: "selection-changed" });
});
