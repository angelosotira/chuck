#!/usr/bin/env node
// twitter-follow.mjs — Single-window Twitter follow runner for @neotericdotart
// One window of WINDOW_SIZE follows per invocation, then exits.
// Cron fires every 16 min. Daily cap + end-date checks built in.
// Uses cached user ID (one /me call at startup, not per follow).

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const SHEET1_CSV  = 'https://docs.google.com/spreadsheets/d/1VexgzLs8fQE_xRdXvezrTbhKaHAXZZ8cI06lKZfsgH4/export?format=csv';
const MAX_PER_DAY = 990;
const WINDOW_SIZE = 15;    // safe for 240s cron timeout (15 × ~13s ≈ 195s)
const DELAY_MS    = 8000;  // 8s between follows
const END_DATE    = '2026-03-19';
const PROGRESS    = '/Users/vaynerchuck/.openclaw/workspace/memory/twitter-follow-progress.json';
const STATUS_LOG  = '/Users/vaynerchuck/.openclaw/workspace/memory/twitter-follow-status.md';

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

// ── Get our user ID once (avoids /me rate limit per follow) ──────────────────
console.log('🔑 Fetching user ID...');
let MY_USER_ID = null;
try {
  const out = execSync('xurl /2/users/me', { encoding: 'utf8', timeout: 15000, stdio: ['pipe','pipe','pipe'] });
  MY_USER_ID = JSON.parse(out)?.data?.id;
  if (!MY_USER_ID) throw new Error('no id in response');
  console.log(`✅ User ID: ${MY_USER_ID}`);
} catch(e) { console.error('❌ Auth failed:', e.message); process.exit(1); }

// ── Fetch sheet ───────────────────────────────────────────────────────────────
console.log('📥 Fetching account list...');
const rows = (await (await fetch(SHEET1_CSV)).text()).split('\n').filter(Boolean).map(line => {
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
const toFollow    = accounts.filter(a => !followedSet.has(a.handle) && !failedSet.has(a.handle));
const canToday    = MAX_PER_DAY - followedToday;
const batch       = toFollow.slice(0, Math.min(WINDOW_SIZE, canToday));

console.log(`\n📊 ${accounts.length} total | ✅ ${prog.followed.length} followed | ⏳ ${toFollow.length} remaining`);
console.log(`📅 Today: ${followedToday}/${MAX_PER_DAY} | 🎯 This window: ${batch.length}\n`);

if (batch.length === 0) {
  console.log(toFollow.length === 0 ? '🎉 All done!' : '🛑 Daily cap reached.');
  process.exit(0);
}

// ── Follow helpers ────────────────────────────────────────────────────────────
function resolveHandle(handle) {
  try {
    const out = JSON.parse(execSync(`xurl user @${handle}`, { encoding: 'utf8', timeout: 15000, stdio: ['pipe','pipe','pipe'] }));
    return out?.data?.id || null;
  } catch(e) {
    const msg = (e.stdout || e.message || '').toString();
    return (msg.includes('not found') || msg.includes('Could not find')) ? 'not_found' : null;
  }
}

function followOne(handle, score) {
  const targetId = resolveHandle(handle);
  if (!targetId || targetId === 'not_found') {
    const reason = targetId === 'not_found' ? 'user not found' : 'could not resolve';
    console.log(`  ⚠️  @${handle} — ${reason}`);
    prog.failed.push(handle); prog.failedReasons[handle] = reason; failedSet.add(handle);
    return { success: false };
  }
  try {
    const out = JSON.parse(execSync(
      `xurl -X POST /2/users/${MY_USER_ID}/following -d '${JSON.stringify({target_user_id:targetId})}'`,
      { encoding: 'utf8', timeout: 20000, stdio: ['pipe','pipe','pipe'] }
    ));
    const ok = out?.data?.following === true || out?.data?.pending_follow === true;
    const errMsg = out?.errors?.[0]?.message || out?.detail || '';
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
    console.log(`\n⚠️  429 hit after ${won} follows. Next window in 16 min.`);
    save(todayCount); break;
  }
  if (result.success) { todayCount++; won++; } else { lost++; }
  save(todayCount);
  if (i < batch.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
}

const remaining = accounts.filter(a => !followedSet.has(a.handle) && !failedSet.has(a.handle)).length;
console.log(`\n════════════════════════════════\n✅ ${won} followed | ❌ ${lost} failed\n📅 Today: ${todayCount}/${MAX_PER_DAY} | Total: ${prog.followed.length} | Left: ${remaining}\n════════════════════════════════`);
writeFileSync(STATUS_LOG, `# Twitter Follow Log\n_Updated: ${new Date().toISOString()}_\n\n- ✅ Total: ${prog.followed.length}\n- ❌ Failed: ${prog.failed.length}\n- ⏳ Remaining: ${remaining}\n- 📅 Today: ${todayCount}/${MAX_PER_DAY}\n`);
