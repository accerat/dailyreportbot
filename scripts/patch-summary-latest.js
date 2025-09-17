// scripts/patch-summary-latest.js
// Usage: node scripts/patch-summary-latest.js ./src/services/summary.js
// Inserts a salvage helper & block to fill lastText/healthVal if null, plus logs.
// Safe to re-run: will no-op if markers already present.
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const target = process.argv[2] || './src/services/summary.js';
const abs = resolve(process.cwd(), target);
let src = readFileSync(abs, 'utf8');

if (src.includes('/* COERCE_LATEST_FIELDS_START */')) {
  console.log('[patch] Already patched:', target);
  process.exit(0);
}

const helper = `
/* COERCE_LATEST_FIELDS_START */
function __coerceLatestFields(obj) {
  if (!obj || typeof obj !== 'object') return {};
  let cur = obj;
  for (const k of ['data','doc','docs','snapshot','Item','Attributes','value']) {
    if (cur && typeof cur === 'object' && cur[k]) cur = cur[k];
  }
  const out = {};
  const setMaybe = (k,v) => { if (out[k]==null && v!=null) out[k]=v; };
  const tsKeys = ['timestamp','time','createdAt','created_at','ts','date','dt','submittedAt','updatedAt','lastUpdated'];
  for (const k of tsKeys) if (cur[k]) setMaybe('timestamp', cur[k]);
  const txtKeys = ['text','content','body','note','daily','report','message','update','summary'];
  for (const k of txtKeys) if (cur[k]) setMaybe('text', cur[k]);
  const healthKeys = ['health','mood','score','status','rating','vibe'];
  for (const k of healthKeys) if (cur[k]!=null) {
    const n = Number(cur[k]); if (Number.isFinite(n)) setMaybe('health', n);
  }
  return out;
}
/* COERCE_LATEST_FIELDS_END */
`;

// Try to insert helper after imports
const importBlockMatch = src.match(/^(?:import\\s.+\\n)+/m);
if (importBlockMatch) {
  const endIdx = importBlockMatch.index + importBlockMatch[0].length;
  src = src.slice(0, endIdx) + helper + src.slice(endIdx);
} else {
  src = helper + src;
}

// Insert salvage block before const flagOut =
const flagIdx = src.indexOf('const flagOut');
if (flagIdx === -1) {
  console.error('[patch] Could not find "const flagOut" anchor — aborting without changes.');
  process.exit(2);
}

const salvage = `
// --- salvage latest fields if detection failed ---
try {
  if (typeof latest !== 'undefined' && (lastText == null || healthVal == null)) {
    const _cf = __coerceLatestFields(latest);
    if (lastText == null && _cf.timestamp) {
      try {
        const dt = (typeof DateTime !== 'undefined')
          ? DateTime.fromISO(String(_cf.timestamp), { zone: CT }).isValid
            ? DateTime.fromISO(String(_cf.timestamp), { zone: CT })
            : DateTime.fromMillis(Number(_cf.timestamp), { zone: CT })
          : null;
        if (dt && dt.isValid) lastText = dt.toFormat('M/d h:mma');
      } catch {}
    }
    if (healthVal == null && _cf.health != null) {
      const n = Number(_cf.health);
      if (Number.isFinite(n)) healthVal = n;
    }
    console.log('[summary:meta] salvage for', p?.id, _cf);
  }
} catch (e) { console.warn('[summary:meta] salvage error', String(e)); }
// --- end salvage ---
`;

src = src.slice(0, flagIdx) + salvage + src.slice(flagIdx);

writeFileSync(abs, src);
console.log('[patch] Patched:', target);
