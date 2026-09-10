#!/usr/bin/env node
// dsh-comfy-runner v3: 多 loadout 混抽 + 主题批次 + 画幅覆盖 + 500s 看门狗 + 断点续跑 + 并发锁。
//
// 用法:
//   node runner.mjs --n 4                          # 池子随机 4 张，每张按权重抽 loadout
//   node runner.mjs --n 2 --loadout gufeng-sora72  # 只用指定 loadout
//   node runner.mjs --n 50 --keep-going            # 夜间无人值守（看门狗+熔断）
//   node runner.mjs --n 3 --show                   # 干跑：只打印提示词（不写账本、不加锁）
//   node runner.mjs --resume                       # 从中断批次继续
//   node runner.mjs --n 2 --prompt "..."           # 显式提示词
//   node runner.mjs --n 1 --seed S --loadout L --prompt "..."      # 复现单张
//   node runner.mjs --prompts-file runs/youyuan-prompts.txt --loadout recipe-ff240675 --ratio 16:9   # 主题批次
//   node runner.mjs --prompts-file ... --loadout ... --skip "1,3"  # 主题批次补跑：跳过已完成编号
//   node runner.mjs --n 20 --ratio 16:9            # 池子批次但全部 16:9
//   node runner.mjs --n 1 --watchdog-ms 15000      # 临时看门狗（测试）
//
// 主题批次: 提示词文件按 `===== PROMPT NN =====` 分块，每块一张图；--skip "2,4-6" 跳过指定编号。
// 画幅覆盖: --ratio 16:9 --mp 1.3 或 --size 1536x864，运行时写字面尺寸进 #12（无需复制工作流）。
// 并发锁: runs/runner.lock —— 同时只允许一个 runner 实例（锁进程已死或超24h自动接管）。
// 账本 v3: runs[] 流水（append-only）+ activeBatch 当前批 + batches[] 归档（保留最近30批）。
//
// 看门狗: 单图超过 watchdogMs(默认500s) -> 杀 ComfyUI -> 重启 -> 原种子重试，最多 maxRestartsPerImage 次。
// 熔断: 连续 maxConsecutiveFailures 张彻底失败 -> 停批退出。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ComfyClient } from './lib/comfy.mjs'
import { randomCombo, comboKey, buildPrompt, comboSpaceSize, CHARACTER } from './lib/character.mjs'
import { discoverLoadouts, pickLoadout } from './lib/loadouts.mjs'
import { findPidByPort, killPid, restartComfy } from './lib/watchdog.mjs'

const args = process.argv.slice(2)
function argVal(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt }
function argHas(name) { return args.includes(name) }

const N = Number(argVal('--n', '1'))
const SHOW_ONLY = argHas('--show')
const RESUME = argHas('--resume')
const EXPLICIT_PROMPT = argVal('--prompt', null)
const KEEP_GOING = argHas('--keep-going') || argHas('--unattended')
const ONLY_LOADOUT = argVal('--loadout', null)
const SEED_ARG = argVal('--seed', null) // 复现单张 / 主题批次定基准种子：配合 --loadout 使用
const WF_OVERRIDE = argVal('--workflow', null) // 调试用：强制单一工作流文件
const PROMPTS_FILE = argVal('--prompts-file', null) // 主题批次：`===== PROMPT NN =====` 分块的提示词文件
const SKIP_ARG = argVal('--skip', null) // 主题批次跳过编号: "1,3" 或 "2,4-6"
const RATIO_ARG = argVal('--ratio', null) // 画幅覆盖: "16:9"
const SIZE_ARG = argVal('--size', null) // 画幅覆盖（直接尺寸）: "1536x864"
const MP = Number(argVal('--mp', '1.3')) // --ratio 的目标百万像素

if (SKIP_ARG && !PROMPTS_FILE) { console.error('FATAL: --skip requires --prompts-file'); process.exit(2) }
if (PROMPTS_FILE && !fs.existsSync(PROMPTS_FILE)) { console.error(`FATAL: prompts file not found: ${PROMPTS_FILE}`); process.exit(2) }

