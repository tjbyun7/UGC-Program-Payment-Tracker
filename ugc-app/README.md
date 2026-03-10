# UGC Program — Deployment Guide

## What's in this project
- **Admin Dashboard** — manage creators, update view counts, mark payouts
- **Creator Portal** — creators log in with their email to submit videos & track earnings
- **Supabase** — all data syncs in real time across devices

---

## Step 1 — Set up your database

1. Go to your Supabase project → **SQL Editor**
2. Paste the contents of `SETUP_DATABASE.sql` and click **Run**

---

## Step 2 — Deploy to Vercel (free, ~3 minutes)

1. Go to [vercel.com](https://vercel.com) and sign up with GitHub
2. Create a new GitHub repository:
   - Go to [github.com](https://github.com) → **New repository**
   - Name it `ugc-program`, make it **Private**, click **Create**
3. Upload ALL files from this folder to that repository
4. Go back to Vercel → **Add New Project** → Import your GitHub repo
5. Click **Deploy** — Vercel auto-detects it's a Vite/React app
6. In ~1 minute you'll get a live URL like `ugc-program.vercel.app`

---

## How to use

### As the admin:
- Go to your Vercel URL
- You'll see the Admin Dashboard by default
- Click **"Creator Portal"** in the sidebar to preview what creators see

### Sharing with creators:
- Send them your Vercel URL
- They click **"Creator Portal"** in the sidebar (or you can share a direct `/portal` link)
- They enter their email to log in — their email must already exist in the Creators list

### Adding creators:
- In the Admin Dashboard → Creators → **+ Add Creator**
- Fill in their name, handle, and **email** (this is what they use to log in)

---

## Your Supabase credentials (already baked in)
- Project URL: `https://msfxchalkygbqobehfrf.supabase.co`
- These are saved in `src/supabaseClient.js`
