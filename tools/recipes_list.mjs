#!/usr/bin/env node
// 配方候选清单：拉缓存 -> Krea2 过滤 -> 可转换性检查 -> 打印策展表格。
// 用法: node tools/recipes_list.mjs [--force] [--include-missing]
import { cachedRecipes, isKrea2, resolveStack } from '../lib/recipes.mjs'

const args = process.argv.slice(2)
const BASE = process.env.COMFY_BASE || 'http://127.0.0.1:8188'
const FORCE = args.includes('--force')
const INCLUDE_MISSING = args.includes('--include-missing')

const recipes = await cachedRecipes(BASE, { force: FORCE })

const rows = []
for (const rec of recipes) {
  if (!isKrea2(rec)) continue
  const { ok, loras, missing } = resolveStack(rec)
  if (!ok && !INCLUDE_MISSING) continue
  const styleStems = loras
    .map((l) => l.name.split('/').pop())
    .filter((s) => !/textfusion|refusal/i.test(s))
  rows.push({
    id: rec.id.slice(0, 8),
    nsfw: rec.nsfwLevel,
    cfg: rec.cfg,
    ok,
    nLoras: loras.length,
    missing: missing.length,
    stems: styleStems.join('+').slice(0, 70),
    title: rec.title.slice(0, 40),
  })
}

rows.sort((a, b) => (a.ok === b.ok ? b.nsfw - a.nsfw : a.ok ? -1 : 1))
console.log(`total recipes: ${recipes.length}  krea2: ${recipes.filter(isKrea2).length}  convertible: ${rows.filter((r) => r.ok).length}`)
console.log('')
console.log('id       nsfw  cfg  ok  loras  style-loras                                  title')
console.log('-'.repeat(120))
for (const r of rows) {
  console.log(
    `${r.id}  ${String(r.nsfw).padStart(4)}  ${String(r.cfg ?? '?').padStart(3)}  ${r.ok ? 'Y' : 'N'}   ${String(r.nLoras).padStart(2)}    ${r.stems.padEnd(46).slice(0, 46)}  ${r.title}${r.missing ? `  [missing:${r.missing}]` : ''}`
  )
}
