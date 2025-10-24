// src/services/summary.js
import { DateTime } from 'luxon';
import { ChannelType } from 'discord.js';
import * as store from '../db/store.js';
import { STATUS_LABEL, normalizeStatus } from '../constants/status.js';

// --- constants & utils ---
const CT = 'America/Chicago';

function pad(s, w) { return String(s ?? '').padEnd(w, ' '); }
function trunc(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function parseMDY(s) {
  if (!s) return null;
  // supports YYYY-MM-DD or MM/DD/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = String(s).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  const mm = String(m[1]).padStart(2, '0');
  const dd = String(m[2]).padStart(2, '0');
  const yyyy = String(m[3]).length === 2 ? `20${m[3]}` : String(m[3]).padStart(4, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function latestReportFor(projectId) {
  const ctx = await store.load();
  const list = (ctx.daily_reports || []).filter(r => r.project_id === projectId && r.report_date);
  list.sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)));
  return list[list.length - 1] || null;
}

function healthEmoji(h) {
  if (h === 5) return '🟢';
  if (h === 1) return '🔴';
  if (h != null && h >= 2 && h <= 4) return '🟡';
  return '';
}

async function missedTodayFlag(project, todayISO) {
  const ctx = await store.load();
  const latest = (ctx.daily_reports || [])
    .filter(r => r.project_id === project.id && r.report_date)
    .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)))
    .at(-1) || null;

  const lastISO = latest?.report_date || null;
  const healthVal = Number(latest?.health_score);
  const lastText = lastISO || '—';
  const healthCell = (Number.isFinite(healthVal) ? `Health ${healthVal}/5` : 'Health —');

  const statusKey = normalizeStatus(project.status);

  // Never highlight "Upcoming" projects as stale
  if (statusKey === 'upcoming') {
    return { stale: false, lastText, healthVal, healthCell };
  }

  // For "Leaving & Incomplete" status, check if there's a recent report
  if (statusKey === 'leaving_incomplete') {
    // Find when the status was changed to leaving_incomplete
    const statusChangeEvent = (ctx.trigger_events || [])
      .filter(e => e.project_id === project.id && e.type === 'status:leaving_incomplete')
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      .at(-1);

    if (statusChangeEvent && statusChangeEvent.created_at) {
      const changeTime = DateTime.fromISO(statusChangeEvent.created_at);
      const twelveHoursBefore = changeTime.minus({ hours: 12 });

      // Check if any report was submitted within 12 hours before OR any time after the status change
      const hasRecentReport = (ctx.daily_reports || [])
        .filter(r => r.project_id === project.id && r.created_at)
        .some(r => {
          const reportTime = DateTime.fromISO(r.created_at);
          return reportTime >= twelveHoursBefore; // 12 hours before or any time after
        });

      if (hasRecentReport) {
        return { stale: false, lastText, healthVal, healthCell };
      }
    }
  }

  // Default: stale if last report is not today
  const stale = !lastISO || lastISO !== todayISO;

  return {
    stale,
    lastText,
    healthVal,
    healthCell
  };
}

async function resolveTargetChannel(client) {
  const forumId = process.env.PROJECT_DAILY_SUMMARIES_FORUM_ID;
  if (!forumId) throw new Error('PROJECT_DAILY_SUMMARIES_FORUM_ID not set');
  const channel = await client.channels.fetch(forumId).catch(() => null);
  if (!channel) throw new Error('Daily Summary target channel not found');
  if (channel.type === ChannelType.GuildForum) {
    // If given a forum, post in the forum's default channel (will show as a post thread)
    return channel;
  }
  return channel;
}

