// scripts/peek-latest-report.js
// Usage: node scripts/peek-latest-report.js <projectId>
// Prints the raw latest report and the derived fields used by summary.js

import path from 'path';
import { fileURLToPath } from 'url';
import { DateTime } from 'luxon';

// Resolve repo root from this script location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const CT = 'America/Chicago';

const store = await import(path.join(repoRoot, 'src', 'db', 'store.js')).then(m => m.default ?? m);

function parseMDY(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return DateTime.fromObject({ year: +yr, month: +mo, day: +da }, { zone: CT });
}

function sniffLatestDailyAndHealth(latest) {
  const today = DateTime.now().setZone(CT).startOf('day');
  if (!latest || typeof latest !== 'object') {
    return { isToday: false, lastText: null, healthVal: null };
  }
  const stampPaths = [
    ['timestamp'], ['ts'], ['time'], ['date'], ['datetime'], ['updated_at'], ['updatedAt'],
    ['created_at'], ['createdAt'],
    ['reportDate'], ['report_date'], ['dailyDate'], ['daily_date'],
    ['submitted_at'], ['submittedAt'],
    ['meta','timestamp'], ['meta','updated_at'], ['meta','updatedAt'], ['meta','date'],
    ['details','timestamp'], ['details','date'], ['details','updated_at'], ['details','updatedAt']
  ];
  let lastDT = null;
  for (const pathArr of stampPaths) {
    let v = latest;
    for (const k of pathArr) v = v?.[k];
    if (v == null) continue;
    let dt = null;
    if (typeof v === 'number' && isFinite(v)) {
      dt = (v > 1e12) ? DateTime.fromMillis(v, { zone: CT }) : DateTime.fromSeconds(v, { zone: CT });
    } else if (typeof v === 'string') {
      const s = v.trim();
      dt = DateTime.fromISO(s, { zone: CT });
      if (!dt.isValid) dt = DateTime.fromRFC2822(s, { zone: CT });
      if (!dt.isValid) {
        const mdy = parseMDY(s);
        if (mdy?.isValid) dt = mdy;
      }
    } else if (v && typeof v === 'object' && typeof v.seconds === 'number') {
      dt = DateTime.fromSeconds(v.seconds, { zone: CT });
    }
    if (dt?.isValid) { lastDT = dt; break; }
  }

  const healthCandidates = [
    latest?.health_score, latest?.health, latest?.healthScore, latest?.health_rating, latest?.healthscore,
    latest?.details?.health_score, latest?.details?.health, latest?.details?.healthScore,
    latest?.meta?.health_score, latest?.meta?.health, latest?.meta?.healthScore
  ].filter(x => x != null);

  let healthVal = null;
  for (const h of healthCandidates) {
    const n = typeof h === 'string' ? parseFloat(h) : Number(h);
    if (Number.isFinite(n)) { healthVal = Math.max(1, Math.min(5, Math.round(n))); break; }
    if (typeof h === 'string') {
      const m = h.match(/(\d(?:\.\d+)?)/);
      if (m) {
        const nn = parseFloat(m[1]);
        if (Number.isFinite(nn)) { healthVal = Math.max(1, Math.min(5, Math.round(nn))); break; }
      }
    }
  }

  const isToday = !!(lastDT && lastDT.startOf('day').equals(today));
  const lastText = lastDT ? lastDT.setZone(CT).toFormat('M/d h:mma') : null;
  return { isToday, lastText, healthVal, lastDT: lastDT?.toISO() ?? null };
}

const pid = process.argv[2];
if (!pid) {
  console.error('Usage: node scripts/peek-latest-report.js <projectId>');
  process.exit(1);
}

const latest = await (store.latestReport ? store.latestReport(pid) : Promise.resolve(null));
console.log('[peek] keys =', latest ? Object.keys(latest) : null);
console.dir(latest, { depth: 2, colors: false });

const derived = sniffLatestDailyAndHealth(latest);
console.log('[peek] derived =', derived);
