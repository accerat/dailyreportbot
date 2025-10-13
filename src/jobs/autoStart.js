import { DateTime } from "luxon";
import * as store from "../db/store.js";
import { STATUS } from "../constants/status.js";

const TZ = process.env.TIMEZONE || "America/Chicago";

async function tick(client){
  try{
    const today = DateTime.now().setZone(TZ).toISODate();
    const projects = await store.getAllProjects();
    for (const p of projects){
      const statusKey = String(p.status || "").toLowerCase();
      const start = p.start_date || p.anticipated_start_date || null;

      // When start date is reached, just update status - reminders will handle the rest
      if (statusKey === "started" && start && String(start) <= today){
        await store.updateProjectFields(p.id, { status: STATUS.IN_PROGRESS });
      }
    }
  } catch (e){
    console.error("[autoStart] tick error", e);
  }
}

export function startAutoStartJob(client){
  // run now + hourly
  tick(client);
  setInterval(() => tick(client), 60*60*1000);
}
