#!/usr/bin/env node
/**
 * 更新 UNET 模型封面
 * 使用批量 API 调用获取封面 URL，然后更新 JSON
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const API_KEY = '4bdff125174140bb804395756f8c597d';
const ENDPOINT = 'https://www.runninghub.ai/openapi/v2/resource/list';
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 3500;
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
      // 1016 可能是限流，等待更长时间
      if (json.code === 1016 || json.code === 1003 || res.status === 429) {
        if (attempt < retries) {
          const waitTime = 60000 * attempt; // 递增等待时间
          console.log(`  限流 (${json.code})，等待 ${waitTime/1000}s...`);
          await sleep(waitTime);
          continue;
        }
      }
      if (json.code !== 0) {
        if (attempt < retries) {
          console.log(`  API 错误 ${json.code}，重试中...`);
          await sleep(3000);
          continue;
        }
        throw new Error(`API error: ${json.code}`);
      }
      return json;
    } catch (e) {
      if (attempt < retries) {
        console.log(`  网络错误，重试中...`);
        await sleep(3000);
        continue;
      }
      throw e;
    }
  }
  throw new Error('API failed after retries');
}

async function main() {
  console.log('开始更新 UNET 封面...\n');
  
  // 读取现有数据
  const data = JSON.parse(readFileSync(OUTPUT_JSON, 'utf-8'));
  const totalUnets = data.unets.length;
  const withCover = data.unets.filter(u => u.cover).length;
  console.log(`总 UNET 数: ${totalUnets}`);
  console.log(`已有封面: ${withCover}`);
  
  // 获取所有 UNET 的封面
  const first = await callApi({ resourceType: 'UNET', current: 1, size: PAGE_SIZE });
  const total = parseInt(first.data.total, 10);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  console.log(`API 总数: ${total}, 页数: ${totalPages}\n`);
  
  // 收集所有 UNET 的封面 URL
  const coverMap = new Map();
  for (const record of first.data.records) {
    const cover = record.thumbnailUrl || record.posterUrl || '';
    if (cover) coverMap.set(record.id, cover);
  }
  
  // 抓取剩余页面
  for (let p = 2; p <= totalPages; p++) {
    process.stdout.write(`  抓取第 ${p}/${totalPages} 页\r`);
    await sleep(REQUEST_DELAY_MS);
    const r = await callApi({ resourceType: 'UNET', current: p, size: PAGE_SIZE });
    for (const record of r.data.records) {
      const cover = record.thumbnailUrl || record.posterUrl || '';
      if (cover) coverMap.set(record.id, cover);
    }
  }
  console.log(`\n获取到 ${coverMap.size} 个封面 URL`);
  
  // 更新 data.unets
  let updated = 0;
  for (const unet of data.unets) {
    if (!unet.cover && coverMap.has(unet.id)) {
      unet.cover = coverMap.get(unet.id);
      updated++;
    }
  }
  
  // 同时也更新其他没有封面的模型（checkpoint, lora）
  const ckptCoverMap = new Map();
  console.log('\n抓取 CHECKPOINT 封面...');
  const ckptFirst = await callApi({ resourceType: 'CHECKPOINT', current: 1, size: PAGE_SIZE, baseModels: ['IL-XL'] });
  for (const record of ckptFirst.data.records) {
    const cover = record.thumbnailUrl || record.posterUrl || '';
    if (cover) ckptCoverMap.set(record.id, cover);
  }
  
  // 抓取 minimax-h3 checkpoints
  const ckptMMFirst = await callApi({ resourceType: 'CHECKPOINT', current: 1, size: PAGE_SIZE, baseModels: ['minimax-h3'] });
  for (const record of ckptMMFirst.data.records) {
    const cover = record.thumbnailUrl || record.posterUrl || '';
    if (cover) ckptCoverMap.set(record.id, cover);
  }
  
  for (const ckpt of data.checkpoints) {
    if (!ckpt.cover && ckptCoverMap.has(ckpt.id)) {
      ckpt.cover = ckptCoverMap.get(ckpt.id);
      updated++;
    }
  }
  
  console.log('抓取 LoRA 封面...');
  const loraCoverMap = new Map();
  const loraFirst = await callApi({ resourceType: 'LORA', current: 1, size: PAGE_SIZE, baseModels: ['IL-XL'] });
  for (const record of loraFirst.data.records) {
    const cover = record.thumbnailUrl || record.posterUrl || '';
    if (cover) loraCoverMap.set(record.id, cover);
  }
  
  const loraMMFirst = await callApi({ resourceType: 'LORA', current: 1, size: PAGE_SIZE, baseModels: ['minimax-h3'] });
  for (const record of loraMMFirst.data.records) {
    const cover = record.thumbnailUrl || record.posterUrl || '';
    if (cover) loraCoverMap.set(record.id, cover);
  }
  
  for (const lora of data.loras) {
    if (!lora.cover && loraCoverMap.has(lora.id)) {
      lora.cover = loraCoverMap.get(lora.id);
      updated++;
    }
  }
  
  // 保存
  writeFileSync(OUTPUT_JSON, JSON.stringify(data, null, 2));
  
  // 统计
  const finalUnetCover = data.unets.filter(u => u.cover).length;
  const finalCkptCover = data.checkpoints.filter(c => c.cover).length;
  const finalLoraCover = data.loras.filter(l => l.cover).length;
  
  console.log('\n=== 更新完成 ===');
  console.log(`UNET 封面: ${withCover} -> ${finalUnetCover} (${finalUnetCover - withCover} 新增)`);
  console.log(`Checkpoint 封面: ${finalCkptCover}/${data.checkpoints.length}`);
  console.log(`LoRA 封面: ${finalLoraCover}/${data.loras.length}`);
  console.log(`总共更新: ${updated} 个模型封面`);
}

main().catch(console.error);
