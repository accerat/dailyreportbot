// src/services/clockify.js
// Clockify API integration for project management

const CLOCKIFY_API_KEY = process.env.CLOCKIFY_API_KEY;
const CLOCKIFY_WORKSPACE_ID = process.env.CLOCKIFY_WORKSPACE_ID;
const CLOCKIFY_API_BASE = 'https://api.clockify.me/api/v1';

/**
 * Make a request to the Clockify API
 * @param {string} endpoint - API endpoint (e.g., '/projects')
 * @param {object} options - fetch options
 * @returns {Promise<object>} API response
 */
async function clockifyRequest(endpoint, options = {}) {
  if (!CLOCKIFY_API_KEY) {
    throw new Error('CLOCKIFY_API_KEY not configured in environment');
  }
  if (!CLOCKIFY_WORKSPACE_ID) {
    throw new Error('CLOCKIFY_WORKSPACE_ID not configured in environment');
  }

  const url = `${CLOCKIFY_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'X-Api-Key': CLOCKIFY_API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Clockify API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Create a new project in Clockify
 * @param {object} params - Project parameters
 * @param {string} params.name - Project name
 * @param {string} [params.color] - Project color (hex format, e.g., '#FF5733')
 * @param {string} [params.note] - Project note/description
 * @param {boolean} [params.isPublic] - Whether the project is public (default: true)
 * @returns {Promise<object>} Created project data
 */
export async function createClockifyProject({ name, color, note, isPublic = true }) {
  try {
    console.log(`[clockify] Creating project: ${name}`);

    const projectData = {
      name,
      clientId: null,
      isPublic,
      color: color || '#2196F3', // Default blue color
      note: note || '',
      billable: false,
      public: isPublic,
    };

    const project = await clockifyRequest(`/workspaces/${CLOCKIFY_WORKSPACE_ID}/projects`, {
      method: 'POST',
      body: JSON.stringify(projectData),
    });

    console.log(`[clockify] Project created successfully: ${project.id}`);
    return project;
  } catch (error) {
    console.error('[clockify] Error creating project:', error);
    throw error;
  }
}

/**
 * Archive a project in Clockify
 * @param {string} projectId - Clockify project ID
 * @returns {Promise<object>} Updated project data
 */
export async function archiveClockifyProject(projectId) {
  try {
    console.log(`[clockify] Archiving project: ${projectId}`);

    const project = await clockifyRequest(
      `/workspaces/${CLOCKIFY_WORKSPACE_ID}/projects/${projectId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ archived: true }),
      }
    );

    console.log(`[clockify] Project archived successfully: ${projectId}`);
    return project;
  } catch (error) {
    console.error('[clockify] Error archiving project:', error);
    throw error;
  }
}

/**
 * Unarchive a project in Clockify
 * @param {string} projectId - Clockify project ID
 * @returns {Promise<object>} Updated project data
 */
export async function unarchiveClockifyProject(projectId) {
  try {
    console.log(`[clockify] Unarchiving project: ${projectId}`);

    const project = await clockifyRequest(
      `/workspaces/${CLOCKIFY_WORKSPACE_ID}/projects/${projectId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ archived: false }),
      }
    );

    console.log(`[clockify] Project unarchived successfully: ${projectId}`);
    return project;
  } catch (error) {
    console.error('[clockify] Error unarchiving project:', error);
    throw error;
  }
}

/**
 * Update a project in Clockify
 * @param {string} projectId - Clockify project ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated project data
 */
export async function updateClockifyProject(projectId, updates) {
  try {
    console.log(`[clockify] Updating project: ${projectId}`);

    const project = await clockifyRequest(
      `/workspaces/${CLOCKIFY_WORKSPACE_ID}/projects/${projectId}`,
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      }
    );

    console.log(`[clockify] Project updated successfully: ${projectId}`);
    return project;
  } catch (error) {
    console.error('[clockify] Error updating project:', error);
    throw error;
  }
}

/**
 * Get a project from Clockify
 * @param {string} projectId - Clockify project ID
 * @returns {Promise<object>} Project data
 */
export async function getClockifyProject(projectId) {
  try {
    const project = await clockifyRequest(
      `/workspaces/${CLOCKIFY_WORKSPACE_ID}/projects/${projectId}`
    );
    return project;
  } catch (error) {
    console.error('[clockify] Error getting project:', error);
    throw error;
  }
}

/**
 * List all projects in Clockify
 * @param {object} options - Query options
 * @param {boolean} [options.archived] - Filter by archived status
 * @returns {Promise<Array>} List of projects
 */
export async function listClockifyProjects({ archived = false } = {}) {
  try {
    const params = new URLSearchParams({ archived: archived.toString() });
    const projects = await clockifyRequest(
      `/workspaces/${CLOCKIFY_WORKSPACE_ID}/projects?${params}`
    );
    return projects;
  } catch (error) {
    console.error('[clockify] Error listing projects:', error);
    throw error;
  }
}

/**
 * Check if a project name already exists in Clockify
 * @param {string} projectName - Project name to check
 * @returns {Promise<object|null>} Existing project or null
 */
export async function findProjectByName(projectName) {
  try {
    const projects = await listClockifyProjects({ archived: false });
    return projects.find(p => p.name === projectName) || null;
  } catch (error) {
    console.error('[clockify] Error finding project by name:', error);
    throw error;
  }
}

/**
 * Sync a Discord project to Clockify
 * - Creates project if it doesn't exist
 * - Returns the Clockify project ID and duplicate warning
 * @param {object} discordProject - Discord project object from store
 * @returns {Promise<{projectId: string, isDuplicate: boolean}>} Clockify project ID and duplicate flag
 */
export async function syncProjectToClockify(discordProject) {
  try {
    // If already has a Clockify project ID, return it
    if (discordProject.clockify_project_id) {
      console.log(`[clockify] Project already synced: ${discordProject.clockify_project_id}`);
      return { projectId: discordProject.clockify_project_id, isDuplicate: false };
    }

    // Check for duplicate name
    const existingProject = await findProjectByName(discordProject.name);
    const isDuplicate = existingProject !== null;

    if (isDuplicate) {
      console.warn(`[clockify] Warning: Project with name "${discordProject.name}" already exists in Clockify (${existingProject.id})`);
    }

    // Create new project in Clockify
    const clockifyProject = await createClockifyProject({
      name: discordProject.name,
      note: `Discord Thread: ${discordProject.thread_channel_id}\nForeman: ${discordProject.foreman_display || 'N/A'}`,
      color: '#2196F3',
    });

    return { projectId: clockifyProject.id, isDuplicate };
  } catch (error) {
    console.error('[clockify] Error syncing project:', error);
    throw error;
  }
}

/**
 * Check if Clockify is properly configured
 * @returns {boolean} True if configured
 */
export function isClockifyConfigured() {
  return !!(CLOCKIFY_API_KEY && CLOCKIFY_WORKSPACE_ID);
}
