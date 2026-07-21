import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('src')
const maxFileLines = 300
const ignore = [
  /\.test\.(ts|tsx)$/,
  /\.behavior\.test\.(ts|tsx)$/,
  /\/test\//,
  /bindings\//,
]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = walk(root).filter((file) => !ignore.some((rule) => rule.test(file)))
const violations = []
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).length
  if (lines > maxFileLines) violations.push({ file: path.relative(process.cwd(), file), lines })
}
if (violations.length) {
  console.error(`Source file limit exceeded (>${maxFileLines} lines):`)
  for (const item of violations) console.error(`  ${item.file}: ${item.lines}`)
  process.exit(1)
}
console.log(`OK: ${files.length} production source files <= ${maxFileLines} lines`)
