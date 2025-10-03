// src/services/summary.js
import { DateTime } from 'luxon';
import { ChannelType } from 'discord.js';
import * as store from '../db/store.js';


async function latestReportFor(projectId){
  const ctx = await store.load();
  const list = (ctx.daily_reports || []).filter(r => r.project_id === projectId && r.report_date);
  list.sort((a,b) => String(a.report_date).localeCompare(String(b.report_date)));
  return list[list.length - 1] || null;
}

function healthEmoji(h){
  if (h === 5) return '🟢';
  if (h === 1) return '🔴';
  if (h != null && h >= 2 && h <= 4) return '🟡';
  return '';
}
const CT = 'America/Chicago';

function pad(s, w) { return String(s ?? '').padEnd(w, ' '); }
function trunc(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function parseMDY(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const [_, mo, da, yr] = m;
  return DateTime.fromObject({ year: +yr, month: +mo, day: +da }, { zone: CT });
}

function norm(val) {
  return String(val ?? '').toLowerCase().replace(/[\s_\-–—]+/g, ' ').trim();
}

function isOnHold(p) {
  const s = norm(p.status);
  return p.paused === true || s.includes('hold') || s === 'on hold';
}

function isComplete(p, today) {
  const s = norm(p.status);
  // Treat anything that clearly denotes completion as complete, but exclude "incomplete" + "leaving"
  if (s && s.includes('complete') && !s.includes('incomplete') && !s.includes('leaving')) {
    return true;
  }
  // Common boolean flags
  if (p.is_closed === true || p.closed === true || p.completed === true || p.complete === true) {
    return true;
  }
  // Date-based completion
  const comp = parseMDY(p.completion_date) || parseMDY(p.completed_date) || parseMDY(p.end_date);
  if (comp && comp.startOf('day') <= today.startOf('day')) return true;
  return false;
}

function projectIsActiveToday(p, today) {
  if (isOnHold(p)) return false;
  if (isComplete(p, today)) return false;
  // Not active if start_date is in the future
  const start = parseMDY(p.start_date);
  if (start && start.startOf('day') > today.startOf('day')) return false;
  return true;
}

async function resolveTargetChannel(client) {
  const id = process.env.PROJECT_DAILY_SUMMARIES_FORUM_ID;
  if (!id) throw new Error('PROJECT_DAILY_SUMMARIES_FORUM_ID is not set');
  const ch = await client.channels.fetch(id);

  // Post directly in a THREAD
  if (typeof ch?.isThread === 'function' && ch.isThread()) return ch;
  // Or directly in a TEXT channel (no auto child threads)
  if (ch?.type === ChannelType.GuildText || (typeof ch?.isTextBased === 'function' && ch.isTextBased())) return ch;
  // Forums always create posts/threads; not desired here
  if (ch?.type === ChannelType.GuildForum) {
    throw new Error('Daily summary target is a Forum. Set PROJECT_DAILY_SUMMARIES_FORUM_ID to a THREAD or TEXT channel.');
  }
  throw new Error(`Unsupported channel type for ${id}`);
}

async function missedTodayFlag(project, todayISO) {
  const today = DateTime.fromISO(todayISO, { zone: CT });
  if (!projectIsActiveToday(project, today)) return '';

  // Pull all reports and find the latest one for this project
  const ctx = await store.load();
  const reports = (ctx.daily_reports || []).filter(r => r.project_id === project.id);

  if (!reports.length) {
    return 'No daily yet • Health —';
  }

  // newest by ISO date
  reports.sort((a, b) => (a.report_date || '').localeCompare(b.report_date || ''));
  const latest = reports[reports.length - 1] || null;

  const latestISO = latest?.report_date || null;
  if (!latestISO) {
    return 'No daily yet • Health —';
  }

  // is today?
  const isToday = (latestISO === todayISO);
  if (isToday) return '';

  // derive "M/D" text
  let lastText = '';
  try {
    lastText = DateTime.fromISO(latestISO, { zone: CT }).toFormat('M/d');
  } catch {
    lastText = String(latestISO);
  }

  // derive health (prefer numeric property; otherwise parse from text)
  let healthVal = null;
  if (typeof latest.health === 'number') {
    healthVal = Number.isFinite(latest.health) ? Math.max(1, Math.min(5, latest.health)) : null;
  } else if (typeof latest.health === 'string') {
    const n = Number(latest.health);
    healthVal = Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : null;
  } else if (latest.text) {
    const m = String(latest.text).match(/health\s*[:\-]?\s*(\d(?:\.\d)?)\s*\/?\s*5/i);
    if (m) {
      const n = Number(m[1]);
      healthVal = Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : null;
    }
  }

  const healthCell = (healthVal != null ? `Health ${healthVal}/5` : 'Health —');
  return `Last daily ${lastText} • ${healthCell}`;
}

export async function postDailySummaryAll(clientParam) {
  const client = clientParam || global.client;
  const target = await resolveTargetChannel(client);
  const todayISO = DateTime.now().setZone(CT).toISODate();

  });


  // Fetch projects
  let projects = [];
  if (typeof store.allSummaryProjects === 'function') {
    projects = await store.allSummaryProjects();
  } else if (typeof store.load === 'function') {
    const ctx = await store.load();
    projects = ctx.projects || [];

  // Exclude projects that are 100% complete no gobacks
  projects = projects.filter(p => {
    const v = String(p.status || '').toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
    return v !== 'complete_no_gobacks';

  }

  // Build rows
  const rows = await Promise.all(projects.map(async (p) => {
    const foreman = p.foreman_display || '—';
    const status = p.status || (p.paused ? 'On Hold' : (p.completion_date ? 'Complete' : 'Started'));
    const start = p.start_date || '—';
    const anticipated = p.completion_date || p.anticipated_end || '—';

    // latest totals if present
    let totalHrs = '—';
    try {
      if (typeof store.latestReport === 'function') {
        const latest = await store.latestReport(p.id);
        if (latest && (latest.cum_man_hours ?? latest.total_man_hours ?? latest.man_hours)) {
          totalHrs = String(latest.cum_man_hours ?? latest.total_man_hours ?? latest.man_hours);
        }
      }
    } catch {}

    const flag = await missedTodayFlag(p, todayISO);
    return { name: p.name, status, foreman, start, anticipated, totalHrs, flag };
  }));

  const headers = ['Project', 'Status', 'Foreman', 'Start', 'Anticipated End'];
  const widths = [
    Math.min(Math.max(headers[0].length, ...rows.map(r => String(r.name).length)), 36),
    Math.min(Math.max(headers[1].length, ...rows.map(r => String(r.status).length)), 24),
    Math.min(Math.max(headers[2].length, ...rows.map(r => String(r.foreman).length)), 18),
    Math.max(headers[3].length, ...rows.map(r => String(r.start).length)),
    Math.max(headers[4].length, ...rows.map(r => String(r.anticipated).length))
  ];

  const headerLine = [
    pad(headers[0], widths[0]),
    pad(headers[1], widths[1]),
    pad(headers[2], widths[2]),
    pad(headers[3], widths[3]),
    pad(headers[4], widths[4])
  ].join('  ');
  const sepLine = widths.map(w => '-'.repeat(w)).join('  ');

  const bodyLines = rows.map(r => {
  const line = [
    pad(trunc(r.name, widths[0]), widths[0]),
    pad(String(r.status), widths[1]),
    pad(String(r.foreman), widths[2]),
    pad(String(r.start), widths[3]),
    pad(String(r.anticipated), widths[4])
  ].join('  ');
  return r.stale ? ('- ' + line) : ('  ' + line);
});

  const title = `📊 ${todayISO} — Project Daily Summary`;
  const table = ['```diff', headerLine, sepLine, ...bodyLines, '```'].join('\n');

  await target.send({ content: title, allowedMentions: { parse: [] } });
  await target.send({ content: table, allowedMentions: { parse: [] } });

  return rows.length;
}