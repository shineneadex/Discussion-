# Discussion board

A responsive, shared meeting board built with React, TypeScript, Vite, and Supabase. Move agenda topics between **To discuss**, **Discussing**, and **Discussed**, vote to prioritise work, and keep everyone on the same timer.

## Features

- Add and edit topics with descriptions, author names, and workflow status.
- Upvote or remove your vote once per topic per browser profile; vote totals are maintained in Postgres.
- Drag topics between columns, or use the card actions to move them.
- Search agenda topics and sort the queue by votes.
- Use a shared, server-clock timer with presets, pause, reset, and +1 minute.
- Separate boards by URL, e.g. `/?board=sprint-42`.
- Subscribe to Supabase Realtime changes, with periodic refresh as a fallback.
- Responsive desktop and mobile layout.

## Supabase setup

The project uses the Supabase project already associated with this board. To create a separate Supabase project:

1. Create a project at https://supabase.com/dashboard.
2. In its SQL Editor, run `supabase/schema.sql`.
3. Under **Project Settings → API**, copy the Project URL and publishable key (or legacy anon public key).

The SQL creates the topics, votes, and board-specific timer tables; RLS policies; timer RPC functions; a vote-count trigger; and Realtime publication entries.

## Configure and run locally

Node.js 20.19+ or 22.12+ is recommended for Vite 7.

```bash
npm install
cp .env.example .env
```

Set the variables in `.env`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Then run:

```bash
npm run dev
```

Open the same board URL in two browser windows to test collaborative updates. The frontend uses only the publishable/anon key. **Never put a Supabase service-role key in browser environment variables.**

## Deploy to Vercel

1. Import this repository at https://vercel.com/new.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Project Settings → Environment Variables**.
3. Deploy. Vercel uses `npm run build` and the `dist` directory configured in `vercel.json`.

Vite embeds environment variables at build time; redeploy after changing them.

## Access and security

This is an **open, link-based board without sign-in**. Anyone who can reach the site can read and change topics and cast or remove votes. Use it only for non-sensitive meeting content. The per-browser voter identifier is a convenience, not strong identity verification; people can bypass it by clearing browser storage or using another browser.

For confidential use, add Supabase Auth and board membership/ownership tables, then restrict topic and vote policies to authenticated board members. Review the RLS policies before exposing the app publicly.
