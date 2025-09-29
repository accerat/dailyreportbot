/* src/interactions/mentionPanel.js */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
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
    // Strip leading list markers: "1)", "1.", "1??", "-", "•"
    s = s.replace(/^(?:\d+\s*[\)\.]|[\u0030-\u0039]\uFE0F?\u20E3|\s*[•-])\s*/u, '');
    // Keep only the scope label (before " - status" if present)
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
      if (starter?.content) return starter.content;
    }
  }catch(e){ log('fetchStarterMessage error', e?.message); }
  try{
    const msgs = await thread.messages.fetch({ limit: 10 });
    const oldest = [...msgs.values()].sort((a,b)=>a.createdTimestamp-b.createdTimestamp)[0];
    return oldest?.content || '';
  }catch(e){ log('messages.fetch error', e?.message); }
  return '';
}

async function ensureInThread(thread){
  try{
    if (!thread?.isThread?.()) return;
    await thread.join(); // no-op if already joined
  }catch(e){ log('thread.join error', e?.message); }
}

// --- Panel row builder (kept for callers that compose UI here) ---
export function buildPanelRow(project){
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dr:open:${project.id}`).setLabel('Open Daily Report').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`dr:settpl:${project.id}`).setLabel('Set Template').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dr:reftpl:${project.id}`).setLabel('Refresh Template').setStyle(ButtonStyle.Secondary)
  );
  return row;
}

// --- Wire interactions, thread joining, mention responder ---
export function wireMentionPanel(client){
  // Join active threads on ready (Forums = threads)
  client.on('ready', async () => {
    try{
      for (const [, guild] of client.guilds.cache){
        const list = await guild.channels.fetchActiveThreads().catch(()=>null);
        const threads = list?.threads || [];
        for (const [, th] of threads) await ensureInThread(th);
      }
      log('joined active threads');
    }catch(e){ log('ready/join threads error', e?.message); }
  });

  // Auto-join new threads/posts
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
            return i.reply({ content: 'Could not find scope lines in the first post. Put each scope on its own line (e.g., "1) CMU - 106A (Return Storage)").', flags: 64 });
          }
          await store.setThreadTemplate(thread.id, scopes, { updatedBy: i.user.id });
          return i.reply({ content: `? Saved ${scopes.length} scope lines for this thread.`, flags: 64 });
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
          return i.reply({ content: `?? Template refreshed with ${scopes.length} scope lines.`, flags: 64 });
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

  // Mention responder (works in threads once joined)
  client.on('messageCreate', async (m) => {
    try{
      const ch = m.channel;
      const isThread = !!ch?.isThread?.();
      log('msg isThread=' + isThread, 'guild=' + (m.guild?.id||'n/a'), 'ch=' + (ch?.id||'n/a'));
      if (m.author?.bot) return;
      if (isThread) await ensureInThread(ch);
      if (m.mentions?.has?.(m.client.user)) {
        await m.reply('? DailyReportBot is online.\nUse **Set Template / Refresh Template** in the panel, then **Open Daily Report**.');
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
    if (tpl?.scopes?.length){
      prefill = tpl.scopes.map((s, idx)=>`${idx+1}) ${s} - `).join('\n');
    }
  }catch(e){ log('prefill error', e?.message); }

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

// Compatibility export for index.js
export const wireInteractions = wireMentionPanel;
export default { wireMentionPanel, buildPanelRow, wireInteractions };