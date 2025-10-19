// src/db/templates.js
// ARCHITECTURAL PRINCIPLE: Google Drive is the PRIMARY database
// Local files are NOT used - all reads/writes go directly to Drive

import { loadFromDrive, saveToDrive } from '../utils/driveStorage.js';

async function load(){
  try{
    const data = await loadFromDrive('templates', { byProjectId: {} });
    if (!data || typeof data !== 'object') return { byProjectId: {} };
    data.byProjectId = data.byProjectId || {};
    return data;
  }catch{
    return { byProjectId: {} };
  }
}

async function save(data){
  await saveToDrive('templates', data);
}

export async function getTemplateForProject(projectId){
  const d = await load();
  return d.byProjectId?.[String(projectId)] || '';
}

export async function setTemplateForProject(projectId, value){
  const d = await load();
  d.byProjectId = d.byProjectId || {};
  // allow string or object { body, end, start, reminder_time, foreman }
  if (typeof value === 'string'){
    d.byProjectId[String(projectId)] = value;
  } else if (value && typeof value === 'object'){
    d.byProjectId[String(projectId)] = {
      body: String(value.body || ''),
      end: String(value.end || ''),
      start: String(value.start || ''),
      reminder_time: String(value.reminder_time || ''),
      foreman: String(value.foreman || '')
    };
  } else {
    d.byProjectId[String(projectId)] = '';
  }
  await save(d);
}

export async function clearTemplateForProject(projectId){
  const d = await load();
  if (d.byProjectId){
    delete d.byProjectId[String(projectId)];
  }
  await save(d);
}
