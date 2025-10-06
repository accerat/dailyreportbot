import { DateTime } from "luxon";
import * as store from "../db/store.js";
import { STATUS, normalizeStatus } from "../constants/status.js";

const TZ = process.env.TIMEZONE || "America/Chicago";

async function tick(client){
  try{
    const today = DateTime.now().setZone(TZ).toISODate();
    const projects = (await (store.getAllProjects?.() || store.listProjects?.())) || [];
    for (const p of projects){
      const statusKey = normalizeStatus(p.status);
      const start = p.start_date || p.anticipated_start_date || null;
      if (statusKey === STATUS.STARTED /* which we now label "Upcoming" */ && start && String(start) <= today){
        await store.updateProjectFields(p.id, { status: STATUS.IN_PROGRESS });
        try{
          if (p.thread_channel_id){
            const ch = await client.channels.fetch(p.thread_channel_id).catch(()=>null);
            if (ch?.isThread?.()){
              await ch.send("Status auto-updated to **In Progress** (start date reached).");
            }
          }
        }catch{}
      }
    }
  }catch(e){
    console.error("[autoStart] tick error", e);
  }
}

export function startAutoStartJob(client){
  tick(client); // run once at boot
  setInterval(() => tick(client), 60*60*1000); // then hourly
}
