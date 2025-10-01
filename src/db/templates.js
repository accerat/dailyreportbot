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
    return JSON.parse(s);
  }catch(e){
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

export async function setTemplateForProject(projectId, text){
  const d = await load();
  d.byProjectId = d.byProjectId || {};
  d.byProjectId[String(projectId)] = String(text);
  await save(d);
}

export async function clearTemplateForProject(projectId){
  const d = await load();
  if (d.byProjectId){
    delete d.byProjectId[String(projectId)];
  }
  await save(d);
}
