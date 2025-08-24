import cron from 'node-cron'; import { runReminderPass } from './remindersRuntime.js'; cron.schedule('0 * * * *', async()=>{ await runReminderPass(null); }, { timezone: 'America/Chicago' });
