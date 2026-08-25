#!/usr/bin/env node
/**
 * 从 RunningHub 公开 API 抓取模型数据
 *
 * 支持资源类型: CHECKPOINT / LORA / UNET
 * 支持基础模型筛选: IL-XL, kea2 (UNET 需不过滤 baseModels 才能拿到所有底模)
 * 增量更新: 只抓取 createTime > lastFetchedAt 的新记录，合并到现有 JSON
 *
 * 用法:
 *   node scripts/fetchRhModels.mjs              # 全量抓取（CHECKPOINT+LORA+UNET）
 *   node scripts/fetchRhModels.mjs --unet      # 仅抓取 UNET
 *   node scripts/fetchRhModels.mjs --checkpoint # 仅抓取 CHECKPOINT
 *   node scripts/fetchRhModels.mjs --lora       # 仅抓取 LoRA
 *   node scripts/fetchRhModels.mjs --incremental # 仅抓取 createTime > last fetchedAt 的新记录
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const API_KEY = '4bdff125174140bb804395756f8c597d';
const ENDPOINT = 'https://www.runninghub.ai/openapi/v2/resource/list';
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 3500;
const MAX_RETRY = 5;
const OUTPUT_JSON = resolve(process.cwd(), '../public/data/runninghubModels.json');
const COVER_DIR = resolve(process.cwd(), '../public/rh-covers');

const args = process.argv.slice(2);
const MODE_INCREMENTAL = args.includes('--incremental');
const MODE_UNET = args.includes('--unet');
const MODE_CHECKPOINT = args.includes('--checkpoint');
const MODE_LORA = args.includes('--lora');
const NO_DOWNLOAD = process.env.NO_DOWNLOAD === '1';

// ─── helpers ────────────────────────────────────────────────────────────────

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

async function fetchPage(kind, baseModels, page) {
  const body = { resourceType: kind, current: page, size: PAGE_SIZE };
  if (baseModels && baseModels.length > 0) body.baseModels = baseModels;
  return callApi(body);
}

/** 抓取 kind 类型，baseModels=null 表示不过滤 */
async function fetchAll(kind, baseModels = null) {
  const baseStr = baseModels ? baseModels.join(',') : '(all)';
  console.log(`\n==== Fetching ${kind} [baseModels=${baseStr}] ====`);
  const first = await fetchPage(kind, baseModels, 1);
  const total = parseInt(first.data.total, 10);
  const records = [...first.data.records];
  const totalPages = Math.ceil(total / PAGE_SIZE);
  console.log(`  total=${total}, pages=${totalPages}`);
  for (let p = 2; p <= totalPages; p++) {
    process.stdout.write(`  page ${p}/${totalPages}\r`);
    await sleep(REQUEST_DELAY_MS);
    const r = await fetchPage(kind, baseModels, p);
    records.push(...r.data.records);
    if (records.length >= total) break;
  }
  console.log(`  ✓ got ${records.length} ${kind} records`);
  return records;
}

/** 抓取增量: 仅返回 createTime > cutoff 的记录 */
async function fetchSince(kind, baseModels, cutoff) {
  const baseStr = baseModels ? baseModels.join(',') : '(all)';
  console.log(`\n==== Fetching ${kind} since ${cutoff} [baseModels=${baseStr}] ====`);
  const first = await fetchPage(kind, baseModels, 1);
  const total = parseInt(first.data.total, 10);
  const allRecords = [...first.data.records];
  const totalPages = Math.ceil(total / PAGE_SIZE);

  for (let p = 2; p <= totalPages; p++) {
    process.stdout.write(`  page ${p}/${totalPages}  (filtered ${allRecords.filter(r => r.createTime > cutoff).length}+)\r`);
    await sleep(REQUEST_DELAY_MS);
    const r = await fetchPage(kind, baseModels, p);
    allRecords.push(...r.data.records);
    if (allRecords.length >= total) break;
  }

  const filtered = allRecords.filter(r => r.createTime > cutoff);
  console.log(`  total fetched=${allRecords.length}, new since ${cutoff}=${filtered.length}`);
  return filtered;
}

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

// ─── classify ───────────────────────────────────────────────────────────────

