// src/relay/dailyReportsForwarder.js
// No-op: Forwarding is handled inline in interactions/mentionPanel.js after the Daily Report is posted.
// This file exists only to satisfy prior imports to avoid runtime errors.
export function wireDailyReportsForwarding(client){
  try {
    console.log('[dailyReportsForwarder] forwarding handled inline; no-op');
  } catch {}
}
