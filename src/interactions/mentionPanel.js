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
        { name: 'Foreman', value: submitterDisplay, inline: true },
  { name: 'Percent Complete', value: `${report.percent_complete ?? '—'}%`, inline: true },
  ...(report.completion_date ? [{ name: 'Anticipated End', value: String(report.completion_date), inline: true }] : []),
  { name: '# Guys', value: String(report.man_count ?? '—'), inline: true },
  { name: 'Man-hours', value: String(report.man_hours ?? '—'), inline: true },
  ...(report.health_score ? [{ name: 'Health Score', value: `${report.health_score} / 5`, inline: true }] : []),
  ...(blockers ? [{ name: 'Blockers', value: blockers, inline: false }] : []),
  ...(plan ? [{ name: 'Tomorrow’s Plan', value: plan, inline: false }] : [])
  ).setTimestamp();

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
