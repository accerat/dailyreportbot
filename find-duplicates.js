// find-duplicates.js
// Find duplicate projects by thread_channel_id in Google Drive store

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

  console.log(`\n=== ALL PROJECTS ===\n`);
  data.projects.forEach(p => {
    console.log(`ID ${p.id}: "${p.name}"`);
    console.log(`  Thread: ${p.thread_channel_id}`);
    console.log(`  Foreman: ${p.foreman_display || 'N/A'} (${p.foreman_user_id || 'N/A'})`);
    console.log(`  Status: ${p.status || 'N/A'}`);
    console.log(`  Reminder: ${p.reminder_time || 'N/A'}`);
    console.log();
  });

  // Find duplicates by thread_channel_id
  const byThread = {};
  data.projects.forEach(p => {
    if (!byThread[p.thread_channel_id]) {
      byThread[p.thread_channel_id] = [];
    }
    byThread[p.thread_channel_id].push(p);
  });

  console.log(`\n=== DUPLICATES (same thread_channel_id) ===\n`);
  let found = false;
  Object.entries(byThread).forEach(([threadId, projects]) => {
    if (projects.length > 1) {
      found = true;
      console.log(`Thread ${threadId} has ${projects.length} projects:`);
      projects.forEach(p => {
        console.log(`  - ID ${p.id}: "${p.name}" (Foreman: ${p.foreman_display || 'N/A'})`);
      });
      console.log();
    }
  });

  if (!found) {
    console.log('No duplicates found.');
  }
}

main().catch(console.error);
