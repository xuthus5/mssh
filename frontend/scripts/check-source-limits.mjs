import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'

const root = path.resolve('src')
const maxFileLines = 300
const maxFunctionLines = 50
const maxPositionalParameters = 3
// Framework/contract functions that require more positional parameters than
// the project limit. wails' RuntimeTransport.call must keep its 4-argument
// signature because the runtime invokes it by position.
const positionalParameterExemptions = [
  { file: 'src/lib/wsTransport.ts', name: 'call' },
]
const fileLimitIgnore = [
  /\.test\.(ts|tsx)$/,
  /\.behavior\.test\.(ts|tsx)$/,
  /\/test\//,
  /bindings\//,
]
const functionScanIgnore = [/bindings\//]
const testRegistrationRoots = new Set(['describe', 'it', 'test'])
// TypeScript 7 dropped the in-process compiler API, so the checks parse with
// babel instead. These are the function-like node types it reports.
const functionTypes = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
  'TSDeclareMethod',
])
const nonChildKeys = new Set([
  'loc',
  'start',
  'end',
  'extra',
  'errors',
  'tokens',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

// Windows reports paths with backslashes, which would never match the
// forward-slash patterns and exemption entries below. Normalize so the checks
// behave the same on every platform.
function toPosix(value) {
  return value.split(path.sep).join('/')
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function isNode(value) {
  return typeof value === 'object' && value !== null && typeof value.type === 'string'
}

function nodeList(value) {
  return Array.isArray(value) ? value.filter(isNode) : []
}

function childNodes(node) {
  const children = []
  for (const [key, value] of Object.entries(node)) {
    if (nonChildKeys.has(key)) continue
    if (Array.isArray(value)) children.push(...value.filter(isNode))
    else if (isNode(value)) children.push(value)
  }
  return children
}

function parseSource(file) {
  const source = fs.readFileSync(file, 'utf8')
  const plugins = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript']
  try {
    return parse(source, { sourceType: 'module', plugins })
  } catch (error) {
    throw new Error(`failed to parse ${toPosix(path.relative(process.cwd(), file))}: ${error.message}`)
  }
}

function callRoot(callee) {
  if (!isNode(callee)) return ''
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
    return callRoot(callee.object)
  }
  if (callee.type === 'CallExpression' || callee.type === 'OptionalCallExpression') {
    return callRoot(callee.callee)
  }
  return ''
}

function isTestRegistrationCallback(node, parent, file) {
  if (!/\.test\.(ts|tsx)$/.test(file)) return false
  if (!parent || parent.type !== 'CallExpression') return false
  if (!parent.arguments.includes(node)) return false
  return testRegistrationRoots.has(callRoot(parent.callee))
}

function nodeName(node) {
  if (!isNode(node)) return '<anonymous>'
  if (typeof node.name === 'string') return node.name
  if (typeof node.value === 'string') return node.value
  return '<anonymous>'
}

function functionName(node, parent) {
  if (isNode(node.id)) return nodeName(node.id)
  if (isNode(node.key)) return nodeName(node.key)
  if (parent && (parent.type === 'VariableDeclarator' || parent.type === 'ObjectProperty')) {
    return nodeName(parent.id ?? parent.key)
  }
  return '<anonymous>'
}

function scanFunctions(file) {
  const violations = []
  const relativeFile = toPosix(path.relative(process.cwd(), file))
  const visit = (node, parent) => {
    if (functionTypes.has(node.type) && node.body && !isTestRegistrationCallback(node, parent, file)) {
      const start = node.loc.start.line
      const end = node.loc.end.line
      const lines = end - start + 1
      const name = functionName(node, parent)
      if (lines > maxFunctionLines) violations.push({ kind: 'function-lines', file: relativeFile, line: start, name, actual: lines })
      const parameters = nodeList(node.params).length
      const exempt = positionalParameterExemptions.some((rule) => rule.file === relativeFile && rule.name === name)
      if (!exempt && parameters > maxPositionalParameters) {
        violations.push({ kind: 'parameters', file: relativeFile, line: start, name, actual: parameters })
      }
    }
    for (const child of childNodes(node)) visit(child, node)
  }
  visit(parseSource(file), null)
  return violations
}

const allFiles = walk(root)
const productionFiles = allFiles.filter((file) => !fileLimitIgnore.some((rule) => rule.test(toPosix(file))))
const violations = []
for (const file of productionFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).length
  if (lines > maxFileLines) violations.push({ kind: 'file-lines', file: toPosix(path.relative(process.cwd(), file)), actual: lines })
}
for (const file of allFiles.filter((file) => !functionScanIgnore.some((rule) => rule.test(toPosix(file))))) {
  violations.push(...scanFunctions(file))
}
if (violations.length) {
  console.error('Source limits exceeded:')
  for (const item of violations) {
    if (item.kind === 'file-lines') console.error(`  ${item.file}: ${item.actual} file lines (max ${maxFileLines})`)
    if (item.kind === 'function-lines') console.error(`  ${item.file}:${item.line} ${item.name}: ${item.actual} function lines (max ${maxFunctionLines})`)
    if (item.kind === 'parameters') console.error(`  ${item.file}:${item.line} ${item.name}: ${item.actual} positional parameters (max ${maxPositionalParameters})`)
  }
  process.exit(1)
}
console.log(`OK: ${productionFiles.length} production files, ${allFiles.length} TypeScript sources within limits`)