const TAG_MAP = {
  '真实': 'realistic', '写实': 'realistic', '摄影': 'realistic',
  '二次元': 'anime', '2D': 'anime', '动画': 'anime',
  'IP形象': 'character', 'IP角色': 'character', '角色': 'character', '人物': 'character',
  '风格化': 'stylization', '插画': 'stylization', '风格': 'stylization',
  '辅助': 'helper', '工具': 'helper',
  '画风增强': 'rh-pick', '概念': 'concept', '构图': 'composition', '精选': 'rh-pick',
};

function classify(record) {
  const cats = new Set();
  const tagNames = (record.tags || []).map((t) => t.name).filter(Boolean);
  for (const n of tagNames) {
    for (const [k, v] of Object.entries(TAG_MAP)) {
      if (n.includes(k)) cats.add(v);
    }
  }
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

function pickVersion(record, baseModel) {
  return (
    record.versions?.find((x) => x.baseModel === baseModel) ||
    record.versions?.find((x) => x.baseModel === 'IL-XL') ||
    record.versions?.[0]
  );
}

function pickVersionName(record, baseModel) {
  const v = pickVersion(record, baseModel);
  return v?.versionResourceName || '';
}

function pickTriggerWords(record, baseModel) {
  const v = pickVersion(record, baseModel);
  return v?.triggerWords || '';
}

function pickBaseModelSubtype(record, baseModel) {
  const v = pickVersion(record, baseModel);
  return v?.baseModelSubtype || '';
}

function descToText(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// ─── transform ──────────────────────────────────────────────────────────────

/**
 * @param {string} kind  'CHECKPOINT' | 'LORA' | 'UNET'
 * @param {string|null} baseModel  筛选的底模（UNET 不过滤时为 null）
 */
async function transformRecords(records, kind, baseModel, downloadCoverMode = 'first') {
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const nodeName = r.nodeModelName || '';
    const versionName = pickVersionName(r, baseModel);
    const fileName = (versionName || nodeName).split('/').pop() || nodeName;
    const cats = classify(r);
    const triggerWords = pickTriggerWords(r, baseModel);
    let description = descToText(r.desc);
    if (triggerWords && description) description = `触发词: ${triggerWords} | ${description}`;
    else if (triggerWords) description = `触发词: ${triggerWords}`;
    const sub = pickBaseModelSubtype(r, baseModel);
    const entry = {
      id: r.id,
      name: fileName,
      label: (r.resourceName || nodeName || '').replace(/\.safetensors$/i, ''),
      category: cats,
      defaultWeight: kind === 'CHECKPOINT' ? 1.0 : 0.7,
      description,
      baseModel: baseModel || sub || '',
      baseModelSubtype: sub,
      version: r.versions?.[0]?.version || '',
      triggerWords,
      tags: (r.tags || []).map((t) => t.name).filter(Boolean),
      posterUrl: r.posterUrl || '',
      thumbnailUrl: r.thumbnailUrl || '',
      cover: '',
      owner: r.owner?.name || '',
      createTime: r.createTime || '',
      updateTime: r.updateTime || r.createTime || '',
    };
    if (downloadCoverMode === 'first') {
      const localPath = await downloadCover(r, kind === 'CHECKPOINT' ? 'ckpt' : kind === 'UNET' ? 'unet' : 'lora');
      entry.cover = localPath;
    }
    out.push(entry);
    if ((i + 1) % 100 === 0) console.log(`  transformed ${i + 1}/${records.length}`);
  }
  return out;
}

// ─── deduplicate merge ─────────────────────────────────────────────────────

function dedupeAndMerge(existing, incoming) {
  const seen = new Set(existing.map(e => e.name.toLowerCase()));
  const added = [];
  for (const r of incoming) {
    if (!seen.has(r.name.toLowerCase())) {
      seen.add(r.name.toLowerCase());
      added.push(r);
    }
  }
  return [...existing, ...added];
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  const downloadMode = NO_DOWNLOAD ? 'none' : 'first';
  const now = new Date().toISOString();

  // 读取现有数据
  let existing = {
    version: 5,
    checkpoints: [],
    loras: [],
    unets: [],
    fetchedAt: now,
    updatedAt: now,
    lastFetchedAt: null,
  };
  if (existsSync(OUTPUT_JSON)) {
    try {
      const raw = JSON.parse(readFileSync(OUTPUT_JSON, 'utf-8'));
      existing = {
        version: raw.version || 5,
        checkpoints: raw.checkpoints || [],
        loras: raw.loras || [],
        unets: raw.unets || [],
        fetchedAt: raw.fetchedAt || now,
        updatedAt: raw.updatedAt || now,
        lastFetchedAt: raw.lastFetchedAt || raw.fetchedAt || null,
      };
      console.log(`Loaded existing DB: ${existing.checkpoints.length} ckpt, ${existing.loras.length} lora, ${existing.unets.length} unet`);
    } catch (e) {
      console.warn('Failed to read existing JSON, starting fresh:', e.message);
    }
  }

  // 确定增量cutoff
  const cutoff = MODE_INCREMENTAL ? (existing.lastFetchedAt || existing.fetchedAt) : null;
  if (MODE_INCREMENTAL) {
    console.log(`Incremental mode: only fetching records newer than ${cutoff}`);
  }

  // ── UNET ──
  if (MODE_UNET || (!MODE_CHECKPOINT && !MODE_LORA)) {
    // UNET 不过滤 baseModels，因为 krea2/kea2 的 UNET 不过滤拿不到
    let unetRaw;
    if (MODE_INCREMENTAL && cutoff) {
      unetRaw = await fetchSince('UNET', null, cutoff);
    } else {
      unetRaw = await fetchAll('UNET', null);
    }
    await sleep(REQUEST_DELAY_MS);
    const unets = await transformRecords(unetRaw, 'UNET', null, downloadMode);
    existing.unets = MODE_INCREMENTAL
      ? dedupeAndMerge(existing.unets, unets)
      : unets;
  }

  // ── CHECKPOINT (IL-XL) ──
  if (MODE_CHECKPOINT || (!MODE_UNET && !MODE_LORA)) {
    let ckptRaw;
    if (MODE_INCREMENTAL && cutoff) {
      ckptRaw = await fetchSince('CHECKPOINT', ['IL-XL'], cutoff);
    } else {
      ckptRaw = await fetchAll('CHECKPOINT', ['IL-XL']);
    }
    await sleep(REQUEST_DELAY_MS);
    const ckpts = await transformRecords(ckptRaw, 'CHECKPOINT', 'IL-XL', downloadMode);
    existing.checkpoints = MODE_INCREMENTAL
      ? dedupeAndMerge(existing.checkpoints, ckpts)
      : ckpts;
  }

  // ── LORA (IL-XL) ──
  if (MODE_LORA || (!MODE_UNET && !MODE_CHECKPOINT)) {
    let loraRaw;
    if (MODE_INCREMENTAL && cutoff) {
      loraRaw = await fetchSince('LORA', ['IL-XL'], cutoff);
    } else {
      loraRaw = await fetchAll('LORA', ['IL-XL']);
    }
    await sleep(REQUEST_DELAY_MS);
    const loras = await transformRecords(loraRaw, 'LORA', 'IL-XL', downloadMode);
    existing.loras = MODE_INCREMENTAL
      ? dedupeAndMerge(existing.loras, loras)
      : loras;
  }

  // ── write ──
  existing.version = 5;
  existing.updatedAt = now;
  existing.lastFetchedAt = now;
  existing.baseModelFilter = ['IL-XL (Checkpoint/LoRA)', 'kea2 (UNET)', 'all'];
  existing.categories = [
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
  ];

  writeFileSync(OUTPUT_JSON, JSON.stringify(existing, null, 2));
  console.log(`\n✓ written ${OUTPUT_JSON}`);
  console.log(`  checkpoints=${existing.checkpoints.length}`);
  console.log(`  loras=${existing.loras.length}`);
  console.log(`  unets=${existing.unets.length}`);
  const withCover = existing.checkpoints.filter(x => x.cover).length
    + existing.loras.filter(x => x.cover).length
    + existing.unets.filter(x => x.cover).length;
  console.log(`  covers downloaded=${withCover}`);
  console.log(`  lastFetchedAt=${existing.lastFetchedAt}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
