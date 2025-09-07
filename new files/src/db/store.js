
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_FILE = join(__dirname, '../../data/store.json');
//CHANGED DEFAULTSTATE 8/20 11:09pm 
//const defaultState = { projects: [], daily_reports: [], trigger_events: [], reminder_log: [], missed_reports: [] };

const defaultState = {
  settings: {
    non_uhc_forum_id: null,
    uhc_forum_id: null,
    non_uhc_category_id: null,
    uhc_category_id: null,
    project_category_id: null   // <— NEW single-category slot
  },
  projects: [],
  daily_reports: [],
  trigger_events: [],
  reminder_log: [],
  missed_reports: []
};



async function ensureFile(){ try{ await mkdir(dirname(DATA_FILE),{recursive:true}); await readFile(DATA_FILE,'utf-8'); }catch{ await writeFile(DATA_FILE, JSON.stringify(defaultState,null,2)); } }
export async function load(){ await ensureFile(); return JSON.parse(await readFile(DATA_FILE,'utf-8')); }
export async function save(s){ await writeFile(DATA_FILE, JSON.stringify(s,null,2)); return s; }
export async function getProjectByThread(id){ const s=await load(); return s.projects.find(p=>p.thread_channel_id===id)||null; }
export async function insertDailyReport(r){ const s=await load(); const id=(s.daily_reports.at(-1)?.id||0)+1; const row={id,...r}; s.daily_reports.push(row); const p=s.projects.find(x=>x.id===r.project_id); if(p&&r.percent_complete===100&&!p.completed_at){p.completed_at=r.report_date;} await save(s); return row; }
export async function countReportsUpTo(pid, d){ const s=await load(); return s.daily_reports.filter(r=>r.project_id===pid && r.report_date<=d).length; }
export async function hasReportOn(pid,d){ const s=await load(); return s.daily_reports.some(r=>r.project_id===pid && r.report_date===d); }
export async function logReminder(pid, d, h){ const s=await load(); if(s.reminder_log.some(x=>x.project_id===pid && x.ct_date===d && x.ct_hour===h)) return false; s.reminder_log.push({project_id:pid, ct_date:d, ct_hour:h}); await save(s); return true; }

//replaced "projects needing reminder"
//export async function projectsNeedingReminder(h, d){ const s=await load(); return s.projects.filter(p=>!p.paused && p.reminder_active!==false && Number((p.reminder_start_ct||'08:00').split(':')[0])<=h && !s.daily_reports.some(r=>r.project_id===p.id && r.report_date===d) && !s.reminder_log.some(l=>l.project_id===p.id && l.ct_date===d && l.ct_hour===h)); }
export async function projectsNeedingReminder(ctHour, today) {
  const s = await load();
  return s.projects.filter(p =>
    !p.paused &&
    p.reminder_active !== false &&
    (!p.start_date || p.start_date <= today) &&
    Number((p.reminder_start_ct || '08:00').split(':')[0]) <= ctHour &&
    !s.daily_reports.some(r => r.project_id === p.id && r.report_date === today) &&
    !s.reminder_log.some(l => l.project_id === p.id && l.ct_date === today && l.ct_hour === ctHour)
  );
}

export async function latestReport(pid){ const s=await load(); const list=s.daily_reports.filter(r=>r.project_id===pid).sort((a,b)=> (a.report_date<b.report_date?1:-1)); return list[0]||null; }
export async function sumReportsInRange(pid, a, b){ const s=await load(); const inRange=s.daily_reports.filter(r=>r.project_id===pid && r.created_at>=a && r.created_at<b); const guys=inRange.reduce((t,r)=>t+(+r.man_count||0),0); const hours=inRange.reduce((t,r)=>t+(+r.man_hours||0),0); return {guys, hours}; }
export async function hadTrigger(pid, a, b, type){ const s=await load(); return s.trigger_events.some(t=>t.project_id===pid && t.type===type && t.created_at>=a && t.created_at<b); }
export async function addMissedDay(pid, d){ const s=await load(); if(!s.missed_reports.some(m=>m.project_id===pid && m.ct_date===d)){ s.missed_reports.push({project_id:pid, ct_date:d}); await save(s); } }
export async function countMissed(pid){ const s=await load(); return s.missed_reports.filter(m=>m.project_id===pid).length; }
export async function allSummaryProjects(){ const s=await load(); return s.projects.filter(p=>!p.paused || (p.completed_at && p.track_in_summary!==false)); }

//added exports
export async function getSettings() {
  const s = await load();
  return s.settings || {};
}

export async function saveSettings(partial) {
  const s = await load();
  s.settings = { ...(s.settings || {}), ...partial };
  await save(s);
  return s.settings;
}

