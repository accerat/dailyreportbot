
# DailyReportBot v2 — JS-only (no DB)
Runs locally with Node. Uses `data/store.json` instead of Postgres.

## Quick start
```powershell
npm install
copy .env.example .env   # fill BOT_TOKEN, APP_ID, GUILD_ID, forum/channel IDs, ADMIN_USER_IDS
npm run register
npm start
```

## Seed a test project
```powershell
node -e "const f=require('fs');const p='data/store.json';const s=JSON.parse(fs.readFileSync(p));s.projects.push({id:1,name:'Test Project A',thread_channel_id:'<THREAD_ID>',foreman_user_id:'<FOREMAN_ID>',reminder_start_ct:'08:00',paused:false,reminder_active:true,track_in_summary:true});fs.writeFileSync(p,JSON.stringify(s,null,2));console.log('ok')"
```
