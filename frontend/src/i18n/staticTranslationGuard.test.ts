import { parse, type ParserPlugin } from '@babel/parser'
import { describe, expect, it } from 'vitest'
import { hasEnglishTranslation } from '@/i18n'

const sources = import.meta.glob('../**/*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>

interface AstNode {
  type: string
  [key: string]: unknown
}

interface WalkState {
  file: string
  violations: string[]
}

interface CollectorState extends WalkState {
  depth: number
}

// TypeScript 7 dropped the in-process compiler API, so the guard inspects a
// babel AST instead of the compiler's.
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
const chinesePattern = /[\u3400-\u9fff]/

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

function productionSources(): [string, string][] {
  return Object.entries(sources).filter(([file]) => !/\.test\.(ts|tsx)$/.test(file))
}

function findStaticTranslations(): string[] {
  const violations: string[] = []
  for (const [file, source] of productionSources()) {
    collectStaticTranslations(parseSource(file, source), { file, violations, depth: 0 })
  }
  return violations
}

function collectStaticTranslations(node: AstNode, state: CollectorState) {
  const nextDepth = state.depth + (functionTypes.has(node.type) ? 1 : 0)
  if (state.depth === 0 && isTranslatorCall(node)) state.violations.push(location(state.file, node))
  if (isHook(node, 'useState') && containsTranslator(nodeList(node.arguments)[0])) {
    state.violations.push(location(state.file, node))
  }
  for (const child of childNodes(node)) collectStaticTranslations(child, { ...state, depth: nextDepth })
}

function findMissingStaticTranslations(): string[] {
  const violations: string[] = []
  for (const [file, source] of productionSources()) {
    collectTranslationKeys(parseSource(file, source), { file, violations })
  }
  return violations
}

function collectTranslationKeys(node: AstNode, state: WalkState) {
  if (isTranslatorCall(node)) recordMissingTranslation(nodeList(node.arguments)[0], node, state)
  for (const child of childNodes(node)) collectTranslationKeys(child, state)
}

function findMissingProductionTranslations(): string[] {
  const violations: string[] = []
  for (const [file, source] of productionSources()) {
    collectProductionStrings(parseSource(file, source), { file, violations })
  }
  return violations
}

function collectProductionStrings(node: AstNode, state: WalkState) {
  const key = translationKey(node)
  if (key && chinesePattern.test(key) && !hasEnglishTranslation(key)) {
    state.violations.push(`${location(state.file, node)} ${JSON.stringify(key)}`)
  }
  for (const child of childNodes(node)) collectProductionStrings(child, state)
}

function recordMissingTranslation(node: AstNode | undefined, source: AstNode, state: WalkState) {
  const key = translationKey(node)
  if (key && chinesePattern.test(key) && !hasEnglishTranslation(key)) {
    state.violations.push(`${location(state.file, source)} ${JSON.stringify(key)}`)
  }
}

function parseSource(file: string, source: string): AstNode {
  const plugins: ParserPlugin[] = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript']
  return parse(source, { sourceType: 'module', plugins }) as unknown as AstNode
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string'
}

function nodeList(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.filter(isNode) : []
}

function childNodes(node: AstNode): AstNode[] {
  const children: AstNode[] = []
  for (const [key, value] of Object.entries(node)) {
    if (nonChildKeys.has(key)) continue
    if (Array.isArray(value)) children.push(...value.filter(isNode))
    else if (isNode(value)) children.push(value)
  }
  return children
}

function isNamedIdentifier(value: unknown, name: string): boolean {
  return isNode(value) && value.type === 'Identifier' && value.name === name
}

function isTranslatorCall(node: AstNode): boolean {
  return isHook(node, 't')
}

function isHook(node: AstNode, name: string): boolean {
  return node.type === 'CallExpression' && isNamedIdentifier(node.callee, name)
}

function containsTranslator(node: AstNode | undefined): boolean {
  if (!node) return false
  if (isTranslatorCall(node)) return true
  return childNodes(node).some((child) => containsTranslator(child))
}

function translationKey(node: AstNode | undefined): string {
  if (!node) return ''
  if (node.type === 'StringLiteral') return typeof node.value === 'string' ? node.value : ''
  if (node.type === 'TemplateLiteral') return templateKey(node)
  return ''
}

function templateKey(node: AstNode): string {
  if (nodeList(node.expressions).length > 0) return ''
  const quasi = nodeList(node.quasis)[0] as { value?: { cooked?: string | null; raw?: string } } | undefined
  return quasi?.value?.cooked ?? quasi?.value?.raw ?? ''
}

function location(file: string, node: AstNode): string {
  const loc = node.loc as { start?: { line?: number } } | undefined
  return `${file}:${loc?.start?.line ?? 0}`
}
