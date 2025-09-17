// scripts/patch-summary-latest.js
// Usage: node scripts/patch-summary-latest.js [path/to/src/services/summary.js]
// Patches summary.js to robustly detect latest daily timestamp + health score.

import fs from 'fs';
import path from 'path';

const target = process.argv[2] || path.join('src', 'services', 'summary.js');
const src = fs.readFileSync(target, 'utf8');

function insertOnce(haystack, needle, insertion) {
  if (haystack.includes(insertion.trim())) return haystack; // already present
  const idx = haystack.indexOf(needle);
  if (idx === -1) return haystack;
  return haystack.slice(0, idx + needle.length) + "\n" + insertion + "\n" + haystack.slice(idx + needle.length);
}

// 1) Insert helper after CT constant (or after imports if CT not found)
const helperBlock = `
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

    let healthVal = null;
    for (const h of healthCandidates) {
      const n = typeof h === 'string' ? parseFloat(h) : Number(h);
      if (Number.isFinite(n)) { healthVal = Math.max(1, Math.min(5, Math.round(n))); break; }
      if (typeof h === 'string') {
        // Parse strings like "3/5", "Good (4)"
        const m = h.match(/(\d(?:\.\d+)?)/);
        if (m) {
          const nn = parseFloat(m[1]);
          if (Number.isFinite(nn)) { healthVal = Math.max(1, Math.min(5, Math.round(nn))); break; }
        }
      }
    }

    const isToday = !!(lastDT && lastDT.startOf('day') <= today && lastDT.startOf('day').equals(today));
    const lastText = lastDT ? lastDT.setZone(CT).toFormat('M/d h:mma') : null;
    return { isToday, lastText, healthVal };
  } catch (e) {
    console.warn('[patch] sniffLatestDailyAndHealth error:', e);
    return { isToday: false, lastText: null, healthVal: null };
  }
}
// --- end injected sniff helper ---
`.trim();

let out = src;
if (out.includes('function sniffLatestDailyAndHealth(') === false) {
  if (out.includes("const CT = 'America/Chicago';")) {
    out = insertOnce(out, "const CT = 'America/Chicago';", "\n" + helperBlock + "\n");
  } else {
    // fallback: after luxon import
    out = insertOnce(out, "import { DateTime } from 'luxon';", "\n" + helperBlock + "\n");
  }
}

// 2) Replace the local computation of health/lastText/flagOut with calls to the helper
// We look for the block that defines healthVal/lastText then builds healthCell/flagOut.
out = out.replace(
  /let\s+healthVal\s*=\s*null;[\s\S]*?const\s+healthCell[\s\S]*?flagOut[\s\S]*?;/m,
  `const { isToday, lastText, healthVal } = sniffLatestDailyAndHealth(latest);
    const healthCell = (healthVal != null ? \`Health \${healthVal}/5\` : 'Health —');
    const flagOut = isToday ? (flag ?? '') : ((lastText ? \`Last daily \${lastText}\` : 'No daily yet') + \` • \${healthCell}\`);
    console.log('[summary] project', p.id, 'isToday=', isToday, 'lastText=', lastText, 'healthVal=', healthVal);`
);

// 3) Write back if changed
if (out !== src) {
  fs.writeFileSync(target, out);
  console.log(`[patch] Updated ${target}`);
} else {
  console.log('[patch] No changes applied (patterns not found or already patched).');
}
