// src/interactions/mentionPanel.js
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { todayCT, nowCT } from '../util/time.js';
import * as store from '../db/store.js';

// Map triggers -> intake channels from .env
const TRIGGER_CHANNELS = {
  materials: process.env.TRACK_MATERIALS_CHANNEL_ID,
  uhc_materials: process.env.TRACK_UHC_MATERIALS_CHANNEL_ID,
  lodging: process.env.TRACK_LODGING_CHANNEL_ID,
  rfi: process.env.TRACK_RFI_CCD_COR_CHANNEL_ID,
  ccd: process.env.TRACK_RFI_CCD_COR_CHANNEL_ID,
  cor: process.env.TRACK_RFI_CCD_COR_CHANNEL_ID,
};

const TRIGGERS = [
  ['materials', 'Materials'],
  ['uhc_materials', 'UHC Materials'],
  ['lodging', 'Lodging'],
  ['rfi', 'RFI'],
  ['ccd', 'CCD'],
  ['cor', 'COR'],
];

function buildTriggerRows(report) {
  const selected = new Set(report.triggers || []);
  const mk = ([value, label]) =>
    new ButtonBuilder()
      .setCustomId(`panel:tgl:${report.id}:${value}`)
      .setLabel(`${selected.has(value) ? '✓ ' : ''}${label}`)
      .setStyle(selected.has(value) ? ButtonStyle.Success : ButtonStyle.Secondary);

  const rowA = new ActionRowBuilder().addComponents(
    mk(TRIGGERS[0]), mk(TRIGGERS[1]), mk(TRIGGERS[2])
  );
  const rowB = new ActionRowBuilder().addComponents(
    mk(TRIGGERS[3]), mk(TRIGGERS[4]), mk(TRIGGERS[5])
  );
  const submitRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`panel:submit:${report.id}`).setLabel('Submit').setStyle(ButtonStyle.Primary)
  );
  return [rowA, rowB, submitRow];
}

// Mini controls shown when you click "Show Status"
function buildStatusRow(project) {
  const status = String(project.status || 'open').toLowerCase();
  const isClosed = !!project.is_closed;
  const pid = project.id;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`panel:setstatus:${pid}:open`)
      .setLabel('Open')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isClosed && status === 'open'),
    new ButtonBuilder()
      .setCustomId(`panel:setstatus:${pid}:in-progress`)
      .setLabel('In Progress')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isClosed && status === 'in-progress'),
    new ButtonBuilder()
      .setCustomId(`panel:setstatus:${pid}:blocked`)
      .setLabel('Blocked')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isClosed && status === 'blocked'),
    new ButtonBuilder()
      .setCustomId(`panel:setstatus:${pid}:on-hold`)
      .setLabel('On Hold')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isClosed && status === 'on-hold'),
    new ButtonBuilder()
      .setCustomId(`panel:close:${pid}`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(`panel:reopen:${pid}`)
      .setLabel('Reopen')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!isClosed),
  );
}

// Project status / close controls (rendered as the 3rd row on the panel)
function projectControlsRow(project) {
  const status = String(project.status || 'open').toLowerCase();
  const isClosed = !!project.is_closed;
  const pid = project.id;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`proj:status:${pid}:open`)
      .setLabel('Open')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isClosed && status === 'open'),
    new ButtonBuilder()
      .setCustomId(`proj:status:${pid}:in-progress`)
      .setLabel('In Progress')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isClosed && status === 'in-progress'),
    new ButtonBuilder()
      .setCustomId(`proj:status:${pid}:blocked`)
      .setLabel('Blocked')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isClosed && status === 'blocked'),
    new ButtonBuilder()
      .setCustomId(`proj:status:${pid}:on-hold`)
      .setLabel('On Hold')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isClosed && status === 'on-hold'),
    new ButtonBuilder()
      .setCustomId(`proj:close:${pid}`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed === true),
    new ButtonBuilder()
      .setCustomId(`proj:reopen:${pid}`)
      .setLabel('Reopen')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isClosed === false),
  );
  return row;
}

