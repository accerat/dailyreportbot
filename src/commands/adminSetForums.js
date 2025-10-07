import { SlashCommandBuilder, ChannelType } from 'discord.js';
import { saveSettings, getSettings } from '../db/store.js';

export const data = new SlashCommandBuilder()
  .setName('admin-set-forums')
  .setDescription('[Admin] Set the project forums once (Non-UHC and UHC)')
  .addChannelOption(o =>
    o.setName('non_uhc_forum')
     .setDescription('Forum for standard projects')
     .addChannelTypes(ChannelType.GuildForum)
     .setRequired(true)
  )
  .addChannelOption(o =>
    o.setName('uhc_forum')
     .setDescription('Forum for UHC projects')
     .addChannelTypes(ChannelType.GuildForum)
     .setRequired(true)
  );

export async function execute(i) {
  if (!isAdmin(i)) return;
  await i.deferReply({ flags: 64 });
  const non = i.options.getChannel('non_uhc_forum', true);
  const uhc = i.options.getChannel('uhc_forum', true);

  await saveSettings({ non_uhc_forum_id: non.id, uhc_forum_id: uhc.id });
  const s = await getSettings();
  await i.editReply(
    `Forums saved.\n• Non-UHC: ${non.name} (${s.non_uhc_forum_id})\n• UHC: ${uhc.name} (${s.uhc_forum_id})`
  );
}

function isAdmin(i) {
  const allowed = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean);
  if (allowed.includes(i.user.id)) return true;
  if (i.memberPermissions?.has('Administrator')) return true;
  i.reply({ content: 'Admins only.', flags: 64 }); return false;
}
