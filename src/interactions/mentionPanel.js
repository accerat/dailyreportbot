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
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { DateTime } from 'luxon';
import * as store from '../db/store.js';
import { postWeatherHazardsIfNeeded } from '../services/weather.js';
import { maybePingOnReport } from '../services/pings.js';
import { STATUS, STATUS_LABEL, normalizeStatus } from '../constants/status.js';

const TZ = process.env.TIMEZONE || 'America/Denver';

/** Build the panel embed for a project */
function buildProjectPanelEmbed(project){
  const statusKey = normalizeStatus(project.status);
  const statusLabel = STATUS_LABEL[statusKey] || 'Started';
  const foreman = project.foreman_display || '—';
  const start = project.start_date || '—';
  const reminder = project.reminder_time || '—';
  const isClosed = project.is_closed === true;

  return new EmbedBuilder()
    .setTitle(`Project Panel — ${project.name}`)
    .addFields(
      { name: 'Status', value: statusLabel, inline: true },
      { name: 'Foreman', value: foreman, inline: true },
      { name: 'Start Date', value: String(start), inline: true },
      { name: 'Reminder Time', value: String(reminder), inline: true },
      { name: 'Thread', value: `<#${project.thread_channel_id}>`, inline: true },
      { name: 'Closed?', value: isClosed ? 'Yes' : 'No', inline: true },
    );
}

