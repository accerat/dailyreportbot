# DailyReportBot Troubleshooting Session - October 20, 2025

---
## 🚨 CRITICAL INSTRUCTION FOR CLAUDE 🚨

**ALWAYS UPDATE THIS LOG AS YOU WORK**

This document must be continuously updated throughout the troubleshooting session:
- ✅ After every significant discovery or finding
- ✅ After every command executed that reveals new information
- ✅ After every file change or configuration update
- ✅ After every state transition (e.g., restarting services, testing changes)
- ✅ After every hypothesis tested (whether it succeeds or fails)
- ✅ When learning anything new about the system behavior

**Why**: If the session disconnects, the next Claude instance needs a complete history to understand:
1. What the problem is
2. What has been tried
3. What was discovered
4. What the current state is
5. What to do next

**How**: Add new sections with timestamps as work progresses. You can delete outdated information later, but NEVER work without updating this log first.

---

## Issue Summary
DailyReportBot was responding to mentions with **TWO duplicate panels** showing different data:
- Panel 1: Nick Phelps, 06:00 reminder time
- Panel 2: Kenny Reyes, 19:00 reminder time

## Root Cause Investigation

### Initial Diagnosis
- Google Drive OAuth credentials were missing/misconfigured
- Multiple bot versions (V2, V3, V4) existed with conflicting configurations
- V3 and V4 were using the **same BOT_TOKEN**, causing potential conflicts

### Actions Taken

#### 1. Fixed Google Drive Integration
- Added Google OAuth credentials to V3DailyReportBot/.env:
  - `GOOGLE_OAUTH_CLIENT_ID=[REDACTED]`
  - `GOOGLE_OAUTH_CLIENT_SECRET=[REDACTED]`
  - `GOOGLE_OAUTH_REFRESH_TOKEN=[REDACTED]`

- Created upload-to-drive.js script to upload local JSON files to Google Drive
- Added Drive file IDs to .env:
  - `STORE_JSON_DRIVE_ID=1lA3ioBBk8IVhhTNQQJTu0Sahvy1KDiwC`
  - `TEMPLATES_JSON_DRIVE_ID=1FHYuHsHw5ambA80g5yvEL1bW3CaDE3mP`

#### 2. Cleaned Up Multiple Bot Versions
- **V2DailyReportBot**: Renamed to `V2DailyReportBot.OLD` (had different BOT_TOKEN)
- **V3DailyReportBot**: Active version (kept running)
- **V4DailyReportBot**: Renamed to `V4DailyReportBot.OLD` and disabled token
  - Changed `BOT_TOKEN` to `DISABLED_USE_V3_INSTEAD` to prevent conflicts

#### 3. PM2 Process Management
- Deleted old `v3dailyreportbot` PM2 process
- Created new PM2 process named `DailyReportBot`:
  ```bash
  cd "C:\Users\acela\Bots\V3DailyReportBot"
  npx pm2 start src/index.js --name DailyReportBot
  npx pm2 save
  ```

#### 4. Added Debug Logging
Enhanced `src/interactions/mentionPanel.js` with detailed logging:
- Lines 143, 148, 150: Log mention receipt, project load, panel display
- Lines 127, 132-134, 136-138: Log every showPanel call with project details

### Key Findings from Logs

**Critical Discovery**: Logs show only **ONE** mention being processed:
```
[mentionPanel] Mention received in thread: 1413164224632459284
[drive-storage] ✅ Loaded store from Drive (6 top-level keys)
[mentionPanel] Project loaded: ID=3, Name=Pinellas Park, FL - 1390.1006, Foreman=Kenny Reyes, Time=19:00
[showPanel] CALLED - Project: 3, Foreman: Kenny Reyes, Time: 19:00
[showPanel] Attempting msg.reply for project 3
[showPanel] msg.reply SUCCESS for project 3
[mentionPanel] Panel shown for project ID=3
```

**But user sees TWO Discord messages with different data!**

This proves:
- ✅ Only ONE showPanel() call happening in code
- ✅ Only ONE bot instance running in PM2
- ✅ Nick Phelps message is NOT coming from current running code
- ❌ Duplicate is coming from external source

### Current Data State
**Google Drive Store** (store.json) shows only ONE Pinellas Park project:
```json
{
  "id": 3,
  "name": "Pinellas Park, FL - 1390.1006",
  "thread_channel_id": "1413164224632459284",
  "foreman_display": "Kenny Reyes",
  "foreman_user_id": "1404918954258071645",
  "reminder_time": "19:00",
  "start_date": "2025-10-04",
  "status": "in_progress"
}
```