const ROOT = import.meta.dirname
// 配置加载：优先个人 config.json（不入库），回退 config.example.json（模板），最后内置默认
function loadConfig() {
  for (const f of ['config.json', 'config.example.json']) {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')) } catch { /* try next */ }
  }
  return {}
}
const CFG = loadConfig()
const BASE = argVal('--base', CFG.base)
const PORT = Number(new URL(BASE).port || 8188)
const WATCHDOG_MS = Number(argVal('--watchdog-ms', String(CFG.watchdogMs || 500000)))
const GRACE_MS = Number(CFG.restartGraceMs || 300000)
const MAX_RESTARTS = Number(CFG.maxRestartsPerImage || 3)
const MAX_CONSEC_FAIL = Number(CFG.maxConsecutiveFailures || 3)

const RUNS_DIR = path.join(ROOT, 'runs')
const IMG_DIR = path.join(RUNS_DIR, 'images')
const LEDGER = path.join(RUNS_DIR, 'runs.json')
const LOCK_PATH = path.join(RUNS_DIR, 'runner.lock')
fs.mkdirSync(IMG_DIR, { recursive: true })

// ---- 画幅覆盖 ----
function resolveSize() {
  if (SIZE_ARG) {
    const m = SIZE_ARG.match(/^(\d{3,4})x(\d{3,4})$/)
    if (!m) { console.error('FATAL: --size expects WxH like 1536x864'); process.exit(2) }
    return { width: Number(m[1]), height: Number(m[2]) }
  }
  if (RATIO_ARG) {
    const m = RATIO_ARG.match(/^(\d+):(\d+)$/)
    if (!m) { console.error('FATAL: --ratio expects W:H like 16:9'); process.exit(2) }
    const rw = Number(m[1]), rh = Number(m[2])
    if (rw <= 0 || rh <= 0) { console.error('FATAL: --ratio numbers must be positive'); process.exit(2) }
    // 宽边按 64 取整，高边按精确比例 8 取整——常见比例得到标准分辨率（16:9@1.3MP -> 1536x864）
    const px = Math.sqrt(MP * 1e6)
    let width = Math.max(256, Math.round(px * Math.sqrt(rw / rh) / 64) * 64)
    let height = Math.max(256, Math.round(width * rh / rw / 8) * 8)
    if (width > 4096 || height > 4096) {
      console.error(`FATAL: --ratio ${RATIO_ARG} @ ${MP}MP resolves out of bounds (${width}x${height})`)
      process.exit(2)
    }
    return { width, height }
  }
  return null
}
const SIZE_OVERRIDE = resolveSize()

// ---- 主题批次解析 ----
function parsePromptBlocks(raw) {
  const blocks = []
  let cur = null
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^===== PROMPT (\d+) =====\s*$/)
    if (m) { if (cur && cur.text.trim()) blocks.push(cur); cur = { num: Number(m[1]), text: '' }; continue }
    if (cur) cur.text += line + '\n'
  }
  if (cur && cur.text.trim()) blocks.push(cur)
  for (const b of blocks) b.text = b.text.trim()
  return blocks
}
function parseSkip(spec) {
  const out = new Set()
  for (const part of String(spec).split(',')) {
    const p = part.trim()
    if (!p) continue
    const m = p.match(/^(\d+)-(\d+)$/)
    if (m) { for (let i = Number(m[1]); i <= Number(m[2]); i++) out.add(i); continue }
    const n = Number(p)
    if (Number.isFinite(n) && n > 0) out.add(n)
    else { console.error(`FATAL: bad --skip item "${p}"`); process.exit(2) }
  }
  return out
}

