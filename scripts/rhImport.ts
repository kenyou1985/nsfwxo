#!/usr/bin/env tsx
/**
 * 把从 RunningHub 抓取的模型列表 JSON 转成本地数据集格式
 *
 * 用法：
 *   pnpm tsx scripts/rhImport.ts scripts/rh-import-raw.json
 *   pnpm tsx scripts/rhImport.ts --stdin < scripts/rh-import-raw.json
 *
 * 输入格式（兼容两种）：
 *   1. { loras: [...], models: [...] }
 *   2. [...API records...]
 *   3. JSONL（每行一个响应）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface APIRecord {
  resourceName?: string;
  name?: string;
  baseModel?: string;
  baseModels?: string[];
  tags?: string[];
  category?: string[];
  cover?: string;
  coverImage?: string;
  thumbnail?: string;
  image?: string;
  versions?: Array<{ version_resource_name?: string }>;
}

interface RawPayload {
  loras?: APIRecord[];
  models?: APIRecord[];
}

const IL_XL_KEYWORDS = ['illustrious', 'il-xl', 'ilxl'];

function isILXL(rec: APIRecord): boolean {
  const bm = (rec.baseModel || '').toLowerCase();
  if (bm && IL_XL_KEYWORDS.some((k) => bm.includes(k))) return true;
  if (Array.isArray(rec.baseModels)) {
    return rec.baseModels.some((b) => IL_XL_KEYWORDS.some((k) => b.toLowerCase().includes(k)));
  }
  return false;
}

function pickName(rec: APIRecord): string {
  if (rec.versions && rec.versions[0]?.version_resource_name) {
    return rec.versions[0].version_resource_name;
  }
  return rec.resourceName || rec.name || '';
}

function pickCover(rec: APIRecord): string {
  return rec.cover || rec.coverImage || rec.thumbnail || rec.image || '';
}

function pickCategory(rec: APIRecord): string[] {
  const raw = rec.tags || rec.category || [];
  const out = new Set<string>();
  for (const t of raw) {
    const lower = t.toLowerCase();
    if (lower.includes('realistic') || lower.includes('真实')) out.add('realistic');
    else if (lower.includes('anime') || lower.includes('2d') || lower.includes('二次元')) out.add('anime');
    else if (lower.includes('rh') && lower.includes('pick')) out.add('rh-pick');
    else if (lower.includes('character') || lower.includes('角色')) out.add('character');
    else if (lower.includes('style') || lower.includes('风格')) out.add('stylization');
    else if (lower.includes('concept') || lower.includes('概念')) out.add('concept');
    else if (lower.includes('composition') || lower.includes('构图')) out.add('composition');
    else if (lower.includes('helper') || lower.includes('辅助')) out.add('helper');
    else if (lower.includes('ip')) out.add('character');
    else out.add('other');
  }
  return out.size ? Array.from(out) : ['other'];
}

function toEntry(rec: APIRecord, kind: 'checkpoint' | 'lora') {
  const name = pickName(rec);
  const label = name.replace(/\.safetensors$/i, '').replace(/[-_]+/g, ' ').trim();
  return {
    name,
    label,
    category: pickCategory(rec),
    defaultWeight: kind === 'checkpoint' ? 1.0 : 0.7,
    description: '',
    cover: pickCover(rec),
  };
}

function normalize(input: unknown): RawPayload {
  if (Array.isArray(input)) {
    // 单一 records 数组 — 假定是 lora（脚本同时识别带 kind 字段的）
    const loras: APIRecord[] = [];
    const models: APIRecord[] = [];
    for (const rec of input as APIRecord[]) {
      const rname = (rec.resourceName || rec.name || '').toLowerCase();
      if (rname.includes('checkpoint') || rname.includes('xl_v') || rec.baseModel?.toLowerCase().includes('xl')) {
        models.push(rec);
      } else {
        loras.push(rec);
      }
    }
    return { loras, models };
  }
  if (input && typeof input === 'object') {
    const p = input as RawPayload;
    return {
      loras: p.loras || [],
      models: p.models || [],
    };
  }
  return { loras: [], models: [] };
}

function readInput(filePath?: string): RawPayload {
  let raw: string;
  if (filePath && filePath !== '--stdin') {
    raw = readFileSync(resolve(filePath), 'utf8');
  } else {
    raw = readFileSync(0, 'utf8');
  }
  // 优先尝试 JSON，否则按 JSONL
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return normalize(JSON.parse(trimmed));
    } catch {
      // fall through to JSONL
    }
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const loras: APIRecord[] = [];
  const models: APIRecord[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.loras) loras.push(...obj.loras);
      if (obj.models) models.push(...obj.models);
      if (Array.isArray(obj)) {
        const norm = normalize(obj);
        loras.push(...(norm.loras || []));
        models.push(...(norm.models || []));
      }
    } catch {
      // skip
    }
  }
  return { loras, models };
}

const arg = process.argv[2];
const payload = readInput(arg);

const checkpoints = payload.models.filter(isILXL).map((r) => toEntry(r, 'checkpoint'));
const loras = payload.loras.filter(isILXL).map((r) => toEntry(r, 'lora'));

// 去重
const dedupe = (arr: ReturnType<typeof toEntry>[]) => {
  const seen = new Set<string>();
  return arr.filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true)));
};

const dataset = {
  version: 3,
  baseModelFilter: 'IL-XL',
  source: 'https://www.runninghub.ai/page-model',
  updatedAt: new Date().toISOString().slice(0, 10),
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
  checkpoints: dedupe(checkpoints),
  loras: dedupe(loras),
};

const out = resolve(process.cwd(), 'src/data/runninghubModels.json');
console.error(`[rhImport] checkpoints=${dataset.checkpoints.length}, loras=${dataset.loras.length}`);
console.error(`[rhImport] writing to ${out}`);

// merge：保留现有 JSON 不被覆盖
import('node:fs').then((fs) => {
  let existing: typeof dataset | null = null;
  try {
    existing = JSON.parse(fs.readFileSync(out, 'utf8'));
  } catch {
    // ignore
  }
  if (existing) {
    const seen = new Set<string>();
    const mergedCheckpoints = [...dataset.checkpoints, ...existing.checkpoints].filter((e) =>
      seen.has(e.name) ? false : (seen.add(e.name), true)
    );
    const mergedLoras = [...dataset.loras, ...existing.loras].filter((e) =>
      seen.has(e.name) ? false : (seen.add(e.name), true)
    );
    dataset.checkpoints = mergedCheckpoints;
    dataset.loras = mergedLoras;
    console.error(`[rhImport] merged existing: total checkpoints=${mergedCheckpoints.length}, loras=${mergedLoras.length}`);
  }
  fs.writeFileSync(out, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
  console.error('[rhImport] done');
});