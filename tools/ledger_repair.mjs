#!/usr/bin/env node
// tools/ledger_repair.mjs — 从 ComfyUI /history 回填账本流水。
//
// 场景：并发/崩溃导致 runs/runs.json 的 runs[] 丢失记录，但图都在 ComfyUI 输出目录和 history 里。
// 本工具扫描 history，找出所有 dsh_* 前缀的已完成条目，去重后补进 runs[]（只追加，不改已有记录，
// 不碰 activeBatch/batches）。
//
// 用法:
//   node tools/ledger_repair.mjs                       # 干跑：只打印将要补什么
//   node tools/ledger_repair.mjs --apply               # 实际写入账本
//   node tools/ledger_repair.mjs --apply --download-missing   # 本地缺图也从 /view 下载
//   node tools/ledger_repair.mjs --match-prompts runs/youyuan-prompts.txt   # 按提示词文本标注 promptNo
//   node tools/ledger_repair.mjs --max-items 2000      # 拉更多 history
import fs from 'node:fs'
import path from 'node:path'
import { discoverLoadouts } from '../lib/loadouts.mjs'

const args = process.argv.slice(2)
function argVal(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt }
function argHas(name) { return args.includes(name) }

const ROOT = path.resolve(import.meta.dirname, '..')
const LEDGER = path.join(ROOT, 'runs', 'runs.json')
const IMG_DIR = path.join(ROOT, 'runs', 'images')
const BASE = argVal('--base', 'http://127.0.0.1:8188')
const MAX_ITEMS = Number(argVal('--max-items', '1000'))
const APPLY = argHas('--apply')
const DOWNLOAD = argHas('--download-missing')
const MATCH_FILE = argVal('--match-prompts', null)

// ---- 参数化节点定位（与 runner 一致；找不到时按 class_type 兜底） ----
function findNode(prompt, id, classType) {
  if (prompt[id]) return prompt[id]
  for (const node of Object.values(prompt)) {
    if (node.class_type === classType) return node
  }
  return null
}

function normText(s) { return String(s || '').replace(/\s+/g, ' ').trim() }

// ---- 提示词块匹配表（可选） ----
let promptMap = null // Map<normalized text, promptNo>
if (MATCH_FILE) {
  const raw = fs.readFileSync(MATCH_FILE, 'utf8')
  promptMap = new Map()
  let cur = null, buf = ''
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^===== PROMPT (\d+) =====\s*$/)
    if (m) {
      if (cur != null && normText(buf)) promptMap.set(normText(buf), cur)
      cur = Number(m[1]); buf = ''
      continue
    }
    if (cur != null) buf += line + '\n'
  }
  if (cur != null && normText(buf)) promptMap.set(normText(buf), cur)
  console.log(`match-prompts: loaded ${promptMap.size} blocks from ${MATCH_FILE}`)
}

// ---- loadout 匹配表：loraText -> loadout（并列时按 #12 字面尺寸精确匹配） ----
const loadouts = discoverLoadouts(path.join(ROOT, 'workflows'))
const byLoraText = new Map()
for (const l of loadouts) {
  if (!byLoraText.has(l.loraText)) byLoraText.set(l.loraText, [])
  byLoraText.get(l.loraText).push(l)
}
function matchLoadout(loraText, width, height) {
  const cands = byLoraText.get(loraText)
  if (!cands || !cands.length) return 'unknown'
  if (cands.length === 1) return cands[0].id
  for (const c of cands) {
    try {
      const t = JSON.parse(fs.readFileSync(c.workflowPath, 'utf8'))
      const n = t['12']?.inputs
      if (n && n.width === width && n.height === height) return c.id
    } catch { /* unreadable template */ }
  }
  return cands[0].id
}

// ---- history ----
const r = await fetch(`${BASE}/history?max_items=${MAX_ITEMS}`)
if (!r.ok) { console.error(`FATAL: /history ${r.status}`); process.exit(2) }
const history = await r.json()
console.log(`history: ${Object.keys(history).length} entries fetched`)

// ---- 现有 runs 去重键 ----
const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
const existing = new Set()
for (const run of ledger.runs || []) {
  existing.add(`${run.prefix}|${run.images?.[0]?.comfy || ''}`)
}

let scanned = 0, ours = 0, added = 0, dup = 0, downloads = 0
const byBatch = new Map()
const toAdd = []

