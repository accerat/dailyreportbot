import { SlashCommandBuilder, ChannelType } from 'discord.js';
import { saveSettings, getSettings } from '../db/store.js';

export const data = new SlashCommandBuilder()
  .setName('admin-set-project-category')
  .setDescription('[Admin] Set the ONE parent category that contains your project forums')
  .addChannelOption(o =>
    o.setName('category')
     .setDescription('The parent category (e.g., Project Discussions)')
     .addChannelTypes(ChannelType.GuildCategory)
     .setRequired(true)
  );

export async function execute(i) {
  if (!isAdmin(i)) return;
  await i.deferReply({ flags: 64 });

  const cat = i.options.getChannel('category', true);

  await saveSettings({
    project_category_id: cat.id
  });

  const s = await getSettings();
  await i.editReply(`Project category saved: ${cat.name} (${s.project_category_id})`);
}

function isAdmin(i) {
  const allowed = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean);
  if (allowed.includes(i.user.id)) return true;
  if (i.memberPermissions?.has('Administrator')) return true;
  i.reply({ content: 'Admins only.', flags: 64 }); return false;
}
