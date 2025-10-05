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
} from 'discord.js';
import { DateTime } from 'luxon';
import * as store from '../db/store.js';
import * as templates from '../db/templates.js';
import { postWeatherHazardsIfNeeded } from '../services/weather.js';
import { maybePingOnReport } from '../services/pings.js';
import { postExecutiveCompletionSummary } from '../services/health.js';
import { STATUS, STATUS_LABEL, normalizeStatus } from '../constants/status.js';

const TZ = process.env.TIMEZONE || 'America/Chicago'; // default to CT

function buildProjectPanelEmbed(project) {
  const statusKey = normalizeStatus(project.status);
  const statusLabel = STATUS_LABEL[statusKey] || 'Started';
  const foreman = project.foreman_display || '—';
  const start = project.start_date || '—';
  const reminder = project.reminder_time || '—';

  return new EmbedBuilder()
    .setTitle(`Project Panel — ${project.name}`)
    .addFields(
      { name: 'Status', value: String(statusLabel), inline: true },
      { name: 'Foreman', value: String(foreman), inline: true },
      { name: 'Start Date', value: String(start), inline: true },
      { name: 'Reminder Time', value: String(reminder), inline: true },
      ...(project.thread_channel_id
        ? [{ name: 'Thread', value: `<#${project.thread_channel_id}>`, inline: true }]
        : []),
    );
}

