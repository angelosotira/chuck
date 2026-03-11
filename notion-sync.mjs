#!/usr/bin/env node
// notion-sync.mjs — Sync twitter follow progress → Notion DBs (run hourly)

import { readFileSync } from 'fs';

const TOKEN = 'ntn_R66077062863184vCBLhvM9KNyvk3hvakk6E5MivtuM9Oj';
const BD_DB = '31f189d9-98ae-8051-a2b1-f34c9b27fbf9';
const LL_DB = '31f189d9-98ae-8026-a380-cd8972ea2c2d';
const PROG  = '/Users/vaynerchuck/.openclaw/workspace/memory/twitter-follow-progress.json';

const prog       = JSON.parse(readFileSync(PROG, 'utf8'));
const followedSet = new Set(prog.followed.map(h => h.toLowerCase().replace(/^@/,'')));
const failedSet   = new Set(prog.failed.map(h => h.toLowerCase().replace(/^@/,'')));
const reasons     = prog.failedReasons || {};
console.log(`📊 ${followedSet.size} followed, ${failedSet.size} failed\n`);

const H = { 'Authorization':`Bearer ${TOKEN}`, 'Notion-Version':'2022-06-28', 'Content-Type':'application/json' };

async function ensureProps(dbId) {
  await fetch(`https://api.notion.com/v1/databases/${dbId}`, { method:'PATCH', headers:H, body:JSON.stringify({
    properties: {
      'Follow Status': { select: { options: [
        {name:'✅ Followed',color:'green'},{name:'❌ Failed',color:'red'},{name:'⏳ Pending',color:'gray'}
      ]}},
      'Follow Notes': { rich_text: {} }
    }
  })});
}

async function getAllRows(dbId) {
  const rows = []; let cursor;
  while (true) {
    const body = { page_size:100 }; if (cursor) body.start_cursor = cursor;
    const data = await (await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, { method:'POST', headers:H, body:JSON.stringify(body) })).json();
    if (data.object === 'error') break;
    rows.push(...data.results);
    if (!data.has_more) break;
    cursor = data.next_cursor;
    process.stdout.write(`  ${rows.length}...\r`);
  }
  return rows;
}

async function syncDB(dbId, name) {
  console.log(`\n📥 ${name}...`);
  const rows = await getAllRows(dbId);
  console.log(`\n   ${rows.length} rows`);
  let f=0, x=0;
  for (const row of rows) {
    const handle = (row.properties['X Username']?.rich_text?.[0]?.plain_text||'').toLowerCase().replace(/^@/,'').trim();
    if (!handle) continue;
    let status, note;
    if (followedSet.has(handle))     { status='✅ Followed'; note=`Followed ${new Date().toISOString().slice(0,10)}`; f++; }
    else if (failedSet.has(handle))  { status='❌ Failed';   note=reasons[handle]||'Unable to follow'; x++; }
    else continue;
    await fetch(`https://api.notion.com/v1/pages/${row.id}`, { method:'PATCH', headers:H, body:JSON.stringify({
      properties: {
        'Follow Status': { select: { name: status } },
        'Follow Notes':  { rich_text: [{ type:'text', text:{ content: note.slice(0,2000) } }] }
      }
    })});
    process.stdout.write(status === '✅ Followed' ? '✅' : '❌');
  }
  console.log(`\n  ✅ ${f} followed | ❌ ${x} failed`);
}

await ensureProps(BD_DB); await ensureProps(LL_DB);
await syncDB(BD_DB, 'Blackdove X Followers');
await syncDB(LL_DB, 'Layer Scored Leads');
console.log(`\n✅ Notion sync complete — ${followedSet.size} followed | ${failedSet.size} failed`);
