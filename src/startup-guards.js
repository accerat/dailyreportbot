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
