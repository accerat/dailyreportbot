// src/commands/adminOfficeAlertsNow.js
import { DateTime } from 'luxon';
import * as store from '../db/store.js';
import { normalizeStatus, STATUS } from '../constants/status.js';

const MLB_OFFICE_CHANNEL_ID = '1397271405606998036';
const CT = 'America/Chicago';

export const data = {
  name: 'admin-office-alerts-now',
  description: '[ADMIN] Run office alerts check immediately',
};

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const ctx = await store.load();
    const projects = ctx.projects || [];
    const todayISO = DateTime.now().setZone(CT).toISODate();

    const missingDataIssues = [];
    const wrongStatusReports = [];

    // Check each project
    for (const p of projects) {
      const statusKey = normalizeStatus(p.status);

      // Issue 1: Project is "In Progress" but missing foreman or anticipated end
      if (statusKey === STATUS.IN_PROGRESS) {
        const missingFields = [];
        if (!p.foreman_display && !p.foreman_user_id) {
          missingFields.push('foreman');
        }
        if (!p.anticipated_end && !p.completion_date) {
          missingFields.push('anticipated end date');
        }

        if (missingFields.length > 0) {
          missingDataIssues.push({
            name: p.name,
            missing: missingFields.join(' and ')
          });
        }
      }

      // Issue 2: Daily report submitted for project NOT "In Progress"
      if (statusKey !== STATUS.IN_PROGRESS) {
        // Check if there's a report for today
        const todayReport = (ctx.daily_reports || []).find(
          r => r.project_id === p.id && r.report_date === todayISO
        );

        if (todayReport) {
          wrongStatusReports.push({
            name: p.name,
            status: p.status || 'Unknown'
          });
        }
      }
    }

    // Send alerts if there are issues
    if (missingDataIssues.length > 0 || wrongStatusReports.length > 0) {
      const channel = await interaction.client.channels.fetch(MLB_OFFICE_CHANNEL_ID);

      let message = '⚠️ **Daily Project Alerts** ⚠️\n\n';

      if (missingDataIssues.length > 0) {
        message += '**Projects "In Progress" missing critical data:**\n';
        missingDataIssues.forEach(issue => {
          message += `• ${issue.name} — Missing: ${issue.missing}\n`;
        });
        message += '\n';
      }

      if (wrongStatusReports.length > 0) {
        message += '**Daily reports submitted for projects NOT "In Progress":**\n';
        wrongStatusReports.forEach(issue => {
          message += `• ${issue.name} — Status: ${issue.status}\n`;
        });
      }

      await channel.send({ content: message, allowedMentions: { parse: [] } });

      await interaction.editReply({
        content: `Office alerts posted! Found ${missingDataIssues.length} missing data issue(s) and ${wrongStatusReports.length} wrong status report(s).`
      });
    } else {
      await interaction.editReply({
        content: 'No issues found - all projects look good!'
      });
    }
  } catch (err) {
    console.error('[admin-office-alerts-now] failed:', err);
    await interaction.editReply({ content: `Error: ${err.message}` });
  }
}
