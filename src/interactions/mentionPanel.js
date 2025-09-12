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
} from 'discord.js';
import { DateTime } from 'luxon';
import * as store from '../db/store.js';
import { postWeatherHazardsIfNeeded } from '../services/weather.js';
import { STATUS, STATUS_LABEL, normalizeStatus } from '../constants/status.js';

const TZ = process.env.TIMEZONE || 'America/Chicago';

function buildProjectPanelEmbed(project){
  const statusKey = normalizeStatus(project.status);
  const statusLabel = STATUS_LABEL[statusKey] || 'Started';
  const foreman = project.foreman_display || '—';
  const start = project.start_date || '—';
  const reminder = project.reminder_time || '—';
  const completion = project.completion_date || '—';

  const embed = new EmbedBuilder()
    .setTitle(`Project Panel — ${project.name}`)
    .addFields(
      { name: 'Status', value: statusLabel, inline: true },
      { name: 'Foreman', value: String(foreman), inline: true },
      { name: 'Start', value: String(start), inline: true },
      { name: 'Reminder Time', value: String(reminder), inline: true },
    );

  if (project.thread_channel_id){
    embed.addFields({ name: 'Thread', value: `<#${project.thread_channel_id}>`, inline: true });
  }
  if (project.completion_date){
    embed.addFields({ name: 'Anticipated End', value: String(completion), inline: true });
  }
  return embed;
}

function rowMain(project){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dr:open:${project.id}`).setLabel('Open Daily Report').setStyle(ButtonStyle.Primary),
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
      start_date: DateTime.now().setZone(TZ).toISODate(),
      status: STATUS.STARTED,
      reminder_time: '19:00',
    });
  }
  return p;
}

function showReportModal(interaction, project){
  const modal = new ModalBuilder()
    .setCustomId(`dr:submit:${project.id}`)
    .setTitle(`Daily Report — ${project.name}`);

  // IMPORTANT: Discord modals may contain at most 5 ActionRow components.
  // We keep the original 5 here to restore stability. We'll add "Anticipated End Date"
  // in a follow-up revision without exceeding the limit.
  const synopsis = new TextInputBuilder()
    .setCustomId('synopsis')
    .setLabel('Synopsis (add Blockers: / Plan:)')
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
    .setLabel('Man-hours today')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const health = new TextInputBuilder()
    .setCustomId('health')
    .setLabel('Health score 1–5')
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
        const pct = Math.max(0, Math.min(100, Number(i.fields.getTextInputValue('pct') || '0')));
        const guys = Math.max(0, Number(i.fields.getTextInputValue('guys') || '0'));
        const hours = Math.max(0, Number(i.fields.getTextInputValue('hours') || '0'));
        const health = Math.max(0, Math.min(5, Number(i.fields.getTextInputValue('health') || '0')));
        const { blockers, plan } = parseFromSynopsis(synopsis || '');

        const now = DateTime.now().setZone(TZ);
        const report = {
          project_id: project.id,
          author_user_id: i.user.id,
          message_id: null,
          created_at: now.toISO(),
          created_date: now.toISODate(),
          percent_complete: Number.isFinite(pct) ? pct : null,
          man_count: Number.isFinite(guys) ? guys : null,
          man_hours: Number.isFinite(hours) ? hours : null,
          health_score: Number.isFinite(health) ? health : null,
          synopsis: synopsis || null,
        };

        await store.insertDailyReport(report);

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

        const thread = await i.client.channels.fetch(project.thread_channel_id);
        await thread.send({ embeds: [embed] });

        await postWeatherHazardsIfNeeded({
          client: i.client,
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

      // Foreman/status handlers left untouched (they were not part of the failure)
      if (i.isButton() && i.customId.startsWith('panel:foreman:')){
        return i.reply({ content: 'Use your existing change-foreman flow.', ephemeral: true });
      }
      if (i.isButton() && i.customId.startsWith('panel:status:')){
        return i.reply({ content: 'Use your existing set-status flow.', ephemeral: true });
      }
    }catch(e){
      console.error(e);
      try{
        await i.reply({ content: 'This interaction failed. Please try again.', ephemeral: true });
      }catch{}
    }
  });
}

export async function showPanelMessage(msg, project){
  return showPanel(msg, project);
}
