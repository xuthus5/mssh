import fs from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript'

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

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function lineNumber(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1
}

function functionName(node, sourceFile) {
  if (node.name) return node.name.getText(sourceFile)
  if (ts.isVariableDeclaration(node.parent)) return node.parent.name.getText(sourceFile)
  if (ts.isPropertyAssignment(node.parent)) return node.parent.name.getText(sourceFile)
  return '<anonymous>'
}

function callRoot(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return callRoot(expression.expression)
  }
  if (ts.isCallExpression(expression)) return callRoot(expression.expression)
  return ''
}

function isTestRegistrationCallback(node, file) {
  if (!/\.test\.(ts|tsx)$/.test(file) || !ts.isCallExpression(node.parent)) return false
  if (!node.parent.arguments.includes(node)) return false
  return testRegistrationRoots.has(callRoot(node.parent.expression))
}

function scanFunctions(file) {
  const source = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const violations = []
  function visit(node) {
    if (ts.isFunctionLike(node) && node.body && !isTestRegistrationCallback(node, file)) {
      const start = lineNumber(sourceFile, node.getStart(sourceFile))
      const end = lineNumber(sourceFile, node.end)
      const lines = end - start + 1
      const relativeFile = path.relative(process.cwd(), file)
      const name = functionName(node, sourceFile)
      if (lines > maxFunctionLines) violations.push({ kind: 'function-lines', file: relativeFile, line: start, name, actual: lines })
      const exempt = positionalParameterExemptions.some((rule) => rule.file === relativeFile && rule.name === name)
      if (!exempt && node.parameters.length > maxPositionalParameters) {
        violations.push({ kind: 'parameters', file: relativeFile, line: start, name, actual: node.parameters.length })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

const allFiles = walk(root)
const productionFiles = allFiles.filter((file) => !fileLimitIgnore.some((rule) => rule.test(file)))
const violations = []
for (const file of productionFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).length
  if (lines > maxFileLines) violations.push({ kind: 'file-lines', file: path.relative(process.cwd(), file), actual: lines })
}
for (const file of allFiles.filter((file) => !functionScanIgnore.some((rule) => rule.test(file)))) {
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
