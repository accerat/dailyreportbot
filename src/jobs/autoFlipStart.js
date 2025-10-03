
// src/jobs/autoFlipStart.js
import cron from 'node-cron';
import { DateTime } from 'luxon';
import { autoFlipUpcomingToInProgress } from '../db/store.js';

// Run daily at 00:10 CT to flip upcoming->in_progress when start_date arrives
cron.schedule('10 0 * * *', async () => {
  try{
    const today = DateTime.now().setZone('America/Chicago').toISODate();
    const changed = await autoFlipUpcomingToInProgress(today);
    if (changed) console.log(`[autoFlipStart] flipped ${changed} project(s) to in_progress for ${today}`);
  }catch(e){
    console.error('[autoFlipStart] error', e);
  }
}, { timezone: 'America/Chicago' });
