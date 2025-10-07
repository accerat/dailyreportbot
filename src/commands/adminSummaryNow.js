// src/commands/adminSummaryNow.js
import { SlashCommandBuilder } from 'discord.js';
import { postDailySummaryAll } from '../services/summary.js';

export const data = new SlashCommandBuilder()
  .setName('admin-summary-now')
  .setDescription('Post the Project Daily Summary thread right now.');

export async function execute(interaction) {
  try {
    await interaction.deferReply({ flags: 64 });
    const forumId = process.env.PROJECT_DAILY_SUMMARIES_FORUM_ID;
    if (!forumId) {
      await interaction.editReply('Missing PROJECT_DAILY_SUMMARIES_FORUM_ID in .env');
      return;
    }
    const count = await postDailySummaryAll();
    await interaction.editReply(`✅ Posted daily summary. ${count} project(s) included.`);
  } catch (err) {
    console.error('[admin-summary-now] failed:', err);
    try {
      await interaction.editReply('Sorry, something went wrong while posting the summary.');
    } catch {}
  }
}