/** Row of main actions */
function rowMain(project){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dr:open:${project.id}`)
      .setLabel('Open Daily Report')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`panel:foreman:${project.id}`)
      .setLabel('Change Foreman')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`panel:status:${project.id}`)
      .setLabel('Set Status')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Row for close/reopen */
function rowCloseReopen(project){
  const isClosed = project.is_closed === true;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`proj:close:${project.id}`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId(`proj:reopen:${project.id}`)
      .setLabel('Reopen')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!isClosed),
  );
}

/** Ensure project record exists for this thread */
async function ensureProject(thread){
  let p = await store.getProjectByThread(thread.id);
  if (!p){
    p = await store.upsertProject({
      name: thread.name,
      thread_channel_id: thread.id,
      start_date: DateTime.now().setZone('America/Chicago').toISODate(),
      status: STATUS.STARTED,
      reminder_time: '19:00',
    });
  }
  return p;
}

/** Build & show the report modal (5 inputs max) */
function showReportModal(interaction, project){
  const modal = new ModalBuilder()
    .setCustomId(`dr:submit:${project.id}`)
    .setTitle(`Daily Report — ${project.name}`);

  const synopsis = new TextInputBuilder()
    .setCustomId('synopsis')
    .setLabel('Synopsis (include Blockers & Tomorrow plan)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const pct = new TextInputBuilder()
    .setCustomId('pct')
    .setLabel('Completion % (0-100)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const guys = new TextInputBuilder()
    .setCustomId('guys')
    .setLabel('# of workers on site')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const hours = new TextInputBuilder()
    .setCustomId('hours')
    .setLabel('Total man-hours today')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const health = new TextInputBuilder()
    .setCustomId('health')
    .setLabel('Health score 1–5 (1=bad, 5=great)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(synopsis),
    new ActionRowBuilder().addComponents(pct),
    new ActionRowBuilder().addComponents(guys),
    new ActionRowBuilder().addComponents(hours),
    new ActionRowBuilder().addComponents(health),
  );
  return interaction.showModal(modal);
}

/** Parse optional blockers/plan from synopsis free text */
function parseFromSynopsis(text){
  const out = { blockers: null, plan: null };
  if (!text) return out;
  const lower = text.toLowerCase();
  // crude parse: look for "blockers:" and "plan:"
  const b = lower.indexOf('blockers:');
  if (b >= 0){
    const after = text.slice(b + 'blockers:'.length);
    const next = after.toLowerCase().indexOf('plan:');
    out.blockers = (next >= 0 ? after.slice(0, next) : after).trim();
  }
  const p = lower.indexOf('plan:');
  if (p >= 0){
    const after = text.slice(p + 'plan:'.length);
    out.plan = after.trim();
  }
  return out;
}

export function wireInteractions(client){
  // mention to open a panel inside a thread
  client.on(Events.MessageCreate, async (msg) => {
    try{
      if (msg.author.bot) return;
      if (!msg.mentions.has(client.user)) return;
      const channel = msg.channel;
      if (!channel.isThread()) {
        return msg.reply({ content: 'Please mention me **inside a project thread**.', flags: MessageFlags.Ephemeral });
      }
      const project = await ensureProject(channel);
      const embed = buildProjectPanelEmbed(project);
      const row1 = rowMain(project);
      const row2 = rowCloseReopen(project);
      try{
        await msg.reply({ embeds: [embed], components: [row1, row2] });
      }catch{
        await msg.channel.send({ embeds: [embed], components: [row1, row2] });
      }
    }catch(e){ console.error('panel mention error', e); }
  });

  client.on(Events.InteractionCreate, async (i) => {
    try{
      // open report modal
      if (i.isButton() && i.customId.startsWith('dr:open:')){
        const pid = i.customId.split(':').pop();
        const project = await store.getProjectById(Number(pid));
        if (!project) return i.reply({ content: 'Project not found.', flags: MessageFlags.Ephemeral });
        return showReportModal(i, project);
      }

      // submit report
      if (i.isModalSubmit() && i.customId.startsWith('dr:submit:')){
        const pid = Number(i.customId.split(':').pop());
        const project = await store.getProjectById(pid);
        if (!project) return i.reply({ content: 'Project not found.', flags: MessageFlags.Ephemeral });

        const synopsis = i.fields.getTextInputValue('synopsis')?.trim();
        const pct = Number(i.fields.getTextInputValue('pct') || '0');
        const guys = Number(i.fields.getTextInputValue('guys') || '0');
        const hours = Number(i.fields.getTextInputValue('hours') || '0');
        const health = Number(i.fields.getTextInputValue('health') || '0');
        const { blockers, plan } = parseFromSynopsis(synopsis);

        const now = DateTime.now().setZone('America/Chicago'); // reports historically CT in your store
        const report = {
          project_id: project.id,
          author_user_id: i.user.id,
          created_at: now.toISO(),
          report_date: now.toISODate(),
          synopsis,
          percent_complete: Number.isFinite(pct) ? pct : null,
          man_count: Number.isFinite(guys) ? guys : null,
          man_hours: Number.isFinite(hours) ? hours : null,
          health_score: Number.isFinite(health) && health>0 ? health : null,
          blockers: blockers || null,
          tomorrow_plan: plan || null,
          triggers: [],
          photos: []
        };
        const row = await store.insertDailyReport(report);

        // Build embed
        const embed = new EmbedBuilder()
          .setTitle(`Daily Report — ${project.name}`)
          .setDescription(synopsis || '—')
          .addFields(
            { name: 'Completed By', value: (i.member?.displayName || i.user.username), inline: true },
            { name: 'Submitted (Discord)', value: i.user.tag, inline: true },
            { name: 'Foreman', value: project.foreman_display || '—', inline: true },
            { name: 'Percent Complete', value: `${report.percent_complete ?? '—'}%`, inline: true },
            { name: '# Guys', value: String(report.man_count ?? '—'), inline: true },
            { name: 'Man-hours', value: String(report.man_hours ?? '—'), inline: true },
            ...(report.health_score ? [{ name: 'Health Score', value: `${report.health_score} / 5`, inline: true }] : []),
            ...(blockers ? [{ name: 'Blockers', value: blockers, inline: false }] : []),
            ...(plan ? [{ name: 'Tomorrow’s Plan', value: plan, inline: false }] : []),
          )
          .setTimestamp();

        // Post in the project thread
        const thread = await i.client.channels.fetch(project.thread_channel_id);
        await thread.send({ embeds: [embed] });

        // update last_report_date, post weather hazards, and maybe ping
        await store.updateProjectFields(project.id, { last_report_date: now.setZone(TZ).toISODate() });
        await postWeatherHazardsIfNeeded({ project: (await store.getProjectById(project.id)), channel: thread, tz: TZ }).catch(()=>{});
        await maybePingOnReport({
          channel: thread,
          blockers,
          healthScore: report.health_score,
          roleIds: {
            COO_ROLE_ID: process.env.COO_ROLE_ID,
            FINANCE_ROLE_ID: process.env.FINANCE_ROLE_ID,
            LODGING_ROLE_ID: process.env.LODGING_ROLE_ID,
            MLB_OFFICE_ROLE_ID: process.env.MLB_OFFICE_ROLE_ID,
          },
        }).catch(()=>{});

        return i.reply({ content: 'Report submitted.', flags: MessageFlags.Ephemeral });
      }

      // Change Foreman: present selects
      if (i.isButton() && i.customId.startsWith('panel:foreman:')){
        const pid = Number(i.customId.split(':').pop());
        const project = await store.getProjectById(pid);
        if (!project) return i.reply({ content: 'Project not found.', flags: MessageFlags.Ephemeral });

        const rowUser = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(`foreman:pick:${pid}`)
            .setPlaceholder('Select a foreman')
            .setMinValues(1).setMaxValues(1)
        );
        const rowTime = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`foreman:time:${pid}`)
            .setPlaceholder('Reminder time (local)')
            .addOptions(['06:30','12:00','19:00','20:00'].map(v => ({ label: v, value: v })))
        );
        return i.reply({ content: 'Select new foreman and reminder time:', components: [rowUser, rowTime], flags: MessageFlags.Ephemeral });
      }

      // Foreman pick validation + save
      if (i.isUserSelectMenu() && i.customId.startsWith('foreman:pick:')){
        const pid = Number(i.customId.split(':').pop());
        const uid = i.values[0];
        const member = await i.guild.members.fetch(uid).catch(()=>null);
        const roleId = process.env.MLB_FOREMEN_ROLE_ID || process.env.FOREMAN_ROLE_ID;
        if (roleId && !member?.roles.cache.has(roleId)){
          return i.reply({ content: 'Selected user does not have the Foreman role.', flags: MessageFlags.Ephemeral });
        }
        await store.updateProjectFields(pid, { foreman_user_id: uid, foreman_display: (member?.displayName || member?.user?.username || uid) });
        return i.reply({ content: 'Foreman updated.', flags: MessageFlags.Ephemeral });
      }

      if (i.isStringSelectMenu() && i.customId.startsWith('foreman:time:')){
        const pid = Number(i.customId.split(':').pop());
        const v = i.values[0];
        await store.updateProjectFields(pid, { reminder_time: v });
        return i.reply({ content: `Reminder time set to ${v}.`, flags: MessageFlags.Ephemeral });
      }

      // Status menu button -> ephemeral select
      if (i.isButton() && i.customId.startsWith('panel:status:')){
        const pid = Number(i.customId.split(':').pop());
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`status:set:${pid}`)
          .setPlaceholder('Select status')
          .addOptions([
            { label: STATUS_LABEL[STATUS.STARTED], value: STATUS.STARTED },
            { label: STATUS_LABEL[STATUS.ON_HOLD], value: STATUS.ON_HOLD },
            { label: STATUS_LABEL[STATUS.IN_PROGRESS], value: STATUS.IN_PROGRESS },
            { label: STATUS_LABEL[STATUS.LEAVING_INCOMPLETE], value: STATUS.LEAVING_INCOMPLETE },
            { label: STATUS_LABEL[STATUS.COMPLETE_NO_GOBACKS], value: STATUS.COMPLETE_NO_GOBACKS },
          ]);
        return i.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
      }

      if (i.isStringSelectMenu() && i.customId.startsWith('status:set:')){
        const pid = Number(i.customId.split(':').pop());
        const status = i.values[0];
        await store.updateProjectFields(pid, { status });
        // ping MLB Office on terminal transitions
        const project = await store.getProjectById(pid);
        const channel = await i.client.channels.fetch(project.thread_channel_id);
        await maybePingOnReport({
          channel,
          statusChangedTo: status,
          roleIds: {
            MLB_OFFICE_ROLE_ID: process.env.MLB_OFFICE_ROLE_ID,
            FINANCE_ROLE_ID: process.env.FINANCE_ROLE_ID,
            LODGING_ROLE_ID: process.env.LODGING_ROLE_ID,
          }
        }).catch(()=>{});
        return i.reply({ content: `Status updated to ${STATUS_LABEL[status] || status}.`, flags: MessageFlags.Ephemeral });
      }

      // Close / Reopen
      if (i.isButton() && i.customId.startsWith('proj:close:')){
        const pid = Number(i.customId.split(':').pop());
        const p = await store.getProjectById(pid);
        if (!p) return i.reply({ content: 'Project not found.', flags: MessageFlags.Ephemeral });
        await store.closeProjectByThread(p.thread_channel_id, { reason: 'panel', closedBy: i.user.id });
        return i.reply({ content: 'Project closed.', flags: MessageFlags.Ephemeral });
      }
      if (i.isButton() && i.customId.startsWith('proj:reopen:')){
        const pid = Number(i.customId.split(':').pop());
        const p = await store.getProjectById(pid);
        if (!p) return i.reply({ content: 'Project not found.', flags: MessageFlags.Ephemeral });
        await store.reopenProjectByThread(p.thread_channel_id, { reopenedBy: i.user.id });
        return i.reply({ content: 'Project reopened.', flags: MessageFlags.Ephemeral });
      }
    }catch(e){
      console.error('Interaction handler error:', e);
      if (!i.deferred && !i.replied){
        await i.reply({ content: 'There was an error handling that action. Please try again.', flags: MessageFlags.Ephemeral });
      } else if (i.deferred){
        await i.editReply({ content: 'There was an error handling that action. Please try again.' });
      }
    }
  });
}
