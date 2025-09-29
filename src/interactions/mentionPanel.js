// src/interactions/mentionPanel.js
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';
import * as store from '../db/store.js';

function log(...a){ console.log('[mentionPanel]', ...a); }

function parseScopeLines(text){
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const scopes = [];
  for (let line of lines){
    let s = String(line).trim();
    if (!s) continue;
    s = s.replace(/^(?:\d+\s*[\)\.]|[\u0030-\u0039]\uFE0F?\u20E3|\s*[•-])\s*/u, '');
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
  }catch{}
  try{
    const msgs = await thread.messages.fetch({ limit: 10 });
    const oldest = [...msgs.values()].sort((a,b)=>a.createdTimestamp-b.createdTimestamp)[0];
    return oldest?.content || '';
  }catch{}
  return '';
}

export function buildPanelRow(project){
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dr:open:${project.id}`).setLabel('Open Daily Report').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`dr:settpl:${project.id}`).setLabel('Set Template').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dr:reftpl:${project.id}`).setLabel('Refresh Template').setStyle(ButtonStyle.Secondary)
  );
  return row;
}

export function wireMentionPanel(client){
  client.on('interactionCreate', async (i) => {
    try{
      if (i.isButton()){
        const cid = i.customId || '';
        if (cid.startsWith('dr:settpl:')){
          const thread = i.channel;
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
        return;
      }
    }catch(e){
      console.error(e);
      try{ await i.reply({ content: 'Error handling interaction.', flags: 64 }); }catch{}
    }
  });
  log('wired');
}

async function showReportModal(interaction){
  const projectId = (interaction.customId || '').split(':')[2] || 'unknown';

  let prefill = '';
  try{
    const tpl = await store.getThreadTemplate(interaction.channel.id);
    if (tpl && Array.isArray(tpl.scopes) && tpl.scopes.length){
      prefill = tpl.scopes.map((s, idx)=>`${idx+1}) ${s} - `).join('\n');
    }
  }catch{}

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
  log('modal rows = 5');
}

export const wireInteractions = wireMentionPanel;
export default { wireMentionPanel, wireInteractions, buildPanelRow };