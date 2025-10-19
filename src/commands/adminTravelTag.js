// src/commands/adminTravelTag.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { processTravelTagging, processLastWeek } from '../services/clockifyTravelTagger.js';

export const data = new SlashCommandBuilder()
  .setName('travel-tag')
  .setDescription('Tag travel time entries with next/previous project names')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(option =>
    option
      .setName('period')
      .setDescription('Time period to process')
      .setRequired(true)
      .addChoices(
        { name: 'Last Week (Sat-Fri)', value: 'last_week' },
        { name: 'Custom Date Range', value: 'custom' }
      )
  )
  .addStringOption(option =>
    option
      .setName('start_date')
      .setDescription('Start date (YYYY-MM-DD) - required if Custom selected')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('end_date')
      .setDescription('End date (YYYY-MM-DD) - required if Custom selected')
      .setRequired(false)
  );

export async function execute(interaction) {
  const period = interaction.options.getString('period');
  const startDateStr = interaction.options.getString('start_date');
  const endDateStr = interaction.options.getString('end_date');

  await interaction.deferReply({ ephemeral: true });

  try {
    let summary;

    if (period === 'last_week') {
      // Process last Saturday-Friday
      summary = await processLastWeek();
    } else if (period === 'custom') {
      // Validate custom dates
      if (!startDateStr || !endDateStr) {
        return interaction.editReply({
          content: 'Custom date range requires both start_date and end_date parameters.',
        });
      }

      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return interaction.editReply({
          content: 'Invalid date format. Use YYYY-MM-DD (e.g., 2025-10-13)',
        });
      }

      if (startDate > endDate) {
        return interaction.editReply({
          content: 'Start date must be before or equal to end date.',
        });
      }

      // Set time boundaries
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      summary = await processTravelTagging(startDate, endDate);
    }

    // Build response message
    const lines = [
      '**Travel Tagging Complete**',
      '',
      `✅ Users Processed: ${summary.usersProcessed}`,
      `🔍 Travel Entries Found: ${summary.travelEntriesFound}`,
      `🏷️ Travel Entries Tagged: ${summary.travelEntriesTagged}`,
      `➕ Tags Created: ${summary.tagsCreated}`,
    ];

    if (summary.errors.length > 0) {
      lines.push('');
      lines.push(`⚠️ Errors: ${summary.errors.length}`);
      lines.push('');
      lines.push('**Error Details:**');
      summary.errors.slice(0, 5).forEach(err => lines.push(`• ${err}`));
      if (summary.errors.length > 5) {
        lines.push(`... and ${summary.errors.length - 5} more errors`);
      }
    }

    return interaction.editReply({ content: lines.join('\n') });
  } catch (error) {
    console.error('[travel-tag command] Error:', error);
    return interaction.editReply({
      content: `Failed to process travel tagging: ${error.message || 'Unknown error'}`,
    });
  }
}
