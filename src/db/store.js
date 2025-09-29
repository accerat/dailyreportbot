// src/db/store.js
import fs from 'fs';
import path from 'path';
const DATA_PATH = path.resolve(process.cwd(), 'data', 'store.json');

export async function load(){
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const s = JSON.parse(raw);
    if (!s.thread_templates) s.thread_templates = {};
    if (!Array.isArray(s.projects)) s.projects = s.projects || [];
    if (!Array.isArray(s.daily_reports)) s.daily_reports = s.daily_reports || [];
    return s;
  } catch {
    return { thread_templates: {}, projects: [], daily_reports: [] };
  }
}
export async function save(s){
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(s, null, 2), 'utf8');
}

export async function getThreadTemplate(threadId){
  const s = await load();
  return s.thread_templates?.[threadId] || null;
}
export async function setThreadTemplate(threadId, scopes, { updatedBy } = {}){
  const s = await load();
  if (!s.thread_templates) s.thread_templates = {};
  const clean = Array.isArray(scopes) ? scopes.map(x => String(x).trim()).filter(Boolean) : [];
  s.thread_templates[threadId] = {
    scopes: clean,
    updatedBy: updatedBy || null,
    updatedAt: Date.now(),
  };
  await save(s);
  return s.thread_templates[threadId];
}