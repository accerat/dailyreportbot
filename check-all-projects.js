// check-all-projects.js
// Download and show ALL projects from Google Drive

import 'dotenv/config';
import { google } from 'googleapis';

async function getDriveClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function main() {
  const drive = await getDriveClient();
  const storeId = process.env.STORE_JSON_DRIVE_ID;

  const response = await drive.files.get({
    fileId: storeId,
    alt: 'media'
  }, { responseType: 'text' });

  const data = JSON.parse(response.data);

  console.log(`\n=== ALL PROJECTS (Total: ${data.projects.length}) ===\n`);
  console.log(JSON.stringify(data.projects, null, 2));
}

main().catch(console.error);