export async function upsertProject(project) {
  const s = await load();
  const idx = s.projects.findIndex(p =>
    p.thread_channel_id === project.thread_channel_id ||
    (project.id && p.id === project.id)
  );
  if (idx >= 0) {
    s.projects[idx] = { ...s.projects[idx], ...project };
  } else {
    project.id = (s.projects.at(-1)?.id || 0) + 1;
    s.projects.push(project);
  }
  await save(s);
  return project;
}

// end added exports

// added more exports

export async function getReportById(id){
  const s = await load();
  return s.daily_reports.find(r => r.id === id) || null;
}

export async function getProjectById(id){
  const s = await load();
  return s.projects.find(p => p.id === id) || null;
}

export async function updateReportTriggers(reportId, triggers, authorUserId){
  const s = await load();
  const r = s.daily_reports.find(x => x.id === reportId);
  if (!r) return null;

  // de-dup and normalize
  const list = Array.isArray(triggers) ? [...new Set(triggers)] : [];
  r.triggers = list;

  const now = new Date().toISOString();
  for (const t of list) {
    // record once per report/trigger
    const exists = s.trigger_events.some(e => e.report_id === r.id && e.type === t);
    if (!exists) {
      s.trigger_events.push({
        project_id: r.project_id,
        report_id: r.id,
        type: t,
        created_at: now,
        author_user_id: authorUserId,
      });
    }
  }
  await save(s);
  return r;
}
// v4 add — project status helpers (top-level)
export async function setProjectStatusByThread(threadId, status) {
  const s = await load();
  const p = s.projects.find(x => x.thread_channel_id === threadId);
  if (!p) return null;
  p.status = String(status || '').trim().toLowerCase();
  await save(s);
  return p;
}

export async function closeProjectByThread(threadId, { reason, closedBy } = {}) {
  const s = await load();
  const p = s.projects.find(x => x.thread_channel_id === threadId);
  if (!p) return null;
  p.is_closed = true;
  p.closed_reason = reason || null;
  p.closed_by = closedBy || null;
  p.closed_at = new Date().toISOString();
  if (!p.status || p.status === 'open') p.status = 'closed';
  await save(s);
  return p;
}

export async function reopenProjectByThread(threadId, { reopenedBy } = {}) {
  const s = await load();
  const p = s.projects.find(x => x.thread_channel_id === threadId);
  if (!p) return null;
  p.is_closed = false;
  p.closed_reason = null;
  p.closed_by = reopenedBy || null;
  p.closed_at = null;
  if (p.status === 'closed' || !p.status) p.status = 'open';
  await save(s);
  return p;
}

 // end added more exports

// === Injected helpers for new features ===
import { STATUS, normalizeStatus } from '../constants/status.js';

function _ensureProjectDefaults(p){
  if (!p.status) p.status = STATUS.STARTED;
  p.status = normalizeStatus(p.status);
  if (!p.reminder_time) p.reminder_time = '19:00';
  if (!('last_report_date' in p)) p.last_report_date = null;
  if (!('lastWeatherPostedAt' in p)) p.lastWeatherPostedAt = null;
  return p;
}

export async function updateProjectFields(id, fields){
  const s = await load();
  const idx = (s.projects||[]).findIndex(p=>p.id===id);
  if (idx === -1) return false;
  s.projects[idx] = { ..._ensureProjectDefaults(s.projects[idx]), ...fields };
  await save(s);
  return true;
}

function _alreadyReminded(s, pid, dateISO, hour){
  return (s.reminder_log||[]).some(r=>r.project_id===pid && r.ct_date===dateISO && r.ct_hour===hour);
}
function _hasReportOn(s, pid, dateISO){
  return (s.daily_reports||[]).some(r=>r.project_id===pid && r.report_date===dateISO);
}
function _firstReportDate(s, pid){
  const rows = (s.daily_reports||[]).filter(r=>r.project_id===pid).sort((a,b)=>(a.report_date||'').localeCompare(b.report_date||''));
  return rows[0]?.report_date || null;
}

// Override reminder selection logic
export async function projectsNeedingReminder(hour, todayISO){
  const s = await load();
  const projects = (s.projects||[]).map(_ensureProjectDefaults);

  const needsHour = (p) => {
    const h = Number(String(p.reminder_time||'19:00').split(':')[0]) || 19;
    return h === Number(hour);
  };

  return projects.filter(p => {
    if (_alreadyReminded(s, p.id, todayISO, hour)) return false;
    if (!needsHour(p)) return false;

    const status = normalizeStatus(p.status);
    const inProgress = status === STATUS.IN_PROGRESS;

    const startDate = p.start_date || _firstReportDate(s, p.id) || null;
    const started = startDate ? (todayISO >= startDate) : false;
    const hasAnyReport = (s.daily_reports||[]).some(r=>r.project_id===p.id);
    const hasTodayReport = _hasReportOn(s, p.id, todayISO);

    if (hasTodayReport) return false;
    if (inProgress) return true;
    if (started && !hasAnyReport) return true;
    return false;
  });
}
