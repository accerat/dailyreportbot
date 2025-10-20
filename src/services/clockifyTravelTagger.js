// src/services/clockifyTravelTagger.js
// Automatically tags travel time entries with the next/previous project name

const CLOCKIFY_API_KEY = process.env.CLOCKIFY_API_KEY;
const CLOCKIFY_WORKSPACE_ID = process.env.CLOCKIFY_WORKSPACE_ID;
const CLOCKIFY_API_BASE = 'https://api.clockify.me/api/v1';

// Travel client name (case-insensitive matching)
const TRAVEL_CLIENT_NAME = 'travel';

/**
 * Make a request to the Clockify API
 */
async function clockifyRequest(endpoint, options = {}) {
  if (!CLOCKIFY_API_KEY) {
    throw new Error('CLOCKIFY_API_KEY not configured');
  }
  if (!CLOCKIFY_WORKSPACE_ID) {
    throw new Error('CLOCKIFY_WORKSPACE_ID not configured');
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
 * Get all active users in the workspace
 */
async function getWorkspaceUsers() {
  const allUsers = await clockifyRequest(`/workspaces/${CLOCKIFY_WORKSPACE_ID}/users`);
  // Filter for only active users (not deactivated)
  return allUsers.filter(user => user.status === 'ACTIVE');
}

/**
 * Get time entries for a user within a date range
 */
async function getUserTimeEntries(userId, startDate, endDate) {
  const params = new URLSearchParams({
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  return clockifyRequest(
    `/workspaces/${CLOCKIFY_WORKSPACE_ID}/user/${userId}/time-entries?${params}`
  );
}

/**
 * Get all tags in the workspace
 */
async function getWorkspaceTags() {
  return clockifyRequest(`/workspaces/${CLOCKIFY_WORKSPACE_ID}/tags`);
}

/**
 * Create a new tag in the workspace
 */
async function createTag(tagName) {
  return clockifyRequest(`/workspaces/${CLOCKIFY_WORKSPACE_ID}/tags`, {
    method: 'POST',
    body: JSON.stringify({ name: tagName }),
  });
}

/**
 * Update a time entry with tags
 */
async function updateTimeEntryTags(userId, timeEntryId, tagIds, existingEntry) {
  // Clockify requires PATCH with all required fields preserved
  return clockifyRequest(
    `/workspaces/${CLOCKIFY_WORKSPACE_ID}/user/${userId}/time-entries/${timeEntryId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        start: existingEntry.timeInterval.start,
        end: existingEntry.timeInterval.end,
        billable: existingEntry.billable || false,
        description: existingEntry.description || '',
        projectId: existingEntry.projectId,
        taskId: existingEntry.taskId || null,
        tagIds: tagIds,
      }),
    }
  );
}

/**
 * Get all projects in the workspace (including archived)
 */
async function getProjects() {
  // Get both active and archived projects
  const activeProjects = await clockifyRequest(`/workspaces/${CLOCKIFY_WORKSPACE_ID}/projects?archived=false`);
  const archivedProjects = await clockifyRequest(`/workspaces/${CLOCKIFY_WORKSPACE_ID}/projects?archived=true`);
  return [...activeProjects, ...archivedProjects];
}

/**
 * Check if a project is a travel project by client name
 */
function isTravelProject(projectInfo) {
  if (!projectInfo || !projectInfo.clientName) return false;
  const normalized = projectInfo.clientName.toLowerCase().trim();
  return normalized === TRAVEL_CLIENT_NAME.toLowerCase();
}

/**
 * Find the next or previous project for a travel entry
 * @param {Array} allEntries - All time entries for the user, sorted by start time
 * @param {number} travelEntryIndex - Index of the travel entry
 * @param {object} projectsMap - Map of project IDs to project info
 * @returns {string|null} - Project name to tag with, or null
 */
function findProjectToTag(allEntries, travelEntryIndex, projectsMap) {
  const travelEntry = allEntries[travelEntryIndex];
  const travelEndTime = new Date(travelEntry.timeInterval.end || travelEntry.timeInterval.start);
  const twoDaysLater = new Date(travelEndTime.getTime() + 2 * 24 * 60 * 60 * 1000);

  // Look forward for next non-travel project within 2 days
  for (let i = travelEntryIndex + 1; i < allEntries.length; i++) {
    const entry = allEntries[i];
    const entryStartTime = new Date(entry.timeInterval.start);

    // Stop if we're past 2 days
    if (entryStartTime > twoDaysLater) break;

    const projectInfo = projectsMap[entry.projectId];
    if (projectInfo && !isTravelProject(projectInfo)) {
      return projectInfo.name;
    }
  }

  // No next project found, look backward for previous non-travel project
  for (let i = travelEntryIndex - 1; i >= 0; i--) {
    const entry = allEntries[i];
    const projectInfo = projectsMap[entry.projectId];

    if (projectInfo && !isTravelProject(projectInfo)) {
      return projectInfo.name;
    }
  }

  return null;
}

/**
 * Process travel tagging for a date range
 * @param {Date} startDate - Start of date range
 * @param {Date} endDate - End of date range
 * @returns {Promise<object>} - Summary of processed entries
 */
export async function processTravelTagging(startDate, endDate) {
  console.log(`[travel-tagger] Processing travel entries from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  try {
    // Get all projects to build project ID -> project info map
    const projects = await getProjects();
    const projectsMap = {};
    const travelProjects = [];
    projects.forEach(p => {
      projectsMap[p.id] = {
        name: p.name,
        clientName: p.clientName || null
      };
      // Track projects with "travel" in name for debugging
      if (p.name.toLowerCase().includes('travel')) {
        travelProjects.push({ name: p.name, client: p.clientName });
      }
    });

    console.log(`[travel-tagger] Found ${travelProjects.length} projects with 'travel' in name:`,
      travelProjects.map(p => `"${p.name}" (client: ${p.client || 'NONE'})`).join(', '));

    // Check if there's a project called exactly "Travel"
    const travelExact = projects.find(p => p.name.toLowerCase() === 'travel');
    if (travelExact) {
      console.log(`[travel-tagger] Found exact "Travel" project: client="${travelExact.clientName || 'NONE'}", id=${travelExact.id}`);
    }

    // Get all existing tags
    const existingTags = await getWorkspaceTags();
    const tagsByName = {};
    existingTags.forEach(tag => {
      tagsByName[tag.name.toLowerCase()] = tag.id;
    });

    // Get all active users
    const users = await getWorkspaceUsers();
    console.log(`[travel-tagger] Found ${users.length} active users`);

    const summary = {
      usersProcessed: 0,
      travelEntriesFound: 0,
      travelEntriesTagged: 0,
      tagsCreated: 0,
      errors: [],
    };

    // Process each user
    for (const user of users) {
      try {
        console.log(`[travel-tagger] Processing user: ${user.name} (${user.id})`);

        // Get all time entries for this user in an EXPANDED date range
        // We need to look beyond the target range to find previous/next projects
        const expandedStartDate = new Date(startDate);
        expandedStartDate.setDate(expandedStartDate.getDate() - 30); // 30 days before
        const expandedEndDate = new Date(endDate);
        expandedEndDate.setDate(expandedEndDate.getDate() + 30); // 30 days after

        const timeEntries = await getUserTimeEntries(user.id, expandedStartDate, expandedEndDate);

        // Sort by start time
        timeEntries.sort((a, b) =>
          new Date(a.timeInterval.start) - new Date(b.timeInterval.start)
        );

        console.log(`[travel-tagger] Found ${timeEntries.length} time entries for ${user.name}`);

        // Find all travel entries (but only tag entries within the original date range)
        for (let i = 0; i < timeEntries.length; i++) {
          const entry = timeEntries[i];
          const entryStartTime = new Date(entry.timeInterval.start);
          const projectInfo = projectsMap[entry.projectId];

          // Debug: log ALL entries with travel client
          if (projectInfo && projectInfo.clientName && projectInfo.clientName.toLowerCase() === 'travel') {
            const inRange = entryStartTime >= startDate && entryStartTime <= endDate;
            console.log(`[travel-tagger] DEBUG: ${user.name} - ${projectInfo.name}, start=${entryStartTime.toISOString()}, inRange=${inRange}`);
          }

          // Only process travel entries that fall within the original target date range
          if (isTravelProject(projectInfo) && entryStartTime >= startDate && entryStartTime <= endDate) {
            summary.travelEntriesFound++;
            console.log(`[travel-tagger] Found travel entry for ${user.name}: ${projectInfo.name} (Client: ${projectInfo.clientName}, ID: ${entry.id})`);

            // Find which project to tag with
            const tagProjectName = findProjectToTag(timeEntries, i, projectsMap);

            console.log(`[travel-tagger] DEBUG: User ${user.name} has ${timeEntries.length} total entries, travel entry at index ${i}`);

            if (tagProjectName) {
              console.log(`[travel-tagger] Tagging travel entry with: ${tagProjectName}`);

              // Get or create tag
              let tagId = tagsByName[tagProjectName.toLowerCase()];

              if (!tagId) {
                console.log(`[travel-tagger] Creating new tag: ${tagProjectName}`);
                const newTag = await createTag(tagProjectName);
                tagId = newTag.id;
                tagsByName[tagProjectName.toLowerCase()] = tagId;
                summary.tagsCreated++;
              }

              // Update time entry with tag (preserve existing tags)
              const existingTagIds = entry.tagIds || [];
              if (!existingTagIds.includes(tagId)) {
                await updateTimeEntryTags(user.id, entry.id, [...existingTagIds, tagId], entry);
                summary.travelEntriesTagged++;
                console.log(`[travel-tagger] Successfully tagged travel entry for ${user.name}`);
              } else {
                console.log(`[travel-tagger] Travel entry already has tag ${tagProjectName}`);
              }
            } else {
              console.log(`[travel-tagger] No project found to tag for travel entry (${user.name})`);
            }
          }
        }

        summary.usersProcessed++;
      } catch (error) {
        console.error(`[travel-tagger] Error processing user ${user.name}:`, error);
        summary.errors.push(`${user.name}: ${error.message}`);
      }
    }

    console.log(`[travel-tagger] Complete. Tagged ${summary.travelEntriesTagged}/${summary.travelEntriesFound} travel entries`);
    return summary;
  } catch (error) {
    console.error('[travel-tagger] Fatal error:', error);
    throw error;
  }
}

/**
 * Process the previous week (Saturday to Friday)
 */
export async function processLastWeek() {
  const now = new Date();

  // Calculate the PREVIOUS COMPLETE Saturday-Friday week
  // "Last week" means the most recent completed week, not the current week
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  let daysToLastFriday;

  if (dayOfWeek === 6) {
    // Today is Saturday - last Friday was yesterday
    daysToLastFriday = 1;
  } else if (dayOfWeek === 0) {
    // Today is Sunday - last Friday was 2 days ago
    daysToLastFriday = 2;
  } else {
    // Monday (1) through Friday (5)
    // Last Friday was (dayOfWeek + 2) days ago
    daysToLastFriday = dayOfWeek + 2;
  }

  const lastFriday = new Date(now);
  lastFriday.setDate(now.getDate() - daysToLastFriday);
  lastFriday.setHours(23, 59, 59, 999);

  // Last Saturday is 6 days before last Friday
  const lastSaturday = new Date(lastFriday);
  lastSaturday.setDate(lastFriday.getDate() - 6);
  lastSaturday.setHours(0, 0, 0, 0);

  console.log(`[travel-tagger] Today is ${now.toDateString()} (day ${dayOfWeek})`);
  console.log(`[travel-tagger] Processing last week: ${lastSaturday.toISOString()} to ${lastFriday.toISOString()}`);

  return processTravelTagging(lastSaturday, lastFriday);
}
