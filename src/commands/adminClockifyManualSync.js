// src/commands/adminClockifyManualSync.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import * as store from '../db/store.js';
import { syncProjectToClockify, archiveClockifyProject, isClockifyConfigured } from '../services/clockify.js';
import { STATUS } from '../constants/status.js';

export const data = new SlashCommandBuilder()
  .setName('clockify-sync')
  .setDescription('Manually sync Discord projects to Clockify')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(option =>
    option
      .setName('mode')
      .setDescription('Sync mode')
      .setRequired(true)
      .addChoices(
        { name: 'Sync All Projects', value: 'sync_all' },
        { name: 'Sync Current Thread', value: 'sync_current' },
        { name: 'Show Status', value: 'status' }
      )
  );

export async function execute(interaction) {
  const mode = interaction.options.getString('mode');

  if (!isClockifyConfigured()) {
    return interaction.reply({
      content: 'Clockify is not configured. Please set CLOCKIFY_API_KEY and CLOCKIFY_WORKSPACE_ID in .env file.',
      ephemeral: true,
    });
  }

  if (mode === 'status') {
    // Show sync status
    const allProjects = await store.getAllProjects();
    const synced = allProjects.filter(p => p.clockify_project_id);
    const unsynced = allProjects.filter(p => !p.clockify_project_id);

    const statusMessage = [
      `**Clockify Sync Status**`,
      ``,
      `Total Projects: ${allProjects.length}`,
      `Synced to Clockify: ${synced.length}`,
      `Not Synced: ${unsynced.length}`,
      ``,
      unsynced.length > 0 ? `**Unsynced Projects:**` : '',
      ...unsynced.slice(0, 10).map(p => `• ${p.name} (ID: ${p.id})`),
      unsynced.length > 10 ? `... and ${unsynced.length - 10} more` : '',
    ].filter(Boolean).join('\n');

    return interaction.reply({ content: statusMessage, ephemeral: true });
  }

  if (mode === 'sync_current') {
    // Sync current thread only
    const threadId = interaction.channelId;
    const project = await store.getProjectByThread(threadId);

    if (!project) {
      return interaction.reply({
        content: 'This thread is not tracked as a project.',
        ephemeral: true,
      });
    }

    if (project.clockify_project_id) {
      return interaction.reply({
        content: `This project is already synced to Clockify (Project ID: ${project.clockify_project_id})`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const { projectId, isDuplicate } = await syncProjectToClockify(project);
      await store.updateProjectFields(project.id, { clockify_project_id: projectId });

      // Archive if status is complete
      if (project.status === STATUS.COMPLETE_NO_GOBACKS) {
        await archiveClockifyProject(projectId);
      }

      let message = `Successfully synced "${project.name}" to Clockify!\nClockify Project ID: ${projectId}`;
      if (isDuplicate) {
        message += `\n\n⚠️ Warning: A project with this name already existed in Clockify.`;
      }

      return interaction.editReply({ content: message });
    } catch (error) {
      console.error('[clockify] Manual sync error:', error);
      return interaction.editReply({
        content: `Failed to sync project: ${error.message || 'Unknown error'}`,
      });
    }
  }

  if (mode === 'sync_all') {
    // Sync all unsynced projects
    await interaction.deferReply({ ephemeral: true });

    const allProjects = await store.getAllProjects();
    const unsynced = allProjects.filter(p => !p.clockify_project_id);

    if (unsynced.length === 0) {
      return interaction.editReply({ content: 'All projects are already synced to Clockify!' });
    }

    const results = {
      success: [],
      failed: [],
      duplicates: [],
    };

    for (const project of unsynced) {
      try {
        const { projectId, isDuplicate } = await syncProjectToClockify(project);
        await store.updateProjectFields(project.id, { clockify_project_id: projectId });

        // Archive if status is complete
        if (project.status === STATUS.COMPLETE_NO_GOBACKS) {
          await archiveClockifyProject(projectId);
        }

        results.success.push(project.name);
        if (isDuplicate) {
          results.duplicates.push(project.name);
        }
      } catch (error) {
        console.error(`[clockify] Failed to sync project ${project.name}:`, error);
        results.failed.push(`${project.name}: ${error.message}`);
      }
    }

    const summary = [
      `**Clockify Bulk Sync Complete**`,
      ``,
      `✅ Successfully synced: ${results.success.length}`,
      `❌ Failed: ${results.failed.length}`,
      results.duplicates.length > 0 ? `⚠️ Duplicates detected: ${results.duplicates.length}` : '',
      ``,
      results.failed.length > 0 ? `**Failed Projects:**` : '',
      ...results.failed.map(f => `• ${f}`),
      ``,
      results.duplicates.length > 0 ? `**Duplicate Names (created anyway):**` : '',
      ...results.duplicates.map(d => `• ${d}`),
    ].filter(Boolean).join('\n');

    return interaction.editReply({ content: summary });
  }
}