// ---- ledger v3 ----
function loadLedger() {
  let raw = null
  try {
    raw = fs.readFileSync(LEDGER, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return { runs: [], usedCombos: [], batches: [], version: 3 }
    console.error(`FATAL: cannot read ledger ${LEDGER}: ${e.message}`); process.exit(2)
  }
  let l = null
  try {
    l = JSON.parse(raw)
  } catch (e) {
    // 读到半写状态/损坏的账本：宁可停也不能静默重置（重置后下一次保存=全账本抹除）
    console.error(`FATAL: ledger ${LEDGER} is corrupt (${e.message}) — refusing to reset it.`)
    console.error('       修复: 稍等并发写结束后重试；或用 tools/ledger_repair.mjs 从 ComfyUI history 重建 runs[]')
    process.exit(2)
  }
  if (!l || typeof l !== 'object') l = { runs: [], usedCombos: [] }
  if (!l.version) {
    // v2 -> v3 迁移：单槽 batch -> activeBatch + batches 归档
    if (l.batch) { l.activeBatch = { ...l.batch, kind: l.batch.kind || 'pool' }; delete l.batch }
    l.batches = []
    l.version = 3
  }
  l.runs = l.runs || []
  l.usedCombos = l.usedCombos || []
  l.batches = l.batches || []
  return l
}
function saveLedger(l) { fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2), 'utf8') }
function archiveBatch(l) {
  if (!l.activeBatch) return
  const b = l.activeBatch
  b.finishedAt = new Date().toISOString()
  l.batches.push(b)
  while (l.batches.length > 30) l.batches.shift()
  l.activeBatch = null
}

// ---- 并发锁 ----
let lockHeld = false
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}
function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now(), argv: args.join(' ') }))
      fs.closeSync(fd)
      lockHeld = true
      return { ok: true }
    } catch (e) {
      if (e.code !== 'EEXIST') { console.error(`FATAL: lock create failed: ${e.message}`); process.exit(2) }
      let info = null
      try { info = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')) } catch { /* unreadable */ }
      if (info && pidAlive(info.pid) && Date.now() - (info.ts || 0) < 24 * 3600e3) {
        return { ok: false, pid: info.pid, argv: info.argv }
      }
      console.log(`lock: stale (pid=${info?.pid} ${info && pidAlive(info.pid) ? 'older than 24h' : 'process gone'}) — taking over`)
      try { fs.unlinkSync(LOCK_PATH) } catch { /* raced */ }
    }
  }
  console.error('FATAL: could not acquire runner.lock after takeover'); process.exit(2)
}
function releaseLock() { if (!lockHeld) return; try { fs.unlinkSync(LOCK_PATH) } catch { /* already gone */ } lockHeld = false }

function randSeed() { return crypto.randomInt(1, 2 ** 46) }

// ---- loadouts ----
let loadouts = WF_OVERRIDE
  ? [{ id: 'override', workflowPath: WF_OVERRIDE, trigger: '', lead: '', qualityTail: undefined, weight: 1, loraText: '(override)' }]
  : discoverLoadouts()
if (ONLY_LOADOUT) {
  loadouts = loadouts.filter((l) => l.id === ONLY_LOADOUT)
  if (!loadouts.length) { console.error(`FATAL: loadout "${ONLY_LOADOUT}" not found. available: ${discoverLoadouts().map((l) => l.id).join(', ')}`); process.exit(2) }
}
if (!loadouts.length) { console.error('FATAL: no loadouts found in workflows/ (drop an exported API workflow there)'); process.exit(2) }
if (PROMPTS_FILE && !ONLY_LOADOUT && !WF_OVERRIDE) { console.error('FATAL: --prompts-file (themed batch) requires --loadout <id> — themed batches run one style, not a mix'); process.exit(2) }

// 每份 loadout 的参数化节点号固定为 #18/#201/#1535（discoverLoadouts 已校验）
const TEMPLATES = new Map()
for (const l of loadouts) {
  TEMPLATES.set(l.id, JSON.parse(fs.readFileSync(l.workflowPath, 'utf8')))
}
const NODE_PROMPT = '18'
const NODE_SAMPLER = '201'
const NODE_SAVE = '1535'
const NODE_LATENT = '12'

