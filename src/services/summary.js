// src/services/summary.js
import { DateTime } from 'luxon';
import { ChannelType } from 'discord.js';
import * as store from '../db/store.js';
import { STATUS_LABEL, normalizeStatus } from '../constants/status.js';

const CT = 'America/Chicago';

function truncate(str, n) {
  str = String(str ?? '');
  return str.length > n ? (str.slice(0, n-1) + '…') : str;
}
function pad(str, w) { return String(str ?? '').padEnd(w, ' '); }

/**
 * Return a ThreadChannel (or TextBased channel) ready to receive messages for today's summary.
 * Supports:
 *  - Env points to a THREAD: send header into that thread and return it.
 *  - Env points to a TEXT channel: create/find today's thread; post header.
 *  - Env points to a FORUM: create/find today's forum post with first message; return the created thread.
 */
async function getOrCreateDailyThread(client) {
  const parentId = process.env.PROJECT_DAILY_SUMMARIES_FORUM_ID;
  if (!parentId) return null;

  const ch = await client.channels.fetch(parentId);
  const today = DateTime.now().setZone(CT).toISODate();
  const threadName = `${today} — Project Daily Summary`;

  // If the env is already a thread id, use it directly and ensure header exists
  if (typeof ch?.isThread === 'function' && ch.isThread()) {
    // Post header if the thread has no messages yet
    try {
      const fetched = await ch.messages.fetch({ limit: 1 }).catch(() => null);
      if (!fetched || fetched.size === 0) {
        await ch.send({ content: `📊 ${threadName}` });
      }
    } catch {}
    return ch;
  }

  // Forum parent: create daily forum post w/ first message
  if (ch?.type === ChannelType.GuildForum) {
    // Try to find an existing post/thread by name first
    try {
      const act = await ch.threads.fetchActive();
      let t = act?.threads?.find(t => t.name === threadName);
      if (!t) {
        const arch = await ch.threads.fetchArchived();
        t = arch?.threads?.find(t => t.name === threadName);
      }
      if (t) return t;
    } catch {}
    const thread = await ch.threads.create({
      name: threadName,
      message: { content: `📊 ${threadName}`, allowedMentions: { parse: [] } },
    });
    return thread;
  }

  // Text channel (GuildText or similar): create/find a thread and post header
  if (ch?.type === ChannelType.GuildText || typeof ch?.isTextBased === 'function' && ch.isTextBased()) {
    // search active/archived for today's name
    try {
      const act = await ch.threads.fetchActive();
      let t = act?.threads?.find(t => t.name === threadName);
      if (!t) {
        const arch = await ch.threads.fetchArchived();
        t = arch?.threads?.find(t => t.name === threadName);
      }
      if (t) return t;
    } catch {}
    const thread = await ch.threads.create({ name: threadName, autoArchiveDuration: 1440 });
    await thread.send({ content: `📊 ${threadName}`, allowedMentions: { parse: [] } });
    return thread;
  }

  throw new Error(`Unsupported channel type for ${parentId}`);
}

export async function postDailySummaryAll() {
  const thread = await getOrCreateDailyThread(global.client);
  if (!thread) return 0;

  const projects = await store.allSummaryProjects();

  // resolve the "latest report" function available in store
  const latestFn =
    (typeof store.latestReport === 'function' && store.latestReport) ||
    (typeof store.latestDailyReport === 'function' && store.latestDailyReport) ||
    (typeof store.lastReportForProject === 'function' && store.lastReportForProject) ||
    null;

  const countMissedFn = (typeof store.countMissed === 'function' && store.countMissed) || null;

  const rows = await Promise.all(projects.map(async (p) => {
    const statusKey = normalizeStatus(p.status);
    const status = STATUS_LABEL[statusKey] || 'Started';
    const foreman = p.foreman_display || '—';
    const latest = latestFn ? await latestFn(p.id) : null;
    const start = p.start_date || '—';
    const anticipated = p.anticipated_end || '—';
    const totalHrs = (latest && (latest.cum_man_hours ?? latest.total_man_hours)) ?? p.total_hours ?? '—';
    const flags = countMissedFn ? ((await countMissedFn(p.id)) ? '⚠️ Missed' : '') : '';
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
  await thread.send({ content: msg, allowedMentions: { parse: [] } });
  return rows.length;
}
