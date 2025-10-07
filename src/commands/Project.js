// src/commands/project.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
} from 'discord.js';

import {
  getProjectByThread,
  // helpers added to store.js below:
  setProjectStatusByThread,
  closeProjectByThread,
  reopenProjectByThread,
} from '../db/store.js';

export const data = new SlashCommandBuilder()
  .setName('project')
  .setDescription('Set status or close/reopen the current project thread.')
  .addSubcommand(sc =>
    sc.setName('status')
      .setDescription('Set or view status for this project thread')
      .addStringOption(o =>
        o.setName('value')
         .setDescription('New status (leave blank to view)')
         .setRequired(false)
      )
  )
  .addSubcommand(sc =>
    sc.setName('close')
      .setDescription('Close this project thread')
      .addStringOption(o =>
        o.setName('reason')
         .setDescription('Optional reason for closing')
         .setRequired(false)
      )
  )
  .addSubcommand(sc =>
    sc.setName('reopen')
      .setDescription('Reopen this project thread')
  )
  // Let everyone use it; change if you want to restrict
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const threadId = interaction.channelId;

  // Must already be a tracked project (we won’t silently create one)
  const proj = await getProjectByThread(threadId);
  if (!proj) {
    return interaction.reply({
      content: 'This thread/channel is not tracked as a project yet.',
      flags: 64,
    });
  }

  if (sub === 'status') {
    const value = interaction.options.getString('value');
    if (!value) {
      const fields = [
        `**Status:** ${proj.status ?? '—'}`,
        `**Closed:** ${proj.is_closed ? 'Yes' : 'No'}`,
        proj.closed_reason ? `**Closed Reason:** ${proj.closed_reason}` : null,
      ].filter(Boolean);
      return interaction.reply({ content: fields.join('\n'), flags: 64 });
    }
    const updated = await setProjectStatusByThread(threadId, value);
    if (!updated) {
      return interaction.reply({ content: 'Could not update status.', flags: 64 });
    }
    return interaction.reply({ content: `Status set to **${updated.status}**.`, flags: 0 });
  }

  if (sub === 'close') {
    const reason = interaction.options.getString('reason') || undefined;
    const updated = await closeProjectByThread(threadId, { reason, closedBy: interaction.user.id });
    if (!updated) {
      return interaction.reply({ content: 'Could not close project.', flags: 64 });
    }
    const msg = [`🛑 Project closed.`];
    if (reason) msg.push(`Reason: ${reason}`);
    return interaction.reply({ content: msg.join(' '), flags: 0 });
  }

  if (sub === 'reopen') {
    const updated = await reopenProjectByThread(threadId, { reopenedBy: interaction.user.id });
    if (!updated) {
      return interaction.reply({ content: 'Could not reopen project.', flags: 64 });
    }
    return interaction.reply({ content: '✅ Project re-opened.', flags: 0 });
  }
}
