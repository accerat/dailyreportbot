#!/usr/bin/env node
// scripts/patch-summary-latest.js
// Usage: node scripts/patch-summary-latest.js ./src/services/summary.js
// Inserts a small helper (coerceLatestFields) and a salvage block that fills
// lastText/healthVal when they are coming back null.

import fs from 'fs';
import path from 'path';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/patch-summary-latest.js ./src/services/summary.js');
  process.exit(1);
}

const src = fs.readFileSync(target, 'utf8');

const helper = `
// === injected by scripts/patch-summary-latest.js ===
function __flattenObj(obj, prefix='') {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const [k,v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    out.push([key, v]);
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...__flattenObj(v, key));
  }
  return out;
}
function __firstMatch(flat, needles) {
  const lower = flat.map(([k,v])=>[k.toLowerCase(),k,v]);
  for (const n of needles) {
    const idx = lower.findIndex(([lk])=>lk.includes(n));
    if (idx >= 0) return { key: lower[idx][1], value: lower[idx][2], needle: n };
  }
  return null;
}
function coerceLatestFields(reportObj) {
  const flat = __flattenObj(reportObj || {});
  const ts    = __firstMatch(flat, ['timestamp','createdat','created_at','ts','time','date','submittedat','created']);
  const text  = __firstMatch(flat, ['text','note','notes','desc','description','message','body','content','report','summary']);
  const health= __firstMatch(flat, ['health','mood','wellness','score','rating','statusvalue']);
  let healthVal = null;
  if (health) {
    const raw = health.value;
    const n = typeof raw === 'number' ? raw : Number(raw);
    healthVal = Number.isFinite(n) ? n : null;
  }
  return {
    stampKey: ts?.key || null,
    stampVal: ts?.value ?? null,
    textKey: text?.key || null,
    textVal: text?.value ?? null,
    healthKey: health?.key || null,
    healthRaw: health?.value ?? null,
    healthVal
  };
}
// === end injected ===
`;

// Only inject helper once
let out = src.includes('function coerceLatestFields(') ? src : src.replace(/(\n)(export\s+|const\s+|async\s+function|function\s+)/, "\n" + helper + "$2");

if (!out.includes('coerceLatestFields(')) {
  console.log('[patch] helper already present or injection did not match earliest location; writing file unchanged.');
  fs.writeFileSync(target, src, 'utf8');
  process.exit(0);
}

// Try to add a salvage block right before the line that defines healthCell/flagOut.
// We'll search for a place where both 'let healthVal' and 'let lastText' exist and insert after them.

let inserted = false;
out = out.replace(/(let\s+healthVal\s*=\s*null;[^]*?let\s+lastText\s*=\s*null;)/m, (m) => {
  inserted = true;
  return m + `

    // --- injected salvage using coerceLatestFields ---
    // If the existing pipeline fails to set these, we try to infer them directly from the latest report/status objects.
    try {
      const salvageObj = (typeof status === 'object' && status) || (typeof report === 'object' && report) || (typeof latest === 'object' && latest) || null;
      const _coerced = coerceLatestFields(salvageObj);
      if (healthVal == null && typeof _coerced.healthVal === 'number') healthVal = _coerced.healthVal;
      if (lastText == null) {
        const _s = _coerced.stampVal || _coerced.textVal;
        if (_s != null) {
          try {
            // Format timestamp if it looks like one, else stringify
            const maybeNum = Number(_s);
            const d = Number.isFinite(maybeNum) && String(_s).length >= 10 ? new Date(maybeNum) : new Date(_s);
            if (!isNaN(d.getTime())) {
              const mm = String(d.getMonth()+1), dd = String(d.getDate()), hh = d.getHours()%12 || 12, min = String(d.getMinutes()).padStart(2,'0'), ampm = d.getHours()<12?'am':'pm';
              lastText = `${mm}/${dd} ${hh}:${min}${ampm}`;
            } else {
              lastText = String(_s);
            }
          } catch { lastText = String(_s); }
        }
      }
      console.log('[summary:meta] salvage', { projectId: p?.id, healthVal, lastText, _coerced });
    } catch (e) {
      console.warn('[summary:meta] salvage error', e?.message || e);
    }
    // --- end injected salvage ---
  `;
});

if (!inserted) {
  console.warn('[patch] Could not find the expected anchor to insert salvage block. Writing only the helper.');
}

fs.writeFileSync(target, out, 'utf8');
console.log('[patch] updated', target);
