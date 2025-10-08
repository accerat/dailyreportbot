import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '../../data');
const FILE = join(DATA_DIR, 'templates.json');

async function load(){
  try{
    const s = await readFile(FILE, 'utf8');
    const data = JSON.parse(s);
    if (!data || typeof data !== 'object') return { byProjectId: {} };
    data.byProjectId = data.byProjectId || {};
    return data;
  }catch{
    return { byProjectId: {} };
  }
}

async function save(data){
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(data, null, 2), 'utf8');
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