function rowMain(project) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dr:open:${project.id}`)
      .setLabel('Open Daily Report')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`panel:status:${project.id}`)
      .setLabel('Set Status')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`tmpl:set:${project.id}`)
      .setLabel('Set Template')
      .setStyle(ButtonStyle.Secondary),
  );
}

async function ensureProject(thread) {
  let p = await store.getProjectByThread(thread.id);
  if (!p) {
    p = await store.upsertProject({
      name: thread.name,
      thread_channel_id: thread.id,
      start_date: DateTime.now().setZone(TZ).toISODate(),
      status: STATUS.STARTED,
      reminder_time: '19:00',
    });
  }
  return p;
}

async function showReportModal(interaction, project) {
  const modal = new ModalBuilder()
    .setCustomId(`dr:submit:${project.id}`)
    .setTitle(`Daily Report — ${project.name}`);

  const synopsis = new TextInputBuilder()
    .setCustomId('synopsis')
    .setLabel('Daily Summary')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  try {
    const t = await templates.getTemplateForProject(project.id);
    if (t) {
      if (typeof t === 'string') synopsis.setValue(String(t).slice(0, 4000));
      else if (t && t.body) synopsis.setValue(String(t.body).slice(0, 4000));
    }
  } catch { /* ignore template read errors */ }

  const pct = new TextInputBuilder()
    .setCustomId('pct')
    .setLabel('Completion % (0-100)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const completion = new TextInputBuilder()
    .setCustomId('completion_date')
    .setLabel('Anticipated End Date (MM/DD/YYYY)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  try {
    const t = await templates.getTemplateForProject(project.id);
    if (t && typeof t === 'object' && t.end) completion.setValue(String(t.end).slice(0, 100));
  } catch { /* ignore template read errors */ }

  const labor = new TextInputBuilder()
    .setCustomId('labor')
    .setLabel('Labor (manpower, hours)')
    .setPlaceholder('example = 4, 8 means 4 men 8 hours')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const health = new TextInputBuilder()
    .setCustomId('health')
    .setLabel('Health (1=urgent problems, 5=all good)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const rows = [
    new ActionRowBuilder().addComponents(synopsis),
    new ActionRowBuilder().addComponents(pct),
    new ActionRowBuilder().addComponents(completion),
    new ActionRowBuilder().addComponents(labor),
    new ActionRowBuilder().addComponents(health),
  ].slice(0, 5); // Discord max 5 rows

  try { console.log('[mentionPanel] modal rows =', rows.length); } catch {}
  modal.addComponents(...rows);
  return interaction.showModal(modal);
}

function parseLabor(text) {
  if (!text) return { guys: null, hours: null };
  const nums = Array.from(String(text).matchAll(/(\d+(?:\.\d+)?)/g))
    .map(m => Number(m[1]))
    .filter(n => Number.isFinite(n));
  const people = Number.isFinite(nums[0]) ? Math.round(nums[0]) : null;
  const hrs = Number.isFinite(nums[1]) ? Math.round(nums[1]) : null;
  return { guys: people, hours: hrs };
}

function parseFromSynopsis(text) {
  const out = { blockers: null, plan: null };
  if (!text) return out;
  const lower = text.toLowerCase();
  const b = lower.indexOf('blockers:');
  if (b >= 0) {
    const after = text.slice(b + 'blockers:'.length);
    const next = after.toLowerCase().indexOf('plan:');
    out.blockers = (next >= 0 ? after.slice(0, next) : after).trim();
  }
  const p = lower.indexOf('plan:');
  if (p >= 0) {
    const after = text.slice(p + 'plan:'.length);
    out.plan = after.trim();
  }
  return out;
}

async function showPanel(msg, project) {
  const embed = buildProjectPanelEmbed(project);
  const row1 = rowMain(project);
  const rows = [row1].filter(r => r && r.components && r.components.length >= 1 && r.components.length <= 5);
  try {
    await msg.reply({ embeds: [embed], components: rows });
  } catch {
    await msg.channel.send({ embeds: [embed], components: rows });
  }
}

export function wireInteractions(client) {
  client.on(Events.MessageCreate, async (msg) => {
    try {
      if (msg.author?.bot) return;
      if (!msg.mentions?.has?.(client.user)) return;
      const channel = msg.channel;
      if (!channel?.isThread?.() && ![10, 11, 12].includes(channel?.type)) {
        return msg.reply({ content: 'Please mention me **inside a project thread**.' });
      }
      const project = await ensureProject(channel);
      await showPanel(msg, project);
    } catch (e) { console.error('panel mention error', e); }
  });

  client.on(Events.InteractionCreate, async (i) => {
    try {
      // --- Open Daily Report modal ---
      if (i.isButton() && i.customId.startsWith('dr:open:')) {
        const pid = Number(i.customId.split(':').pop());
        const project = await store.getProjectById(pid);
        if (!project) return i.reply({ content: 'Project not found.', ephemeral: true });
        return showReportModal(i, project);
      }

      // --- Submit Daily Report ---
      if (i.isModalSubmit() && i.customId.startsWith('dr:submit:')) {
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

        const now = DateTime.now().setZone(TZ);
        const report = {
          project_id: project.id,
          author_user_id: i.user.id,
          created_at: now.toISO(),
          report_date: now.toISODate(),
          synopsis,
          percent_complete: Number.isFinite(pct) ? pct : null,
          man_count: Number.isFinite(guys) ? guys : null,
          man_hours: Number.isFinite(hours) ? hours : null,
          health_score: Number.isFinite(health) && health > 0 ? health : null,
          blockers: blockers || null,
          tomorrow_plan: plan || null,
          triggers: [],
          photos: [],
          completion_date: (completion_date || null),
        };

        await store.insertDailyReport(report);

        const _update = {
          foreman_user_id: i.user.id,
          foreman_display: (i.member?.displayName || i.user.username),
        };
        if (completion_date) _update.completion_date = completion_date;
        await store.updateProjectFields(project.id, _update);

        const embed = new EmbedBuilder()
          .setTitle(`Daily Report — ${project.name}`)
          .setDescription(synopsis || '—')
          .addFields(
            { name: 'Completed By', value: (i.member?.displayName || i.user.username), inline: true },
            { name: 'Submitted (Discord)', value: i.user.tag, inline: true },
            { name: 'Foreman', value: _update.foreman_display || '—', inline: true },
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

        // Forward to consolidated #daily-reports channel with Jump button
        try {
          const drChId = process.env.DAILY_REPORTS_CHANNEL_ID;
          if (drChId) {
            const reportsChannel = await i.client.channels.fetch(drChId);
            if (reportsChannel && typeof reportsChannel.send === 'function') {
              const jumpRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Jump to Request').setURL(post?.url || thread?.url || '')
              );
              await reportsChannel.send({ embeds: [embed], components: [jumpRow], allowedMentions: { parse: [] } });
            }
          }
        } catch (e) { console.error('daily-reports forward error', e); }

        await store.updateProjectFields(project.id, { last_report_date: now.toISODate() });
        await postWeatherHazardsIfNeeded({ project: await store.getProjectById(project.id), channel: thread, tz: TZ }).catch(() => {});
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
        }).catch(() => {});

        return i.reply({ content: 'Report submitted.', ephemeral: true });
      }

      // --- Set Template button -> modal with extra fields ---
      if (i.isButton() && i.customId.startsWith('tmpl:set:')) {
        const pid = Number(i.customId.split(':').pop());
        const project = await store.getProjectById(pid);
        if (!project) return i.reply({ content: 'Project not found.', ephemeral: true });
        const existing = await templates.getTemplateForProject(pid);

        const modal = new ModalBuilder().setCustomId(`tmpl:save:${pid}`).setTitle('Set Daily Summary Template');

        const body = new TextInputBuilder()
          .setCustomId('tmpl_body')
          .setLabel('Template text (prefills Daily Summary)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);

        if (existing) {
          if (typeof existing === 'string') body.setValue(String(existing).slice(0, 4000));
          else if (existing.body) body.setValue(String(existing.body).slice(0, 4000));
        }

        const end = new TextInputBuilder()
          .setCustomId('tmpl_end')
          .setLabel('Anticipated End Date (MM/DD/YYYY)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        if (existing && typeof existing === 'object' && existing.end) {
          end.setValue(String(existing.end).slice(0, 100));
        }

        const startDate = new TextInputBuilder()
          .setCustomId('tmpl_start')
          .setLabel('Start Date (MM/DD/YYYY or YYYY-MM-DD)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const foremanField = new TextInputBuilder()
          .setCustomId('tmpl_foreman')
          .setLabel('Initial Foreman (@mention or ID)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const timeField = new TextInputBuilder()
          .setCustomId('tmpl_time')
          .setLabel('Daily Reminder Time (HH:MM 24h)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        // Discord max 5 rows
        modal.addComponents(
          new ActionRowBuilder().addComponents(body),
          new ActionRowBuilder().addComponents(end),
          new ActionRowBuilder().addComponents(startDate),
          new ActionRowBuilder().addComponents(foremanField),
          new ActionRowBuilder().addComponents(timeField),
        );

        return i.showModal(modal);
      }

      // --- Save Template + project fields ---
      if (i.isModalSubmit() && i.customId.startsWith('tmpl:save:')) {
        const pid = Number(i.customId.split(':').pop());
        const body = (i.fields.getTextInputValue('tmpl_body') || '').trim();
        const end = (i.fields.getTextInputValue('tmpl_end') || '').trim();
        const startIn = (i.fields.getTextInputValue('tmpl_start') || '').trim();
        const foremanIn = (i.fields.getTextInputValue('tmpl_foreman') || '').trim();
        const timeIn = (i.fields.getTextInputValue('tmpl_time') || '').trim();

        const updates = {};
        if (startIn) updates.start_date = startIn;
        if (/^\d{1,2}:\d{2}$/.test(timeIn)) updates.reminder_time = timeIn;

        if (foremanIn) {
          const uidMatch = foremanIn.match(/\d{15,20}/);
          if (uidMatch) {
            const uid = uidMatch[0];
            try {
              const member = await i.guild.members.fetch(uid).catch(() => null);
              const roleId = process.env.MLB_FOREMEN_ROLE_ID || process.env.FOREMAN_ROLE_ID;
              if (roleId && member && !member.roles.cache.has(roleId)) {
                try { await i.followUp({ content: 'Note: foreman not set — selected user lacks the Foreman role.', ephemeral: true }); } catch {}
              } else {
                updates.foreman_user_id = uid;
                updates.foreman_display = (member?.displayName || member?.user?.username || uid);
              }
            } catch { /* ignore fetch error */ }
          }
        }

        if (Object.keys(updates).length) {
          await store.updateProjectFields(pid, updates);
        }

        if (body.length === 0 && end.length === 0) {
          await templates.clearTemplateForProject(pid);
          await i.reply({ content: 'Template fields saved. No template text provided — cleared existing template.', ephemeral: true });
        } else {
          await templates.setTemplateForProject(pid, { body, end });
          await i.reply({ content: 'Template and fields saved.', ephemeral: true });
        }
        return;
      }

      // --- Set Status button -> select menu ---
      if (i.isButton() && i.customId.startsWith('panel:status:')) {
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

      // --- Handle status select ---
      if (i.isStringSelectMenu() && i.customId.startsWith('status:set:')) {
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
          },
        }).catch(() => {});

        try {
          if (status === STATUS.COMPLETE_NO_GOBACKS) {
            await postExecutiveCompletionSummary(i.client, pid).catch(() => {});
          }
        } catch { /* ignore */ }

        return i.reply({ content: 'Status updated.', ephemeral: true });
      }

    } catch (err) {
      console.error('interaction error', err);
      try {
        if (!i.replied && !i.deferred) {
          await i.reply({ content: 'There was an error handling that action. Please try again.', ephemeral: true });
        } else {
          await i.editReply({ content: 'There was an error handling that action. Please try again.' });
        }
      } catch { /* ignore */ }
    }
  });
}
