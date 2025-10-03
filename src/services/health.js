import { DateTime } from 'luxon';
import * as store from '../db/store.js';

function badge(avg) {
  if (avg >= 4.5) return '🟩 Excellent';
  if (avg >= 3.5) return '🟨 Stable';
  if (avg >= 2.5) return '🟧 Watch';
  return '🟥 At Risk';
}

export async function postWeeklyHealthSummary(client, channelId, tz) {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const ctx = await store.load();
  const since = DateTime.now().setZone(tz).minus({ days: 6 }).startOf('day');
  const byJob = new Map();

  for (const r of ctx.daily_reports || []) {
    if (!r.health_score) continue;
    const dt = DateTime.fromISO(r.report_date);
    if (dt < since) continue;
    if (!byJob.has(r.project_id)) byJob.set(r.project_id, []);
    byJob.get(r.project_id).push(Number(r.health_score));
  }

  const summary = [];
  for (const [project_id, arr] of byJob) {
    if (!arr.length) continue;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const p = (ctx.projects || []).find(x => x.id === project_id);
    summary.push({ name: p?.name || project_id, avg });
  }

  summary.sort((a, b) => a.avg - b.avg);
  const lines = summary.length
    ? summary.map(s => `• **${s.name}** — ${s.avg.toFixed(2)}/5 ${badge(s.avg)}`)
    : ['(No health data in the last 7 days)'];

  await channel.send({ content: ['🧭 **Weekly Health Summary** (last 7 days)', ...lines].join('\n') });
}


export async function postExecutiveCompletionSummary(client, projectId) {
  if (!client) return;
  const ctx = await store.load();
  const p = (ctx.projects || []).find(x => x.id === projectId);
  if (!p) return;

  const reports = (ctx.daily_reports || []).filter(r => r.project_id === projectId);
  // First/last dates
  const dates = reports.map(r => r.report_date).filter(Boolean).sort();
  const first = dates[0] || '—';
  const last = dates[dates.length - 1] || '—';

  // Lowest-ever health (from health_score)
  const healths = reports.map(r => Number(r.health_score)).filter(n => Number.isFinite(n));
  const minHealth = healths.length ? Math.min(...healths) : null;
  const colorBadge = (h) => {
    if (h === 5) return '🟢';
    if (h === 1) return '🔴';
    if (h != null && h >= 2 && h <= 4) return '🟡';
    return '🟡';
  };

  // Count status transitions to "leaving_incomplete"
  let leavingCount = 0;
  if (typeof store.countProjectEventsByType === 'function') {
    leavingCount = await store.countProjectEventsByType(projectId, 'status:leaving_incomplete');
  }

  // Foreman
  const foreman = p.foreman_display || '—';

  // Channel
  const chId = process.env.EXEC_SUMMARY_CHANNEL_ID || process.env.PROJECT_DAILY_SUMMARIES_FORUM_ID;
  if (!chId) return;
  const channel = await client.channels.fetch(chId).catch(() => null);
  if (!channel) return;

  const title = `${colorBadge(minHealth)} ${p.name} — Completed`;
  const lines = [
    `**Project**: ${p.name}`,
    `**Foreman**: ${foreman}`,
    `**First Daily**: ${first}`,
    `**Last Daily**: ${last}`,
    `**Times Marked "Leaving & Incomplete"**: ${leavingCount}`
  ];

  await channel.send({ content: `🧾 **Executive Summary**
${title}
` + lines.join('\n') });
}
