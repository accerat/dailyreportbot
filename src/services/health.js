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
  const channelId = process.env.EXEC_SUMMARY_CHANNEL_ID || process.env.PROJECT_DAILY_SUMMARIES_FORUM_ID;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const ctx = await store.load();
  const project = (ctx.projects || []).find(p => p.id === projectId);
  if (!project) return;

  const reports = (ctx.daily_reports || []).filter(r => r.project_id === projectId);
  const parseDate = (s) => {
    try { return DateTime.fromISO(String(s), { zone: 'America/Chicago' }); } catch { return null; }
  };
  let firstDate = null, lastDate = null, minHealth = null;
  for (const r of reports) {
    const d = parseDate(r.report_date);
    if (d) {
      if (!firstDate || d < firstDate) firstDate = d;
      if (!lastDate || d > lastDate) lastDate = d;
    }
    const hs = (typeof r.health_score === 'number') ? r.health_score
              : (Number.isFinite(Number(r.health)) ? Number(r.health) : null);
    if (Number.isFinite(hs)) {
      const v = Math.max(1, Math.min(5, Number(hs)));
      minHealth = (minHealth == null) ? v : Math.min(minHealth, v);
    }
  }
  const fc = (ctx.trigger_events || []).filter(e => e.project_id === projectId && e.type === 'status:leaving_incomplete').length;

  const colorEmoji = (h) => {
    if (h === 1) return '🔴';
    if (h === 5) return '🟢';
    if (h == null) return '⚪';
    return '🟡';
  };

  const name = `${colorEmoji(minHealth)} ${project.name}`;
  const foreman = project.foreman_display || '—';
  const fmt = (d) => d ? d.setLocale('en').toFormat('M/d/yyyy') : '—';

  const lines = [
    `**Project:** ${name}`,
    `**Foreman:** ${foreman}`,
    `**First Daily Report:** ${fmt(firstDate)}`,
    `**Last Daily Report:** ${fmt(lastDate)}`,
    `**Leaving & Incomplete Count:** ${fc}`,
  ];

  await channel.send({
    content: `✅ **Project Completed** — Executive Summary`,
    allowedMentions: { parse: [] },
  });
  await channel.send({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}