// 画幅覆盖预检：所有用到的 loadout 都必须有 #12 EmptyLatentImage
if (SIZE_OVERRIDE) {
  for (const [id, api] of TEMPLATES) {
    const n = api[NODE_LATENT]
    if (!n || n.class_type !== 'EmptyLatentImage') {
      console.error(`FATAL: loadout "${id}" lacks #${NODE_LATENT} EmptyLatentImage — cannot apply --ratio/--size`)
      process.exit(2)
    }
  }
}

function makeApiPrompt(loadoutId, { text, seed, prefix, size }) {
  const api = JSON.parse(JSON.stringify(TEMPLATES.get(loadoutId)))
  api[NODE_PROMPT].inputs.text = text
  api[NODE_SAMPLER].inputs.seed = seed
  api[NODE_SAVE].inputs.filename_prefix = prefix
  if (size) {
    api[NODE_LATENT].inputs.width = size.width
    api[NODE_LATENT].inputs.height = size.height
  }
  return api
}

// ---- 计划批次（loadout + 组合 + 种子在开跑前定死，配合 --resume 断点续跑） ----
function planJobs(ledger, n) {
  const used = new Set(ledger.usedCombos || [])
  const jobs = []
  let prevCombo = null, prevLoadoutId = null, guard = 0
  while (jobs.length < n && guard < n * 800) {
    guard++
    const loadout = pickLoadout(loadouts, Math.random, prevLoadoutId)
    const combo = randomCombo()
    const key = comboKey(combo, loadout.id)
    if (used.has(key)) continue
    if (prevCombo) {
      let overlap = 0
      for (const k of Object.keys(combo)) if (combo[k] === prevCombo[k]) overlap++
      if (overlap > 1) continue
    }
    used.add(key)
    prevCombo = combo; prevLoadoutId = loadout.id
    jobs.push({
      idx: jobs.length + 1,
      loadout: loadout.id,
      comboKey: key,
      seed: randSeed(),
      text: buildPrompt(combo, loadout),
      status: 'pending',
    })
  }
  return jobs
}

// ---- main ----
const ledger = loadLedger()
let jobs
let batchId
let batchKind

if (RESUME && ledger.activeBatch?.jobs?.some((j) => j.status === 'pending')) {
  jobs = ledger.activeBatch.jobs
  batchId = ledger.activeBatch.id
  batchKind = ledger.activeBatch.kind || 'pool'
  for (const j of jobs) {
    if (!TEMPLATES.has(j.loadout)) { console.error(`FATAL: resume needs loadout "${j.loadout}" (missing from workflows/)`); process.exit(2) }
  }
  console.log(`resuming ${batchKind} batch ${batchId}: ${jobs.filter((j) => j.status === 'pending').length} pending / ${jobs.length} total`)
} else {
  // 上一批没有 pending（崩溃前没归档，或已完成）——先归档再开新批（干跑不落盘）
  if (ledger.activeBatch && !SHOW_ONLY) {
    console.log(`note: previous batch ${ledger.activeBatch.id} (${ledger.activeBatch.kind || 'pool'}) has no pending jobs — archiving`)
    archiveBatch(ledger)
  }
  batchId = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17)
  if (PROMPTS_FILE) {
    const blocks = parsePromptBlocks(fs.readFileSync(PROMPTS_FILE, 'utf8'))
    if (!blocks.length) { console.error(`FATAL: no "===== PROMPT NN =====" blocks found in ${PROMPTS_FILE}`); process.exit(2) }
    const skip = SKIP_ARG ? parseSkip(SKIP_ARG) : new Set()
    const chosen = blocks.filter((b) => !skip.has(b.num))
    if (!chosen.length) { console.error(`FATAL: all ${blocks.length} prompt blocks skipped (--skip ${SKIP_ARG})`); process.exit(2) }
    batchKind = 'themed'
    jobs = chosen.map((b, i) => ({
      idx: i + 1, promptNo: b.num, loadout: ONLY_LOADOUT, comboKey: null,
      seed: SEED_ARG ? Number(SEED_ARG) + i : randSeed(),
      text: b.text, status: 'pending',
    }))
    console.log(`themed batch: ${blocks.length} blocks, ${blocks.length - chosen.length} skipped, ${jobs.length} to run (loadout=${ONLY_LOADOUT})`)
  } else if (EXPLICIT_PROMPT) {
    const l = pickLoadout(loadouts)
    batchKind = 'explicit'
    jobs = Array.from({ length: N }, (_, i) => ({
      idx: i + 1, loadout: l.id, comboKey: null,
      seed: SEED_ARG ? Number(SEED_ARG) + i : randSeed(),
      text: EXPLICIT_PROMPT, status: 'pending',
    }))
  } else {
    batchKind = 'pool'
    jobs = planJobs(ledger, N)
  }
  if (!SHOW_ONLY) {
    ledger.activeBatch = { id: batchId, kind: batchKind, startedAt: new Date().toISOString(), jobs }
    saveLedger(ledger)
  }
}

