// src/services/summary.js
import { DateTime } from 'luxon';
import { ChannelType } from 'discord.js';
import * as store from '../db/store.js';

const CT = 'America/Chicago';

// --- injected sniff helper (idempotent) ---
function sniffLatestDailyAndHealth(latest) {
  try {
    const today = DateTime.now().setZone(CT).startOf('day');
    if (!latest || typeof latest !== 'object') {
      return { isToday: false, lastText: null, healthVal: null };
    }

    // Candidate timestamp fields (top-level + nested)
    const stampPaths = [
      ['timestamp'], ['ts'], ['time'], ['date'], ['datetime'], ['updated_at'], ['updatedAt'],
      ['created_at'], ['createdAt'],
      ['reportDate'], ['report_date'], ['dailyDate'], ['daily_date'], ['submitted_at'], ['submittedAt'],
      ['meta','timestamp'], ['meta','updated_at'], ['meta','updatedAt'], ['meta','date'],
      ['details','timestamp'], ['details','date'], ['details','updated_at'], ['details','updatedAt']
    ];

    let lastDT = null;
    for (const path of stampPaths) {
      let v = latest;
      for (const k of path) v = v?.[k];
      if (v == null) continue;
      let dt = null;
      if (typeof v === 'number' && isFinite(v)) {
        // seconds vs millis
        dt = (v > 1e12) ? DateTime.fromMillis(v, { zone: CT }) : DateTime.fromSeconds(v, { zone: CT });
      } else if (typeof v === 'string') {
        const s = v.trim();
        // try ISO first
        dt = DateTime.fromISO(s, { zone: CT });
        if (!dt.isValid) {
          // try RFC2822
          dt = DateTime.fromRFC2822(s, { zone: CT });
        }
        if (!dt.isValid && typeof parseMDY === 'function') {
          try { dt = parseMDY(s); } catch {}
        }
      } else if (v && typeof v === 'object' && typeof v.seconds === 'number') {
        // Firestore Timestamp-like
        dt = DateTime.fromSeconds(v.seconds, { zone: CT });
      }
      if (dt && dt.isValid) { lastDT = dt; break; }
    }

    // Health from multiple aliases
    const healthCandidates = [
      latest?.health_score, latest?.health, latest?.healthScore, latest?.health_rating, latest?.healthscore,
      latest?.details?.health_score, latest?.details?.health, latest?.details?.healthScore,
      latest?.meta?.health_score, latest?.meta?.health, latest?.meta?.healthScore
    ].filter(x => x != null);

    const { isToday, lastText, healthVal } = sniffLatestDailyAndHealth(latest);
    const healthCell = (healthVal != null ? `Health ${healthVal}/5` : 'Health —');
    const flagOut = isToday ? (flag ?? '') : ((lastText ? `Last daily ${lastText}` : 'No daily yet') + ` • ${healthCell}`);
    console.log('[summary] project', p.id, 'isToday=', isToday, 'lastText=', lastText, 'healthVal=', healthVal);
console.log('[summary] project', p.id, 'isToday=', isToday, 'lastText=', lastText, 'healthVal=', healthVal);
return { name: p.name, status, foreman, start, anticipated, totalHrs, flag: flagOut };
  }));

  const headers = ['Project', 'Status', 'Foreman', 'Start', 'Anticipated End', 'Total Hrs', 'Flag'];
  const widths = [
    Math.min(Math.max(headers[0].length, ...rows.map(r => String(r.name).length)), 36),
    Math.min(Math.max(headers[1].length, ...rows.map(r => String(r.status).length)), 24),
    Math.min(Math.max(headers[2].length, ...rows.map(r => String(r.foreman).length)), 18),
    Math.max(headers[3].length, ...rows.map(r => String(r.start).length)),
    Math.max(headers[4].length, ...rows.map(r => String(r.anticipated).length)),
    Math.max(headers[5].length, ...rows.map(r => String(r.totalHrs).length)),
    Math.min(Math.max(headers[6].length, ...rows.map(r => String(r.flag).length)), 20),
  ];

  const headerLine = headers.map((h, i) => pad(h, widths[i])).join('  ');
  const sepLine = widths.map(w => '-'.repeat(w)).join('  ');

  const bodyLines = rows.map(r => [
    pad(trunc(r.name, widths[0]), widths[0]),
    pad(trunc(r.status, widths[1]), widths[1]),
    pad(trunc(r.foreman, widths[2]), widths[2]),
    pad(String(r.start), widths[3]),
    pad(String(r.anticipated), widths[4]),
    pad(String(r.totalHrs), widths[5]),
    pad(trunc(r.flag, widths[6]), widths[6]),
  ].join('  '));

  const title = `📊 ${todayISO} — Project Daily Summary`;
  const table = ['```', headerLine, sepLine, ...bodyLines, '```'].join('\n');

  await target.send({ content: title, allowedMentions: { parse: [] } });
  await target.send({ content: table, allowedMentions: { parse: [] } });

  return rows.length;
}
