// src/jobs/noonSummary.js
import cron from 'node-cron';
import { postDailySummaryAll } from '../services/summary.js';

// Run every day at 12:00 PM America/Chicago
cron.schedule(
  '0 12 * * *',
  async () => {
    try {
      await postDailySummaryAll();
    } catch (err) {
      console.error('[noonSummary] postDailySummaryAll failed:', err);
    }
  },
  { timezone: 'America/Chicago' }
);
