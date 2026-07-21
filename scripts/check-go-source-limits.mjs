#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const maxLines = 300
const roots = ['internal', 'pkg']
const skipDir = new Set(['testdata', 'vendor'])
const failures = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (skipDir.has(entry)) continue
      walk(full)
      continue
    }
    if (!entry.endsWith('.go') || entry.endsWith('_test.go')) continue
    const text = readFileSync(full, 'utf8')
    const lines = text.split(/\r?\n/).length
    if (lines > maxLines) {
      failures.push({ file: relative(root, full), lines })
    }
  }
}

for (const r of roots) walk(join(root, r))
if (failures.length) {
  console.error(`Go production files exceed ${maxLines} lines:`)
  for (const item of failures.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${item.file}: ${item.lines}`)
  }
  process.exit(1)
}
console.log(`Go source limits OK (<= ${maxLines} lines)`)
