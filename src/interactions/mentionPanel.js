/* src/interactions/mentionPanel.js */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType
} from 'discord.js';
import * as store from '../db/store.js';

const TAG = '[mentionPanel]';
const log = (...a) => console.log(TAG, ...a);

// --- Helpers ---
function parseScopeLines(text){
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const scopes = [];
  for (let line of lines){
    let s = String(line).trim();
    if (!s) continue;
    // Strip leading list marker: "1)", "1.", "1️⃣", "-", "•"
    s = s.replace(/^(?:\d+\s*[\)\.]|[\u0030-\u0039]\uFE0F?\u20E3|\s*[•-])\s*/u, '');
    // Keep only the scope label (before status like " - 50%")
    const idx = s.indexOf(' - ');
    if (idx !== -1) s = s.slice(0, idx).trim();
    if (s) scopes.push(s);
  }
  return scopes;
}

async function fetchFirstPostContent(thread){
  try{
    if (typeof thread.fetchStarterMessage === 'function'){
      const starter = await thread.fetchStarterMessage();
      if (starter && starter.content) return starter.content;
    }
  }catch(e){
    log('fetchStarterMessage error', e?.message);
  }
  try{
    const msgs = await thread.messages.fetch({ limit: 10 });
    const oldest = [...msgs.values()].sort((a,b)=>a.createdTimestamp-b.createdTimestamp)[0];
    return oldest?.content || '';
  }catch(e){
    log('messages.fetch error', e?.message);
  }
  return '';
}

// Auto-join threads so we receive messageCreate events in Forum/Public/Private threads
async function ensureInThread(thread){
  try{
    if (!thread?.isThread()) return;
    // In discord.js v14, .join() resolves even if already joined
    await thread.join();
  }catch(e){
    log('thread.join error', e?.message);
  }
}

// --- Panel row builder ---
export function buildPanelRow(project){
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dr:open:${project.id}`).setLabel('Open Daily Report').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`dr:settpl:${project.id}`).setLabel('Set Template').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dr:reftpl:${project.id}`).setLabel('Refresh Template').setStyle(ButtonStyle.Secondary)
  );
  return row;
}

// --- Wire interactions, thread joining, and mention responder ---
export function wireMentionPanel(client){
  // On ready: join active threads across all guilds (forums create threads-as-posts)
  client.on('ready', async () => {
    try{
      for (const [gid, guild] of client.guilds.cache){
        // Join active threads in this guild
        const list = await guild.channels.fetchActiveThreads().catch(()=>null);
        const threads = list?.threads || [];
        for (const [tid, th] of threads){
          await ensureInThread(th);
        }
      }
      log('joined active threads');
    }catch(e){
      log('ready/join threads error', e?.message);
    }
  });

  // Join new threads as they are created (esp. Forum posts)
  client.on('threadCreate', async (thread) => {
    await ensureInThread(thread);
    log('threadCreate joined', thread?.id, 'parent=', thread?.parentId);
  });

  // Buttons / modal
  client.on('interactionCreate', async (i) => {
    try{
      if (i.isButton()){
        const cid = i.customId || '';
        log('button', cid, 'in', i.channel?.id);
        if (cid.startsWith('dr:settpl:')){
          const thread = i.channel;
          await ensureInThread(thread);
          const content = await fetchFirstPostContent(thread);
          const scopes = parseScopeLines(content);
          if (!scopes.length){
            return i.reply({ content: 'Could not find scope lines in the first post. Each scope should be on its own line (e.g., "1) CMU - 106A (Return Storage)").', flags: 64 });
          }
          await store.setThreadTemplate(thread.id, scopes, { updatedBy: i.user.id });
          return i.reply({ content: `✅ Saved ${scopes.length} scope lines for this thread.`, flags: 64 });
        }
        if (cid.startsWith('dr:reftpl:')){
          const thread = i.channel;
          await ensureInThread(thread);
          const content = await fetchFirstPostContent(thread);
          const scopes = parseScopeLines(content);
          if (!scopes.length){
            return i.reply({ content: 'Could not find scope lines in the first post to refresh.', flags: 64 });
          }
          await store.setThreadTemplate(thread.id, scopes, { updatedBy: i.user.id });
          return i.reply({ content: `🔄 Template refreshed with ${scopes.length} scope lines.`, flags: 64 });
        }
        if (cid.startsWith('dr:open:')){
          await showReportModal(i);
          return;
        }
      }
      if (i.isModalSubmit() && i.customId.startsWith('dr:submit:')){
        log('modal submit', i.customId);
        return;
      }
    }catch(e){
      console.error(e);
      try{ await i.reply({ content: 'Error handling interaction.', flags: 64 }); }catch{}
    }
  });

  // Mention responder with rich logging
  client.on('messageCreate', async (m) => {
    try{
      const ch = m.channel;
      const t = ch?.type;
      const isThread = !!ch?.isThread?.();
      const parentType = ch?.parent?.type;
      log('msg', `t=${t} isThread=${isThread} parent=${parentType} guild=${m.guild?.id} ch=${ch?.id}`);
      if (m.author?.bot) return;
      if (isThread) await ensureInThread(ch);
      if (m.mentions?.has?.(m.client.user)) {
        await m.reply('✅ DailyReportBot is online.\nUse **Set Template / Refresh Template** in the panel, then **Open Daily Report**.');
        log('mention reply sent');
      }
    }catch(e){ console.error(e); }
  });

  log('wired');
}

// Build & show the Daily Report modal with prefilled Daily Summary
async function showReportModal(interaction){
  const projectId = (interaction.customId || '').split(':')[2] || 'unknown';

  let prefill = '';
  try{
    const tpl = await store.getThreadTemplate(interaction.channel.id);
    if (tpl && Array.isArray(tpl.scopes) && tpl.scopes.length){
      prefill = tpl.scopes.map((s, idx)=>`${idx+1}) ${s} - `).join('\\n');
    }
  }catch(e){
    log('prefill error', e?.message);
  }

  const modal = new ModalBuilder()
    .setCustomId(`dr:submit:${projectId}`)
    .setTitle(`Daily Report — ${projectId}`);

  const synopsis = new TextInputBuilder()
    .setCustomId('synopsis')
    .setLabel('Daily Summary')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setValue(prefill || '');

  const row = new ActionRowBuilder().addComponents(synopsis);
  await interaction.showModal(modal.addComponents(row));
  log('modal shown');
}

// Compatibility export
export const wireInteractions = wireMentionPanel;
export default { wireMentionPanel, buildPanelRow, wireInteractions };