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

function parseScopeLines(text){
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const scopes = [];
  const re = /^(?:\d+\s*[\)\.]|\d+\p{Emoji_Presentation}?|[\u0030-\u0039]\uFE0F?\u20E3)\s*|^\s*[•\-]\s*/u;
  for (let line of lines){
    line = String(line).trim();
    if (!line) continue;
    // Remove leading list markers like "1)", "1.", "1️⃣", "•"
    line = line.replace(re, '').trim();
    // Stop at ' - ' status if present
    const idx = line.indexOf(' - ');
    if (idx !== -1) line = line.slice(0, idx).trim();
    // Heuristic: scope lines often contain '-' or '('; but accept any non-empty
    if (line) scopes.push(line);
  }
  // Require at least 2 to avoid false positives
  return scopes.length >= 2 ? scopes : [];
}

async function fetchFirstPostContent(thread){
  try{
    if (thread.fetchStarterMessage){
      const starter = await thread.fetchStarterMessage();
      if (starter && starter.content) return starter.content;
    }
  }catch(_){}
  // Fallback: fetch first 10 messages and pick oldest
  try{
    const msgs = await thread.messages.fetch({ limit: 10 });
    const oldest = [...msgs.values()].sort((a,b)=>a.createdTimestamp-b.createdTimestamp)[0];
    return oldest?.content || '';
  }catch(_){}
  return '';
}

import { postWeatherHazardsIfNeeded } from '../services/weather.js';
import { maybePingOnReport } from '../services/pings.js';
import { STATUS, STATUS_LABEL, normalizeStatus } from '../constants/status.js';

const TZ = process.env.TIMEZONE || 'America/Chicago'; // default to CT per your org

function buildProjectPanelEmbed(project){
  const statusKey = normalizeStatus(project.status);
  const statusLabel = STATUS_LABEL[statusKey] || 'Started';
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
    new ButtonBuilder().setCustomId(`dr:settpl:${project.id}`).setLabel('Set Template').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dr:reftpl:${project.id}`).setLabel('Refresh Template').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`panel:foreman:${project.id}`).setLabel('Change Foreman').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`panel:status:${project.id}`).setLabel('Set Status').setStyle(ButtonStyle.Secondary),
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

  // Prefill Daily Summary (synopsis) from per-thread template, if available
  let prefill = '';
  try{
    const thread = interaction.channel;
    const tpl = thread ? await store.getThreadTemplate(thread.id) : null;
    if (tpl && Array.isArray(tpl.scopes) && tpl.scopes.length){
      prefill = tpl.scopes.map((s, idx)=>`${idx+1}) ${s} - `).join('\n');
    }
  }catch(e){ console.warn('Prefill template fetch failed:', e); }


  const synopsis = new TextInputBuilder().setCustomId('synopsis'.setValue('<<PREFILL>>')).setLabel('Daily Summary').setStyle(TextInputStyle.Paragraph).setRequired(true);
  const pct = new TextInputBuilder().setCustomId('pct').setLabel('Completion % (0-100)').setStyle(TextInputStyle.Short).setRequired(true);
  const completion = new TextInputBuilder().setCustomId('completion_date').setLabel('Anticipated End Date (MM/DD/YYYY)').setStyle(TextInputStyle.Short).setRequired(true);
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
        return showReportModal(i, project);
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
        await thread.send({ embeds: [embed] });

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

        return i.reply({ content: 'Report submitted.', ephemeral: true });
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
