// src/utils/driveStorage.js
// Google Drive as PRIMARY database (not backup)
// ARCHITECTURAL PRINCIPLE: Drive is the source of truth, NOT local files

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

// File IDs - these ARE the database
const FILE_IDS = {
  store: process.env.STORE_JSON_DRIVE_ID || null,
  templates: process.env.TEMPLATES_JSON_DRIVE_ID || null
};

/**
 * Get authenticated Google Drive client
 */
async function getDriveClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('[drive-storage] OAuth2 credentials not configured in .env');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Download JSON data from Google Drive
 * @param {string} fileKey - 'store' or 'templates'
 * @param {object} defaultData - Default data if file doesn't exist
 * @returns {Promise<object>} Parsed JSON data
 */
export async function loadFromDrive(fileKey, defaultData = {}) {
  try {
    const drive = await getDriveClient();
    const fileId = FILE_IDS[fileKey];

    if (!fileId) {
      console.warn(`[drive-storage] No file ID for ${fileKey}, returning default data`);
      console.warn(`[drive-storage] Set ${fileKey.toUpperCase()}_JSON_DRIVE_ID in .env`);
      return defaultData;
    }

    // Download file from Drive
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media'
    }, { responseType: 'text' });

    const data = JSON.parse(response.data);
    console.log(`[drive-storage] ✅ Loaded ${fileKey} from Drive (${Object.keys(data).length} top-level keys)`);
    return data;

  } catch (error) {
    if (error.code === 404) {
      console.warn(`[drive-storage] File ${fileKey} not found in Drive, returning default data`);
      return defaultData;
    }
    console.error(`[drive-storage] Failed to load ${fileKey}:`, error.message);
    throw error;
  }
}

/**
 * Save JSON data to Google Drive
 * @param {string} fileKey - 'store' or 'templates'
 * @param {object} data - Data to save
 * @returns {Promise<object>} Drive API response
 */
export async function saveToDrive(fileKey, data) {
  try {
    const drive = await getDriveClient();
    const fileId = FILE_IDS[fileKey];

    const jsonString = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(jsonString, 'utf8');

    const fileMetadata = {
      name: `DailyReportBot-${fileKey}.json`,
      mimeType: 'application/json'
    };

    if (!fileId && DRIVE_FOLDER_ID) {
      fileMetadata.parents = [DRIVE_FOLDER_ID];
    }

    const media = {
      mimeType: 'application/json',
      body: require('stream').Readable.from([buffer])
    };

    let response;

    if (fileId) {
      // Update existing file
      response = await drive.files.update({
        fileId: fileId,
        media,
        fields: 'id, name, modifiedTime'
      });
      console.log(`[drive-storage] ✅ Saved ${fileKey} to Drive (${response.data.modifiedTime})`);
    } else {
      // Create new file
      response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, webViewLink'
      });
      console.log(`[drive-storage] ✅ Created ${fileKey} in Drive`);
      console.log(`[drive-storage] ⚠️ Add to .env: ${fileKey.toUpperCase()}_JSON_DRIVE_ID=${response.data.id}`);

      // Update in-memory file ID so subsequent saves work
      FILE_IDS[fileKey] = response.data.id;
    }

    return response.data;

  } catch (error) {
    console.error(`[drive-storage] Failed to save ${fileKey}:`, error.message);
    throw error;
  }
}

/**
 * Check if Drive storage is configured
 */
export function isDriveConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID &&
            process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
            process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
}
