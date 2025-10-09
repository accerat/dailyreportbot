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
} from 'discord.js';
import { DateTime } from 'luxon';
import * as store from '../db/store.js';
import { postExecutiveCompletionSummary } from '../services/health.js';
import * as templates from '../db/templates.js';
import { postWeatherHazardsIfNeeded } from '../services/weather.js';
import { maybePingOnReport } from '../services/pings.js';
import { STATUS, STATUS_LABEL, normalizeStatus } from '../constants/status.js';

const TZ = process.env.TIMEZONE || 'America/Chicago'; // default to CT per your org

function buildProjectPanelEmbed(project){
  const statusKey = normalizeStatus(project.status);
  const statusLabel = STATUS_LABEL[statusKey] || STATUS_LABEL[STATUS.STARTED];
  const foreman = project.foreman_display || '—';
  const start = project.start_date || '—';
  const reminder = project.reminder_time || '—';

  return new EmbedBuilder()
    .setTitle(`Project Panel — ${project.name}`)
    .addFields(
      { name: 'Status', value: statusLabel, inline: true },
      { name: 'Foreman', value: foreman, inline: true },
      { name: 'Start Date', value: String(start), inline: true },
      { name: 'Reminder Time', value: String(reminder), inline: true },
      ...(project.thread_channel_id ? [{ name: 'Thread', value: `<#${project.thread_channel_id}>`, inline: true }] : []),
    );
}

function rowMain(project){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dr:open:${project.id}`).setLabel('Open Daily Report').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`panel:status:${project.id}`).setLabel('Set Status').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tmpl:set:${project.id}`).setLabel('Set Template').setStyle(ButtonStyle.Secondary),
  );
}

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

async function showReportModal(interaction, project){
  const modal = new ModalBuilder().setCustomId(`dr:submit:${project.id}`).setTitle(`Daily Report — ${project.name}`);

  const synopsis = new TextInputBuilder().setCustomId('synopsis').setLabel('Daily Summary').setStyle(TextInputStyle.Paragraph).setRequired(true);
  try {
    const t = await templates.getTemplateForProject(project.id);
    if (t) {
      if (typeof t === 'string') synopsis.setValue(String(t).slice(0, 4000));
      else if (t && t.body) synopsis.setValue(String(t.body).slice(0, 4000));
    }
  } catch {}

  const pct = new TextInputBuilder().setCustomId('pct').setLabel('Completion % (0-100)').setStyle(TextInputStyle.Short).setRequired(true);
  const completion = new TextInputBuilder().setCustomId('completion_date').setLabel('Anticipated End Date (MM/DD/YYYY)').setStyle(TextInputStyle.Short).setRequired(true);
  try {
    const t = await templates.getTemplateForProject(project.id);
    if (t && typeof t === 'object' && t.end) completion.setValue(String(t.end).slice(0, 100));
  } catch {}
  const labor = new TextInputBuilder().setCustomId('labor').setLabel('Labor (manpower, hours)').setPlaceholder('example = 4, 8 means 4 men 8 hours').setStyle(TextInputStyle.Short).setRequired(true);
  const health = new TextInputBuilder().setCustomId('health').setLabel('Health (1=urgent problems, 5=all good)').setStyle(TextInputStyle.Short).setRequired(true);

      const rows = [
    new ActionRowBuilder().addComponents(synopsis),
    new ActionRowBuilder().addComponents(pct),
    new ActionRowBuilder().addComponents(completion),
    new ActionRowBuilder().addComponents(labor),
    new ActionRowBuilder().addComponents(health),
  ];
  // SAFEGUARD: Discord allows max 5 rows in a modal
  const limited = rows.slice(0, 5);
  try { console.log('[mentionPanel] modal rows =', limited.length); } catch {}
  modal.addComponents(...limited);
  return interaction.showModal(modal);
}

function parseLabor(text){
  if (!text) return { guys: null, hours: null };
  const nums = Array.from(String(text).matchAll(/(\d+(?:\.\d+)?)/g)).map(m=>Number(m[1])).filter(n=>Number.isFinite(n));
  const people = Number.isFinite(nums[0]) ? Math.round(nums[0]) : null;
  const hrs = Number.isFinite(nums[1]) ? Math.round(nums[1]) : null;
  return { guys: people, hours: hrs };
}

