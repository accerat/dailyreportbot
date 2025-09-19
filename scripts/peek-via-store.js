// scripts/peek-via-store.js
// Usage: node scripts/peek-via-store.js <projectId> [lookbackDays]
import { DateTime } from 'luxon';
import * as store from '../src/db/store.js';

const CT = 'America/Chicago';
const id = Number(process.argv[2] ?? '0');
const lookback = Number(process.argv[3] ?? '45');

if (!id) {
  console.error('usage: node scripts/peek-via-store.js <projectId> [lookbackDays]');
  process.exit(2);
}

try {
  await store.load();
} catch (e) {
  // some stores load lazily; ignore
}

let lastISO = null;
for (let d = 0; d < lookback; d++) {
  const dayISO = DateTime.now().setZone(CT).minus({ days: d }).toISODate();
  try {
    // hasReportOn(id, 'YYYY-MM-DD') -> boolean
    // returns true if a report exists for that calendar day
    // eslint-disable-next-line no-await-in-loop
    const yes = await store.hasReportOn(id, dayISO);
    if (yes) { lastISO = dayISO; break; }
  } catch (_) { /* ignore and continue */ }
}

const out = {
  ok: true,
  called: { hasReportOn: '(id, dayISO)' },
  guess: {
    timestamp: lastISO,
    text: lastISO ? DateTime.fromISO(lastISO).setZone(CT).toFormat('M/d') : null,
    health: null,
    isToday: lastISO === DateTime.now().setZone(CT).toISODate(),
  }
};
console.log(JSON.stringify(out, null, 2));
