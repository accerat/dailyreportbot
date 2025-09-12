import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, Events } from 'discord.js';

// The button ID your UI uses to open the daily report modal
const BTN_ID = 'open-daily-report';

/**
 * Wires up interaction handlers for the Daily Report modal.
 * Exports a named function because index.js imports { wireInteractions }.
 */
export function wireInteractions(client) {
  console.log('[mentionPanel] handlers wired');

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (!interaction.isButton()) return;
      if (interaction.customId !== BTN_ID) return;

      const modal = new ModalBuilder()
        .setCustomId('daily-report-modal')
        .setTitle('Daily Report');

      // Discord modals allow a MAX of 5 components (1 TextInput per ActionRow)
      // Keep it at 5 or fewer to avoid "BASE_TYPE_MAX_LENGTH" errors.
      const fields = [
        new TextInputBuilder()
          .setCustomId('yesterday')
          .setLabel('What did you do yesterday?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false),

        new TextInputBuilder()
          .setCustomId('today')
          .setLabel('What will you do today?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false),

        new TextInputBuilder()
          .setCustomId('blockers')
          .setLabel('Any blockers?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false),

        new TextInputBuilder()
          .setCustomId('notes')
          .setLabel('Notes')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false),

        new TextInputBuilder()
          .setCustomId('health')
          .setLabel('Health (1-5)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ];

      for (const field of fields.slice(0, 5)) {
        modal.addComponents(new ActionRowBuilder().addComponents(field));
      }

      await interaction.showModal(modal);
    } catch (err) {
      console.error('[mentionPanel] modal error:', err);
      if (interaction.isRepliable && interaction.isRepliable() && !interaction.replied) {
        await interaction.reply({ content: 'Could not open the daily report modal.', ephemeral: true }).catch(() => {});
      }
    }
  });
}
