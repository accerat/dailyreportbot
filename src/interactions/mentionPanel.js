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
import { syncProjectToClockify, archiveClockifyProject, unarchiveClockifyProject, isClockifyConfigured } from '../services/clockify.js';

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
  console.log(`[showPanel] CALLED - Project: ${project.id}, Foreman: ${project.foreman_display}, Time: ${project.reminder_time}`);
  const embed = buildProjectPanelEmbed(project);
  const row1 = rowMain(project);
  const rows = [row1].filter(r => r && r.components && r.components.length >= 1 && r.components.length <= 5);
  try{
    console.log(`[showPanel] Attempting msg.reply for project ${project.id}`);
    await msg.reply({ embeds: [embed], components: rows });
    console.log(`[showPanel] msg.reply SUCCESS for project ${project.id}`);
  }catch(e){
    console.log(`[showPanel] msg.reply FAILED, using channel.send for project ${project.id}:`, e.message);
    await msg.channel.send({ embeds: [embed], components: rows });
    console.log(`[showPanel] channel.send SUCCESS for project ${project.id}`);
  }
}

export function wireInteractions(client){
  client.on(Events.MessageCreate, async (msg) => {
    try{
      if (msg.author.bot) return;
      if (!msg.mentions.has(client.user)) return;
      const channel = msg.channel;
      console.log(`[mentionPanel] Mention received in thread: ${channel.id}`);
      if (!channel.isThread()) {
        return msg.reply({ content: 'Please mention me **inside a project thread**.' });
      }
      const project = await ensureProject(channel);
      console.log(`[mentionPanel] Project loaded: ID=${project.id}, Name=${project.name}, Foreman=${project.foreman_display}, Time=${project.reminder_time}`);
      await showPanel(msg, project);
      console.log(`[mentionPanel] Panel shown for project ID=${project.id}`);
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
        // Defer reply immediately to prevent interaction timeout (Discord requires response within 3s)
        await i.deferReply({ ephemeral: true });

        const pid = Number(i.customId.split(':').pop());
        const project = await store.getProjectById(pid);
        if (!project) return i.editReply({ content: 'Project not found.' });

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

        return i.editReply({ content: 'Report submitted.' });
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
  // Defer reply immediately to prevent interaction timeout (Discord requires response within 3s)
  await i.deferReply({ ephemeral: true });

  const pid = Number(i.customId.split(':').pop());
  const body = (i.fields.getTextInputValue('tmpl_body') || '').trim();
  const startRaw = (i.fields.getTextInputValue('tmpl_start') || '').trim();
  const endRaw = (i.fields.getTextInputValue('tmpl_end') || '').trim();
  const timeRaw = (i.fields.getTextInputValue('tmpl_time') || '').trim();
  const foremanRaw = (i.fields.getTextInputValue('tmpl_foreman') || '').trim();

  if (body.length === 0 && startRaw.length === 0 && endRaw.length === 0 && timeRaw.length === 0 && foremanRaw.length === 0){
    await templates.clearTemplateForProject(pid);
    return i.editReply({ content: 'Template cleared (empty).' });
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

    // If foreman is provided, try to extract user ID and fetch display name
    if (foremanRaw) {
      // Extract user ID from mention format <@123456> or plain ID 123456
      const userIdMatch = foremanRaw.match(/<@!?(\d+)>/) || foremanRaw.match(/^(\d+)$/);
      if (userIdMatch) {
        const userId = userIdMatch[1];
        try {
          const user = await i.client.users.fetch(userId);
          const member = await i.guild.members.fetch(userId).catch(() => null);
          updates.foreman_user_id = userId;
          updates.foreman_display = member?.displayName || user.username;
        } catch {
          // If fetch fails, just use the raw input
          updates.foreman_display = foremanRaw;
        }
      } else {
        // Not a user ID, just use as display name
        updates.foreman_display = foremanRaw;
      }
    }

    if (Object.keys(updates).length > 0) {
      await store.updateProjectFields(pid, updates);
    }

    return i.editReply({ content: 'Template saved.' });
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
        const oldProject = await store.getProjectById(pid);
        const oldStatus = oldProject?.status;

        await store.updateProjectFields(pid, { status });
        let project = await store.getProjectById(pid);
        const channel = await i.client.channels.fetch(project.thread_channel_id);

        // Clockify integration - sync project and manage archive status
        if (isClockifyConfigured()) {
          try {
            const clockifyMessages = [];

            // Create/sync Clockify project if it doesn't exist
            if (!project.clockify_project_id) {
              const { projectId, isDuplicate } = await syncProjectToClockify(project);
              await store.updateProjectFields(pid, { clockify_project_id: projectId });

              if (isDuplicate) {
                clockifyMessages.push(`📎 Clockify: Linked to existing project "${project.name}"`);
              } else {
                clockifyMessages.push(`✅ Clockify: Created new project "${project.name}"`);
              }

              // Re-fetch project to get the updated clockify_project_id
              project = await store.getProjectById(pid);
            }

            // Handle archive/unarchive based on status
            if (project.clockify_project_id) {
              try {
                if (status === STATUS.COMPLETE_NO_GOBACKS) {
                  // Archive when complete
                  await archiveClockifyProject(project.clockify_project_id);
                  clockifyMessages.push(`📦 Clockify: Archived project (status: complete)`);
                  console.log(`[clockify] Archived project ${project.clockify_project_id} for ${project.name}`);
                } else if (oldStatus === STATUS.COMPLETE_NO_GOBACKS && status !== STATUS.COMPLETE_NO_GOBACKS) {
                  // Unarchive when reopening from complete
                  await unarchiveClockifyProject(project.clockify_project_id);
                  clockifyMessages.push(`📂 Clockify: Unarchived project (status: ${STATUS_LABEL[status] || status})`);
                  console.log(`[clockify] Unarchived project ${project.clockify_project_id} for ${project.name}`);
                }
              } catch (archiveError) {
                // Handle workspace mismatch error - the stored project ID belongs to a different workspace
                if (archiveError.message && archiveError.message.includes('doesn\'t belong to Workspace')) {
                  console.error(`[clockify] Workspace mismatch for project ${project.clockify_project_id}, clearing and resyncing...`);

                  try {
                    // Clear the invalid project ID
                    await store.updateProjectFields(pid, { clockify_project_id: null });

                    // Update the in-memory project object so syncProjectToClockify doesn't see the old ID
                    project.clockify_project_id = null;

                    // Re-sync to create a new project in the correct workspace
                    const { projectId, isDuplicate } = await syncProjectToClockify(project);
                    await store.updateProjectFields(pid, { clockify_project_id: projectId });

                    clockifyMessages.push(`🔄 Clockify: Workspace mismatch detected - resynced project "${project.name}"`);

                    // Retry the archive/unarchive operation with the new project ID
                    if (status === STATUS.COMPLETE_NO_GOBACKS) {
                      await archiveClockifyProject(projectId);
                      clockifyMessages.push(`📦 Clockify: Archived project (status: complete)`);
                    }

                    // Recovery succeeded - don't re-throw the error
                    console.log(`[clockify] Successfully recovered from workspace mismatch for ${project.name}`);
                  } catch (recoveryError) {
                    console.error('[clockify] Recovery failed:', recoveryError);
                    // Re-throw the recovery error so outer catch can handle it
                    throw recoveryError;
                  }
                } else {
                  // Re-throw other errors
                  throw archiveError;
                }
              }
            }

            // Send all Clockify update messages to the channel
            if (clockifyMessages.length > 0 && channel) {
              try {
                await channel.send({
                  content: clockifyMessages.join('\n'),
                  allowedMentions: { parse: [] }
                });
              } catch (e) {
                console.error('[clockify] Failed to send status messages:', e);
              }
            }
          } catch (error) {
            console.error('[clockify] Error syncing project on status change:', error);

            // Notify MLB Office about the error
            const officeRoleId = process.env.MLB_OFFICE_ROLE_ID;
            if (officeRoleId && channel) {
              try {
                await channel.send({
                  content: `<@&${officeRoleId}> **Clockify Sync Error**\n\nFailed to sync project "${project.name}" to Clockify.\n\nError: ${error.message || 'Unknown error'}`,
                  allowedMentions: { parse: ['roles'] }
                });
              } catch (notifyError) {
                console.error('[clockify] Failed to send error notification:', notifyError);
              }
            }
          }
        }

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

      // Arrival confirmation button handler
      if (i.isButton() && i.customId.startsWith('arrival:confirm:')){
        const pid = Number(i.customId.split(':').pop());
        const project = await store.getProjectById(pid);
        if (!project) return i.reply({ content: 'Project not found.', ephemeral: true });

        const modal = new ModalBuilder()
          .setCustomId(`arrival:submit:${pid}`)
          .setTitle(`Pre-Arrival Confirmation`);

        const isNextProject = new TextInputBuilder()
          .setCustomId('is_next_project')
          .setLabel('Is this your next project? (yes/no)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('yes or no');

        const arrivingNextNight = new TextInputBuilder()
          .setCustomId('arriving_next_night')
          .setLabel('Will you arrive the next night? (yes/no)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('yes or no');

        const lodgingBooked = new TextInputBuilder()
          .setCustomId('lodging_booked')
          .setLabel('Have you booked lodging? (yes/no)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('yes or no');

        const explanation = new TextInputBuilder()
          .setCustomId('explanation')
          .setLabel('If any answer is "no", explain why:')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('Leave blank if all answers are yes');

        modal.addComponents(
          new ActionRowBuilder().addComponents(isNextProject),
          new ActionRowBuilder().addComponents(arrivingNextNight),
          new ActionRowBuilder().addComponents(lodgingBooked),
          new ActionRowBuilder().addComponents(explanation)
        );

        return i.showModal(modal);
      }

      // Arrival confirmation modal submission handler
      if (i.isModalSubmit() && i.customId.startsWith('arrival:submit:')){
        // Defer reply immediately to prevent interaction timeout (Discord requires response within 3s)
        await i.deferReply({ ephemeral: true });

        const pid = Number(i.customId.split(':').pop());
        const project = await store.getProjectById(pid);
        if (!project) return i.editReply({ content: 'Project not found.' });

        const isNextProject = (i.fields.getTextInputValue('is_next_project') || '').trim().toLowerCase();
        const arrivingNextNight = (i.fields.getTextInputValue('arriving_next_night') || '').trim().toLowerCase();
        const lodgingBooked = (i.fields.getTextInputValue('lodging_booked') || '').trim().toLowerCase();
        const explanation = (i.fields.getTextInputValue('explanation') || '').trim();

        const isNextYes = isNextProject.startsWith('y');
        const arrivingYes = arrivingNextNight.startsWith('y');
        const lodgingYes = lodgingBooked.startsWith('y');
        const allYes = isNextYes && arrivingYes && lodgingYes;

        const thread = await i.client.channels.fetch(project.thread_channel_id).catch(() => null);
        const now = DateTime.now().setZone(TZ);

        // Daily reports start 24 hours after the start date (not when they respond)
        const startDate = DateTime.fromISO(project.start_date, { zone: TZ });
        const dailyReportsStart = startDate.plus({ days: 1 }).toISODate();

        // Mark pre-arrival as confirmed and set daily reports to start tomorrow
        await store.updateProjectFields(pid, {
          pre_arrival_confirmed: true,
          daily_reports_start_date: dailyReportsStart
        });

        if (allYes) {
          // All confirmed - good to go
          const confirmEmbed = new EmbedBuilder()
            .setTitle('✅ Arrival Confirmed')
            .setDescription(`All pre-arrival requirements confirmed by ${i.member?.displayName || i.user.username}. Daily reports will start on ${dailyReportsStart}.`)
            .addFields(
              { name: 'Next Project', value: '✅ Yes', inline: true },
              { name: 'Arriving Tonight', value: '✅ Yes', inline: true },
              { name: 'Lodging Booked', value: '✅ Yes', inline: true }
            )
            .setColor(0x27ae60)
            .setTimestamp();

          if (thread) await thread.send({ embeds: [confirmEmbed] });

          return i.editReply({ content: `Arrival confirmed! Daily reports will start on ${dailyReportsStart}.` });
        } else {
          // Some answers are "no" - flag and notify office, but still confirmed
          const issues = [];
          if (!isNextYes) issues.push('❌ Not confirmed as next project');
          if (!arrivingYes) issues.push('❌ Not arriving tonight');
          if (!lodgingYes) issues.push('❌ Lodging not booked');

          const issueEmbed = new EmbedBuilder()
            .setTitle('⚠️ Pre-Arrival Issues Detected')
            .setDescription(`${i.member?.displayName || i.user.username} has reported issues with pre-arrival requirements. Daily reports will still start on ${dailyReportsStart}.`)
            .addFields(
              { name: 'Next Project', value: isNextYes ? '✅ Yes' : '❌ No', inline: true },
              { name: 'Arriving Tonight', value: arrivingYes ? '✅ Yes' : '❌ No', inline: true },
              { name: 'Lodging Booked', value: lodgingYes ? '✅ Yes' : '❌ No', inline: true },
              ...(explanation ? [{ name: 'Explanation', value: explanation, inline: false }] : [])
            )
            .setColor(0xe74c3c)
            .setTimestamp();

          // Log the event
          await store.logEvent({ project_id: pid, type: 'arrival_issues', author_user_id: i.user.id });

          // Store the issues in the project
          await store.updateProjectFields(pid, {
            arrival_issues: issues.join('; '),
            arrival_issues_explanation: explanation || null,
            arrival_issues_date: now.toISODate()
          });

          // Send to thread
          if (thread) await thread.send({ embeds: [issueEmbed] });

          // Notify MLB Office role
          const officeRoleId = process.env.MLB_OFFICE_ROLE_ID;
          if (officeRoleId && thread) {
            try {
              await thread.send({
                content: `<@&${officeRoleId}> Pre-arrival issues detected for **${project.name}**. Please review and take action.`,
                allowedMentions: { parse: ['roles'] }
              });
            } catch (e) {
              console.error('Failed to notify office role:', e);
            }
          }

          return i.editReply({ content: `Pre-arrival confirmation submitted with issues. The office has been notified. Daily reports will start on ${dailyReportsStart}.` });
        }
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
