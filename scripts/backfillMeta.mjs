#!/usr/bin/env node
/**
 * 仅回填 checkpoints/loras 的 createTime / updateTime / owner / version / baseModelSubtype
 * 从 RunningHub API 重新拉取一份按 name 索引的轻量映射（不下载封面、不覆盖已有字段），
 * 然后写回 public/data/runninghubModels.json
 *
 * 用法:  node scripts/backfillMeta.mjs
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API_KEY = '4bdff125174140bb804395756f8c597d';
const ENDPOINT = 'https://www.runninghub.ai/openapi/v2/resource/list';
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 3500;
const OUTPUT_JSON = resolve(process.cwd(), '../public/data/runninghubModels.json');

async function callApi(body) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      if (res.status === 429 || json?.code === 1003) {
        console.error(`[429] 限流 60s (${attempt})`);
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      if (!json || json.code !== 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return json;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return null;
}

function pickVersion(record, baseModel) {
  return (
    record.versions?.find((x) => x.baseModel === baseModel) ||
    record.versions?.find((x) => x.baseModel === 'IL-XL') ||
    record.versions?.[0]
  );
}

/** 拉取 kind 全部记录并返回 Map<fileName, meta>（meta 只含日期/作者/version/sub） */
async function fetchMetaMap(kind, baseModels) {
  const body = { resourceType: kind, current: 1, size: PAGE_SIZE };
  if (baseModels) body.baseModels = baseModels;

  const first = await callApi(body);
  if (!first) return new Map();

  const total = parseInt(first.data.total, 10);
  const records = [...first.data.records];
  const totalPages = Math.ceil(total / PAGE_SIZE);

  for (let p = 2; p <= totalPages; p++) {
    process.stdout.write(`  ${kind} page ${p}/${totalPages}\r`);
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    const r = await callApi({ ...body, current: p });
    if (r?.data?.records) records.push(...r.data.records);
    if (records.length >= total) break;
  }
  console.log(`  ${kind}: ${records.length} records`);

  const map = new Map();
  for (const rec of records) {
    const nodeName = rec.nodeModelName || '';
    const v = pickVersion(rec, baseModels?.[0] || 'IL-XL');
    const fileName = (v?.versionResourceName || nodeName).split('/').pop() || nodeName;
    if (!fileName) continue;
    map.set(fileName.toLowerCase(), {
      createTime: rec.createTime || '',
      updateTime: rec.updateTime || rec.createTime || '',
      owner: rec.owner?.name || '',
      version: v?.version || '',
      baseModelSubtype: v?.baseModelSubtype || '',
    });
  }
  return map;
}

async function main() {
  if (!existsSync(OUTPUT_JSON)) {
    console.error('no JSON found:', OUTPUT_JSON);
    process.exit(1);
  }
  const db = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8'));

  console.log('Fetching CHECKPOINT metadata...');
  const ckptMap = await fetchMetaMap('CHECKPOINT', ['IL-XL']);
  await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));

  console.log('Fetching LORA metadata...');
  const loraMap = await fetchMetaMap('LORA', ['IL-XL']);

  let cpFilled = 0, lrFilled = 0;
  for (const e of db.checkpoints) {
    const m = ckptMap.get(e.name.toLowerCase());
    if (!m) continue;
    if (!e.createTime && m.createTime) { e.createTime = m.createTime; cpFilled++; }
    if (!e.updateTime && m.updateTime) e.updateTime = m.updateTime;
    if (!e.owner && m.owner) e.owner = m.owner;
    if (!e.version && m.version) e.version = m.version;
    if (!e.baseModelSubtype && m.baseModelSubtype) e.baseModelSubtype = m.baseModelSubtype;
  }
  for (const e of db.loras) {
    const m = loraMap.get(e.name.toLowerCase());
    if (!m) continue;
    if (!e.createTime && m.createTime) { e.createTime = m.createTime; lrFilled++; }
    if (!e.updateTime && m.updateTime) e.updateTime = m.updateTime;
    if (!e.owner && m.owner) e.owner = m.owner;
    if (!e.version && m.version) e.version = m.version;
    if (!e.baseModelSubtype && m.baseModelSubtype) e.baseModelSubtype = m.baseModelSubtype;
  }

  db.updatedAt = new Date().toISOString();
  writeFileSync(OUTPUT_JSON, JSON.stringify(db, null, 2));
  console.log(`\n✓ checkpoints filled=${cpFilled}, loras filled=${lrFilled}`);
  console.log(`  ckpt total=${db.checkpoints.length}, with createTime=${db.checkpoints.filter(x=>x.createTime).length}`);
  console.log(`  lora total=${db.loras.length}, with createTime=${db.loras.filter(x=>x.createTime).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });