import { SlashCommandBuilder } from 'discord.js';
import { postDailySummaryAll } from '../services/summary.js';

export const data = new SlashCommandBuilder()
  .setName('admin-summary-now')
  .setDescription('[Admin] Post the daily summary now');

export async function execute(i){
  if(!isAdmin(i)) return;
  await i.deferReply({ephemeral:true});
  const c = await postDailySummaryAll();
  return i.editReply(`Posted daily summary with ${c} project(s).`);
}

function isAdmin(i){
  const allowed=(process.env.ADMIN_USER_IDS||'').split(',').filter(Boolean);
  if(allowed.includes(i.user.id)) return true;
  if(i.memberPermissions?.has('Administrator')) return true;
  i.reply({content:'Admins only.', ephemeral:true});
  return false;
}
