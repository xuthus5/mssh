import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { hasEnglishTranslation } from '@/i18n'

const sources = import.meta.glob('../**/*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>

describe('static translation guard', () => {
  it('does not freeze translations at module initialization', () => {
    expect(findStaticTranslations()).toEqual([])
  })

  it('covers every static Chinese translation key', () => {
    expect(findMissingStaticTranslations()).toEqual([])
  })

  it('covers every Chinese production string literal', () => {
    expect(findMissingProductionTranslations()).toEqual([])
  })
})

function findStaticTranslations(): string[] {
  const violations: string[] = []
  for (const [file, source] of Object.entries(sources)) {
    if (!/\.test\.(ts|tsx)$/.test(file)) inspectFile(file, source, violations)
  }
  return violations
}

function findMissingStaticTranslations(): string[] {
  const violations: string[] = []
  for (const [file, source] of Object.entries(sources)) {
    if (!/\.test\.(ts|tsx)$/.test(file)) inspectTranslationCoverage(file, source, violations)
  }
  return violations
}

function findMissingProductionTranslations(): string[] {
  const violations: string[] = []
  for (const [file, source] of Object.entries(sources)) {
    if (!/\.test\.(ts|tsx)$/.test(file)) inspectProductionStrings(file, source, violations)
  }
  return violations
}

function inspectFile(file: string, source: string, violations: string[]) {
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
  visit(sourceFile, sourceFile, 0, violations)
}

function inspectTranslationCoverage(file: string, source: string, violations: string[]) {
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
  visitTranslationKeys(sourceFile, sourceFile, violations)
}

function inspectProductionStrings(file: string, source: string, violations: string[]) {
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
  visitProductionStrings(sourceFile, sourceFile, violations)
}

function visit(...args: [ts.Node, ts.SourceFile, number, string[]]) {
  const [node, sourceFile, functionDepth, violations] = args
  const nextDepth = functionDepth + (ts.isFunctionLike(node) ? 1 : 0)
  if (functionDepth === 0 && isTranslatorCall(node)) violations.push(location(sourceFile, node))
  if (ts.isCallExpression(node) && isHook(node, 'useState') && containsTranslator(node.arguments[0])) {
    violations.push(location(sourceFile, node))
  }
  ts.forEachChild(node, (child) => visit(child, sourceFile, nextDepth, violations))
}

function visitTranslationKeys(node: ts.Node, sourceFile: ts.SourceFile, violations: string[]) {
  if (isTranslatorCall(node)) {
    const key = staticTranslationKey(node.arguments[0])
    if (key && /[\u3400-\u9fff]/.test(key) && !hasEnglishTranslation(key)) {
      violations.push(`${location(sourceFile, node)} ${JSON.stringify(key)}`)
    }
  }
  ts.forEachChild(node, (child) => visitTranslationKeys(child, sourceFile, violations))
}

function visitProductionStrings(node: ts.Node, sourceFile: ts.SourceFile, violations: string[]) {
  const key = staticTranslationKey(ts.isExpression(node) ? node : undefined)
  if (key && /[\u3400-\u9fff]/.test(key) && !hasEnglishTranslation(key)) {
    violations.push(`${location(sourceFile, node)} ${JSON.stringify(key)}`)
  }
  ts.forEachChild(node, (child) => visitProductionStrings(child, sourceFile, violations))
}

function staticTranslationKey(node: ts.Expression | undefined): string {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text
  return ''
}

function containsTranslator(node: ts.Node | undefined): boolean {
  if (!node) return false
  if (isTranslatorCall(node)) return true
  return node.getChildren().some(containsTranslator)
}

function isTranslatorCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't'
}

function isHook(node: ts.CallExpression, name: string): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === name
}

function location(sourceFile: ts.SourceFile, node: ts.Node): string {
  const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return `${sourceFile.fileName}:${point.line + 1}`
}
