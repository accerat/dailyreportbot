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
