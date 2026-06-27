#!/usr/bin/env node
/**
 * 从 RunningHub 公开 API 抓取所有 IL-XL 的 CHECKPOINT / LORA
 * 速率限制：60秒内 20 次，所以加入节流
 *
 * 用法：
 *   node scripts/fetchRhModels.mjs
 */
import { writeFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const API_KEY = '4bdff125174140bb804395756f8c597d';
const ENDPOINT = 'https://www.runninghub.cn/openapi/v2/resource/list';
const BASE_MODEL = 'IL-XL';
const PAGE_SIZE = 50;          // max
const REQUEST_DELAY_MS = 3500; // 20 req / 60s -> 3000ms 安全余量
const MAX_RETRY = 5;
const OUTPUT_JSON = resolve(process.cwd(), 'src/data/runninghubModels.json');
const COVER_DIR = resolve(process.cwd(), 'public/rh-covers');

if (!existsSync(COVER_DIR)) mkdirSync(COVER_DIR, { recursive: true });

async function callApi(body) {
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
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
        console.error(`[429] 限流，等待 60s (attempt ${attempt}/${MAX_RETRY})`);
        await sleep(60_000);
        continue;
      }
      if (!json || json.code !== 0) {
        console.error(`[!] 异常 ${res.status}:`, text.slice(0, 200));
        await sleep(2000);
        continue;
      }
      return json;
    } catch (e) {
      console.error(`[net error] attempt ${attempt}:`, e.message);
      await sleep(3000);
    }
  }
  throw new Error('API failed after retries');
}

async function fetchAll(kind) {
  console.log(`\n==== Fetching ${kind} ====`);
  const first = await callApi({ resourceType: kind, baseModels: [BASE_MODEL], current: 1, size: PAGE_SIZE });
  const total = parseInt(first.data.total, 10);
  const records = [...first.data.records];
  const totalPages = Math.ceil(total / PAGE_SIZE);
  console.log(`  total=${total}, pages=${totalPages}`);
  for (let p = 2; p <= totalPages; p++) {
    process.stdout.write(`  page ${p}/${totalPages}\r`);
    await sleep(REQUEST_DELAY_MS);
    const r = await callApi({ resourceType: kind, baseModels: [BASE_MODEL], current: p, size: PAGE_SIZE });
    records.push(...r.data.records);
    if (records.length >= total) break;
  }
  console.log(`  ✓ got ${records.length} ${kind} records`);
  return records;
}

/** 下载封面到本地，仅用于 1 个封面 */
async function downloadCover(record, kind) {
  const cover = record.thumbnailUrl || record.posterUrl;
  if (!cover) return '';
  const id = record.id;
  const local = resolve(COVER_DIR, `${kind}-${id}.jpg`);
  if (existsSync(local)) return `/rh-covers/${kind}-${id}.jpg`;
  try {
    const res = await fetch(cover, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.runninghub.ai/' },
    });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return '';
    writeFileSync(local, buf);
    return `/rh-covers/${kind}-${id}.jpg`;
  } catch {
    return '';
  }
}

/** 把标签名 -> 我们的 category id */
const TAG_MAP = {
  '真实': 'realistic',
  '写实': 'realistic',
  '摄影': 'realistic',
  '二次元': 'anime',
  '2D': 'anime',
  '动画': 'anime',
  'IP形象': 'character',
  'IP角色': 'character',
  '角色': 'character',
  '人物': 'character',
  '风格化': 'stylization',
  '插画': 'stylization',
  '风格': 'stylization',
  '辅助': 'helper',
  '工具': 'helper',
  '画风增强': 'rh-pick',
  '概念': 'concept',
  '构图': 'composition',
  '精选': 'rh-pick',
};

function classify(record) {
  const cats = new Set();
  const tagNames = (record.tags || []).map((t) => t.name).filter(Boolean);
  for (const n of tagNames) {
    for (const [k, v] of Object.entries(TAG_MAP)) {
      if (n.includes(k)) cats.add(v);
    }
  }
  // resourceName 关键字兜底
  const name = (record.resourceName || record.nodeModelName || '').toLowerCase();
  if (cats.size === 0) {
    if (name.includes('realistic') || name.includes('real')) cats.add('realistic');
    else if (name.includes('anime') || name.includes('2d')) cats.add('anime');
    else if (name.includes('character') || name.includes('char')) cats.add('character');
    else if (name.includes('style') || name.includes('ghibli') || name.includes('cyber')) cats.add('stylization');
    else cats.add('other');
  }
  return Array.from(cats);
}