console.log(`character=${CHARACTER.id}  kind=${batchKind}  loadouts=[${loadouts.map((l) => l.id + (l.weight !== 1 ? ` x${l.weight}` : '')).join(', ')}]`)
if (SIZE_OVERRIDE) console.log(`canvas override: ${SIZE_OVERRIDE.width}x${SIZE_OVERRIDE.height}${RATIO_ARG ? ` (--ratio ${RATIO_ARG} @ ${MP}MP)` : ' (--size)'}`)
if (batchKind === 'pool') console.log(`combos used=${(ledger.usedCombos || []).length}  space≈${comboSpaceSize() * loadouts.length}  jobs=${jobs.length}  watchdog=${WATCHDOG_MS}ms`)

if (SHOW_ONLY) {
  console.log('(dry run: no generation, no lock, ledger untouched)')
  for (const j of jobs) {
    const tag = j.promptNo != null ? `prompt ${j.promptNo}` : `job ${j.idx}`
    console.log(`\n===== ${tag} [${j.loadout}] seed=${j.seed} =====\n${j.text}`)
  }
  process.exit(0)
}

// 干跑结束，正式开跑前拿并发锁
const lock = acquireLock()
if (!lock.ok) {
  console.error(`FATAL: another runner is active (pid ${lock.pid}: ${lock.argv || '?'})`)
  console.error('       wait for it to finish, or resume after it exits: node runner.mjs --resume')
  process.exit(5)
}

const client = new ComfyClient(BASE)

// 初始健康检查：连不上就尝试拉起 ComfyUI
try {
  await client.systemStats()
  console.log('comfyui: reachable')
} catch {
  console.log('comfyui: unreachable — trying to start it')
  if (!CFG.comfy?.exe || !fs.existsSync(CFG.comfy.exe)) {
    console.error('FATAL: ComfyUI not reachable and no valid comfy.exe in config.json — start it manually or edit config.json (see config.example.json)')
    process.exit(2)
  }
  const pid = findPidByPort(PORT)
  if (pid) { console.log(`  stale process pid=${pid} found, killing`); killPid(pid); await new Promise((r) => setTimeout(r, 3000)) }
  const startedOk = await restartComfy({ base: BASE, port: PORT, comfy: CFG.comfy })
  if (!startedOk) { console.error('FATAL: ComfyUI will not come up'); process.exit(2) }
}

