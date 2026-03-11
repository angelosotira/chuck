#!/usr/bin/env node
// twitter-follow.mjs — Optimized single-window follow runner for @neotericdotart
//
// Rate limit strategy:
//   - GET /2/users/me         → called ONCE at startup (not per follow)
//   - GET /2/users/by         → batch lookup up to 100 handles in ONE API call
//   - POST /2/users/:id/following → 1 call per follow (bottleneck: 50/15min)
//
// Result: ~1.025 API calls per follow vs old 3.0
// Window: 40 follows per invocation → hits daily cap (990) in ~6.6 hours
// Cron fires every 16 min. Script exits after one window.

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const SHEET1_CSV  = 'https://docs.google.com/spreadsheets/d/1VexgzLs8fQE_xRdXvezrTbhKaHAXZZ8cI06lKZfsgH4/export?format=csv';
const MAX_PER_DAY = 990;
const WINDOW_SIZE = 40;   // 40 follows per window (well under 50/15min API limit)
const DELAY_MS    = 3000; // 3s between follows (faster now — no per-follow lookup)
const END_DATE    = '2026-03-19';
const PROGRESS    = '/Users/vaynerchuck/.openclaw/workspace/memory/twitter-follow-progress.json';
const STATUS_LOG  = '/Users/vaynerchuck/.openclaw/workspace/memory/twitter-follow-status.md';
const UPDATE_LOG  = '/Users/vaynerchuck/.openclaw/workspace/memory/twitter-status-updates.jsonl';

const today = new Date().toISOString().slice(0, 10);
if (today >= END_DATE) { console.log(`🏁 Campaign ended (${END_DATE}).`); process.exit(0); }

// ── Load progress ─────────────────────────────────────────────────────────────
let prog = { followed: [], failed: [], failedReasons: {}, dailyCount: {}, lastRun: null, totalInSheet: 0 };
if (existsSync(PROGRESS)) {
  try { prog = JSON.parse(readFileSync(PROGRESS, 'utf8')); } catch(e) {}
}
if (!prog.failedReasons) prog.failedReasons = {};
if (!prog.dailyCount)    prog.dailyCount    = {};

const followedSet = new Set(prog.followed);
const failedSet   = new Set(prog.failed);
if (!prog.dailyCount[today]) prog.dailyCount[today] = 0;
const followedToday = prog.dailyCount[today];

if (followedToday >= MAX_PER_DAY) {
  console.log(`🛑 Daily limit (${MAX_PER_DAY}) reached for ${today}.`);
  process.exit(0);
}

// ── Get our user ID once ──────────────────────────────────────────────────────
console.log('🔑 Fetching user ID...');
let MY_USER_ID = null;
try {
  const out = execSync('xurl /2/users/me', { encoding: 'utf8', timeout: 15000, stdio: ['pipe','pipe','pipe'] });
  MY_USER_ID = JSON.parse(out)?.data?.id;
  if (!MY_USER_ID) throw new Error('no id');
  console.log(`✅ ID: ${MY_USER_ID}`);
} catch(e) { console.error('❌ Auth failed:', e.message); process.exit(1); }

// ── Fetch sheet ───────────────────────────────────────────────────────────────
console.log('📥 Fetching account list...');
const rawCsv = await (await fetch(SHEET1_CSV)).text();
const rows = rawCsv.split('\n').filter(Boolean).map(line => {
  const cols = []; let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
    cur += c;
  }
  cols.push(cur); return cols;
});
const header = rows[0];
const uIdx = header.findIndex(h => h.trim().toLowerCase() === 'username');
const sIdx = header.findIndex(h => h.trim().toLowerCase().includes('score'));
if (uIdx === -1) { console.error('❌ No Username column.'); process.exit(1); }

const accounts = rows.slice(1)
  .map(r => ({ handle: (r[uIdx]||'').trim().replace(/^@/,'').toLowerCase(), score: parseFloat(r[sIdx]||'0')||0 }))
  .filter(a => a.handle).sort((a,b) => b.score - a.score);

prog.totalInSheet = accounts.length;
const toFollow = accounts.filter(a => !followedSet.has(a.handle) && !failedSet.has(a.handle));
const canToday = MAX_PER_DAY - followedToday;
const batch    = toFollow.slice(0, Math.min(WINDOW_SIZE, canToday));

console.log(`\n📊 ${accounts.length} total | ✅ ${prog.followed.length} followed | ⏳ ${toFollow.length} remaining`);
console.log(`📅 Today: ${followedToday}/${MAX_PER_DAY} | 🎯 This window: ${batch.length}\n`);

if (batch.length === 0) {
  console.log(toFollow.length === 0 ? '🎉 All done!' : '🛑 Daily cap reached.');
  process.exit(0);
}

// ── BATCH resolve all handles → user IDs (1 API call for up to 100) ──────────
console.log(`🔍 Batch resolving ${batch.length} handles...`);
const idMap = new Map();
const notFound = new Set();

try {
  const usernames = batch.map(a => a.handle).join(',');
  const out = execSync(
    `xurl "/2/users/by?usernames=${usernames}&user.fields=id,username"`,
    { encoding: 'utf8', timeout: 20000, stdio: ['pipe','pipe','pipe'] }
  );
  const parsed = JSON.parse(out);
  for (const user of (parsed?.data || [])) {
    idMap.set(user.username.toLowerCase(), user.id);
  }
  // Mark any not returned as not found
  for (const { handle } of batch) {
    if (!idMap.has(handle)) notFound.add(handle);
  }
  console.log(`  ✅ Resolved ${idMap.size}/${batch.length} | ❓ Not found: ${notFound.size}\n`);
} catch(e) {
  console.log(`  ⚠️  Batch lookup failed (${e.message?.slice(0,60)}), falling back to individual lookups`);
}

