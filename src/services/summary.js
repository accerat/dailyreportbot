// src/services/summary.js
import { DateTime } from 'luxon';
import * as store from '../db/store.js';

const CT = 'America/Chicago';

// Find or create the daily summary thread in your summaries forum
async function getOrCreateDailyThread(client) {
  const forumId = process.env.PROJECT_DAILY_SUMMARIES_FORUM_ID;
  if (!forumId) return null;

  const forumChannel = await client.channels.fetch(forumId);
  const today = DateTime.now().setZone(CT).toISODate();
  const threadName = `${today} — Project Daily Summary`;

  // Try to find an existing thread (active first, then archived)
  const active = await forumChannel.threads.fetchActive();
  let thread = active.threads.find(t => t.name === threadName);
  if (!thread) {
    try {
      const archived = await forumChannel.threads.fetchArchived();
      thread = archived.threads.find(t => t.name === threadName);
    } catch { /* ignore if perms not available */ }
  }

  // Create if not found
  if (!thread) {
    thread = await forumChannel.threads.create({
      name: threadName,
      message: { content: `📊 Daily project summary for **${today}** (CT).` }
    });
  }
  if (thread.archived) {
    await thread.setArchived(false).catch(() => {});
  }
  return { thread, today };
}

function labelForType(t) {
  return ({
    materials: 'Materials',
    uhc_materials: 'UHC Materials',
    lodging: 'Lodging',
    rfi: 'RFI',
    ccd: 'CCD',
    cor: 'COR',
  })[t] || t;
}

function pad(str, w) {
  return String(str ?? '').padEnd(w, ' ');
}

function truncate(str, max) {
  const s = String(str ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export async function postDailySummaryAll() {
  const now = DateTime.now().setZone(CT);
  const today = now.toISODate();

  const ctx = await store.load();                 // full JSON store
  const projects = await store.allSummaryProjects(); // keep selection logic as-is

  // Build one row per project (lifetime totals & flags)
  const rows = projects.map(p => {
    const reports = ctx.daily_reports.filter(r => r.project_id === p.id);
    const totalHrs = reports.reduce((t, r) => t + (+r.man_hours || 0), 0);
    const start = p.start_date || (reports[0]?.report_date) || '—';
    const anticipated = p.completion_date || '—';

    // Flags that happened at least once on the job (lifetime)
    const ever = Array.from(new Set(
      ctx.trigger_events.filter(e => e.project_id === p.id).map(e => labelForType(e.type))
    ));
    const flags = ever.length ? ever.join(', ') : '—';

    // NEW: include current status (default to 'open')
    const status = String(p.status || 'open').toLowerCase();

    return {
      name: p.name,
      status,
      start,
      anticipated,
      totalHrs,
      flags
    };
  });

  // Sort alphabetically by project name
  rows.sort((a, b) => a.name.localeCompare(b.name));

  // Compute column widths (with sane caps so it fits nicely)
  const headers = ['Project', 'Status', 'Start', 'Anticipated End', 'Total Hrs', 'Flags (ever)'];
  const maxName   = Math.min(Math.max(headers[0].length, ...rows.map(r => r.name.length)), 36);
  const maxStatus = Math.min(Math.max(headers[1].length, ...rows.map(r => String(r.status).length)), 12);
  const maxStart  = Math.max(headers[2].length, ...rows.map(r => String(r.start).length));
  const maxEnd    = Math.max(headers[3].length, ...rows.map(r => String(r.anticipated).length));
  const maxHrs    = Math.max(headers[4].length, ...rows.map(r => String(r.totalHrs).length));
  const maxFlags  = Math.min(Math.max(headers[5].length, ...rows.map(r => String(r.flags).length)), 50);

  const headerLine = [
    pad(headers[0], maxName),
    pad(headers[1], maxStatus),
    pad(headers[2], maxStart),
    pad(headers[3], maxEnd),
    pad(headers[4], maxHrs),
    pad(headers[5], maxFlags),
  ].join('  ');

  const sepLine = [
    '-'.repeat(maxName),
    '-'.repeat(maxStatus),
    '-'.repeat(maxStart),
    '-'.repeat(maxEnd),
    '-'.repeat(maxHrs),
    '-'.repeat(maxFlags),
  ].join('  ');

  const bodyLines = rows.map(r => {
    return [
      pad(truncate(r.name, maxName), maxName),
      pad(truncate(r.status, maxStatus), maxStatus),
      pad(r.start, maxStart),
      pad(r.anticipated, maxEnd),
      pad(String(r.totalHrs), maxHrs),
      pad(truncate(r.flags, maxFlags), maxFlags),
    ].join('  ');
  });

  const content = [
    `date: ${today}`,
    '',
    '```',
    headerLine,
    sepLine,
    ...bodyLines,
    '```'
  ].join('\n');

  const result = await getOrCreateDailyThread(global.client);
  if (!result) return 0;

  await result.thread.send({ content });
  return rows.length;
}

// Keep the single-project API for compatibility; it now posts the all-in-one thread
export async function postSummaryForProject(_projectId) {
  return postDailySummaryAll();
}
