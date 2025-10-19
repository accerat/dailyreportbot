// src/jobs/travelTagging.js
// Weekly cron job to tag travel time entries with next/previous project names
// Runs every Monday at 8:00 AM America/Chicago

import cron from 'node-cron';
import { processLastWeek } from '../services/clockifyTravelTagger.js';

const TZ = process.env.TIMEZONE || 'America/Chicago';

// Run every Monday at 8:00 AM
cron.schedule(
  '0 8 * * 1',
  async () => {
    console.log('[travel-tagging] Starting weekly travel tagging job');
    try {
      const summary = await processLastWeek();
      console.log('[travel-tagging] Weekly job complete:', {
        usersProcessed: summary.usersProcessed,
        travelEntriesFound: summary.travelEntriesFound,
        travelEntriesTagged: summary.travelEntriesTagged,
        tagsCreated: summary.tagsCreated,
        errors: summary.errors.length,
      });

      if (summary.errors.length > 0) {
        console.error('[travel-tagging] Errors occurred:', summary.errors);
      }
    } catch (err) {
      console.error('[travel-tagging] Weekly job failed:', err);
    }
  },
  { timezone: TZ }
);

console.log(`[travel-tagging] Cron job scheduled: Every Monday at 8:00 AM ${TZ}`);
