
import cron from 'node-cron';
import { DateTime } from 'luxon';
import * as store from '../db/store.js';

// Flip status from 'upcoming' -> 'in_progress' on each project's start date, daily at 00:10 CT
cron.schedule('10 0 * * *', async () => {
  try{
    const today = DateTime.now().setZone('America/Chicago').toISODate();
    const n = await store.autoFlipUpcomingToInProgress(today);
    if (n>0) console.log(`[autoFlipStart] Flipped ${n} project(s) to in_progress for ${today}`);
  }catch(err){
    console.error('[autoFlipStart] error', err);
  }
}, { timezone: 'America/Chicago' });
