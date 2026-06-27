# RunningHub 模型数据导入工具

## 现状说明

**RunningHub 模型库（https://www.runninghub.ai/page-model）需要登录才能看到完整列表。**

我用以下方式验证过：

| 验证手段 | 结果 |
|---------|------|
| `curl` 直接抓页面 | 110KB，仅返回 Nuxt 壳页面，无模型数据 |
| Chrome headless 渲染 | 看到的是登录墙（`login-v2-bg.png`），没有任何 `.safetensors` 或 `resourceName` |
| `POST /api/model-selection/lora/list` | 返回 `{"code":412,"msg":"TOKEN_INVALID"}` |

公开页面只展示登录引导，注册方式：微信扫码 / Google / 邮箱 / 手机。模型 API 端点全部需要登录态 token。

**所以我（Cursor AI）无法绕过登录抓取上百个模型。**

---

## 如何扩充数据库

请按以下任意一种方式导出已登录态的模型数据：

### 方式 A：浏览器 DevTools Network（推荐）

1. 在 Chrome 打开 `https://www.runninghub.ai/page-model`，登录后切到 **IL-XL** 筛选
2. 打开 DevTools → Network → 过滤 `lora/list` 和 `model/list`
3. 翻页直到加载所有模型，对每个响应右键 **Copy → Copy response**
4. 把响应 JSON 粘贴到 `scripts/rh-import-raw.jsonl`（每行一个响应）
5. 运行 `pnpm tsx scripts/rhImport.ts` 自动生成 `runninghubModels.json`

### 方式 B：浏览器 Console 抓取

登录后打开 Console，粘贴以下代码，把打印结果保存成文件：

```javascript
async function fetchAll(kind, size = 50) {
  const first = await fetch('/api/model-selection/' + kind + '/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageNum: 1, pageSize: size, baseModels: ['IL-XL'] })
  }).then(r => r.json());
  const all = [...(first.data?.records || [])];
  const total = first.data?.total || 0;
  for (let p = 2; p * size < total; p++) {
    const r = await fetch('/api/model-selection/' + kind + '/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNum: p, pageSize: size, baseModels: ['IL-XL'] })
    }).then(r => r.json());
    all.push(...(r.data?.records || []));
  }
  return all;
}
(async () => {
  const loras = await fetchAll('lora');
  const models = await fetchAll('model');
  console.log(JSON.stringify({ loras, models }, null, 2));
})();
```

把输出保存成 `scripts/rh-import-raw.json`，然后运行 `pnpm tsx scripts/rhImport.ts scripts/rh-import-raw.json`。

### 方式 C：截图批量录入

把 RunningHub 模型库每一页截图保存到 `scripts/screenshots/`，然后告诉我"基于这些截图录入数据"，我会逐张 OCR + 手工录入。

---

## scripts/rhImport.ts 转换规则

导入脚本会自动把 API 响应转成数据集格式：

| API 字段 | JSON 字段 | 默认值 |
|----------|----------|--------|
| `resourceName` | `name` | — |
| `tags` / `category` | `category` | `["other"]` |
| `versions[0].version_resource_name` | （覆盖 name） | — |
| `cover` | `cover` | `""`（空 → UI 显示文件名占位） |
| — | `label` | 取 name 去后缀 |
| — | `defaultWeight` | LoRA=`0.7`，Checkpoint=`1.0` |
| — | `description` | `""` |

筛选规则：`baseModel` 包含 `illustrious` / `IL-XL` 才纳入。

---

## 临时手动扩充（最快）

直接编辑 `src/data/runninghubModels.json`，按现有格式追加条目即可。Picker 会在下次构建时自动读取。