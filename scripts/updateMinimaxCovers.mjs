#!/usr/bin/env node
/**
 * 专门更新 MiniMax-H3 相关模型的封面
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const API_KEY = '4bdff125174140bb804395756f8c597d';
const ENDPOINT = 'https://www.runninghub.ai/openapi/v2/resource/list';
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 4000;
const OUTPUT_JSON = './public/data/runninghubModels.json';

async function callApi(body, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.code === 1016 || json.code === 1003 || res.status === 429) {
        if (attempt < retries) {
          console.log(`  限流 (${json.code})，等待 60s...`);
          await sleep(60000);
          continue;
        }
      }
      if (json.code !== 0) {
        if (attempt < retries) {
          await sleep(3000);
          continue;
        }
        throw new Error(`API error: ${json.code}`);
      }
      return json;
    } catch (e) {
      if (attempt < retries) {
        await sleep(3000);
        continue;
      }
      throw e;
    }
  }
  throw new Error('API failed after retries');
}

async function fetchAllWithCovers(resourceType, baseModels) {
  const baseStr = baseModels ? baseModels.join(',') : '(all)';
  console.log(`\n==== Fetching ${resourceType} [baseModels=${baseStr}] ====`);
  
  const first = await callApi({ resourceType, current: 1, size: PAGE_SIZE, baseModels });
  const total = parseInt(first.data.total, 10);
  const records = [...first.data.records];
  const totalPages = Math.ceil(total / PAGE_SIZE);
  console.log(`  total=${total}, pages=${totalPages}`);
  
  for (let p = 2; p <= totalPages; p++) {
    process.stdout.write(`  page ${p}/${totalPages}\r`);
    await sleep(REQUEST_DELAY_MS);
    const r = await callApi({ resourceType, current: p, size: PAGE_SIZE, baseModels });
    records.push(...r.data.records);
    if (records.length >= total) break;
  }
  console.log(`  ✓ got ${records.length} records`);
  return records;
}

async function main() {
  console.log('开始更新 MiniMax-H3 模型封面...\n');
  
  const data = JSON.parse(readFileSync(OUTPUT_JSON, 'utf-8'));
  
  // 1. 更新 MiniMax-H3 Checkpoints
  console.log('=== 更新 MiniMax-H3 Checkpoints ===');
  const mmCkptRecords = await fetchAllWithCovers('CHECKPOINT', ['minimax-h3']);
  
  // 创建 ID -> cover 映射
  const ckptCoverMap = new Map();
  for (const r of mmCkptRecords) {
    const cover = r.thumbnailUrl || r.posterUrl || '';
    if (cover) ckptCoverMap.set(r.id, cover);
  }
  
  // 更新数据库中的 checkpoint
  let ckptUpdated = 0;
  for (const ckpt of data.checkpoints) {
    if (ckptCoverMap.has(ckpt.id)) {
      ckpt.cover = ckptCoverMap.get(ckpt.id);
      ckptUpdated++;
    }
  }
  console.log(`  更新了 ${ckptUpdated} 个 Checkpoint 封面`);
  
  await sleep(REQUEST_DELAY_MS);
  
  // 2. 更新 MiniMax-H3 LoRAs
  console.log('\n=== 更新 MiniMax-H3 LoRAs ===');
  const mmLoraRecords = await fetchAllWithCovers('LORA', ['minimax-h3']);
  
  // 创建 ID -> cover 映射
  const loraCoverMap = new Map();
  for (const r of mmLoraRecords) {
    const cover = r.thumbnailUrl || r.posterUrl || '';
    if (cover) loraCoverMap.set(r.id, cover);
  }
  
  // 更新数据库中的 lora
  let loraUpdated = 0;
  for (const lora of data.loras) {
    if (loraCoverMap.has(lora.id)) {
      lora.cover = loraCoverMap.get(lora.id);
      loraUpdated++;
    }
  }
  console.log(`  更新了 ${loraUpdated} 个 LoRA 封面`);
  
  // 保存
  writeFileSync(OUTPUT_JSON, JSON.stringify(data, null, 2));
  
  // 统计
  const mmCkptsWithCover = data.checkpoints.filter(c => (c.baseModel || '').toLowerCase().includes('minimax') && c.cover).length;
  const mmLorasWithCover = data.loras.filter(l => (l.baseModel || '').toLowerCase().includes('minimax') && l.cover).length;
  
  console.log('\n=== 更新完成 ===');
  console.log(`MiniMax-H3 Checkpoints: ${mmCkptsWithCover}/13 有封面`);
  console.log(`MiniMax-H3 LoRAs: ${mmLorasWithCover}/398 有封面`);
}

main().catch(console.error);