// --- main export ---
export async function postDailySummaryAll(clientParam) {
  const client = clientParam || global.client;
  const target = await resolveTargetChannel(client);
  const todayISO = DateTime.now().setZone(CT).toISODate();
  const currentTime = DateTime.now().setZone(CT);

  // Fetch projects
  let projects = [];
  if (typeof store.allSummaryProjects === 'function') {
    projects = await store.allSummaryProjects();
  } else if (typeof store.load === 'function') {
    const ctx = await store.load();
    projects = ctx.projects || [];
  }

  // Exclude projects that are 100% complete no gobacks
  projects = projects.filter(p => {
    const v = String(p.status || '').toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
    return v !== 'complete_no_gobacks';
  });

  // Build rows
  const rows = await Promise.all(projects.map(async (p) => {
    const latest = await latestReportFor(p.id);
    const foreman = p.foreman_display || latest?.foreman_display || '—';
    const statusKey = normalizeStatus(p.status);
    let status = STATUS_LABEL[statusKey] || STATUS_LABEL.started;
    const start = p.start_date || '—';
    const anticipated = (latest?.completion_date) || p.completion_date || p.anticipated_end || '—';

    // Display "In Progress" for projects past start date (instead of "Upcoming")
    if (status === 'Upcoming' && p.start_date) {
      const startDate = DateTime.fromISO(p.start_date, { zone: CT });
      if (startDate.isValid && startDate <= currentTime) {
        status = 'In Progress';
      }
    }

    const healthVal = Number(latest?.health_score);
    const hemoji = Number.isFinite(healthVal) ? healthEmoji(Math.max(1, Math.min(5, healthVal))) : '';
    const name = `${hemoji} ${p.name}`.trim();

    const { stale } = await missedTodayFlag(p, todayISO);

    // Check if project is past end date and not complete/leaving
    let pastDue = false;
    const endDate = anticipated !== '—' ? parseMDY(anticipated) : null;
    if (endDate) {
      const endDT = DateTime.fromISO(endDate, { zone: CT });
      if (endDT.isValid && endDT < currentTime && statusKey !== 'complete_no_gobacks' && statusKey !== 'leaving_incomplete') {
        pastDue = true;
      }
    }

    return { name, status, foreman, start, anticipated, stale, pastDue };
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

  const sepLine = [
    '-'.repeat(widths[0]),
    '-'.repeat(widths[1]),
    '-'.repeat(widths[2]),
    '-'.repeat(widths[3]),
    '-'.repeat(widths[4])
  ].join('  ');

  const bodyLines = rows.map(r => {
    const line = [
      pad(trunc(r.name, widths[0]), widths[0]),
      pad(String(r.status), widths[1]),
      pad(String(r.foreman), widths[2]),
      pad(String(r.start), widths[3]),
      pad(String(r.anticipated), widths[4])
    ].join('  ');

    // Add red exclamation for past due date
    let displayLine = line;
    if (r.pastDue) {
      displayLine = '❗ ' + line.trim();
    }

    // Green (+) if daily done, Red (-) if no daily done
    if (r.stale) {
      return '- ' + displayLine; // Red: No daily report done
    } else {
      return '+ ' + displayLine; // Green: Daily report completed
    }
  });

  const title = `📊 ${todayISO} — Project Daily Summary`;
  const table = ['```diff', headerLine, sepLine, ...bodyLines, '```'].join('\n');

  const legend = `**Legend:**
🟢 Health 5/5  |  🟡 Health 2-4/5  |  🔴 Health 1/5
❗ Past end date  |  🔴 Red = No daily report  |  🟢 Green = Daily report done`;

  await target.send({ content: title, allowedMentions: { parse: [] } });

  // Discord has 2000 char limit. Split table if needed.
  if (table.length <= 2000) {
    await target.send({ content: table, allowedMentions: { parse: [] } });
  } else {
    // Split into multiple messages
    const maxLength = 1990; // Leave room for code block markers
    const lines = ['```diff', headerLine, sepLine, ...bodyLines];
    let currentChunk = [];
    let currentLength = 0;

    for (const line of lines) {
      const lineLength = line.length + 1; // +1 for newline
      if (currentLength + lineLength > maxLength && currentChunk.length > 0) {
        // Send current chunk
        await target.send({
          content: currentChunk.join('\n') + '\n```',
          allowedMentions: { parse: [] }
        });
        currentChunk = ['```diff'];
        currentLength = 9; // Length of ```diff\n
      }
      currentChunk.push(line);
      currentLength += lineLength;
    }

    // Send remaining chunk
    if (currentChunk.length > 1) {
      await target.send({
        content: currentChunk.join('\n') + '\n```',
        allowedMentions: { parse: [] }
      });
    }
  }

  // Send legend at the end
  await target.send({ content: legend, allowedMentions: { parse: [] } });

  return rows.length;
}
