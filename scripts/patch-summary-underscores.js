// scripts/patch-summary-underscores.js
// Rewrites lingering underscored temp vars in src/services/summary.js
// Makes code consistent: _health -> healthVal, _isToday -> isToday, _healthCell -> healthCell
import fs from 'node:fs';

const file = 'src/services/summary.js';
const bak  = `src/services/summary.js.bak-${new Date().toISOString().replace(/[:]/g,'-')}`;

const src = fs.readFileSync(file, 'utf8');
fs.writeFileSync(bak, src);

let out = src;
out = out.replace(/\b_health\b/g, 'healthVal');
out = out.replace(/\b_isToday\b/g, 'isToday');
out = out.replace(/\b_healthCell\b/g, 'healthCell');

fs.writeFileSync(file, out, 'utf8');
console.log('[patch] underscores fixed; backup ->', bak);