**User's Desired State**: Should show Nick Phelps, 06:00 (from template update)

## Possible Causes of Duplicate

### 1. Discord Client Cache (Most Likely)
- Old Discord client (browser/desktop) may have cached JavaScript/service worker
- Cached state showing old Nick Phelps data
- **Solution**: Full system restart to clear all Discord instances

### 2. Hidden Node Process (Less Likely)
- Checked: 5 node processes running (PM2 daemon + 2 bots + 2 background tasks)
- No evidence of rogue DailyReportBot process
- **Solution**: System restart will kill any hidden processes

### 3. Discord Server-Side Cache (Unlikely)
- Discord's gateway might have cached interaction responses
- **Solution**: Wait or restart bot token

## Next Steps After System Restart

1. **Verify PM2 Auto-Started**:
   ```bash
   npx pm2 list
   ```
   Should show: DailyReportBot (online) and TaskBot (online)

2. **Check Logs**:
   ```bash
   npx pm2 logs DailyReportBot --lines 20
   ```
   Should see only ONE login: `[ready] logged in as DailyReportBot#4137`

3. **Test Mention**:
   - Open only ONE Discord client (preferably desktop app)
   - Mention @DailyReportBot in Pinellas Park thread
   - Check if still seeing duplicate messages

4. **Review Logs After Mention**:
   ```bash
   npx pm2 logs DailyReportBot --lines 50 --nostream
   ```
   Should see debug output showing exactly what project data was loaded

## If Duplicate Persists After Restart

### Check for Hidden Webhooks
```bash
cd "C:\Users\acela\Bots\V3DailyReportBot"
grep -r "webhook" src/ --include="*.js"
```

### Check Discord Developer Portal
- Go to https://discord.com/developers/applications
- Verify only ONE application exists for DailyReportBot
- Check bot token matches expected value in .env

### Nuclear Option: Regenerate Bot Token
If all else fails, regenerate the Discord bot token to force disconnect any cached connections

## File Locations

- **Active Bot**: `C:\Users\acela\Bots\V3DailyReportBot`
- **PM2 Logs**: `C:\Users\acela\.pm2\logs\DailyReportBot-*.log`
- **Drive Store**: Google Drive file ID `1lA3ioBBk8IVhhTNQQJTu0Sahvy1KDiwC`
- **Archived Versions**:
  - `C:\Users\acela\Bots\V2DailyReportBot.OLD`
  - `C:\Users\acela\Bots\V4DailyReportBot.OLD`

## PM2 Management Commands

```bash
# List processes
npx pm2 list

# View logs (live)
npx pm2 logs DailyReportBot

# View logs (snapshot)
npx pm2 logs DailyReportBot --lines 50 --nostream

# Restart bot
npx pm2 restart DailyReportBot

# Stop bot
npx pm2 stop DailyReportBot

# Delete process
npx pm2 delete DailyReportBot

# Save PM2 configuration (for auto-start)
npx pm2 save

# Resurrect saved processes (after reboot)
npx pm2 resurrect
```

## Important Notes

1. **Directory Rename Pending**: V3DailyReportBot should be renamed to just "DailyReportBot"
   - Currently blocked by file lock (probably Claude Code process)
   - Can rename after closing Claude Code session

2. **Data Discrepancy**: Store shows Kenny Reyes, but user expects Nick Phelps
   - User had set template to Nick Phelps/06:00
   - Need to verify template was actually saved to Drive
   - May need to re-set template after duplicate issue is resolved

3. **Token Security**: Bot tokens are exposed in this document for troubleshooting
   - Consider regenerating tokens after issue is resolved
   - Ensure .env files are in .gitignore

## UPDATE: October 20, 2025 - Post-Restart Status

### Directory Renamed
- ✅ **V3DailyReportBot → DailyReportBot**
- Working directory is now: `C:\Users\acela\bots\DailyReportBot`

### System Restart Completed
User has restarted the computer to:
- ✅ Kill all Discord client instances
- ✅ Terminate any hidden Node.js processes
- ✅ Clear all in-memory caches
- ✅ Verify PM2 auto-start functionality

### Travel Tagging Feature Removed
The following files were deleted (no longer needed):
- `src/commands/adminTravelTag.js`
- `src/jobs/travelTagging.js`
- `src/services/clockifyTravelTagger.js`

