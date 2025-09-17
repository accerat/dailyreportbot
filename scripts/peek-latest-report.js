// scripts/peek-latest-report.js
// Usage: node scripts/peek-latest-report.js <projectId>
// Writes: peek-report-<id>.json at repo root with keys + coerced fields
import { existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const candidates = [
  './src/db/store.js',
  './dist/db/store.js',
  './src/db/index.js',
  './dist/db/index.js'
];

let storeMod = null;
let storePath = null;

for (const rel of candidates) {
  const p = resolve(repoRoot, rel);
  if (existsSync(p)) {
    try {
      storeMod = await import(pathToFileURL(p).href);
      storePath = p;
      break;
    } catch (e) { /* keep going */ }
  }
}

if (!storeMod) {
  console.error('[peek] failed: could not locate store module; checked:', candidates.join(', '));
  process.exit(1);
}

const projectId = parseInt(process.argv[2] ?? '', 10);
if (!Number.isFinite(projectId)) {
  console.error('Usage: node scripts/peek-latest-report.js <projectId>');
  process.exit(1);
}

const fnNames = Object.keys(storeMod).filter(k => typeof storeMod[k] === 'function');
const prefer = ['latestReport', 'getLatestReport', 'latestDaily', 'getLatestDaily'];
let fn = null, fnName = null;
for (const name of prefer) {
  if (typeof storeMod[name] === 'function') { fn = storeMod[name]; fnName = name; break; }
}
if (!fn) {
  for (const name of fnNames) {
    if (/latest/i.test(name) && storeMod[name].length >= 1) { fn = storeMod[name]; fnName = name; break; }
  }
}
if (!fn) {
  console.error('[peek] failed: no suitable latest* function in store. candidates:', fnNames);
  process.exit(1);
}

let raw;
try {
  raw = await fn(projectId);
} catch (e) {
  raw = { __error: String(e && e.stack || e) };
}

const out = {
  __storePath: storePath,
  __fn: fnName,
  __type: raw?.constructor?.name,
  __keys: raw && typeof raw === 'object' ? Object.keys(raw) : null,
  raw,
};

function coerce(obj) {
  if (!obj || typeof obj !== 'object') return {};
  // unwrap common container shapes
  let cur = obj;
  for (const k of ['data', 'doc', 'docs', 'snapshot', 'Item', 'Attributes', 'value']) {
    if (cur && typeof cur === 'object' && cur[k]) cur = cur[k];
  }
  const flat = {};
  const setMaybe = (k, v) => { if (flat[k] == null && v != null) flat[k] = v; };

  // timestamps
  const tsKeys = ['timestamp','time','createdAt','created_at','ts','date','dt','submittedAt','updatedAt','lastUpdated'];
  for (const k of tsKeys) if (cur[k]) setMaybe('timestamp', cur[k]);

  // text-ish
  const txtKeys = ['text','content','body','note','daily','report','message','update','summary'];
  for (const k of txtKeys) if (cur[k]) setMaybe('text', cur[k]);

  // health-ish
  const healthKeys = ['health','mood','score','status','rating','vibe'];
  for (const k of healthKeys) if (cur[k] != null) {
    const n = Number(cur[k]);
    if (Number.isFinite(n)) setMaybe('health', n);
  }
  return flat;
}

out.__coerced = coerce(raw);

const file = resolve(repoRoot, `peek-report-${projectId}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('[peek] wrote', file);
console.log('[peek] fn =', fnName, 'store =', storePath);
console.log('[peek] keys =', out.__keys);
console.log('[peek] coerced =', out.__coerced);
