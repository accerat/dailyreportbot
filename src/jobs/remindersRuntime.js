import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DateTime } from 'luxon';
import * as store from '../db/store.js';
import { STATUS } from '../constants/status.js';

const MLB_OFFICE_ROLE_ID = process.env.MLB_OFFICE_ROLE_ID || '1396930700447449149';

export async function runReminderPass(onlyProjectId=null){
  const now=DateTime.now().setZone('America/Chicago'); const hour=now.hour; const today=now.toISODate();
  const targets=await store.projectsNeedingReminder(hour, today);
  const rows=onlyProjectId?targets.filter(p=>p.id===onlyProjectId):targets;
  let attempts=0;
  for(const p of rows){
    const __status = String(p.status||"").toLowerCase().replace(/[\s\-]/g, '_');
    if (__status !== STATUS.IN_PROGRESS && __status !== STATUS.STARTED) { continue; }
    attempts++;

    // Send DM reminder to foreman
    try{
      const user=await global.client.users.fetch(p.foreman_user_id);
      const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`rem:dismiss:${p.id}`).setLabel('DISMISS').setStyle(ButtonStyle.Secondary));
      await user.send({ content:`⏰ Daily Report Reminder — **${p.name}**\nWe don't have today's report (CT ${today}). You can **DISMISS** this message to hide it.`, components:[row]});
      await store.logReminder(p.id, today, hour);
    }catch{}

    // Check for 48-hour escalation
    try{
      const lastReportDate = p.last_report_date;
      if (lastReportDate) {
        const lastReport = DateTime.fromISO(lastReportDate, {zone: 'America/Chicago'});
        const hoursSince = now.diff(lastReport, 'hours').hours;

        // If more than 48 hours since last report, escalate to MLB Office
        if (hoursSince >= 48) {
          const shouldEscalate = await store.shouldEscalate(p.id, today);
          if (shouldEscalate && p.thread_channel_id) {
            const thread = await global.client.channels.fetch(p.thread_channel_id);
            await thread.send({
              content: `🚨 **ESCALATION** 🚨\n<@&${MLB_OFFICE_ROLE_ID}>\n\nNo daily report submitted for **${p.name}** in over 48 hours.\nLast report: ${lastReportDate}\nForeman: ${p.foreman_display || 'Unknown'}`,
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