let okCount = 0, consecFail = 0, aborted = false
for (const j of jobs) {
  if (j.status !== 'pending') continue
  const tail = j.promptNo != null
    ? `${batchId}_p${String(j.promptNo).padStart(2, '0')}`
    : `${batchId}_${String(j.idx).padStart(2, '0')}`
  const prefix = `dsh_${CHARACTER.id}/${tail}`
  const label = j.promptNo != null ? `prompt ${j.promptNo}` : `${j.idx}/${jobs.length}`
  console.log(`\n[${label}] loadout=${j.loadout} seed=${j.seed}`)

  let attempt = 0
  let finalOk = false, finalErr = null, restarts = 0
  while (attempt <= MAX_RESTARTS) {
    const budget = attempt === 0 ? WATCHDOG_MS : WATCHDOG_MS + GRACE_MS
    const result = await client.run(makeApiPrompt(j.loadout, { text: j.text, seed: j.seed, prefix, size: SIZE_OVERRIDE }), {
      timeoutMs: budget,
      pollMs: 2500,
      onTick: (s) => { if (s % 60 === 0 && s > 0) console.log(`  ...${s}s`) },
    })
    if (result.ok) {
      finalOk = true
      j.images = []
      for (const img of result.images) {
        const local = path.join(IMG_DIR, `${tail}_${img.filename}`)
        try {
          await client.downloadImage(img, local)
          j.images.push({ comfy: `${img.subfolder}/${img.filename}`, local, bytes: fs.statSync(local).size })
          console.log(`  saved: ${local} (${fs.statSync(local).size} bytes)`)
        } catch (e) {
          j.images.push({ comfy: `${img.subfolder}/${img.filename}`, error: e.message })
          console.log(`  download failed (image still in ComfyUI output): ${e.message}`)
        }
      }
      console.log(`  OK pid=${result.pid}`)
      break
    }
    // 失败分类
    if (result.stage === 'submit') {
      // 提交被拒（节点校验错）是确定性错误：重试无用，直接判死
      finalErr = `submit: ${result.error}`
      console.error(`  FAILED (submit, will NOT retry): ${result.error}`)
      break
    }
    // wait 超时或执行错误：杀进程重启，原种子重试
    attempt++
    restarts++
    finalErr = `${result.stage}: ${result.error}`
    console.error(`  FAILED at ${result.stage} (attempt ${attempt}/${MAX_RESTARTS + 1}): ${String(result.error).slice(0, 300)}`)
    if (attempt > MAX_RESTARTS) break
    if (!CFG.comfy?.exe || !fs.existsSync(CFG.comfy.exe)) {
      console.error('  cannot auto-start ComfyUI (no valid comfy.exe in config.json) — aborting batch')
      aborted = true; break
    }
    const healthy = await restartComfy({ base: BASE, port: PORT, comfy: CFG.comfy })
    if (!healthy) { console.error('  ComfyUI restart failed — aborting batch'); aborted = true; break }
    console.log(`  [watchdog] retrying ${j.promptNo != null ? `prompt ${j.promptNo}` : `job ${j.idx}`} with same seed=${j.seed} (+${GRACE_MS}ms grace)`)
  }

  j.status = finalOk ? 'ok' : 'failed'
  j.error = finalOk ? null : finalErr
  j.restarts = restarts
  j.ts = new Date().toISOString()
  ledger.runs.push({
    ts: j.ts, batchId, pid: null, seed: j.seed, prefix,
    character: CHARACTER.id, loadout: j.loadout, comboKey: j.comboKey,
    kind: batchKind, promptNo: j.promptNo ?? null,
    prompt: j.text, ok: finalOk, error: j.error, restarts,
    images: j.images || [],
  })
  if (finalOk) {
    okCount++
    consecFail = 0
    if (j.comboKey) ledger.usedCombos = [...(ledger.usedCombos || []), j.comboKey]
  } else {
    consecFail++
    if (consecFail >= MAX_CONSEC_FAIL) {
      console.error(`\nCIRCUIT BREAKER: ${consecFail} consecutive failures — stopping batch`)
      aborted = true
    } else if (!KEEP_GOING) {
      saveLedger(ledger)
      process.exit(3)
    }
  }
  saveLedger(ledger)
  if (aborted) break
}

// 批次全部处理完则归档
if (!jobs.some((x) => x.status === 'pending')) archiveBatch(ledger)
saveLedger(ledger)

console.log(`\ndone: ${okCount} ok / ${jobs.filter((x) => x.status !== 'pending').length} attempted${aborted ? ' (ABORTED)' : ''}. ledger: ${LEDGER}`)
process.exit(aborted ? 4 : okCount > 0 ? 0 : 3)