function parseFromSynopsis(text){
  const out = { blockers: null, plan: null };
  if (!text) return out;
  const lower = text.toLowerCase();
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

async function showPanel(msg, project){
  const embed = buildProjectPanelEmbed(project);
  const row1 = rowMain(project);
  const rows = [row1].filter(r => r && r.components && r.components.length >= 1 && r.components.length <= 5);
  try{
    await msg.reply({ embeds: [embed], components: rows });
  }catch{
    await msg.channel.send({ embeds: [embed], components: rows });
  }
}

export function wireInteractions(client){
  client.on(Events.MessageCreate, async (msg) => {
    try{
      if (msg.author.bot) return;
      if (!msg.mentions.has(client.user)) return;
      const channel = msg.channel;
      if (!channel.isThread()) {
        return msg.reply({ content: 'Please mention me **inside a project thread**.' });
      }
      const project = await ensureProject(channel);
      await showPanel(msg, project);
    }catch(e){ console.error('panel mention error', e); }
  });

  client.on(Events.InteractionCreate, async (i) => {
    try{
      if (i.isButton() && i.customId.startsWith('dr:open:')){
        const pid = Number(i.customId.split(':').pop());
        const project = await store.getProjectById(pid);
        if (!project) return i.reply({ content: 'Project not found.', ephemeral: true });
        return await showReportModal(i, project);
      }

      if (i.isModalSubmit() && i.customId.startsWith('dr:submit:')){
        const pid = Number(i.customId.split(':').pop());
        const project = await store.getProjectById(pid);
        if (!project) return i.reply({ content: 'Project not found.', ephemeral: true });

        const synopsis = i.fields.getTextInputValue('synopsis')?.trim();
        const pct = Number(i.fields.getTextInputValue('pct') || '0');
        const completion_date = (i.fields.getTextInputValue('completion_date') || '').trim();
        const laborText = (i.fields.getTextInputValue('labor') || '').trim();
        const { guys, hours } = parseLabor(laborText);
        const health = Number(i.fields.getTextInputValue('health') || '0');
        const { blockers, plan } = parseFromSynopsis(synopsis);

        const now = DateTime.now().setZone('America/Chicago');
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
          photos: [],
          completion_date: (completion_date || null)
        };
        await store.insertDailyReport(report);
        const _foremanDisplay = (i.member?.displayName || i.user.username);
        const _update = { foreman_user_id: i.user.id, foreman_display: _foremanDisplay };
        if (completion_date) _update.completion_date = completion_date;
        await store.updateProjectFields(project.id, _update);

        const embed = new EmbedBuilder()
          .setTitle(`Daily Report — ${project.name}`)
          .setDescription(synopsis || '—')
          .addFields(
            { name: 'Completed By', value: (i.member?.displayName || i.user.username), inline: true },
            { name: 'Submitted (Discord)', value: i.user.tag, inline: true },
            { name: 'Foreman', value: project.foreman_display || '—', inline: true },
            { name: 'Percent Complete', value: `${report.percent_complete ?? '—'}%`, inline: true },
            ...(report.completion_date ? [{ name: 'Anticipated End', value: String(report.completion_date), inline: true }] : []),
            { name: '# Guys', value: String(report.man_count ?? '—'), inline: true },
            { name: 'Man-hours', value: String(report.man_hours ?? '—'), inline: true },
            ...(report.health_score ? [{ name: 'Health Score', value: `${report.health_score} / 5`, inline: true }] : []),
            ...(blockers ? [{ name: 'Blockers', value: blockers, inline: false }] : []),
            ...(plan ? [{ name: 'Tomorrow’s Plan', value: plan, inline: false }] : []),
          )
          .setTimestamp();

        const thread = await i.client.channels.fetch(project.thread_channel_id);
        const post = await thread.send({ embeds: [embed] });

        // --- Forward into the consolidated #daily-reports channel with a Jump button ---
        try {
          const drChId = process.env.DAILY_REPORTS_CHANNEL_ID;
          if (drChId) {
            const reportsChannel = await i.client.channels.fetch(drChId);
            if (reportsChannel && typeof reportsChannel.send === 'function') {
              const jumpRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Jump to Request').setURL(post?.url || thread?.url || '')
              );
              try {
                await reportsChannel.send({ embeds: [embed], components: [jumpRow], allowedMentions: { parse: [] } });
              } catch (e) { console.error('daily-reports forward send error', e); }
            }
          }
        } catch (e) { console.error('daily-reports forward error', e); }
await store.updateProjectFields(project.id, {
  last_report_date: now.setZone(TZ).toISODate(),
  last_report_datetime: now.toISO()
});
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

        return i.reply({ content: 'Report submitted.', ephemeral: true });
      }

      
      // Template buttons
      if (i.isButton() && i.customId.startsWith('tmpl:set:')){
  const pid = Number(i.customId.split(':').pop());
  const project = await store.getProjectById(pid);
  if (!project) return i.reply({ content: 'Project not found.', ephemeral: true });
  const existing = await templates.getTemplateForProject(pid);

  const modal = new ModalBuilder().setCustomId(`tmpl:save:${pid}`).setTitle(`Set Daily Summary Template`);

  const body = new TextInputBuilder()
    .setCustomId('tmpl_body')
    .setLabel('Template text (prefills Daily Summary)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);
  if (existing) {
    if (typeof existing === 'string') body.setValue(String(existing).slice(0, 4000));
    else if (existing.body) body.setValue(String(existing.body).slice(0, 4000));
  }

  const start = new TextInputBuilder()
    .setCustomId('tmpl_start')
    .setLabel('Start Date (YYYY-MM-DD or MM/DD/YYYY)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  if (existing && typeof existing === 'object' && existing.start) {
    start.setValue(String(existing.start).slice(0, 100));
  } else if (project.start_date) {
    start.setValue(String(project.start_date).slice(0, 100));
  }

  const end = new TextInputBuilder()
    .setCustomId('tmpl_end')
    .setLabel('Anticipated End Date (MM/DD/YYYY)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  if (existing && typeof existing === 'object' && existing.end) {
    end.setValue(String(existing.end).slice(0, 100));
  } else if (project.completion_date) {
    end.setValue(String(project.completion_date).slice(0, 100));
  }

  const time = new TextInputBuilder()
    .setCustomId('tmpl_time')
    .setLabel('Daily Reminder Time (HH:MM, 24h)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  if (existing && typeof existing === 'object' && existing.reminder_time) {
    time.setValue(String(existing.reminder_time).slice(0, 20));
  } else if (project.reminder_time) {
    time.setValue(String(project.reminder_time).slice(0, 20));
  }

  const foreman = new TextInputBuilder()
    .setCustomId('tmpl_foreman')
    .setLabel('Initial Foreman (display name or @mention)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  if (existing && typeof existing === 'object' && existing.foreman) {
    foreman.setValue(String(existing.foreman).slice(0, 100));
  } else if (project.foreman_display) {
    foreman.setValue(String(project.foreman_display).slice(0, 100));
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(body),
    new ActionRowBuilder().addComponents(start),
    new ActionRowBuilder().addComponents(end),
    new ActionRowBuilder().addComponents(time),
    new ActionRowBuilder().addComponents(foreman)
  );
  return i.showModal(modal);
}

      if (i.isButton() && i.customId.startsWith('tmpl:clear:')){
        const pid = Number(i.customId.split(':').pop());
        await templates.clearTemplateForProject(pid);
        return i.reply({ content: 'Template cleared for this project/thread.', ephemeral: true });
      }

      if (i.isModalSubmit() && i.customId.startsWith('tmpl:save:')){
  const pid = Number(i.customId.split(':').pop());
  const body = (i.fields.getTextInputValue('tmpl_body') || '').trim();
  const startRaw = (i.fields.getTextInputValue('tmpl_start') || '').trim();
  const endRaw = (i.fields.getTextInputValue('tmpl_end') || '').trim();
  const timeRaw = (i.fields.getTextInputValue('tmpl_time') || '').trim();
  const foremanRaw = (i.fields.getTextInputValue('tmpl_foreman') || '').trim();

  if (body.length === 0 && startRaw.length === 0 && endRaw.length === 0 && timeRaw.length === 0 && foremanRaw.length === 0){
    await templates.clearTemplateForProject(pid);
    return i.reply({ content: 'Template cleared (empty).', ephemeral: true });
  } else {
    await templates.setTemplateForProject(pid, {
      body,
      start: startRaw,
      end: endRaw,
      reminder_time: timeRaw,
      foreman: foremanRaw
    });

    // Also update the project fields
    const updates = {};
    if (startRaw) updates.start_date = startRaw;
    if (endRaw) updates.completion_date = endRaw;
    if (timeRaw) updates.reminder_time = timeRaw;
    if (foremanRaw) updates.foreman_display = foremanRaw;

    if (Object.keys(updates).length > 0) {
      await store.updateProjectFields(pid, updates);
    }

    return i.reply({ content: 'Template saved.', ephemeral: true });
  }

      }
if (i.isButton() && i.customId.startsWith('panel:foreman:')){
        const pid = Number(i.customId.split(':').pop());
        const project = await store.getProjectById(pid);
        if (!project) return i.reply({ content: 'Project not found.', ephemeral: true });

        const rowUser = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId(`foreman:pick:${pid}`).setPlaceholder('Select a foreman').setMinValues(1).setMaxValues(1)
        );
        const rowTime = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`foreman:time:${pid}`).setPlaceholder('Reminder time (local)').addOptions(['06:30','12:00','19:00','20:00'].map(v => ({ label: v, value: v })))
        );
        return i.reply({ content: 'Select new foreman and reminder time:', components: [rowUser, rowTime], ephemeral: true });
      }

      if (i.isUserSelectMenu() && i.customId.startsWith('foreman:pick:')){
        const pid = Number(i.customId.split(':').pop());
        const uid = i.values[0];
        const member = await i.guild.members.fetch(uid).catch(()=>null);
        const roleId = process.env.MLB_FOREMEN_ROLE_ID || process.env.FOREMAN_ROLE_ID;
        if (roleId && !member?.roles.cache.has(roleId)){
          return i.reply({ content: 'Selected user does not have the Foreman role.', ephemeral: true });
        }
        await store.updateProjectFields(pid, { foreman_user_id: uid, foreman_display: (member?.displayName || member?.user?.username || uid) });
        return i.reply({ content: 'Foreman updated.', ephemeral: true });
      }

      if (i.isStringSelectMenu() && i.customId.startsWith('foreman:time:')){
        const pid = Number(i.customId.split(':').pop());
        const v = i.values[0];
        await store.updateProjectFields(pid, { reminder_time: v });
        return i.reply({ content: `Reminder time set to ${v}.`, ephemeral: true });
      }

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
        return i.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      }

      if (i.isStringSelectMenu() && i.customId.startsWith('status:set:')){
        const pid = Number(i.customId.split(':').pop());
        const status = i.values[0];
        await store.updateProjectFields(pid, { status });
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
        
        // Log specific transitions and post executive summary on completion
        try {
          if (status === STATUS.LEAVING_INCOMPLETE && typeof store.logEvent === 'function') {
            await store.logEvent({ project_id: pid, type: 'status:leaving_incomplete', author_user_id: i.user.id });
          }
          if (status === STATUS.COMPLETE_NO_GOBACKS) {
            await postExecutiveCompletionSummary(i.client, pid).catch(()=>{});
          }
        } catch {}
return i.reply({ content: `Status updated to ${STATUS_LABEL[status] || status}.`, ephemeral: true });
      }
    }catch(e){
      console.error('Interaction handler error:', e);
      if (!i.deferred && !i.replied){
        await i.reply({ content: 'There was an error handling that action. Please try again.', ephemeral: true });
      } else if (i.deferred){
        await i.editReply({ content: 'There was an error handling that action. Please try again.' });
      }
    }
  });
}
