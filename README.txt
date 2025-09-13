Change set for DailyReportBot — Fix #1 and #8: Add back Anticipated End Date field to Daily Report.

Files included:
- src/interactions/mentionPanel.js  (drop-in replacement)

What this does:
- Adds an 'Anticipated End Date (MM/DD/YYYY)' field to the Daily Report modal.
- Persists the value to each Daily Report (completion_date).
- Updates the Project's completion_date for pre-filling & summary use.
- Shows the field on the submitted Daily Report embed.

No other files modified.
