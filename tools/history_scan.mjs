#!/usr/bin/env node
// Scan ComfyUI /history for real API-format prompts of the Krea2 workflow runs.
// Usage: node tools/history_scan.mjs [--base http://127.0.0.1:8188] [--max 200]
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
function argVal(name, dflt) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const BASE = argVal('--base', process.env.COMFY_BASE || 'http://127.0.0.1:8188')
const MAX = Number(argVal('--max', '200'))

const ROOT = path.resolve(import.meta.dirname, '..')
const CACHE = path.join(ROOT, 'cache')
fs.mkdirSync(CACHE, { recursive: true })

const res = await fetch(`${BASE}/history?max_items=${MAX}`)
if (!res.ok) {
  console.error(`history fetch failed: HTTP ${res.status}`)
  process.exit(1)
}
const hist = await res.json()
const entries = Object.entries(hist)
console.log(`history entries: ${entries.length}`)

const rows = []
for (const [pid, entry] of entries) {
  const api = entry.prompt && entry.prompt[1]
  if (!api || typeof api !== 'object') { rows.push({ pid, skip: true }); continue }
  const js = JSON.stringify(api)
  const models = [...new Set((js.match(/[\w\\\-. ()]+\.safetensors/g) || []).map((s) => s.trim()))]
  const hasFace = js.includes('FaceDetailer')
  const hasHand = /DetailerForEach|hand_yolo|hand/i.test(js)
  let ts = 0
  for (const m of entry.status?.messages || []) {
    if (m[1] && typeof m[1].timestamp === 'number') ts = Math.max(ts, m[1].timestamp)
  }
  const texts = []
  const prefixes = []
  for (const [nid, node] of Object.entries(api)) {
    const t = node?.inputs?.text
    if (typeof t === 'string' && t.length > 40) {
      texts.push({ nid, type: node.class_type, text: t.slice(0, 180).replace(/\s+/g, ' ') })
    }
    if (/SaveImage|Image Save|SaveIMG|ImageSaver/.test(node?.class_type || '')) {
      prefixes.push(`${nid} ${node.class_type} prefix="${node.inputs?.filename_prefix ?? ''}"`)
    }
  }
  rows.push({ pid, ts, models, hasFace, hasHand, prefixes, texts, nodeCount: Object.keys(api).length, skip: false })
}

rows.sort((a, b) => (b.ts || 0) - (a.ts || 0))
for (const r of rows) {
  if (r.skip) { console.log(`\n[skip] pid=${r.pid} (no api prompt)`); continue }
  console.log('\n' + '='.repeat(70))
  console.log(`pid=${r.pid}`)
  console.log(`  time=${r.ts ? new Date(r.ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '?'}  nodes=${r.nodeCount}  face=${r.hasFace}  hand=${r.hasHand}`)
  console.log(`  models: ${(r.models || []).join(' | ')}`)
  if (r.prefixes.length) console.log(`  save: ${r.prefixes.join(' ; ')}`)
  for (const t of r.texts.slice(0, 5)) console.log(`  text[${t.nid}] (${t.type}): ${t.text}`)
}

const kreaRuns = rows.filter((r) => !r.skip && (r.models || []).some((m) => /krea2/i.test(m)))
for (const r of kreaRuns.slice(0, 10)) {
  const api = hist[r.pid].prompt[1]
  const f = path.join(CACHE, `api-${r.pid}.json`)
  fs.writeFileSync(f, JSON.stringify(api, null, 2), 'utf8')
  console.log(`dumped: ${f}`)
}
console.log(`\ntotal=${rows.length}  krea2-matching=${kreaRuns.length}`)
