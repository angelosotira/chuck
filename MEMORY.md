# MEMORY.md — Vaynerchuck's Long-Term Memory

_Last updated: 2026-03-10 (evening)_

---

## Angelo's Projects

### chuck.neoteric.art
Angelo's generative art portfolio site. https://chuck.neoteric.art/
Home to the Transit Nebula series and Invader series.
GitHub repo: https://github.com/angelosotira/chuck (user: angelosotira)

---

### Transit Nebula I — Canonical Project
**Final home:** `https://chuck.neoteric.art/transit/nebula-i/` (lowercase i)

**Sitemap:**
```
/transit/nebula-i/
  index.html     ← marketing landing (live nebula bg iframe, hero, browse grid, How It Works)
  nebula.html    ← the actual WebGL generative art (shareable link)
  create.html    ← birth chart entry form → redirects to nebula.html
  browse.html    ← full grid of all saved nebulas from Supabase
  reading.html   ← daily astrological reading
  about.html     ← about the work
  method.html    ← astrological method explanation

/transit/index.html  ← Transit series directory (001 Nebula I, 002 TBD)
```

**Shader:** 8-octave fBm, double domain warp, full filament passes. Uses Nebula II engine with Accretion/Drift sliders.
**Supabase:** `nebulas` table. localStorage: `transit_pending_save` / `transit_last_id`
**Thumbnail:** `thumbs/nebula-art-ii.jpg` (updated 2026-03-10 — was outdated pastel version)

---

### Transit Series
- **URL:** `https://chuck.neoteric.art/transit/`
- Nebula I = Work 001 (live), Work 002 = TBD placeholder

### Invader Series
- **URL:** `https://chuck.neoteric.art/invaders.html`
- 10 generative Space Invader variations. All complete.

---

## Supabase
- **Project:** https://iarmibcqsrlknptvzgkn.supabase.co
- **Anon key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlhcm1pYmNxc3Jsa25wdHZ6Z2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMzA1NDEsImV4cCI6MjA4ODYwNjU0MX0.HOvdb-a9GFr0zUEgZqxPYgBEiiZUE9whch-cH0DRhnk`
- **Main table:** `nebulas`

---

## Twitter Follow Campaign (@neotericdotart)

**Goal:** Follow 5,916 scored accounts (people who engaged with @Blackdoveart), high score first.
**Source:** Google Sheet 1 (has @usernames, sorted by score 100→0)
**Status (2026-03-10 ~8pm PT):** ~530 followed, 27 failed, ~5,359 remaining (Notion is source of truth)

### Scripts (all committed + pushed to git)
- `twitter-follow.mjs` — single-window runner (15 follows/window, exits clean)
- `notion-sync.mjs` — syncs progress → Notion DBs
- `memory/twitter-follow-progress.json` — live progress (may need rebuild if git wipes it)
- `memory/rebuild-progress.mjs` — reconstructs progress.json from Notion if lost

### Active Cron Jobs
- **Follow:** `86076fbe-3279-41ed-898b-0e41f19c84d3` — every 16 min, 300s timeout
- **Notion sync:** `e37b87b0-af62-4081-873d-873501c7b91f` — hourly at :05, 600s timeout
- **Status update:** `1ac32d95-ee7f-49af-98fa-3b8610d2435f` — every 6h, announces to Telegram (356245797)
- Campaign ends: `2026-03-19`

### API Rate Limit Math (important)
- `POST /2/users/:id/following` bottleneck: **50 requests per 15-min window**
- Old script: 3 API calls/follow (/me + lookup + follow) → hit /me rate limit fast
- Current script: ~1.025 calls/follow (batch lookup 100 handles in 1 call, /me cached once)
- Window size: 40 follows × 3s delay ≈ 200s — fits in 300s cron timeout
- Daily expected: **990 follows** (hits cap in ~6.6 hours, cron idles rest of day)
- Days to finish: ~5,400 remaining ÷ 990/day = ~5.5 days from now

### Status Update Protocol
- Every 6 hours: auto-update sent to Angelo via Telegram
- Rolling log: `memory/twitter-status-updates.jsonl` (appended after each window)
- **When Angelo asks for status:** read the last 4 entries from `twitter-status-updates.jsonl` (= 1 day of 6h updates) + current progress.json

### Critical Lessons (do not forget)
1. **exec requires `host=gateway, security=allowlist`** — sandbox is blocked. Always explicit.
2. **Always commit AND push immediately** — git reset --hard wipes uncommitted files.
3. **Notion is source of truth** — if progress.json lost, run `memory/rebuild-progress.mjs`.
4. **Never run Notion sync inside follow cron** — too slow, causes timeout. Separate hourly cron.
5. **User ID cache** — script fetches /me once at startup. Batch-resolves handles. Never per-follow.
6. **Script logs to `twitter-status-updates.jsonl`** — read last 4 entries for status updates.

### Notion DBs
- Blackdove X Followers: `31f189d9-98ae-8051-a2b1-f34c9b27fbf9` (5,814 rows)
- Layer Scored Leads: `31f189d9-98ae-8026-a380-cd8972ea2c2d` (253 rows)
- Properties: "Follow Status" (✅/❌/⏳), "Follow Notes"

---

## Notion
- **Workspace:** Layer (workspace_id: 843cf4a2-e8db-4a12-ae1e-530a70802a9e)
- **Access token:** `ntn_R66077062863184vCBLhvM9KNyvk3hvakk6E5MivtuM9Oj`
- **Refresh token:** `nrt_k6607706286b6qnzb97MMWK8zcgSSj9tUugq2VbYH7X6lz`

---

## Technical Notes
- **exec always needs `host=gateway, security=allowlist`** (sandbox is blocked)
- `git`, `node`, `ls` available; always commit+push immediately after writing files
- Angelo uses WhatsApp voice messages — transcription may be slightly off
- Context compaction on long sessions — memory files are continuity

---

## Layer Context
Full deep-dive in: `memory/LAYER.md`
- Layer = museum-grade digital art canvas ($22K), GPU-powered
- ViewTime = proprietary royalty system (pays artists by display time)
- Angelo co-founded DeviantArt (2000, age 19)
- Twitter tone: artist-peer, not marketer

---

## Queued Work
- A1–A10: 10 new astrology artworks (Oscilloscope, Cymatics, Aurora, Root System, Topographic, Tide, Lava Lamp, Magnetic Field, Microscopy, Coral)
- Mandala rotation fix (CW/CCW data-driven by transit scores)
- Twitter Sheet 2 (business leads) follow script — future phase
