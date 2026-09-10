#!/usr/bin/env node
// Inspect a ComfyUI UI-format workflow: main nodes, subgraph definitions, links.
// Usage: node tools/wf_inspect.mjs <workflow.json> [--links] [--node <id>]
import fs from 'node:fs'

const args = process.argv.slice(2)
const file = args[0]
const showLinks = args.includes('--links')
const nodeIdx = args.indexOf('--node')
const focusNode = nodeIdx >= 0 ? args[nodeIdx + 1] : null

const wf = JSON.parse(fs.readFileSync(file, 'utf8'))
console.log(`file: ${file}`)
console.log(`top keys: ${Object.keys(wf).join(', ')}`)
console.log(`main nodes: ${wf.nodes?.length}  links: ${wf.links?.length}  groups: ${wf.groups?.length}`)

const defs = wf.definitions?.subgraphs || []
console.log(`\nsubgraph definitions: ${defs.length}`)
for (const d of defs) {
  console.log(`  def ${d.id}  "${d.name}"  nodes=${d.nodes?.length}  inputs=${d.inputs?.map((i) => i.name).join(',') || ''}  outputs=${d.outputs?.map((o) => `${o.name}:${o.type}`).join(',') || ''}`)
}

console.log('\n== main nodes ==')
for (const n of wf.nodes || []) {
  const sg = n.subgraph !== undefined ? ` subgraph=${JSON.stringify(n.subgraph).slice(0, 60)}` : ''
  const outs = (n.outputs || []).map((o, i) => `${i}:${o.name}(${o.type})`).join(' ')
  console.log(`#${n.id} [${n.type}] mode=${n.mode ?? 0}${sg} title="${n.title ?? ''}"`)
  if (outs) console.log(`     out: ${outs}`)
  const wvn = n.widgets_values_named
  if (wvn) console.log(`     widgets_named: ${JSON.stringify(wvn).slice(0, 400)}`)
}

if (focusNode) {
  const n = (wf.nodes || []).find((x) => String(x.id) === focusNode)
  console.log(`\n== focus node #${focusNode} ==`)
  console.log(JSON.stringify(n, null, 2).slice(0, 4000))
}

if (showLinks) {
  console.log('\n== links (id: origin.slot -> target.slot type) ==')
  for (const l of wf.links || []) {
    console.log(`  ${l[0]}: #${l[1]}.${l[2]} -> #${l[3]}.${l[4]}  ${l[5]}`)
  }
}
