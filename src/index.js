import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

import { startKeepAlive } from './http/keepalive.js';
import { wireInteractions } from './interactions/mentionPanel.js';
import './jobs/reminders.js';
import './jobs/noonSummary.js';
import './jobs/midnightMissed.js';


// Admin command modules
import * as adminSummary from './commands/adminSummaryNow.js';
import * as adminReminders from './commands/adminRemindersNow.js';
import * as adminBackfill from './commands/adminBackfillMissed.js';
import * as adminSetForums from './commands/adminSetForums.js';
import * as adminSetProjectCategory from './commands/adminSetProjectCategory.js';

// Create the client BEFORE using it
export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});
global.client = client;

client.once(Events.ClientReady, (c) => {
  console.log(`[ready] logged in as ${c.user.tag}`);
});

// Slash-command dispatcher
const commandMap = new Map([
  [adminSummary.data.name, adminSummary],
  [adminReminders.data.name, adminReminders],
  [adminBackfill.data.name, adminBackfill],
  [adminSetForums.data.name, adminSetForums],
  [adminSetProjectCategory.data.name, adminSetProjectCategory],

]);

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const mod = commandMap.get(interaction.commandName);
  try {
    if (!mod?.execute) {
      return interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
    await mod.execute(interaction); // each /admin-* defers internally
  } catch (err) {
    console.error('Slash command error:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: 'Sorry, something went wrong.' });
    } else {
      await interaction.reply({ content: 'Sorry, something went wrong.', ephemeral: true });
    }
  }
});

// Optional: Dismiss button handler for reminder DMs
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton()) return;
  if (!i.customId?.startsWith('rem:dismiss:')) return;
  try {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rem:dismissed').setLabel('DISMISSED').setStyle(ButtonStyle.Secondary).setDisabled(true)
    );
    if (i.message.editable !== false) {
      await i.message.edit({ components: [row] });
    }
    await i.reply({ content: 'Dismissed. You can still submit the daily report in the project thread.', ephemeral: true });
  } catch (e) {
    console.error('Dismiss handler error:', e);
    if (!i.replied) await i.reply({ content: 'Dismissed.', ephemeral: true });
  }
});

// Wire up message-based interactions (mentions + panel)
wireInteractions(client);

// Keepalive HTTP server (for UptimeRobot)
const port = process.env.PORT ? Number(process.env.PORT) : 14522;
startKeepAlive(client).listen(port, () => {
  console.log(`HTTP keepalive listening on ${port}`);
});

// Login
client.login(process.env.BOT_TOKEN);
