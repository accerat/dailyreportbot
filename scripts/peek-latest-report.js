#!/usr/bin/env node
// scripts/peek-latest-report.js
// Usage: node scripts/peek-latest-report.js <projectId>
// Prints the store exports, calls the best "latest" function it finds, and writes peek-report-<id>.json

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const repoRoot   = path.resolve(__dirname, '..');
const storePath  = path.resolve(repoRoot, 'src', 'db', 'store.js');

if (!fs.existsSync(storePath)) {
  console.error(`[peek] store.js not found at ${storePath}`);
  process.exit(2);
}

let store;
try {
  store = await import(pathToFileURL(storePath).href);
} catch (e) {
  console.error('[peek] failed to import store.js:', e?.stack || e);
  process.exit(2);
}

const exportNames = Object.keys(store || {});
console.log('[peek] store export names =', exportNames);

const projectIdArg = process.argv[2];
if (!projectIdArg) {
  console.error('Usage: node scripts/peek-latest-report.js <projectId>');
  process.exit(1);
}
const projectId = /^[0-9]+$/.test(projectIdArg) ? Number(projectIdArg) : projectIdArg;

const candidates = [
  'latestReport','getLatestReport','latestDaily','getLatestDaily','latest',
  'latestEntry','latestForProject','lastDaily','fetchLatestReport','getLatest'
];
let fnName = candidates.find(n => typeof store[n] === 'function');

if (!fnName) {
  // Fallback: first exported function with arity >= 1
  fnName = exportNames.find(n => typeof store[n] === 'function' && store[n].length >= 1);
}
if (!fnName) {
  console.error('[peek] No suitable function found on store.* that takes a projectId.');
  process.exit(3);
}
console.log('[peek] selected function =', fnName);

let report = null;
try {
  report = await store[fnName](projectId);
} catch (e) {
  console.warn(`[peek] calling ${fnName}(${projectId}) threw:`, e?.message || e);
}

if (!report) {
  console.log('[peek] function returned null/undefined.');
} else {
  try {
    const keys = Object.keys(report);
    console.log('[peek] top-level keys =', keys);
  } catch {}
}

function flatten(obj, prefix='') {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const [k,v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out.push([key,v]);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v, key));
    }
  }
  return out;
}

function firstMatchKey(flat, needles) {
  const lower = flat.map(([k,v]) => [k.toLowerCase(), k, v]);
  for (const n of needles) {
    const idx = lower.findIndex(([lk]) => lk.includes(n));
    if (idx >= 0) return { key: lower[idx][1], value: lower[idx][2], needle: n };
  }
  return null;
}

const flat = flatten(report || {});
const tsGuess    = firstMatchKey(flat, ['timestamp','createdat','created_at','ts','time','date','submittedat','created']);
const textGuess  = firstMatchKey(flat, ['text','note','notes','desc','description','message','body','content','report','summary']);
const healthGuess= firstMatchKey(flat, ['health','mood','wellness','score','rating','statusvalue']);

let healthVal = null;
if (healthGuess) {
  const raw = healthGuess.value;
  const n = typeof raw === 'number' ? raw : Number(raw);
  healthVal = Number.isFinite(n) ? n : null;
}

const derived = {
  tsKey: tsGuess?.key || null,
  tsVal: tsGuess?.value ?? null,
  textKey: textGuess?.key || null,
  textVal: textGuess?.value ?? null,
  healthKey: healthGuess?.key || null,
  healthRaw: healthGuess?.value ?? null,
  healthVal,
};

console.log('[peek] derived =', derived);

const outPath = path.resolve(repoRoot, `peek-report-${projectId}.json`);
try {
  fs.writeFileSync(outPath, JSON.stringify({ projectId, fnName, report, derived }, null, 2));
  console.log('[peek] wrote', outPath);
} catch (e) {
  console.warn('[peek] failed to write output file:', e?.message || e);
}