function pickVersionName(record) {
  // 找 IL-XL 的版本；没有则第一个
  const v = record.versions?.find((x) => x.baseModel === BASE_MODEL) || record.versions?.[0];
  return v?.versionResourceName || '';
}

function pickTriggerWords(record) {
  const v = record.versions?.find((x) => x.baseModel === BASE_MODEL) || record.versions?.[0];
  return v?.triggerWords || '';
}

function pickBaseModelSubtype(record) {
  const v = record.versions?.find((x) => x.baseModel === BASE_MODEL) || record.versions?.[0];
  return v?.baseModelSubtype || '';
}

function descToText(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function transformKind(records, kind, downloadCoverMode = 'first') {
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const nodeName = r.nodeModelName || '';
    const versionName = pickVersionName(r);
    // filename = 从 versionResourceName 提取 basename（不含 models/checkpoints/ 前缀）
    const fileName = (versionName || nodeName).split('/').pop() || nodeName;
    const cats = classify(r);
    const triggerWords = pickTriggerWords(r);
    let description = descToText(r.desc);
    if (triggerWords && description) description = `触发词: ${triggerWords} | ${description}`;
    else if (triggerWords) description = `触发词: ${triggerWords}`;
    const sub = pickBaseModelSubtype(r);
    const entry = {
      id: r.id,
      name: fileName,
      label: r.resourceName || nodeName.replace(/\.safetensors$/, ''),
      category: cats,
      defaultWeight: kind === 'CHECKPOINT' ? 1.0 : 0.7,
      description,
      baseModel: BASE_MODEL,
      baseModelSubtype: sub,
      version: r.versions?.[0]?.version || '',
      triggerWords,
      tags: (r.tags || []).map((t) => t.name).filter(Boolean),
      posterUrl: r.posterUrl || '',
      thumbnailUrl: r.thumbnailUrl || '',
      cover: '',
      owner: r.owner?.name || '',
      createTime: r.createTime || '',
    };
    // 仅下首个封面（避免 5000+ 次下载太慢）
    if (downloadCoverMode === 'first') {
      const localPath = await downloadCover(r, kind === 'CHECKPOINT' ? 'ckpt' : 'lora');
      entry.cover = localPath;
    }
    out.push(entry);
    if ((i + 1) % 50 === 0) console.log(`  transformed ${i + 1}/${records.length}`);
  }
  return out;
}

async function main() {
  const downloadMode = process.env.NO_DOWNLOAD === '1' ? 'none' : 'first';
  const ckptsRaw = await fetchAll('CHECKPOINT');
  await sleep(REQUEST_DELAY_MS);
  const lorasRaw = await fetchAll('LORA');

  console.log('\n==== Transforming ====');
  const ckpts = await transformKind(ckptsRaw, 'CHECKPOINT', downloadMode);
  await sleep(REQUEST_DELAY_MS);
  const loras = await transformKind(lorasRaw, 'LORA', downloadMode);

  // 去重
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter((e) => seen.has(e.name) ? false : (seen.add(e.name), true));
  };

  const dataset = {
    version: 4,
    baseModelFilter: BASE_MODEL,
    source: 'https://www.runninghub.cn/openapi/v2/resource/list',
    fetchedAt: new Date().toISOString(),
    categories: [
      { id: 'all', label: '全部' },
      { id: 'rh-pick', label: '推荐' },
      { id: 'realistic', label: '真实' },
      { id: 'anime', label: '二次元' },
      { id: 'character', label: 'IP 角色' },
      { id: 'stylization', label: '风格化' },
      { id: 'helper', label: '辅助' },
      { id: 'concept', label: '概念' },
      { id: 'composition', label: '构图' },
      { id: 'other', label: '其他' },
    ],
    checkpoints: dedupe(ckpts),
    loras: dedupe(loras),
  };

  writeFileSync(OUTPUT_JSON, JSON.stringify(dataset, null, 2));
  console.log(`\n✓ written ${OUTPUT_JSON}`);
  console.log(`  checkpoints=${dataset.checkpoints.length}`);
  console.log(`  loras=${dataset.loras.length}`);
  const withCover = dataset.checkpoints.filter(x => x.cover).length + dataset.loras.filter(x => x.cover).length;
  console.log(`  covers downloaded=${withCover}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});