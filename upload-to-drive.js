// upload-to-drive.js
// Upload store.json and templates.json to Google Drive and get file IDs

import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import { Readable } from 'stream';

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

async function getDriveClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function uploadFile(fileName, filePath) {
  const drive = await getDriveClient();

  const fileContent = fs.readFileSync(filePath, 'utf8');
  const buffer = Buffer.from(fileContent, 'utf8');

  const fileMetadata = {
    name: `DailyReportBot-${fileName}`,
    mimeType: 'application/json'
    // Skip parents - upload to root of Drive
  };

  const media = {
    mimeType: 'application/json',
    body: Readable.from([buffer])
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id, name, webViewLink'
  });

  return response.data;
}

async function main() {
  console.log('Uploading files to Google Drive...\n');

  try {
    const storeFile = await uploadFile('store.json', './data/store.json');
    console.log('✅ Uploaded store.json');
    console.log(`   File ID: ${storeFile.id}`);
    console.log(`   View: ${storeFile.webViewLink}`);
    console.log(`\n   Add to .env:\n   STORE_JSON_DRIVE_ID=${storeFile.id}\n`);

    const templatesFile = await uploadFile('templates.json', './data/templates.json');
    console.log('✅ Uploaded templates.json');
    console.log(`   File ID: ${templatesFile.id}`);
    console.log(`   View: ${templatesFile.webViewLink}`);
    console.log(`\n   Add to .env:\n   TEMPLATES_JSON_DRIVE_ID=${templatesFile.id}\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

main().catch(console.error);
