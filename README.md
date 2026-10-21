# Discussion board

A live meeting board with three columns: To discuss, Discussing and Discussed. Everyone on the same board link sees changes instantly.

- Add topics and upvote them (one vote per person per topic; the To discuss column sorts by votes)
- Drag topics between columns, or use the arrow buttons on each card (works on touch and keyboard)
- A shared timer on the Discussing column with start, pause, reset, add 1 minute and 2/5/10/15 minute presets. Timing runs on the server clock, so every browser agrees. An alarm sounds when it hits zero.
- See who is online
- Separate boards by URL: `/?board=sprint-42`

Built with Vite, React, TypeScript and Supabase (Postgres plus Realtime).

## Set up Supabase

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor**, paste in `supabase/schema.sql` and run it. It creates the tables, row level security policies, timer functions and turns on Realtime.
3. In **Project Settings > API**, copy the project URL and the `anon` public key.

## Run locally

```bash
npm install
cp .env.example .env   # then fill in the two values
npm run dev
```

Open the app in two browser windows to watch the sync.

## Deploy to Vercel

1. Push this folder to a Git repository and import it at https://vercel.com/new (or run `npx vercel` from this folder).
2. Vercel detects Vite. `vercel.json` already sets the build command and the `dist` output directory.
3. Under **Settings > Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then deploy.

Environment variables are baked in at build time, so redeploy after changing them.

## Security notes

This version has no sign-in: anyone who has the site URL can read and change a board. That suits a team meeting or a workshop, not sensitive content.

- Clients can only change a topic's column, not rewrite its text, and cannot write to the timer table directly (only through the timer functions).
- A vote is tied to a random id kept in the browser, so someone determined could add or remove votes by hand.
- To lock it down, add Supabase Auth (anonymous sign-ins work well), store `auth.uid()` as the voter id, and tighten the policies in `schema.sql` to match.