// ── Follow helper (uses pre-resolved IDs) ────────────────────────────────────
function followOne(handle, score) {
  // Handle not-found from batch lookup
  if (notFound.has(handle)) {
    console.log(`  ⚠️  @${handle} — not found`);
    prog.failed.push(handle); prog.failedReasons[handle] = 'user not found'; failedSet.add(handle);
    return { success: false };
  }

  let targetId = idMap.get(handle);

  // Fallback: individual lookup if batch didn't get this one
  if (!targetId) {
    try {
      const out = JSON.parse(execSync(`xurl user @${handle}`, { encoding: 'utf8', timeout: 15000, stdio: ['pipe','pipe','pipe'] }));
      targetId = out?.data?.id;
    } catch(e) {
      const msg = (e.stdout || e.message || '').toString();
      const reason = (msg.includes('not found') || msg.includes('Could not find')) ? 'user not found' : 'lookup failed';
      console.log(`  ⚠️  @${handle} — ${reason}`);
      prog.failed.push(handle); prog.failedReasons[handle] = reason; failedSet.add(handle);
      return { success: false };
    }
  }

  if (!targetId) {
    console.log(`  ⚠️  @${handle} — could not resolve`);
    prog.failed.push(handle); prog.failedReasons[handle] = 'no id resolved'; failedSet.add(handle);
    return { success: false };
  }

  // Follow via raw API (no extra /me call — MY_USER_ID cached at startup)
  try {
    const out = JSON.parse(execSync(
      `xurl -X POST /2/users/${MY_USER_ID}/following -d '${JSON.stringify({target_user_id:targetId})}'`,
      { encoding: 'utf8', timeout: 20000, stdio: ['pipe','pipe','pipe'] }
    ));
    const errMsg = out?.errors?.[0]?.message || out?.detail || '';
    const ok = out?.data?.following === true || out?.data?.pending_follow === true;

    if (ok || errMsg.toLowerCase().includes('already')) {
      console.log(`  ✅ @${handle} (score:${score})`);
      prog.followed.push(handle); followedSet.add(handle); return { success: true };
    }
    if (errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit') || errMsg.toLowerCase().includes('too many'))
      return { success: false, rateLimited: true };

    console.log(`  ⚠️  @${handle} — ${errMsg.slice(0,80)}`);
    prog.failed.push(handle); prog.failedReasons[handle] = errMsg.slice(0,100); failedSet.add(handle);
    return { success: false };
  } catch(e) {
    const stdout = e.stdout?.toString()||''; const msg = e.stderr?.toString()||e.message||'';
    if (stdout.includes('429')||msg.includes('429')||stdout.includes('Too Many')||msg.includes('Too Many'))
      return { success: false, rateLimited: true };
    const reason = (stdout||msg).slice(0,100).trim();
    console.log(`  ❌ @${handle} — ${reason.slice(0,80)}`);
    prog.failed.push(handle); prog.failedReasons[handle] = reason; failedSet.add(handle);
    return { success: false };
  }
}

function save(todayCount) {
  prog.dailyCount[today] = todayCount;
  prog.lastRun = new Date().toISOString();
  writeFileSync(PROGRESS, JSON.stringify(prog, null, 2));
}

// ── Run window ────────────────────────────────────────────────────────────────
let won = 0, lost = 0, todayCount = followedToday;

for (let i = 0; i < batch.length; i++) {
  const { handle, score } = batch[i];
  const result = await followOne(handle, score);
  if (result.rateLimited) {
    console.log(`\n⚠️  429 rate limit after ${won} follows. Next window in ~16 min.`);
    save(todayCount); break;
  }
  if (result.success) { todayCount++; won++; } else { lost++; }
  save(todayCount);
  if (i < batch.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
}

const remaining = accounts.filter(a => !followedSet.has(a.handle) && !failedSet.has(a.handle)).length;
const daysLeft  = Math.ceil(remaining / MAX_PER_DAY);

console.log(`\n════════════════════════════════\n✅ ${won} followed | ❌ ${lost} failed\n📅 Today: ${todayCount}/${MAX_PER_DAY} | Total: ${prog.followed.length} | Left: ${remaining} (~${daysLeft}d)\n════════════════════════════════`);

// ── Write status files ────────────────────────────────────────────────────────
writeFileSync(STATUS_LOG, `# Twitter Follow Log\n_Updated: ${new Date().toISOString()}_\n\n- ✅ Total: ${prog.followed.length}\n- ❌ Failed: ${prog.failed.length}\n- ⏳ Remaining: ${remaining}\n- 📅 Today: ${todayCount}/${MAX_PER_DAY}\n- 🗓️ Est. days left: ${daysLeft}\n`);

// Append to rolling status update log (used by 6h status cron)
const updateEntry = JSON.stringify({
  ts: new Date().toISOString(),
  followed: prog.followed.length,
  failed: prog.failed.length,
  today: todayCount,
  remaining,
  daysLeft,
  windowFollowed: won
}) + '\n';
const existingLog = existsSync(UPDATE_LOG) ? readFileSync(UPDATE_LOG, 'utf8') : '';
writeFileSync(UPDATE_LOG, existingLog + updateEntry);