Modified files to remove travel tag references:
- `src/index.js`: Removed import of `travelTagging.js` and `adminTravelTag.js` command
- `src/scripts/register-commands.js`: Removed `adminTravelTag` from command registration

### Utility Scripts Created
Three diagnostic scripts were created during troubleshooting:
1. **check-all-projects.js** - Downloads and displays all projects from Google Drive
2. **find-duplicates.js** - Finds duplicate projects by thread_channel_id
3. **upload-to-drive.js** - Uploads store.json and templates.json to Google Drive

### Current Git Status
```
D src/commands/adminTravelTag.js (deleted)
M src/index.js (modified - removed travel tag imports)
M src/interactions/mentionPanel.js (modified - debug logging added)
D src/jobs/travelTagging.js (deleted)
M src/scripts/register-commands.js (modified - removed travel tag)
D src/services/clockifyTravelTagger.js (deleted)
?? TROUBLESHOOTING_NOTES.md (new)
?? check-all-projects.js (new)
?? find-duplicates.js (new)
?? upload-to-drive.js (new)
```

### CRITICAL MISTAKE: Was Looking at Local Machine, Not AWS
**Time**: After system restart
**Mistake**: Claude was checking PM2 status on LOCAL Windows machine instead of AWS production server
- **Local machine**: `C:\Users\acela\bots\DailyReportBot` (development only, should NOT run bots)
- **AWS production**: `ubuntu@18.118.203.113` (where all bots actually run)

**Correct Understanding:**
- Per PROJECT_LOG.md: "PRODUCTION: Runs ONLY on AWS"
- Per PROJECT_LOG.md: "NEVER run locally - running locally creates a second bot instance which causes confusion"
- Local PM2 showing empty list is CORRECT behavior
- Need to SSH to AWS to check actual bot status

**What Actually Happened:**
- User restarted LOCAL Windows computer
- DailyReportBot is running on AWS (remote server, not affected by local restart)
- Duplicate posting issue was caused by LOCAL instance Claude accidentally started
- Computer restart killed the local instance, resolving the duplicate issue

**Resolution**: Duplicate posting issue RESOLVED by restarting computer (killed local instance)

### AWS Bot Status Investigation

**MaterialBot Issue** - ✅ RESOLVED - Invalid Discord Token
- **Problem**: PM2 showed "online" but bot was NOT connected to Discord
- Error: `[login] FAILED: An invalid token was provided.`
- Old invalid token was revoked
- **Root cause**: Token had been revoked or regenerated on Discord Developer Portal
- **Solution Applied**:
  1. Updated token in `/home/ubuntu/bots/MaterialBot/.env` with new valid token
  3. Restarted: `pm2 restart MaterialBot --update-env`
- **Result**: ✅ MaterialBot now online and connected
  - `[ready] Logged in as MaterialBot#4207 (1403593890195439747)`
  - `✓ Slash commands registered`

**TaskBot Issue** - ✅ RESOLVED - Not Deployed to AWS
- **Problem**: TaskBot existed locally but not on AWS
- Old invalid token needed updating
- **Solution Applied**:
  1. Created archive of TaskBot (excluding node_modules and .git)
  2. Copied to AWS via scp: `scp TaskBot.tar.gz aws:~/bots/`
  3. Extracted on AWS: `tar -xzf TaskBot.tar.gz`
  4. Installed dependencies: `npm install`
  5. Created .env with new valid token
  6. Started with PM2: `pm2 start src/index.js --name TaskBot`
  7. Saved PM2 config: `pm2 save`
- **Result**: ✅ TaskBot now online and connected
  - `[TaskBot] Logged in as TaskBot#4752`
  - `[TaskBot] Ready to process Clockify tasks`
  - Travel tagging cron job scheduled

## 🎉 SESSION SUMMARY - All Issues Resolved

### Issues Fixed
1. ✅ **DailyReportBot Duplicate Posting** - RESOLVED
   - Root cause: Local instance was running simultaneously with AWS instance
   - Solution: Computer restart killed local instance

2. ✅ **MaterialBot Offline** - RESOLVED
   - Root cause: Invalid Discord token (401 Unauthorized)
   - Solution: Updated token in AWS .env and restarted
   - Status: Now logged in as MaterialBot#4207

