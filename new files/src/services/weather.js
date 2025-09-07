import { DateTime } from 'luxon';
import * as store from '../db/store.js';

const UA = 'DailyReportBot/1.0 (weather)';
const WMO_TS = new Set([95,96,99]);

function extractCityState(projectName) {
  const m = projectName.match(/([A-Za-z .'-]+,\s*[A-Z]{2})\s*$/);
  return m ? m[1].trim() : null;
}

async function geocode(cityState) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityState)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }});
  const js = await res.json();
  if (!js?.length) return null;
  return { lat: +js[0].lat, lon: +js[0].lon, display: cityState };
}

async function fetchHourly(lat, lon, tz) {
  const start = DateTime.now().setZone(tz);
  const end = start.plus({ hours: 24 });
  const startDate = start.toISODate();
  const endDate = end.toISODate();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&hourly=temperature_2m,precipitation,snowfall,weathercode,windspeed_10m,windgusts_10m`
    + `&timezone=${encodeURIComponent(tz)}&start_date=${startDate}&end_date=${endDate}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }});
  return res.json();
}

function hazardLines(hourly, tz) {
  if (!hourly?.hourly?.time) return [];
  const h = hourly.hourly;
  const times = h.time.map(t => DateTime.fromISO(t, { zone: tz }));

  const within24 = times.map((t, i) => ({ i, t }));
  const HEAVY_RAIN_IN_PER_HR = 0.25;
  const SNOW_IN_24H = 1.0;
  const GUST_WIND = 35;
  const HOT = 95;
  const COLD = 20;

  const lines = [];

  // Thunderstorms windows
  let runStart = null;
  for (let k=0; k<within24.length; k++) {
    const {i,t} = within24[k];
    const isTs = WMO_TS.has(h.weathercode[i]);
    const isLast = (k === within24.length - 1);
    if (isTs && runStart === null) runStart = t;
    if ((!isTs || isLast) && runStart) {
      const lastT = isTs && isLast ? t : times[i-1];
      lines.push(`⛈️ Thunderstorms likely ${runStart.toFormat('h a')}–${lastT.toFormat('h a')}`);
      runStart = null;
    }
  }

  const heavy = within24.filter(({ i }) => (h.precipitation[i] || 0) >= HEAVY_RAIN_IN_PER_HR);
  if (heavy.length) {
    const hrs = heavy.map(({ t }) => t.toFormat('h a')).join(', ');
    lines.push(`🌧️ Heavy rain ≥ ${HEAVY_RAIN_IN_PER_HR}\" around ${hrs}`);
  }

  const snowTotal = within24.reduce((s, { i }) => s + (h.snowfall[i] || 0), 0);
  if (snowTotal >= SNOW_IN_24H) lines.push(`❄️ Snow ${snowTotal.toFixed(1)}\" in next 24h`);

  const gustMax = Math.max(...within24.map(({ i }) => h.windgusts_10m[i] || 0));
  if (gustMax >= GUST_WIND) lines.push(`💨 Gusts up to ${Math.round(gustMax)} mph`);

  const temps = within24.map(({ i }) => h.temperature_2m[i] || 0);
  const tMax = Math.max(...temps);
  const tMin = Math.min(...temps);
  if (tMax >= HOT) lines.push(`🥵 High to ~${Math.round(tMax)}°F`);
  if (tMin <= COLD) lines.push(`🥶 Low to ~${Math.round(tMin)}°F`);

  return lines;
}

export async function postWeatherHazardsIfNeeded({ project, channel, tz }) {
  const now = DateTime.now().setZone(tz);
  const last = project.lastWeatherPostedAt ? DateTime.fromISO(project.lastWeatherPostedAt, { zone: tz }) : null;
  if (last && now.diff(last, 'hours').hours < 18) return;

  const cityState = extractCityState(project.name);
  if (!cityState) return;

  const geo = await geocode(cityState).catch(() => null);
  if (!geo) return;

  const forecast = await fetchHourly(geo.lat, geo.lon, tz).catch(() => null);
  const lines = hazardLines(forecast, tz);
  if (!lines.length) return;

  await channel.send({
    content: ['🌤️ **Next 24h weather hazards**', `Location: ${geo.display}`, '', ...lines.map(l => `• ${l}`)].join('\n')
  });

  await store.updateProjectFields(project.id, { lastWeatherPostedAt: now.toISO() });
}