async function postTriggerIntakeMessages(client, project, report, authorId) {
  for (const t of report.triggers || []) {
    const channelId = TRIGGER_CHANNELS[t];
    if (!channelId) continue;
    try {
      const ch = await client.channels.fetch(channelId);
      await ch.send(
        `🔔 **${t.toUpperCase()}** trigger — **${project.name}** (Day ${report.day_index}, ${report.report_date})\n` +
        `Requester: <@${authorId}>\nThread: <#${project.thread_channel_id}>`
      );
    } catch (e) {
      console.error('trigger post error', t, e);
    }
  }
}

export function wireInteractions(client) {

  async function showPanel(msg, project) {
    const embed = new EmbedBuilder()
      .setTitle(`Project Panel — ${project.name}`)
      .setDescription('Choose an action below.');
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`panel:new:${project.id}`).setLabel('New Daily Report').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`panel:photos:${project.id}`).setLabel('Add Photos').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`panel:status:${project.id}`).setLabel('Show Status').setStyle(ButtonStyle.Secondary),
    );
    // Row 2: remove Pause/Resume; keep only Change Foreman
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`panel:foreman:${project.id}`)
        .setLabel('Change Foreman')
        .setStyle(ButtonStyle.Secondary),
    );

    const row3 = projectControlsRow(project);
    await msg.reply({ embeds: [embed], components: [row1, row2, row3] });
  }

  client.on(Events.MessageCreate, async (msg) => {
    if (!client.user) return;
    if (!msg.mentions.users.has(client.user.id) || msg.author.bot) return;

    // If already linked, show panel
    const existing = await store.getProjectByThread(msg.channelId);
    if (existing) return showPanel(msg, existing);

    // Must be in a forum thread
    const channel = msg.channel;
    const isThread = typeof channel.isThread === 'function'
      ? channel.isThread()
      : [10, 11, 12].includes(channel.type);
    if (!isThread) {
      const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean);
      const isAdminSender = adminIds.includes(msg.author.id) || msg.member?.permissions?.has('Administrator');
      if (isAdminSender) {
        return msg.reply('This isn’t a thread. Create a **forum post (thread)** in your project forum, then @mention me there.');
      }
      return;
    }

    // Identify forum and parent category
    const forum = channel.parent ?? null;
    const forumId = forum?.id ?? null;
    const categoryId = forum?.parentId ?? null;

    // Settings: category mode and/or legacy forums
    const settings = await store.getSettings();
    const inProjectCategory = !!(settings.project_category_id && categoryId === settings.project_category_id);
    const inKnownForum =
      (settings.non_uhc_forum_id && forumId === settings.non_uhc_forum_id) ||
      (settings.uhc_forum_id && forumId === settings.uhc_forum_id);

    if (!inProjectCategory && !inKnownForum) {
      const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean);
      const isAdminSender = adminIds.includes(msg.author.id) || msg.member?.permissions?.has('Administrator');
      if (isAdminSender) {
        return msg.reply('No project container configured. Run **/admin-set-project-category** (recommended) or **/admin-set-forums** first.');
      }
      return;
    }

    // Determine type
    const isUhcByForum = settings.uhc_forum_id && forumId === settings.uhc_forum_id;
    const isUhcByName  = (forum?.name?.toLowerCase() || '').includes('uhc');
    const type = (isUhcByForum || isUhcByName) ? 'uhc' : 'non_uhc';

    // Link project from thread title
    const project = await store.upsertProject({
      name: channel.name,
      thread_channel_id: channel.id,
      foreman_user_id: null,
      reminder_start_ct: '08:00',
      start_date: null,
      paused: false,
      reminder_active: true,
      track_in_summary: true,
      type
    });

    // Onboarding UI
    const embed = new EmbedBuilder()
      .setTitle(`Set up: ${project.name}`)
      .setDescription('Pick a foreman and set the start date/time for reminders (CST). When finished, press **Finish Setup**.');

    const row1 = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`onb:foreman:${project.id}`)
        .setPlaceholder('Select foreman')
        .setMinValues(1)
        .setMaxValues(1)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`onb:start:${project.id}`).setLabel('Set Start Date & Time').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`onb:done:${project.id}`).setLabel('Finish Setup').setStyle(ButtonStyle.Success),
    );

    await msg.reply({ embeds: [embed], components: [row1, row2] });
  });

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (!i.isButton() && !i.isUserSelectMenu() && !i.isModalSubmit()) return;

      // Onboarding: pick foreman
      if (i.isUserSelectMenu() && i.customId.startsWith('onb:foreman:')) {
        const pid = Number(i.customId.split(':')[2]);
        const userId = i.values[0];
        await store.upsertProject({ id: pid, foreman_user_id: userId });
        return i.reply({ content: `Foreman set to <@${userId}>.`, flags: MessageFlags.Ephemeral });
      }

      // Onboarding: set start date/time
      if (i.isButton() && i.customId.startsWith('onb:start:')) {
        const pid = Number(i.customId.split(':')[2]);
        const modal = new ModalBuilder().setCustomId(`onb:modalstart:${pid}`).setTitle('Start date & time (CST)');
        const date = new TextInputBuilder().setCustomId('start_date').setLabel('Start date (YYYY-MM-DD)').setStyle(TextInputStyle.Short).setRequired(true);
        const time = new TextInputBuilder().setCustomId('reminder_time').setLabel('Reminder start time (HH:MM, CST)').setStyle(TextInputStyle.Short).setRequired(true).setValue('08:00');
        modal.addComponents(
          new ActionRowBuilder().addComponents(date),
          new ActionRowBuilder().addComponents(time),
        );
        return i.showModal(modal);
      }

      if (i.isModalSubmit() && i.customId.startsWith('onb:modalstart:')) {
        const pid = Number(i.customId.split(':')[2]);
        const start_date = i.fields.getTextInputValue('start_date').trim();
        const reminder_time = i.fields.getTextInputValue('reminder_time').trim();
        await store.upsertProject({ id: pid, start_date, reminder_start_ct: reminder_time });
        return i.reply({ content: `Start set to **${start_date}**; reminders begin daily at **${reminder_time} CT**.`, flags: MessageFlags.Ephemeral });
      }

      if (i.isButton() && i.customId.startsWith('onb:done:')) {
        const pid = Number(i.customId.split(':')[2]);
        const s = await store.load();
        const p = s.projects.find(x => x.id === pid);
        if (!p?.foreman_user_id || !p?.start_date) {
          return i.reply({ content: 'Please select a foreman and set the start date/time first.', flags: MessageFlags.Ephemeral });
        }
        await i.reply({ content: `Setup complete for **${p.name}**.`, flags: MessageFlags.Ephemeral });
        const channel = await i.client.channels.fetch(p.thread_channel_id);
        await channel.send({ content: 'Project linked. Here’s your panel:' });
        return (await channel.sendTyping(), showPanel({ reply: (obj) => channel.send(obj) }, p));
      }

      // === Panel actions ===
      const parts = (i.customId || '').split(':');
      if (parts[0] !== 'panel') return;
      const action = parts[1];

      // New Daily Report — modal with Completion date (prefilled from last report)
      if (action === 'new' && i.isButton()) {
        const projectId = Number(parts[2]);
        const last = await store.latestReport(projectId);
        const defaultCompletion = last?.completion_date || '';

        const modal = new ModalBuilder().setCustomId(`panel:modal:${projectId}`).setTitle('Daily Report');
        const synopsis = new TextInputBuilder().setCustomId('synopsis').setLabel('Daily Synopsis').setStyle(TextInputStyle.Paragraph).setRequired(true);
        const pct = new TextInputBuilder().setCustomId('pct').setLabel('Completion % (0-100)').setStyle(TextInputStyle.Short).setRequired(true);
        const guys = new TextInputBuilder().setCustomId('guys').setLabel('# Guys').setStyle(TextInputStyle.Short).setRequired(true);
        const hours = new TextInputBuilder().setCustomId('hours').setLabel('Man-hours').setStyle(TextInputStyle.Short).setRequired(true);
        const comp = new TextInputBuilder().setCustomId('completion_date').setLabel('Completion date (YYYY-MM-DD)').setStyle(TextInputStyle.Short).setRequired(false).setValue(defaultCompletion);

        modal.addComponents(
          new ActionRowBuilder().addComponents(synopsis),
          new ActionRowBuilder().addComponents(pct),
          new ActionRowBuilder().addComponents(guys),
          new ActionRowBuilder().addComponents(hours),
          new ActionRowBuilder().addComponents(comp),
        );
        return i.showModal(modal);
      }

      // Modal submit — save, then show trigger toggles like checkboxes
      if (i.isModalSubmit() && parts[0] === 'panel' && parts[1] === 'modal') {
        const projectId = Number(parts[2]);
        const today = todayCT();
        const percent = Math.max(0, Math.min(100, parseInt(i.fields.getTextInputValue('pct') || '0', 10)));
        const manCount = Math.max(0, parseInt(i.fields.getTextInputValue('guys') || '0', 10));
        const manHours = Math.max(0, Number(i.fields.getTextInputValue('hours') || '0'));
        const synopsis = i.fields.getTextInputValue('synopsis');
        const completion_date = (i.fields.getTextInputValue('completion_date') || '').trim();

        const count = await store.countReportsUpTo(projectId, today);
        const dayIndex = count + 1;

        const ins = await store.insertDailyReport({
          project_id: projectId,
          author_user_id: i.user.id,
          created_at: nowCT().toISO(),
          report_date: today,
          synopsis, percent_complete: percent, man_count: manCount, man_hours: manHours,
          day_index: dayIndex, triggers: [], photos: [], completion_date
        });

        // Keep latest completion date on project for convenient prefill next time
        if (completion_date) await store.upsertProject({ id: projectId, completion_date });

        return i.reply({
          content: 'Report saved. Toggle triggers (checkboxes) and then **Submit**.',
          flags: MessageFlags.Ephemeral,
          components: buildTriggerRows(ins)
        });
      }

      // Toggle a trigger (acts like a checkbox)
      if (action === 'tgl' && i.isButton()) {
        const reportId = Number(parts[2]);
        const trig = parts[3];
        const report = await store.getReportById(reportId);
        if (!report) return i.reply({ content: 'Report not found. Please try again.', flags: MessageFlags.Ephemeral });

        let list = Array.isArray(report.triggers) ? [...report.triggers] : [];
        if (list.includes(trig)) list = list.filter(x => x !== trig); else list.push(trig);

        const updated = await store.updateReportTriggers(reportId, list, i.user.id);
        return i.update({ components: buildTriggerRows(updated) });
      }

      // Final submit — post to intake channels and close the UI
      if (action === 'submit' && i.isButton()) {
        const reportId = Number(parts[2]);
        const report = await store.getReportById(reportId);
        if (!report) {
          return i.reply({ content: 'Report not found. Please try again.', flags: MessageFlags.Ephemeral });
        }

        // Get project BEFORE using it
        const project = await store.getProjectById(report.project_id);

        // Post a confirmation embed in the project thread (visible to everyone in the thread)
        if (project) {
          const ch = await i.client.channels.fetch(project.thread_channel_id);
          const embed = new EmbedBuilder()
            .setTitle(`Daily Report — ${project.name}`)
            .setDescription(report.synopsis || '—')
            .addFields(
              { name: 'Percent Complete', value: `${report.percent_complete ?? '—'}%`, inline: true },
              { name: '# Guys', value: String(report.man_count ?? '—'), inline: true },
              { name: 'Man-hours', value: String(report.man_hours ?? '—'), inline: true },
              { name: 'Completion date', value: report.completion_date || '—', inline: true },
              { name: 'Day #', value: String(report.day_index ?? '—'), inline: true },
              { name: 'Triggers', value: (report.triggers?.length ? report.triggers.join(', ') : 'none'), inline: false },
            )
            .setFooter({ text: `Report date: ${report.report_date}` });
          await ch.send({ embeds: [embed] });

          // Post trigger pings to intake channels (activates your other bots)
          await postTriggerIntakeMessages(i.client, project, report, i.user.id);
        }

        return i.update({ content: 'Daily report submitted ✅', components: [] });
      }

      // === Project status / close / reopen button handling (quick row) ===
      if (i.isButton() && i.customId?.startsWith('proj:')) {
        const partsProj = i.customId.split(':'); // e.g., proj:status:123:on-hold | proj:close:123
        const actionProj = partsProj[1];
        const pid = Number(partsProj[2]);
        const project = await store.getProjectById(pid);
        if (!project) {
          return i.reply({ content: 'Project not found for this thread.', flags: MessageFlags.Ephemeral });
        }

        if (actionProj === 'status') {
          const newStatus = String(partsProj[3] || '').trim().toLowerCase();
          await store.upsertProject({ id: pid, status: newStatus });
          return i.reply({ content: `Status set to **${newStatus}**.`, flags: MessageFlags.Ephemeral });
        }

        if (actionProj === 'close') {
          if (project.is_closed) {
            return i.reply({ content: 'Project is already closed.', flags: MessageFlags.Ephemeral });
          }
          await store.upsertProject({
            id: pid,
            is_closed: true,
            status: project.status && project.status !== 'open' ? project.status : 'closed',
            closed_by: i.user.id,
            closed_at: new Date().toISOString(),
          });
          return i.reply({ content: '🛑 Project closed.' });
        }

        if (actionProj === 'reopen') {
          if (!project.is_closed) {
            return i.reply({ content: 'Project is not closed.', flags: MessageFlags.Ephemeral });
          }
          await store.upsertProject({
            id: pid,
            is_closed: false,
            status: project.status === 'closed' ? 'open' : (project.status || 'open'),
            closed_reason: null,
            closed_at: null,
            reopened_by: i.user.id,
          });
          return i.reply({ content: '✅ Project re-opened.' });
        }
      }

      // Clicked: Show Status (opens mini status panel)
      if (action === 'status' && i.isButton()) {
        const pid = Number(parts[2]);
        const project = await store.getProjectById(pid);
        if (!project) return i.reply({ content: 'Project not found.', flags: MessageFlags.Ephemeral });

        const lines = [
          `**Status:** ${project.status ?? '—'}`,
          `**Closed:** ${project.is_closed ? 'Yes' : 'No'}`,
        ];
        if (project.closed_reason) lines.push(`**Closed Reason:** ${project.closed_reason}`);

        return i.reply({
          content: lines.join('\n'),
          components: [buildStatusRow(project)],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Clicked: set status (Open / In Progress / Blocked / On Hold) from mini panel
      if (i.isButton() && i.customId.startsWith('panel:setstatus:')) {
        const [, , pidStr, value] = i.customId.split(':');
        const pid = Number(pidStr);
        const allowed = new Set(['open', 'in-progress', 'blocked', 'on-hold']);
        const val = String(value || '').toLowerCase();
        if (!allowed.has(val)) {
          return i.reply({ content: 'Invalid status.', flags: MessageFlags.Ephemeral });
        }

        await store.upsertProject({ id: pid, status: val });
        const project = await store.getProjectById(pid);

        return i.update({
          content: `Status set to **${project.status}**.`,
          components: [buildStatusRow(project)],
        });
      }

      // Clicked: Close from mini panel
      if (i.isButton() && i.customId.startsWith('panel:close:')) {
        const pid = Number(i.customId.split(':')[2]);
        const project = await store.getProjectById(pid);
        if (project?.is_closed) {
          return i.reply({ content: 'Project is already closed.', flags: MessageFlags.Ephemeral });
        }
        await store.upsertProject({
          id: pid,
          is_closed: true,
          status: project?.status && project.status !== 'open' ? project.status : 'closed',
          closed_by: i.user.id,
          closed_at: new Date().toISOString(),
        });
        const updated = await store.getProjectById(pid);
        return i.update({ content: '🛑 Project closed.', components: [buildStatusRow(updated)] });
      }

      // Clicked: Reopen from mini panel
      if (i.isButton() && i.customId.startsWith('panel:reopen:')) {
        const pid = Number(i.customId.split(':')[2]);
        const project = await store.getProjectById(pid);
        if (!project?.is_closed) {
          return i.reply({ content: 'Project is not closed.', flags: MessageFlags.Ephemeral });
        }
        await store.upsertProject({
          id: pid,
          is_closed: false,
          status: project.status === 'closed' ? 'open' : (project.status || 'open'),
          closed_reason: null,
          closed_at: null,
          reopened_by: i.user.id,
        });
        const updated = await store.getProjectById(pid);
        return i.update({ content: '✅ Project re-opened.', components: [buildStatusRow(updated)] });
      }

      // Stubs for other panel buttons so they don't "fail"
      if (['photos','pause','resume','foreman'].includes(action) && i.isButton()) {
        return i.reply({ content: 'That action will be available soon.', flags: MessageFlags.Ephemeral });
      }

    } catch (e) {
      console.error('Interaction handler error:', e);
      if (!i.deferred && !i.replied) {
        await i.reply({ content: 'There was an error handling that action. Please try again.', flags: MessageFlags.Ephemeral });
      } else if (i.deferred) {
        await i.editReply({ content: 'There was an error handling that action. Please try again.' });
      }
    }
  });
}
