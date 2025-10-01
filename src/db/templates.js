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
    // Normalize legacy formats:
    // - {} or { byProjectId: { [id]: "string template" } }
    if (!data || typeof data !== 'object') return { byProjectId: {} };
    data.byProjectId = data.byProjectId || {};
    for (const [k, v] of Object.entries(data.byProjectId)){
      if (typeof v === 'string'){
        data.byProjectId[k] = { summary: v, endDate: '' };
      } else if (v && typeof v === 'object'){
        data.byProjectId[k] = {
          summary: String(v.summary || v.body || v.text || ''),
          endDate: String(v.endDate || v.completion || v.completeBy || ''),
        };
      } else {
        data.byProjectId[k] = { summary: '', endDate: '' };
      }
    }
    return data;
  }catch(e){
    return { byProjectId: {} };
  }
}

async function save(data){
  await mkdir(DATA_DIR, { recursive: true });
  // ensure normalized
  const norm = await (async () => {
    if (!data || typeof data !== 'object') return { byProjectId: {} };
    const out = { byProjectId: {} };
    for (const [k, v] of Object.entries(data.byProjectId || {})){
      if (v && typeof v === 'object') out.byProjectId[k] = { summary: String(v.summary || ''), endDate: String(v.endDate || '') };
      else out.byProjectId[k] = { summary: String(v || ''), endDate: '' };
    }
    return out;
  })();
  await writeFile(FILE, JSON.stringify(norm, null, 2), 'utf8');
}

export async function getTemplateForProject(projectId){
  const d = await load();
  return d.byProjectId?.[String(projectId)] || { summary: '', endDate: '' };
}

export async function setTemplateForProject(projectId, value){
  const d = await load();
  d.byProjectId = d.byProjectId || {};
  if (typeof value === 'string'){
    d.byProjectId[String(projectId)] = { summary: value, endDate: '' };
  } else if (value && typeof value === 'object'){
    d.byProjectId[String(projectId)] = {
      summary: String(value.summary || value.body || value.text || ''),
      endDate: String(value.endDate || value.completion || value.completeBy || ''),
    };
  } else {
    d.byProjectId[String(projectId)] = { summary: '', endDate: '' };
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
