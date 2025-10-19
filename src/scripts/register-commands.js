import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import * as adminSummary from '../commands/adminSummaryNow.js';
import * as adminReminders from '../commands/adminRemindersNow.js';
import * as adminBackfill from '../commands/adminBackfillMissed.js';
import * as adminSetForums from '../commands/adminSetForums.js'; // optional legacy
import * as adminSetProjectCategory from '../commands/adminSetProjectCategory.js'; // NEW
import * as adminClockifyManualSync from '../commands/adminClockifyManualSync.js'; // NEW
import * as adminTravelTag from '../commands/adminTravelTag.js'; // NEW

const commands = [
  adminSummary.data,
  adminReminders.data,
  adminBackfill.data,
  adminSetForums.data,          // keep if you still want forum-level config
  adminSetProjectCategory.data,  // NEW
  adminClockifyManualSync.data,  // NEW
  adminTravelTag.data            // NEW
].map(c => c.toJSON());

async function main() {
  const { BOT_TOKEN, APP_ID, GUILD_ID } = process.env;
  if (!BOT_TOKEN || !APP_ID || !GUILD_ID) throw new Error('BOT_TOKEN, APP_ID, and GUILD_ID must be set');
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: commands });
  console.log('Admin commands registered.');
}
main().catch(e=>{ console.error(e); process.exit(1); });
