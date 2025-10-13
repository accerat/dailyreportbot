import { DateTime } from "luxon";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
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

      // Check if this project has reached its start date and needs confirmation
      if (statusKey === "started" && start && String(start) <= today){
        // Check if we've already sent a confirmation request today
        if (p.confirmation_requested_date === today) continue;

        try {
          if (p.thread_channel_id){
            const thread = await client.channels.fetch(p.thread_channel_id).catch(()=>null);
            if (thread?.isThread?.()){
              const foreman = p.foreman_display || p.foreman_user_id ? `<@${p.foreman_user_id}>` : '@Foreman';

              const embed = new EmbedBuilder()
                .setTitle('🚀 Project Start Date Reached')
                .setDescription(`${foreman}, your project **${p.name}** has reached its start date (${start}). Please confirm your arrival details.`)
                .setColor(0x3498db)
                .setTimestamp();

              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`arrival:confirm:${p.id}`)
                  .setLabel('Confirm Arrival Details')
                  .setStyle(ButtonStyle.Primary)
              );

              await thread.send({ content: p.foreman_user_id ? `<@${p.foreman_user_id}>` : '', embeds: [embed], components: [row] });

              // Mark that we've sent the confirmation request
              await store.updateProjectFields(p.id, { confirmation_requested_date: today });
            }
          }
        } catch (e) {
          console.error(`[autoStart] Failed to send confirmation for project ${p.id}:`, e);
        }
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
