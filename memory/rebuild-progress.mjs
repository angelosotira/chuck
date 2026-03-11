#!/usr/bin/env node
// rebuild-progress.mjs — Reconstructs progress.json from Notion (run if progress.json is lost)
import { writeFileSync } from 'fs';

const TOKEN = 'ntn_R66077062863184vCBLhvM9KNyvk3hvakk6E5MivtuM9Oj';
const BD_DB = '31f189d9-98ae-8051-a2b1-f34c9b27fbf9';
const LL_DB = '31f189d9-98ae-8026-a380-cd8972ea2c2d';
const OUT   = '/Users/vaynerchuck/.openclaw/workspace/memory/twitter-follow-progress.json';
const H = { 'Authorization':`Bearer ${TOKEN}`, 'Notion-Version':'2022-06-28', 'Content-Type':'application/json' };

async function getByStatus(dbId, status) {
  const handles=[],reasons={};let cursor;
  while(true){
    const body={page_size:100,filter:{property:'Follow Status',select:{equals:status}}};
    if(cursor)body.start_cursor=cursor;
    const data=await(await fetch(`https://api.notion.com/v1/databases/${dbId}/query`,{method:'POST',headers:H,body:JSON.stringify(body)})).json();
    if(data.object==='error')break;
    for(const row of data.results){
      const h=(row.properties['X Username']?.rich_text?.[0]?.plain_text||'').toLowerCase().replace(/^@/,'').trim();
      const note=row.properties['Follow Notes']?.rich_text?.[0]?.plain_text||'';
      if(h){handles.push(h);if(note&&status==='❌ Failed')reasons[h]=note;}
    }
    if(!data.has_more)break;cursor=data.next_cursor;
    process.stdout.write(`  [${status}] ${handles.length}...\r`);
  }
  return{handles,reasons};
}

console.log('🔄 Rebuilding from Notion...\n');
const {handles:bdF}=await getByStatus(BD_DB,'✅ Followed');
const {handles:bdX,reasons:bdR}=await getByStatus(BD_DB,'❌ Failed');
const {handles:llF}=await getByStatus(LL_DB,'✅ Followed');
const {handles:llX,reasons:llR}=await getByStatus(LL_DB,'❌ Failed');

const followed=[...new Set([...bdF,...llF])];
const failed=[...new Set([...bdX,...llX])];
const failedReasons={...bdR,...llR};
const today=new Date().toISOString().slice(0,10);

writeFileSync(OUT,JSON.stringify({followed,failed,failedReasons,dailyCount:{[today]:0},lastRun:new Date().toISOString(),totalInSheet:5916,_note:'Rebuilt from Notion '+new Date().toISOString()},null,2));
console.log(`\n✅ Rebuilt! Followed:${followed.length} Failed:${failed.length}\nSaved: ${OUT}`);
