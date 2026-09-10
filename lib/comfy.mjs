// Minimal ComfyUI HTTP API client (zero-dependency, Node >= 18).
export class ComfyClient {
  constructor(base = process.env.COMFY_BASE || 'http://127.0.0.1:8188') {
    this.base = base.replace(/\/+$/, '')
    this.clientId = 'dsh-runner-' + Math.random().toString(36).slice(2, 10)
  }

  async systemStats() {
    const r = await fetch(`${this.base}/system_stats`)
    if (!r.ok) throw new Error(`system_stats HTTP ${r.status}`)
    return r.json()
  }

  async queueInfo() {
    const r = await fetch(`${this.base}/queue`)
    if (!r.ok) throw new Error(`queue HTTP ${r.status}`)
    return r.json()
  }

  // Submit an API-format prompt. Throws with node_errors detail on validation failure.
  async submit(apiPrompt) {
    const res = await fetch(`${this.base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: apiPrompt, client_id: this.clientId }),
    })
    const text = await res.text()
    let j
    try { j = JSON.parse(text) } catch { throw new Error(`/prompt HTTP ${res.status}: ${text.slice(0, 500)}`) }
    if (!res.ok || j.error) {
      const nodeErrs = []
      for (const [nid, err] of Object.entries(j.node_errors || {})) {
        nodeErrs.push(`#${nid} ${err.class_type}: ${JSON.stringify(err.errors || err).slice(0, 300)}`)
      }
      throw new Error(`submit rejected: ${JSON.stringify(j.error)} ${nodeErrs.join(' | ')}`)
    }
    return j.prompt_id
  }

  // Poll /history/{pid} until the run completes or errors. Returns the history entry.
  async wait(pid, { timeoutMs = 20 * 60 * 1000, pollMs = 2000, onTick } = {}) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      let entry = null
      try {
        const r = await fetch(`${this.base}/history/${pid}`)
        if (r.ok) { const h = await r.json(); entry = h[pid] || null }
      } catch { /* transient network error: keep polling */ }
      if (entry) {
        const st = entry.status || {}
        if (st.completed || st.status_str === 'error') return entry
      }
      if (onTick) onTick(Math.round((Date.now() - t0) / 1000))
      await new Promise((r) => setTimeout(r, pollMs))
    }
    throw new Error(`timeout waiting for prompt ${pid}`)
  }

  // Extract saved-image refs from a completed history entry.
  outputImages(entry) {
    const out = []
    for (const [nid, o] of Object.entries(entry.outputs || {})) {
      for (const img of o.images || []) {
        if (img.type === 'temp' && /_temp_/.test(img.filename)) continue // preview temp files
        out.push({ node: nid, ...img })
      }
    }
    return out
  }

  async downloadImage(img, destPath) {
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' })
    const r = await fetch(`${this.base}/view?${q}`)
    if (!r.ok) throw new Error(`view HTTP ${r.status} for ${img.filename}`)
    const buf = Buffer.from(await r.arrayBuffer())
    const { default: fs } = await import('node:fs')
    fs.mkdirSync(new URL(`file:///${destPath.replace(/\\/g, '/')}`).pathname.replace(/^\//, ''), { recursive: true })
    fs.writeFileSync(destPath, buf)
    return { path: destPath, bytes: buf.length }
  }

  // Full cycle: submit -> wait -> report. Never throws for execution errors; returns {ok:false,...}.
  async run(apiPrompt, opts = {}) {
    let pid
    try { pid = await this.submit(apiPrompt) } catch (e) { return { ok: false, stage: 'submit', error: e.message } }
    let entry
    try { entry = await this.wait(pid, opts) } catch (e) { return { ok: false, stage: 'wait', pid, error: e.message } }
    const st = entry.status || {}
    if (st.status_str === 'error') {
      const msgs = (st.messages || []).filter((m) => /error/i.test(m[0])).map((m) => JSON.stringify(m).slice(0, 300))
      return { ok: false, stage: 'exec', pid, error: msgs.join(' | ') || 'execution error' }
    }
    return { ok: true, pid, images: this.outputImages(entry), entry }
  }
}