3. ✅ **TaskBot Missing** - RESOLVED
   - Root cause: TaskBot was never deployed to AWS
   - Solution: Deployed TaskBot to AWS with new token
   - Status: Now logged in as TaskBot#4752

### All Bots Status (AWS Production)
- ✅ **ChangeBot** - Online (36h uptime)
- ✅ **DailyReportBot** - Online (14h uptime)
- ✅ **LodgingBot** - Online (18h uptime)
- ✅ **MaterialBot** - Online (newly fixed)
- ✅ **TaskBot** - Online (newly deployed)

### DailyReportBot Code Status Check

**Local Machine** (not deployed):
- Travel tag files DELETED locally
- Changes not committed or pushed
- Files deleted: `adminTravelTag.js`, `travelTagging.js`, `clockifyTravelTagger.js`
- Modified: `index.js`, `mentionPanel.js`, `register-commands.js`
- Status: Uncommitted changes

**AWS Production** (currently running):
- Travel tag files STILL EXIST on AWS
- Code still has travel tag imports and references
- AWS is running OLD code (before travel tag removal)
- Command may not show on Discord if registration wasn't run

**Important**: Local changes were never committed or deployed. AWS still has travel tag code.

### Decision: Removing Travel Tag Feature Completely

**What Happened Yesterday** (reconstructed):
- Claude deleted the travel tag slash command registration
- But left the background cron job and service files intact
- Did not commit or deploy changes
- Did not document the work

**Current State**:
- Slash command gone from Discord (registration removed)
- Background job still running on AWS (processing travel entries weekly)
- Files still exist on AWS but deleted locally

**Action Plan** (Option 2 - Complete Removal):
1. Commit local deletions to git
2. Deploy to AWS
3. Restart DailyReportBot on AWS
4. Verify travel tagging stops running
5. Document everything properly

### Deployment Complete ✅

**Commit**: `2667225` - Remove travel tagging feature and add troubleshooting docs
**Pushed to**: GitHub main branch
**Deployed to**: AWS production
**DailyReportBot**: Restarted successfully

Travel tagging feature has been completely removed from production.

## NEW ISSUE: Status Update Interaction Failed (Oct 20, 2025)

**Problem**: User tried to set Palm Coast Florida status to "Leaving & incomplete" via DailyReportBot
**Error**: "this interaction failed" message in Discord
**Time**: Immediately after deployment of travel tag removal

**Root Cause Found**:
- Error: `TypeError: Assignment to constant variable.` at line 475
- Line 455: `const project = await store.getProjectById(pid);`
- Line 475: `project = await store.getProjectById(pid);` (trying to reassign const)
- This code tries to re-fetch the project after updating Clockify ID

**Fix Applied**:
1. ✅ Change line 455 from `const project` to `let project` to allow reassignment
2. ✅ Add `deferReply()` at start of status update handler (line 449)
3. ✅ Change final `i.reply()` to `i.editReply()` (line 578)

**Explanation**: Status updates take >3 seconds due to Drive saves and Clockify operations.
Discord times out interactions that don't respond within 3 seconds, showing "interaction failed"
even though the status IS actually updating successfully in the background.

**Solution**: Defer the reply immediately, do heavy work, then edit the deferred reply.

**Status**: ✅ RESOLVED - Deployed (commit cd6d307)

---

## NEW FEATURE REQUEST: AI Conversation Analysis for TaskBot (Oct 20, 2025)

**User Request**: Add AI to TaskBot to answer questions about Discord thread conversations

**Example Use Case**:
- Thread: "Des Moines" (has a change order)
- Query: "For the thread Des Moines, what were all the issues?"
- Expected: AI scans entire thread conversation history and summarizes issues

**Implementation Considerations**:
1. **AI Provider**: Which AI service? (OpenAI GPT, Anthropic Claude, etc.)
2. **Message Retrieval**: Fetch Discord thread message history
3. **Context Window**: How many messages to include? (threads can be very long)
4. **Query Interface**: Slash command? Mention bot? DM?
5. **Permissions**: Who can query? Admins only or all users?
6. **Cost Management**: AI API calls cost money per token

**Next Steps**: Planning implementation approach...

---

## NEW ISSUES: Daily Report Submission & Admin Summary Broken (Oct 20, 2025)

**Problem 1**: Daily report submission failing in non-UHC project "Reporty"
- Channel ID: 1397270791175012453
- Error: Unknown (user reports "there's an error")
- Timing: After recent deployments (travel tag removal + defer fix)

