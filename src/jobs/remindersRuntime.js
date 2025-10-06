
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DateTime } from 'luxon';
import * as store from '../db/store.js';
export async function runReminderPass(onlyProjectId=null){
  const now=DateTime.now().setZone('America/Chicago'); const hour=now.hour; const today=now.toISODate();
  const targets=await store.projectsNeedingReminder(hour, today);
  const rows=onlyProjectId?targets.filter(p=>p.id===onlyProjectId):targets;
  let attempts=0;
  for(const p of rows){
    const __status = String(p.status||"").toLowerCase(); if (__status !== "in-progress") { continue; } attempts++;
    try{
      const user=await global.client.users.fetch(p.foreman_user_id);
      const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`rem:dismiss:${p.id}`).setLabel('DISMISS').setStyle(ButtonStyle.Secondary));
      await user.send({ content:`â° Daily Report Reminder â€” **${p.name}**\nWe donâ€™t have todayâ€™s report (CT ${today}). You can **DISMISS** this message to hide it.`, components:[row]});
      await store.logReminder(p.id, today, hour);
    }catch{}
  }
  return attempts;
}

