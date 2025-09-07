// src/services/summary.js
import { DateTime } from 'luxon';
import * as store from '../db/store.js';
import { STATUS_LABEL, normalizeStatus } from '../constants/status.js';

const CT = 'America/Chicago';

function truncate(str, n) {
  str = String(str ?? '');
  return str.length > n ? (str.slice(0, n-1) + '…') : str;
}
function pad(str, w) { return String(str ?? '').padEnd(w, ' '); }

async function getOrCreateDailyThread(client) {
  const forumId = process.env.PROJECT_DAILY_SUMMARIES_FORUM_ID;
  if (!forumId) return null;
  const forumChannel = await client.channels.fetch(forumId);
  const today = DateTime.now().setZone(CT).toISODate();
  const threadName = `${today} — Project Daily Summary`;

  const threads = await forumChannel.threads.fetchActive();
  let thread = threads.threads.find(t => t.name === threadName);
  if (!thread) {
    const archived = await forumChannel.threads.fetchArchived();
    thread = archived.threads.find(t => t.name === threadName);
  }
  if (!thread) {
    const starter = await forumChannel.send({ content: `📊 ${threadName}` });
    thread = await starter.startThread({ name: threadName });
  }
  return thread;
}

export async function postDailySummaryAll() {
  const thread = await getOrCreateDailyThread(global.client);
  if (!thread) return;

  const projects = await store.allSummaryProjects();
  const rows = await Promise.all(projects.map(async (p) => {
    const statusKey = normalizeStatus(p.status);
    const status = STATUS_LABEL[statusKey] || 'Started';
    const foreman = p.foreman_display || '—';
    const latest = await store.latestReport(p.id);
    const start = p.start_date || '—';
    const anticipated = p.anticipated_end || '—';
    const totalHrs = latest?.cum_man_hours ?? p.total_hours ?? '—';
    const flags = (await store.countMissed?.(p.id) ?? 0) ? '⚠️ Missed' : '';
    return { name: p.name, status, foreman, start, anticipated, totalHrs, flags };
  }));

  const headers = ['Project', 'Status', 'Foreman', 'Start', 'Anticipated End', 'Total Hrs', 'Flags (ever)'];
  const maxName   = Math.min(Math.max(headers[0].length, ...rows.map(r => r.name.length)), 36);
  const maxStatus = Math.min(Math.max(headers[1].length, ...rows.map(r => String(r.status).length)), 24);
  const maxFore   = Math.min(Math.max(headers[2].length, ...rows.map(r => String(r.foreman).length)), 18);
  const maxStart  = Math.max(headers[3].length, ...rows.map(r => String(r.start).length));
  const maxEnd    = Math.max(headers[4].length, ...rows.map(r => String(r.anticipated).length));
  const maxHrs    = Math.max(headers[5].length, ...rows.map(r => String(r.totalHrs).length));
  const maxFlags  = Math.min(Math.max(headers[6].length, ...rows.map(r => String(r.flags).length)), 50);

  const headerLine = [
    pad(headers[0], maxName),
    pad(headers[1], maxStatus),
    pad(headers[2], maxFore),
    pad(headers[3], maxStart),
    pad(headers[4], maxEnd),
    pad(headers[5], maxHrs),
    pad(headers[6], maxFlags),
  ].join('  ');

  const sepLine = [
    '-'.repeat(maxName),
    '-'.repeat(maxStatus),
    '-'.repeat(maxFore),
    '-'.repeat(maxStart),
    '-'.repeat(maxEnd),
    '-'.repeat(maxHrs),
    '-'.repeat(maxFlags),
  ].join('  ');

  const bodyLines = rows.map(r => [
    pad(truncate(r.name, maxName), maxName),
    pad(truncate(r.status, maxStatus), maxStatus),
    pad(truncate(r.foreman, maxFore), maxFore),
    pad(r.start, maxStart),
    pad(r.anticipated, maxEnd),
    pad(String(r.totalHrs), maxHrs),
    pad(truncate(r.flags, maxFlags), maxFlags),
  ].join('  '));

  const msg = ['```', headerLine, sepLine, ...bodyLines, '```'].join('\n');
  await thread.send({ content: msg });
}
