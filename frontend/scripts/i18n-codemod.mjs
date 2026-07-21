import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve('src')
const cjk = /[\u4e00-\u9fff]/

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'i18n' || entry.name === 'bindings') continue
      walkFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) && !/\.behavior\.test\./.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function shouldSkipFile(filePath, sourceText) {
  if (filePath.includes(`${path.sep}i18n${path.sep}`)) return true
  if (!cjk.test(sourceText)) return true
  return false
}

function hasTImport(sourceFile) {
  return sourceFile.statements.some((st) => {
    if (!ts.isImportDeclaration(st) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) return false
    if (st.moduleSpecifier.text !== '@/i18n') return false
    const clause = st.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false
    return clause.namedBindings.elements.some((el) => el.name.text === 't')
  })
}

function ensureTImport(text, sourceFile) {
  if (hasTImport(sourceFile)) return text
  // remove old uiText t import
  text = text.replace(/import\s*\{\s*t\s*\}\s*from\s*'@\/lib\/uiText'\s*;?\n?/g, '')
  const imports = sourceFile.statements.filter((st) => ts.isImportDeclaration(st))
  const insertAt = imports.length ? imports[imports.length - 1].end : 0
  const statement = "import { t } from '@/i18n'\n"
  return text.slice(0, insertAt) + (insertAt && text[insertAt - 1] !== '\n' ? '\n' : '') + statement + text.slice(insertAt)
}

function templateToT(node, sourceFile) {
  // Convert template with CJK to t('...${}...', expr1, expr2)
  const parts = []
  const args = []
  for (const span of node.templateSpans) {
    parts.push(span.literal.text.replace(/\r/g, ''))
    // The head is separate; spans: expression + literal after
  }
  // rebuild properly
  const head = node.head.text
  let template = head
  for (const span of node.templateSpans) {
    template += '${}'
    args.push(span.expression.getText(sourceFile))
    template += span.literal.text
  }
  if (!cjk.test(template)) return null
  const call = `t('${esc(template)}'${args.length ? ', ' + args.join(', ') : ''})`
  return call
}

function transformFile(filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8')
  if (shouldSkipFile(filePath, sourceText)) return false

  const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, kind)

  /** @type {{start:number,end:number,text:string}[]} */
  const edits = []

  function alreadyWrapped(node) {
    const parent = node.parent
    if (!parent) return false
    if (ts.isCallExpression(parent) && parent.expression.getText(sourceFile) === 't') return true
    // t.xxx no
    return false
  }

  function isImportContext(node) {
    let cur = node
    while (cur) {
      if (ts.isImportDeclaration(cur) || ts.isExportDeclaration(cur)) return true
      cur = cur.parent
    }
    return false
  }

  function isTypeContext(node) {
    let cur = node.parent
    while (cur) {
      if (
        ts.isTypeNode(cur) ||
        ts.isTypeAliasDeclaration(cur) ||
        ts.isInterfaceDeclaration(cur) ||
        ts.isAsExpression(cur) ||
        ts.isTypeReferenceNode(cur) ||
        ts.isExpressionWithTypeArguments(cur)
      ) return true
      // property name in type literal
      if (ts.isPropertySignature(cur) || ts.isMethodSignature(cur)) return true
      cur = cur.parent
    }
    return false
  }

  function visit(node) {
    // JSX text
    if (ts.isJsxText(node)) {
      const raw = node.getText(sourceFile)
      if (cjk.test(raw)) {
        const leading = raw.match(/^\s*/)[0]
        const trailing = raw.match(/\s*$/)[0]
        const body = raw.trim()
        if (body) {
          edits.push({
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            text: `${leading}{t('${esc(body)}')}${trailing}`,
          })
        }
      }
    }

    // String literal
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const value = node.text
      if (cjk.test(value) && !alreadyWrapped(node) && !isImportContext(node) && !isTypeContext(node)) {
        // skip object property *names* that are string literals used as keys if parent is property assignment name
        if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) {
          // key - skip
        } else if (ts.isEnumMember(node.parent)) {
          // skip
        } else {
          edits.push({
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            text: `t('${esc(value)}')`,
          })
        }
      }
    }

    // Template expression
    if (ts.isTemplateExpression(node)) {
      if (!alreadyWrapped(node) && !isImportContext(node) && !isTypeContext(node)) {
        const replacement = templateToT(node, sourceFile)
        if (replacement) {
          edits.push({
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            text: replacement,
          })
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  if (edits.length === 0) return false

  // apply edits from end to start
  edits.sort((a, b) => b.start - a.start)
  let next = sourceText
  for (const edit of edits) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
  }
  // re-parse to ensure import
  const sf2 = ts.createSourceFile(filePath, next, ts.ScriptTarget.Latest, true, kind)
  next = ensureTImport(next, sf2)
  // cleanup double wrap
  next = next.replace(/t\(t\('((?:\\'|[^'])*)'(?:,\s*[^)]+)?\)\)/g, (m) => m.slice(2, -1))
  fs.writeFileSync(filePath, next)
  return true
}

const files = walkFiles(root)
let count = 0
for (const file of files) {
  if (transformFile(file)) {
    count += 1
    console.log('updated', path.relative(process.cwd(), file))
  }
}
console.log('done, files=', count)
