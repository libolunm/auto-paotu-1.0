#!/usr/bin/env node
// 配方 -> loadout 转换器：把 Lora Manager 的一份配方转成 runner 可用的 loadout。
// 只 patch 模板的 #2 节点（LoraManager 的 lora 栈）；触发词走 sidecar 元数据（进提示词，不进图）。
// 用法:
//   node tools/recipe2loadout.mjs --recipe <id前缀> [--trigger "..."] [--lead "..."] [--tail "..."] [--weight 1] [--force]
import fs from 'node:fs'
import path from 'node:path'
import { cachedRecipes, resolveStack } from '../lib/recipes.mjs'

const args = process.argv.slice(2)
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const argHas = (n) => args.includes(n)

const BASE = argVal('--base', process.env.COMFY_BASE || 'http://127.0.0.1:8188')
const RECIPE_ID = argVal('--recipe', null)
const TEMPLATE = argVal('--template', path.join(import.meta.dirname, '..', 'workflows', 'gufeng-sora72.json'))
const TRIGGER = argVal('--trigger', null)
const LEAD = argVal('--lead', '')
const TAIL = argVal('--tail', '')
const WEIGHT = Number(argVal('--weight', '1'))
const FORCE = argHas('--force')

if (!RECIPE_ID) {
  console.error('usage: node tools/recipe2loadout.mjs --recipe <id> [--trigger "..."] [--lead "..."] [--tail "..."] [--weight 1]')
  process.exit(2)
}

const recipes = await cachedRecipes(BASE, { force: FORCE })
const rec = recipes.find((r) => r.id === RECIPE_ID || r.id.startsWith(RECIPE_ID))
if (!rec) { console.error(`recipe not found: ${RECIPE_ID} (cache has ${recipes.length})`); process.exit(2) }

const { ok, loras, missing } = resolveStack(rec)
if (!ok) {
  console.error(`recipe ${rec.id} NOT convertible — missing loras:`)
  for (const m of missing) console.error('  - ' + m)
  process.exit(3)
}

const wf = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'))
const node2 = wf['2']
if (!node2) { console.error(`template ${TEMPLATE} has no #2 LoraManager node`); process.exit(2) }
node2.inputs.text = loras.map((l) => `<lora:${l.name}:${l.strength}>`).join(' ')
node2.inputs.loras = { __value__: loras.map((l) => ({ name: l.name, strength: l.strength, active: true, expanded: false, clipStrength: 1, selected: false, locked: false })) }

// 切断 #17 -> #18 的 trigger_words1 链接，改用字面量。
// 否则模板里 sora72 的触发词会注入每个配方的提示词，污染非 sora72 画风。
const trigger = TRIGGER || draftTrigger(rec)
if (wf['18'] && Array.isArray(wf['18'].inputs.trigger_words1)) {
  wf['18'].inputs.trigger_words1 = trigger
}

const id = 'recipe-' + rec.id.slice(0, 8)
const wfPath = path.join(import.meta.dirname, '..', 'workflows', id + '.json')
fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2), 'utf8')

const meta = {
  trigger,
  lead: LEAD,
  qualityTail: TAIL || '',
  weight: WEIGHT,
  source: {
    type: 'recipe', id: rec.id, title: rec.title, nsfwLevel: rec.nsfwLevel,
    previewUrl: rec.previewUrl, sourcePath: rec.sourcePath, loras,
  },
}
fs.writeFileSync(wfPath.replace(/\.json$/, '.meta.json'), JSON.stringify(meta, null, 2), 'utf8')

console.log(`ok: ${path.relative(process.cwd(), wfPath)}`)
console.log(`    trigger: "${meta.trigger}"`)
console.log(`    loras: ${loras.map((l) => `${l.name.split('/').pop()}:${l.strength}`).join(' | ')}`)

function draftTrigger(rec) {
  const head = (rec.prompt || '').replace(/<lora:[^>]*>/g, '').split('\n')[0]
  return head.split(',').slice(0, 4).join(',').trim().slice(0, 120)
}