**Problem 2**: Admin-summary function not working
- Likely related to same code changes

**Root Cause Found**:
```
ExpectedConstraintError > s.string().lengthLessThanOrEqual()
Expected: expected.length <= 45
Received: 'Daily Report — Martin - Plastic Surgeon, Houston' (50 chars)
```

**Explanation**:
- Discord modal titles have a **45 character limit**
- Modal title format: `Daily Report — ${project.name}`
- Projects with long names (like "Martin - Plastic Surgeon, Houston") exceed this limit
- This causes the modal creation to fail with validation error

**Fix Applied**:
- Truncate project name in modal title to fit 45 char limit
- Formula: `maxNameLength = 45 - 'Daily Report — '.length = 29 chars`
- If name > 29 chars: `truncate to 28 chars + '…'`
- Example: "Martin - Plastic Surgeon..." instead of full name

**Note**: Admin summary issue likely same root cause (checking...)

**Admin Summary Root Cause**:
```
Invalid Form Body
content[BASE_TYPE_MAX_LENGTH]: Must be 2000 or fewer in length.
```

**Explanation**:
- Admin summary creates a table with all active projects
- Discord message content limited to **2000 characters**
- With many projects, the table exceeds this limit
- Error at line 186 in summary.js when sending the table

**Fix Applied**:
- Check if table length > 2000 chars
- If yes: Split into multiple messages (max 1990 chars each to leave room for code blocks)
- Preserve table structure by including header in first message only
- Each subsequent message continues with ```diff code block

**"You Haven't Done Daily Report" Notification Issue**:
- User received DM from bot about Spring, TX project
- Message: "We don't have today's report"
- Context: User ran admin-summary command around the same time

**DM Source Found**:
- Location: `src/jobs/remindersRuntime.js` line 51
- Trigger: Hourly cron job (`src/jobs/reminders.js`) runs every hour
- Message: `⏰ Daily Report Reminder — **${project.name}**\nWe don't have today's report (CT ${today}).`

**Analysis**:
- The DM was NOT triggered by admin-summary
- It was **coincidental timing** - the hourly reminder cron ran at the same time
- The reminder system checks `projectsNeedingReminder()` every hour
- If project is in_progress/started and matches reminder_time hour, DM is sent
- Spring, TX has reminder configured for that hour, so DM was sent

**Conclusion**: Not a bug, just timing coincidence. The reminder system is working as intended.

---

## NEW ISSUE: Projects Stuck in "Upcoming" Status (Oct 23, 2025)

**Problem**: Admin-summary shows projects with "Upcoming" status but start dates 20+ days ago

**Examples from summary**:
- Porter, TX - Start: 2025-10-04, Status: Upcoming (19 days ago)
- Presque Isle, ME - Start: 2025-10-04, Status: Upcoming (19 days ago)
- Apopka, FL - Start: 2025-10-04, Status: Upcoming (19 days ago)
- Several others with start date 2025-10-04 still marked "Upcoming"

**Expected Behavior**:
- Projects should be "Upcoming" BEFORE start date
- Once start date arrives, status should change to "Started" or "In Progress"
- Projects 19 days past start date should NOT still be "Upcoming"

**Possible Causes**:
1. Manual status updates not happening (users not updating status)
2. No automatic status transition from "Upcoming" → "Started" on start date
3. Projects created with wrong initial status

**Root Cause Found**:
From `constants/status.js` line 10:
```javascript
[STATUS.STARTED]: 'Upcoming',  // status value = 'started', label = 'Upcoming'
```

**Analysis**:
- Status value in database: `'started'`
- Display label: "Upcoming"
- This is **confusing labeling**, not incorrect data
- Projects with start dates 19 days ago are in `'started'` status
- The label "Upcoming" makes it LOOK like they haven't started yet
- But technically they HAVE started - they're just not "In Progress" yet

**Status Workflow**:
1. `started` (labeled "Upcoming") - Project created, before or just after start date
2. `in_progress` (labeled "In Progress") - Active work happening
3. `leaving_incomplete` - Leaving before completion
4. `complete_no_gobacks` - Finished
5. `on_hold` - Paused

**The Question**: Should the label be changed from "Upcoming" to something else?
- Option 1: Change label to "Started" (matches the status value)
- Option 2: Keep as-is (user understands workflow)
- Option 3: Add automatic transition from 'started' → 'in_progress' on start date

**User Decision**: Remove "started" status entirely

**Desired Status List**:
1. **Upcoming** - Before start date only
2. **In Progress** - Active work (should auto-transition from Upcoming on start date)
3. **Leaving & Incomplete** - Leaving before completion
4. **Complete** - 100% done
5. **On Hold** - Keep this? (User didn't mention, need to verify)

**Required Changes**:
1. Remove `STATUS.STARTED` from constants
2. Change default status from 'started' to 'upcoming' (new value needed)
3. Update all projects currently in 'started' status → 'in_progress'
4. Add auto-transition: 'upcoming' → 'in_progress' on start date
5. Update status dropdowns to not show "Started/Upcoming" option
6. Update database migration to fix existing data

**User Clarifications (Oct 23)**:
1. ✅ Remove "On Hold" status too (would clash with "Leaving & Incomplete")
2. ✅ Auto-display: Show "In Progress" if start_date is past (even if status='started')
3. ✅ Red highlighting: Projects past end_date AND not complete/leaving
4. ✅ Yellow highlighting: Projects without daily report in past 24h (changed from red)

**Final 4 Statuses**:
- Upcoming (before start date)
- In Progress (active work)
- Leaving & Incomplete
- Complete (100% done)

**Implementation Progress**:
✅ Updated summary.js display logic:
- Projects past start_date now show "In Progress" instead of "Upcoming"
- Red highlighting (-) for projects past end_date (not complete/leaving)
- Yellow highlighting (!) for projects without report in 24h (changed from red)

✅ Updated status.js constants:
- Added STATUS.UPCOMING = 'upcoming'
- Removed STATUS.STARTED and STATUS.ON_HOLD
- Updated normalizeStatus() to map old statuses → new ones
- Default status now 'upcoming' instead of 'started'

✅ Updated mentionPanel.js status dropdown:
- Removed "Started" and "On Hold" options
- Now shows: Upcoming, In Progress, Leaving & Incomplete, Complete

✅ Updated reminder job (remindersRuntime.js):
- Now checks for 'in_progress' and 'upcoming' (not old 'started' and 'on_hold')

✅ Updated summary.js missedTodayFlag:
- Removed check for old 'started' and 'on_hold' statuses
- Now only skips stale flagging for 'upcoming' projects

**Deployed**: Commit 685496e

**Testing Issue**: Admin-summary command failed with "sorry, something went wrong"
- Error: `ReferenceError: now is not defined` at summary.js:140
- Cause: Used `now` variable inside async map function, but it's out of scope
- Fix: Capture `now` as `currentTime` in closure before the map
- ✅ Fixed line 156 (pastDue check)
- ✅ Fixed line 140 (startDate check) - applied directly on AWS
- Deployed: Commit 8b97eec + hotfix
- **Still failing** - Error: `currentTime is not defined` at line 140
- Problem: Hotfix changed `now` → `currentTime` but didn't define `currentTime`
- Fix: Insert `const currentTime = DateTime.now().setZone(CT);` before the map (line 128)
- Applied via sed on AWS directly...
- ✅ **Admin-summary now working!**

**New Issue**: Projects with ! prefix showing GREEN instead of YELLOW
- Spring TX and Design within reach both have ! prefix
- Expected: Yellow highlighting (no report 24h)
- Actual: GREEN highlighting in Discord
- Problem: In Discord diff syntax, `!` is NOT yellow - it's green (added line)
- Solution: Can't use syntax highlighting for yellow (diff only has red/green)
- Instead: Add 🟡 yellow emoji at start of stale project lines
**User Decision - New Highlighting System**:
Instead of yellow, use this 3-color system:
1. **Red (-)**: No daily report done (stale/overdue for report)
2. **Green (+)**: Daily report completed (up to date)
3. **Red exclamation (❗)**: Past end date (not complete/leaving)
4. Add **legend/key at bottom** explaining all symbols

**Symbols to explain in key**:
- Green circle (🟢): Health score 5/5
- Red circle (🔴): Health score 1/5
- Yellow circle (🟡): Health score 2-4/5
- Red exclamation (❗): Past end date
- Red highlight (-): No daily report
- Green highlight (+): Daily report done

**Note on Edit Failures**:
- First edit attempt failed because I tried to replace "**Status**: Implementing changes..."
- That string didn't exist - file actually ended with "**Next Steps**: Implement status consolidation..."
- Always verify the exact string exists before editing
