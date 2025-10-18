// src/utils/driveBackup.js
// Auto-backup store.json and templates.json to Google Drive

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

// File IDs for updating existing backups
const FILE_ID_MAP = {
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
    console.warn('[drive-backup] OAuth2 not configured, skipping backup');
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Backup a JSON file to Google Drive
 * @param {string} fileKey - 'store' or 'templates'
 * @param {string} filePath - Local file path
 */
export async function backupToDrive(fileKey, filePath) {
  try {
    const drive = await getDriveClient();
    if (!drive) return; // Skip if not configured

    if (!fs.existsSync(filePath)) {
      console.warn(`[drive-backup] File not found: ${filePath}`);
      return;
    }

    const fileName = path.basename(filePath);
    const existingFileId = FILE_ID_MAP[fileKey];

    const fileMetadata = {
      name: `DailyReportBot-${fileName}`,
      mimeType: 'application/json'
    };

    if (!existingFileId && DRIVE_FOLDER_ID) {
      fileMetadata.parents = [DRIVE_FOLDER_ID];
    }

    const media = {
      mimeType: 'application/json',
      body: fs.createReadStream(filePath)
    };

    let response;

    if (existingFileId) {
      // Update existing backup
      response = await drive.files.update({
        fileId: existingFileId,
        media,
        fields: 'id, name, modifiedTime'
      });
      console.log(`[drive-backup] ✅ Updated ${fileName} backup (${response.data.modifiedTime})`);
    } else {
      // Create new backup
      response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, webViewLink'
      });

      console.log(`[drive-backup] ✅ Created ${fileName} backup`);
      console.log(`[drive-backup] ⚠️ Add to .env: ${fileKey.toUpperCase()}_JSON_DRIVE_ID=${response.data.id}`);
    }

    return response.data;
  } catch (e) {
    console.error(`[drive-backup] Failed to backup ${fileKey}:`, e.message);
  }
}

/**
 * Backup store.json to Drive
 */
export async function backupStore() {
  await backupToDrive('store', './data/store.json');
}

/**
 * Backup templates.json to Drive
 */
export async function backupTemplates() {
  await backupToDrive('templates', './data/templates.json');
}

/**
 * Backup both files
 */
export async function backupAll() {
  await Promise.all([
    backupStore(),
    backupTemplates()
  ]);
}

/**
 * Check if Drive backup is configured
 */
export function isBackupConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID &&
            process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
            process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
}
