/* src/commands/Project.js */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function buildPanelRow(project){
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dr:open:${project.id}`).setLabel('Open Daily Report').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`dr:settpl:${project.id}`).setLabel('Set Template').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dr:reftpl:${project.id}`).setLabel('Refresh Template').setStyle(ButtonStyle.Secondary)
  );
  return row;
}

export default { buildPanelRow };
