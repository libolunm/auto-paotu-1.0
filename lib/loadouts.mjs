// Loadout = 一组 LoRA 配置（一份 API 导出的工作流文件）。
// 用法：在 ComfyUI 里配好一组 LoRA → 导出 API 格式 → 丢进 workflows/ 目录 → 完成。
// 触发词自动从 #17 TriggerWord 节点的 orinalMessage 解析（用双逗号分段：第一段=触发词，其余=质量尾巴）。
// 需要微调（画风引导句/权重/尾巴）时在下方 OVERRIDES 里按文件名加一条即可。
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_QUALITY_TAIL } from './character.mjs'

const DIR = path.join(import.meta.dirname, '..', 'workflows')

// 文件名（不含 .json）-> { trigger: 触发词串, lead: 引导短语, qualityTail: 质量尾巴, weight: 抽取权重 }
export const OVERRIDES = {
  'gufeng-sora72': { lead: 'an ethereal ancient-style painting of', weight: 1.5 },
  '3d-fugtrup': {
    trigger: 'fugtrup_style, a high-end 3D digital art of',
    lead: '',
    qualityTail: 'Polished 3D aesthetics, smooth skin textures, glossy expressive eyes, soft subsurface scattering,  vibrant rim lighting. masterwork 3D character art.',
  },
}

// #17 orinalMessage 用双逗号分段。触发词组可能有多个分段（如 sora72），默认全部合并为触发词；
// 质量尾巴默认用 DEFAULT_QUALITY_TAIL，特殊时在 OVERRIDES 里覆盖。
export function parseTrigger(orinalMessage) {
  if (!orinalMessage) return { trigger: '' }
  const seg = orinalMessage.split(/,\s*,/).map((s) => s.trim()).filter(Boolean)
  return { trigger: seg.join(', ') }
}

export function discoverLoadouts(dir = DIR) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json')).sort()) {
    const full = path.join(dir, f)
    let api
    try { api = JSON.parse(fs.readFileSync(full, 'utf8')) } catch { console.warn(`loadout skip (bad json): ${f}`); continue }
    if (!api['18'] || !api['201'] || !api['1535']) {
      console.warn(`loadout skip (missing #18/#201/#1535 parameter nodes): ${f}`)
      continue
    }
    const id = f.replace(/\.json$/, '')
    // sidecar 元数据（recipe2loadout 产出）；优先级: OVERRIDES > sidecar > #17 解析
    let side = {}
    try { side = JSON.parse(fs.readFileSync(path.join(dir, id + '.meta.json'), 'utf8')) } catch { /* no sidecar */ }
    const ov = OVERRIDES[id] || {}
    const parsed = parseTrigger(api['17']?.inputs?.orinalMessage)
    out.push({
      id,
      workflowPath: full,
      trigger: ov.trigger ?? side.trigger ?? parsed.trigger,
      qualityTail: ov.qualityTail || side.qualityTail || DEFAULT_QUALITY_TAIL,
      lead: ov.lead ?? side.lead ?? '',
      weight: ov.weight ?? side.weight ?? 1,
      loraText: api['2']?.inputs?.text || '',
      source: side.source || null,
    })
  }
  return out
}

// 加权随机抽一个 loadout；多于一个时避免与上一张相同
export function pickLoadout(loadouts, random = Math.random, excludeId = null) {
  const pool = loadouts.length > 1 && excludeId ? loadouts.filter((l) => l.id !== excludeId) : loadouts
  const total = pool.reduce((s, l) => s + (l.weight || 1), 0)
  let r = random() * total
  for (const l of pool) { r -= l.weight || 1; if (r <= 0) return l }
  return pool[pool.length - 1]
}
