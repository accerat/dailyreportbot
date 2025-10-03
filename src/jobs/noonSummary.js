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


import { postWeeklyHealthSummary } from '../services/health.js';
const TZ = process.env.TIMEZONE || 'America/Denver';
// Weekly summary Fridays 16:00 in TZ
if (process.env.WEEKLY_HEALTH_ENABLED === 'true') cron.schedule(
  '0 16 * * 5',
  async () => {
    try {
      await postWeeklyHealthSummary(global.client, process.env.EXEC_SUMMARY_CHANNEL_ID || process.env.PROJECT_DAILY_SUMMARIES_FORUM_ID, TZ);
    } catch (err) {
      console.error('[weeklyHealth] postWeeklyHealthSummary failed:', err);
    }
  },
  { timezone: TZ }
);

