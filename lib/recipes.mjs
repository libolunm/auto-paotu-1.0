// Lora Manager 配方客户端：拉取 / 缓存 / 过滤 / LoRA 名解析。
// 数据源: ComfyUI-Lora-Manager 的 HTTP API (GET /api/lm/recipes)。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const CACHE = path.join(ROOT, 'cache', 'recipes.json')

export async function fetchAllRecipes(base = 'http://127.0.0.1:8188', { pageSize = 100 } = {}) {
  const all = new Map()
  let page = 1
  let totalPages = 1
  do {
    const r = await fetch(`${base}/api/lm/recipes?page=${page}&page_size=${pageSize}`)
    if (!r.ok) throw new Error(`/api/lm/recipes HTTP ${r.status}`)
    const j = await r.json()
    const list = j.items || j.recipes || j.data || []
    for (const rec of list) all.set(rec.id, rec)
    const respPageSize = j.page_size || pageSize
    totalPages = j.total_pages || Math.ceil((j.total || all.size) / respPageSize)
    page++
  } while (page <= totalPages)
  return [...all.values()].map(trimRecipe)
}

export function trimRecipe(r) {
  return {
    id: r.id,
    title: (r.title || '').replace(/\s+/g, ' ').slice(0, 90),
    baseModel: r.base_model || r.checkpoint?.modelVersionName || '',
    nsfwLevel: r.preview_nsfw_level ?? 0,
    favorite: !!r.favorite,
    sourcePath: r.source_path || '',
    previewUrl: r.file_url || '',
    loras: (r.loras || []).map((l) => ({
      displayName: l.file_name || l.modelName || '',
      strength: l.strength ?? 1,
      localPath: l.localPath || '',
      inLibrary: !!l.inLibrary,
    })),
    prompt: r.gen_params?.prompt || '',
    negativePrompt: r.gen_params?.negative_prompt || '',
    steps: r.gen_params?.steps ?? null,
    cfg: r.gen_params?.cfg_scale ?? null,
  }
}

// 缓存 24h；--force 时重拉
export async function cachedRecipes(base, { ttlMs = 24 * 3600 * 1000, force = false } = {}) {
  if (!force && fs.existsSync(CACHE)) {
    try {
      const { savedAt, recipes } = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
      if (Date.now() - savedAt < ttlMs && Array.isArray(recipes)) return recipes
    } catch { /* corrupt cache: refetch */ }
  }
  const recipes = await fetchAllRecipes(base)
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify({ savedAt: Date.now(), count: recipes.length, recipes }, null, 2))
  return recipes
}

export function isKrea2(rec) {
  const s = `${rec.baseModel} ${rec.prompt}`.toLowerCase()
  return s.includes('krea 2') || s.includes('krea2')
}

// localPath -> LoraManager 语法的 lora 名（models/loras 之后的相对路径，去扩展名，正斜杠）
export function loraNameFromPath(p) {
  let s = String(p).replace(/\\/g, '/')
  const m = s.match(/models\/loras\/(.+)$/i)
  const rel = m ? m[1] : s.split('/').pop()
  return rel.replace(/\.(safetensors|ckpt|pt)$/i, '')
}

// ComfyUI 实际注册的 lora 名集合（权威来源）
export async function validLoraNames(base = 'http://127.0.0.1:8188') {
  const r = await fetch(`${base}/object_info/LoraLoader`)
  if (!r.ok) throw new Error(`LoraLoader HTTP ${r.status}`)
  const j = await r.json()
  const names = j.LoraLoader?.input?.required?.lora_name?.[0] || []
  return new Set(names.map((n) => String(n).replace(/\\/g, '/').replace(/\.(safetensors|ckpt|pt)$/i, '')))
}

// 配方 lora 栈 -> 可加载名；校验以文件存在为准（LoraManager 认双根目录，核心 LoraLoader 枚举不认 F 盘）
export function resolveStack(rec, _validSetUnused) {
  const loras = []
  const missing = []
  for (const l of rec.loras) {
    if (!l.localPath) { missing.push(`${l.displayName} (no localPath)`); continue }
    const name = loraNameFromPath(l.localPath)
    let exists = false
    try { exists = fs.existsSync(l.localPath) } catch { exists = false }
    if (!exists) { missing.push(`${name} (${l.localPath.slice(-50)})`); continue }
    loras.push({ name, strength: l.strength })
  }
  return { ok: missing.length === 0 && loras.length > 0, loras, missing }
}
