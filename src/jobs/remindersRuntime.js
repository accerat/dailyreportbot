import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DateTime } from 'luxon';
import * as store from '../db/store.js';
import { STATUS } from '../constants/status.js';

const MLB_OFFICE_ROLE_ID = process.env.MLB_OFFICE_ROLE_ID || '1396930700447449149';
const GUILD_ID = process.env.GUILD_ID;

export async function runReminderPass(onlyProjectId=null){
  const now=DateTime.now().setZone('America/Chicago'); const hour=now.hour; const today=now.toISODate();
  const targets=await store.projectsNeedingReminder(hour, today);
  const rows=onlyProjectId?targets.filter(p=>p.id===onlyProjectId):targets;
  let attempts=0;
  for(const p of rows){
    const __status = String(p.status||"").toLowerCase().replace(/[\s\-]/g, '_');
    // Only send reminders for "In Progress" projects (not upcoming, complete, or leaving)
    if (__status !== STATUS.IN_PROGRESS && __status !== STATUS.UPCOMING) { continue; }
    attempts++;

    // Check if this is the pre-arrival day (start date = today and no pre_arrival_confirmed)
    const isPreArrivalDay = !p.pre_arrival_confirmed && p.start_date === today;

    // Send DM reminder to foreman
    try{
      const user=await global.client.users.fetch(p.foreman_user_id);

      // Row 1: Main action buttons
      const row1=new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(isPreArrivalDay ? `arrival:confirm:${p.id}` : `dr:open:${p.id}`)
          .setLabel(isPreArrivalDay ? 'Confirm Arrival' : 'Open Daily Report')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`panel:status:${p.id}`).setLabel('Set Status').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tmpl:set:${p.id}`).setLabel('Set Template').setStyle(ButtonStyle.Secondary)
      );

      // Row 2: Secondary buttons (Jump to Project + Dismiss)
      const row2=new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rem:dismiss:${p.id}`).setLabel('DISMISS').setStyle(ButtonStyle.Secondary)
      );

      // Add Jump to Project button if we have the thread channel
      if (p.thread_channel_id && GUILD_ID) {
        const jumpUrl = `https://discord.com/channels/${GUILD_ID}/${p.thread_channel_id}`;
        row2.addComponents(
          new ButtonBuilder().setURL(jumpUrl).setLabel('Jump to Project').setStyle(ButtonStyle.Link)
        );
      }

      const message = isPreArrivalDay
        ? `🚀 Pre-Arrival Confirmation — **${p.name}**\nToday is your start date (${today}). Please confirm you're arriving tonight.`
        : `⏰ Daily Report Reminder — **${p.name}**\nWe don't have today's report (CT ${today}).`;

      await user.send({
        content: message,
        components:[row1, row2]
      });
      await store.logReminder(p.id, today, hour);
    }catch{}

    // Check for escalations (4-hour and 48-hour)
    try{
      // Use last_report_datetime for accurate hour calculation, fallback to last_report_date for backwards compatibility
      const lastReportTimestamp = p.last_report_datetime || p.last_report_date;
      if (lastReportTimestamp) {
        const lastReport = DateTime.fromISO(lastReportTimestamp, {zone: 'America/Chicago'});
        const hoursSince = now.diff(lastReport, 'hours').hours;
        // Format as "10/08/2025 at 11:59 PM CT" for display
        const lastReportDisplay = lastReport.isValid
          ? lastReport.toFormat('MM/dd/yyyy') + ' at ' + lastReport.toFormat('h:mm a') + ' CT'
          : (p.last_report_date || lastReportTimestamp);

        // 4-hour escalation: First warning to MLB Office
        if (hoursSince >= 4 && hoursSince < 48) {
          const shouldEscalate4h = await store.shouldEscalate4Hour(p.id, today);
          if (shouldEscalate4h && p.thread_channel_id) {
            const thread = await global.client.channels.fetch(p.thread_channel_id);
            await thread.send({
              content: `⚠️ **ALERT** ⚠️\n<@&${MLB_OFFICE_ROLE_ID}>\n\nNo daily report submitted for **${p.name}** in over 4 hours.\nLast report: ${lastReportDisplay}\nForeman: ${p.foreman_display || 'Unknown'}`,
              allowedMentions: { roles: [MLB_OFFICE_ROLE_ID] }
            });
            await store.logEscalation4Hour(p.id, today);
          }
        }

        // 48-hour escalation: Critical alert to MLB Office
        if (hoursSince >= 48) {
          const shouldEscalate = await store.shouldEscalate(p.id, today);
          if (shouldEscalate && p.thread_channel_id) {
            const thread = await global.client.channels.fetch(p.thread_channel_id);
            await thread.send({
              content: `🚨 **ESCALATION** 🚨\n<@&${MLB_OFFICE_ROLE_ID}>\n\nNo daily report submitted for **${p.name}** in over 48 hours.\nLast report: ${lastReportDisplay}\nForeman: ${p.foreman_display || 'Unknown'}`,
              allowedMentions: { roles: [MLB_OFFICE_ROLE_ID] }
            });
            await store.logEscalation(p.id, today);
          }
        }
      }
    }catch(e){
      console.error('Escalation error for project', p.id, e);
    }
  }
  return attempts;
}
