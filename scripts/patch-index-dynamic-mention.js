// scripts/patch-index-dynamic-mention.js
// Makes index.js tolerant to different mentionPanel exports by using dynamic import.
import fs from 'node:fs';

const file = 'src/index.js';
const bak  = `src/index.js.bak-${new Date().toISOString().replace(/[:]/g,'-')}`;
const src  = fs.readFileSync(file, 'utf8');
fs.writeFileSync(bak, src, 'utf8');

if (src.includes("import { wireInteractions } from './interactions/mentionPanel.js'")) {
  const out = src.replace(
    /import\s+\{\s*wireInteractions\s*\}\s+from\s+'\.\/interactions\/mentionPanel\.js';?/,
    "// dynamic mentionPanel loader injected by patch\nlet wireInteractions;\ntry {\n  const mod = await import('./interactions/mentionPanel.js');\n  wireInteractions = mod.wireInteractions || mod.default?.wireInteractions || mod.wire;\n} catch (_) {\n  wireInteractions = undefined;\n}"
  ).replace(
    /wireInteractions\(/g,
    "(wireInteractions||(()=>{}))("
  );
  fs.writeFileSync(file, out, 'utf8');
  console.log('[patch] index.js: dynamic mentionPanel loader installed; backup ->', bak);
} else {
  console.log('[patch] index.js: expected import pattern not found; no changes. backup ->', bak);
}
