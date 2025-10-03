// src/jobs/reminders.js
import cron from 'node-cron';
import { DateTime } from 'luxon';
import { runReminderPass } from './remindersRuntime.js';
import { autoFlipUpcomingToInProgress } from '../db/store.js';

const TZ = 'America/Chicago';

// Hourly: send daily report reminders at each project's configured hour
cron.schedule('0 * * * *', async () => {
  try {
    await runReminderPass(null);
  } catch (err) {
    console.error('[jobs/reminders] runReminderPass failed:', err);
  }
}, { timezone: TZ });

// Daily flip: when the calendar day starts (TZ), flip UPCOMING -> IN_PROGRESS for projects whose start_date === today
cron.schedule('5 0 * * *', async () => {
  try {
    const today = DateTime.now().setZone(TZ).toISODate();
    const n = await autoFlipUpcomingToInProgress(today);
    if (n > 0) console.log(`[jobs/reminders] Auto-flipped ${n} project(s) to in_progress for ${today}`);
  } catch (err) {
    console.error('[jobs/reminders] autoFlipUpcomingToInProgress failed:', err);
  }
}, { timezone: TZ });
