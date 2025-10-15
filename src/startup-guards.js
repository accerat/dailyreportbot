process.on('unhandledRejection', (reason) => {
  try { console.error('[unhandledRejection]', reason); } catch {}
});
process.on('uncaughtException', (err) => {
  try { console.error('[uncaughtException]', err); } catch {}
});

// Env presence (true/false only)
console.log('[env] APP_ID set:', !!process.env.APP_ID);
console.log('[env] BOT_TOKEN set:', !!process.env.BOT_TOKEN);
console.log('[env] PROJECT_DAILY_SUMMARIES_FORUM_ID set:', !!process.env.PROJECT_DAILY_SUMMARIES_FORUM_ID);
console.log('[env] EXEC_SUMMARY_CHANNEL_ID set:', !!process.env.EXEC_SUMMARY_CHANNEL_ID);
console.log('[env] CLOCKIFY_API_KEY set:', !!process.env.CLOCKIFY_API_KEY);
console.log('[env] CLOCKIFY_WORKSPACE_ID set:', !!process.env.CLOCKIFY_WORKSPACE_ID);

// Validate Clockify configuration
export async function validateClockifyConfig(client) {
  const hasApiKey = !!process.env.CLOCKIFY_API_KEY;
  const hasWorkspaceId = !!process.env.CLOCKIFY_WORKSPACE_ID;

  if (!hasApiKey || !hasWorkspaceId) {
    const missing = [];
    if (!hasApiKey) missing.push('CLOCKIFY_API_KEY');
    if (!hasWorkspaceId) missing.push('CLOCKIFY_WORKSPACE_ID');

    console.error(`[clockify] Missing environment variables: ${missing.join(', ')}`);

    // Notify MLB Office role
    const officeRoleId = process.env.MLB_OFFICE_ROLE_ID;
    const execSummaryChannelId = process.env.EXEC_SUMMARY_CHANNEL_ID;

    if (officeRoleId && execSummaryChannelId) {
      try {
        const channel = await client.channels.fetch(execSummaryChannelId);
        if (channel && typeof channel.send === 'function') {
          await channel.send({
            content: `<@&${officeRoleId}> **Clockify Integration Warning**\n\nThe following environment variables are missing:\n${missing.map(v => `• \`${v}\``).join('\n')}\n\nClockify integration will be disabled until these are configured.`,
            allowedMentions: { parse: ['roles'] }
          });
        }
      } catch (error) {
        console.error('[clockify] Failed to send missing config notification:', error);
      }
    }

    return false;
  }

  console.log('[clockify] Configuration validated successfully');
  return true;
}
