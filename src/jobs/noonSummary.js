import cron from 'node-cron';
import { postDailySummaryAll } from '../services/summary.js';

cron.schedule('0 12 * * *', async () => {
  await postDailySummaryAll();
}, { timezone: 'America/Chicago' });
