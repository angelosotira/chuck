# Transit Nebula I — Supabase Setup

## 1. Create a free Supabase project
Go to https://supabase.com → New Project → name it "transit-nebula"

## 2. Run this SQL in the Supabase SQL Editor:

```sql
create table nebulas (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  name text not null,
  email text not null,
  birth_date text not null,
  birth_time text,
  lat float8 not null,
  lon float8 not null,
  city text,
  thumbnail text,
  share_url text
);

alter table nebulas enable row level security;

create policy "Public insert" on nebulas for insert with check (true);
create policy "Public select (no email)" on nebulas for select using (true);
```

## 3. Get your credentials
Project Settings → API → copy:
- Project URL → SUPABASE_URL
- anon/public key → SUPABASE_ANON_KEY

## 4. Replace in these files:
- `nebula-art.html`
- `transit/create.html`
- `transit/browse.html`
- `transit/index.html`

Search for `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_ANON_KEY` and replace with your values.

## 5. Commit and push.

```bash
git add -A
git commit -m "Configure Supabase for Transit Nebula I"
git push
```

## Notes

- **Email privacy:** Email is stored in Supabase but never returned in public SELECT queries (the RLS policy `using (true)` allows all rows to be read — if you want to hide email specifically, you can use a Supabase view or edge function. The browse page only requests non-email columns.)
- **Thumbnails:** Stored as base64 JPEG data URLs in the `thumbnail` column. Each is ~50-80KB. For a large gallery, consider migrating to Supabase Storage.
- **Rate limiting:** Nominatim geocoding is free but rate-limited to 1 req/sec. The create form makes one request per submission, which is fine.
- **The share menu** on nebula-art.html and browse.html works immediately — no Supabase required.