for (const [pid, entry] of Object.entries(history)) {
  scanned++
  // /history 的 prompt 是五元数组 [number, prompt_id, workflow, extra_data, outputs_to_execute]，工作流在 [2]
  const raw = entry.prompt
  const prompt = Array.isArray(raw) ? (raw[2] && typeof raw[2] === 'object' ? raw[2] : raw[1]) : raw
  if (!prompt || typeof prompt !== 'object') continue
  // 找保存节点的前缀
  let saveNode = null
  for (const node of Object.values(prompt)) {
    if (node.class_type === 'SaveImageAdvanced' || node.class_type === 'SaveImage') { saveNode = node; break }
  }
  const prefix = saveNode?.inputs?.filename_prefix || ''
  if (!prefix.startsWith('dsh_')) continue // 不是本系统的产物
  ours++
  // 输出图像（跳过 _temp_）
  const images = []
  for (const out of Object.values(entry.outputs || {})) {
    for (const img of out.images || []) {
      if (img.filename?.startsWith('_temp_')) continue
      images.push(img)
    }
  }
  if (!images.length) continue // 失败/中断的条目没有产物，无法映射
  // 前缀解析: dsh_<char>/<batchId>_<idx> 或 dsh_<char>/<batchId>_p<NN>
  const tail = prefix.slice(prefix.lastIndexOf('/') + 1)
  const character = prefix.slice(4, prefix.indexOf('/'))
  const mp = tail.match(/^(.*)_p(\d+)$/)
  const mi = tail.match(/^(.*)_(\d+)$/)
  const batchId = mp ? mp[1] : mi ? mi[1] : tail
  const promptNo = mp ? Number(mp[2]) : null
  // 参数提取
  const promptNode = findNode(prompt, '18', 'Prompt (LoraManager)')
  const samplerNode = findNode(prompt, '201', 'FLS_SamplerV4')
  const loraNode = findNode(prompt, '2', 'Lora Loader (LoraManager)')
  const latentNode = prompt['12'] || null
  const text = promptNode?.inputs?.text || ''
  const seed = Number(samplerNode?.inputs?.seed) || null
  const loraText = loraNode?.inputs?.text || ''
  const width = Number.isFinite(latentNode?.inputs?.width) ? latentNode.inputs.width : null
  const height = Number.isFinite(latentNode?.inputs?.height) ? latentNode.inputs.height : null
  // promptNo 标注（如果提供了匹配文件且前缀里没有）
  let matchedNo = promptNo
  if (matchedNo == null && promptMap) matchedNo = promptMap.get(normText(text)) ?? null
  // 本地文件映射 + 去重
  const runImages = []
  let firstKey = null
  for (const img of images) {
    const comfy = `${img.subfolder || ''}/${img.filename}`.replace(/^\//, '')
    if (firstKey === null) firstKey = `${prefix}|${comfy}`
    const local = path.join(IMG_DIR, `${tail}_${img.filename}`)
    runImages.push({ comfy, local, bytes: fs.existsSync(local) ? fs.statSync(local).size : null })
  }
  const key = firstKey
  if (existing.has(key)) { dup++; continue }
  existing.add(key)
  // 缺图下载（可选）
  if (DOWNLOAD) {
    for (const ri of runImages) {
      if (ri.bytes != null) continue
      try {
        const url = `${BASE}/view?filename=${encodeURIComponent(path.basename(ri.comfy))}&subfolder=${encodeURIComponent(path.dirname(ri.comfy) === '.' ? '' : path.dirname(ri.comfy))}&type=output`
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const buf = Buffer.from(await resp.arrayBuffer())
        fs.mkdirSync(path.dirname(ri.local), { recursive: true })
        fs.writeFileSync(ri.local, buf)
        ri.bytes = buf.length
        downloads++
      } catch (e) {
        console.log(`  download failed ${ri.comfy}: ${e.message}`)
      }
    }
  }
  // 时间戳：本地图 mtime > history 消息 > 现在
  let ts = null
  const localExists = runImages.find((ri) => ri.bytes != null)
  if (localExists && fs.existsSync(localExists.local)) ts = fs.statSync(localExists.local).mtime.toISOString()
  if (!ts) {
    for (const msg of entry.status?.messages || []) {
      if (Array.isArray(msg) && typeof msg[1] === 'number' && msg[1] > 1e12) { ts = new Date(msg[1]).toISOString(); break }
    }
  }
  if (!ts) ts = new Date().toISOString()
  const missingLocal = runImages.filter((ri) => ri.bytes == null).length
  toAdd.push({
    ts, batchId, pid, seed, prefix,
    character, loadout: matchLoadout(loraText, width, height),
    comboKey: null, kind: matchedNo != null ? 'themed' : 'history-repair', promptNo: matchedNo,
    canvas: width != null && height != null ? `${width}x${height}` : null,
    prompt: text, ok: true, error: null, restarts: 0,
    images: runImages,
  })
  added++
  const b = byBatch.get(batchId) || { added: 0, missing: 0 }
  b.added++
  b.missing += missingLocal
  byBatch.set(batchId, b)
}

// ---- 报告 ----
console.log(`\nscanned=${scanned} ours=${ours} added=${added} already-in-ledger=${dup} downloaded=${downloads}`)
if (byBatch.size) {
  console.log('\nbatch breakdown (to add):')
  for (const [id, b] of [...byBatch.entries()].sort()) {
    console.log(`  ${id}  +${b.added}${b.missing ? `  (${b.missing} image(s) missing locally${DOWNLOAD ? '' : ' — rerun with --download-missing'})` : ''}`)
  }
}
if (!toAdd.length) { console.log('\nnothing to add.'); process.exit(0) }

if (!APPLY) {
  console.log('\ndry run — rerun with --apply to write these into runs/runs.json')
  process.exit(0)
}

ledger.runs = [...(ledger.runs || []), ...toAdd]
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2), 'utf8')
console.log(`\napplied: ${toAdd.length} runs appended. ledger now has ${ledger.runs.length} runs.`)
