// 看门狗：500s 超时 -> 杀掉 ComfyUI 进程 -> 按配置重启 -> 等健康检查 -> 调用方重试同一张图。
// 仅支持 Windows（netstat/taskkill）。重启命令去掉 --auto-launch，避免每次重启弹浏览器标签。
import { execSync, spawn } from 'node:child_process'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function findPidByPort(port) {
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    for (const line of out.split('\n')) {
      if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
        const parts = line.trim().split(/\s+/)
        const pid = Number(parts[parts.length - 1])
        if (Number.isFinite(pid) && pid > 0) return pid
      }
    }
  } catch { /* netstat unavailable or timed out */ }
  return null
}

export function killPid(pid) {
  try {
    execSync(`taskkill /F /T /PID ${pid}`, { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    return true
  } catch { return false }
}

export function startComfy(comfyCfg) {
  const args = (comfyCfg.args || []).filter((a) => a !== '--auto-launch')
  const child = spawn(comfyCfg.exe, args, {
    cwd: comfyCfg.cwd, detached: true, stdio: 'ignore', windowsHide: true,
  })
  child.unref()
  return child.pid
}

export async function waitHealthy(base, timeoutMs = 5 * 60 * 1000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${base}/system_stats`)
      if (r.ok) return true
    } catch { /* not up yet */ }
    await sleep(5000)
  }
  return false
}

// 完整的看门狗恢复流程。返回 true 表示 ComfyUI 已恢复可用。
export async function restartComfy({ base, port, comfy }) {
  const pid = findPidByPort(port)
  if (pid) {
    console.log(`  [watchdog] killing ComfyUI pid=${pid}`)
    killPid(pid)
  } else {
    console.log('  [watchdog] no listening process found on port; starting fresh')
  }
  await sleep(3000)
  const newPid = startComfy(comfy)
  console.log(`  [watchdog] restarted ComfyUI pid=${newPid}; waiting for health...`)
  const ok = await waitHealthy(base)
  console.log(`  [watchdog] health check: ${ok ? 'OK' : 'FAILED'}`)
  return ok
}
