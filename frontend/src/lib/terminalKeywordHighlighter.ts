const ESC = 0x1b

export interface KeywordRuleInput {
  keyword: string
  color: string
}

interface CompiledRule {
  bytes: number[]
  sgr: number[]
}

function lowerByte(byte: number): number {
  return byte >= 65 && byte <= 90 ? byte + 32 : byte
}

function isWordByte(byte: number): boolean {
  return (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte === 95
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace(/^#/, '')
  const expanded = value.length === 3
    ? value.split('').map((part) => `${part}${part}`).join('')
    : value
  const parsed = Number.parseInt(expanded, 16)
  return Number.isFinite(parsed)
    ? [clampByte((parsed >> 16) & 0xff), clampByte((parsed >> 8) & 0xff), clampByte(parsed & 0xff)]
    : [0, 0, 0]
}

function colorSgr(hex: string): number[] {
  const [r, g, b] = hexToRgb(hex)
  const digits = [r, g, b].map((component) => Array.from(String(component), (char) => char.charCodeAt(0)))
  return [ESC, 91, 51, 56, 59, 50, 59]
    .concat(digits[0])
    .concat(59)
    .concat(digits[1])
    .concat(59)
    .concat(digits[2])
    .concat(109)
}

const SGR_RESET: number[] = [ESC, 91, 48, 109]

interface CompiledResult {
  bytes: number[]
  sgr: number[]
}

function compileRule(rule: KeywordRuleInput): CompiledRule | null {
  const keyword = rule.keyword.trim()
  if (!keyword) return null
  return {
    bytes: Array.from(Uint8Array.from(keyword, (char) => char.charCodeAt(0))),
    sgr: colorSgr(rule.color),
  }
}

/** Exclusive index one past the ANSI escape sequence starting at `start` (which must be ESC). */
function escapeEnd(bytes: number[], start: number): number {
  const next = start + 1
  const second = bytes[next]
  const scanUntil = (predicate: (byte: number, index: number) => boolean): number => {
    let index = next + 1
    while (index < bytes.length) {
      if (predicate(bytes[index], index)) return index + 1
      index += 1
    }
    return bytes.length
  }
  if (second === 0x5d) {
    return scanUntil((byte, index) => byte === 8 || byte === ESC)
  }
  if (second === 0x5b) {
    return scanUntil((byte) => byte >= 0x40 && byte <= 0x7e)
  }
  return Math.min(next + 1, bytes.length)
}

/** If an escape starts strictly before `bound` and ends after it, return its start index. */
export function firstEscapeCrossingBoundary(bytes: number[], bound: number): number {
  let index = 0
  while (index < bytes.length) {
    if (bytes[index] !== ESC) {
      index += 1
      continue
    }
    if (index >= bound) return -1
    const end = escapeEnd(bytes, index)
    if (end > bound) return index
    index = end
  }
  return -1
}

function wordBefore(bytes: number[], index: number): boolean {
  return index > 0 && isWordByte(bytes[index - 1])
}

function wordAfter(bytes: number[], index: number, length: number): boolean {
  const nextIndex = index + length
  return nextIndex < bytes.length && isWordByte(bytes[nextIndex])
}

function lowerByteMatches(actual: number, expected: number): boolean {
  return actual === expected || lowerByte(actual) === lowerByte(expected)
}

/** Annotate `bytes` in the range `[0,end]`. Matching respects `caseInsensitive`, only on whole words. */
class Annotator {
  private readonly output: number[] = []
  private index = 0
  private readonly bytes: number[]
  private readonly rules: CompiledRule[]
  private readonly end: number
  private readonly caseInsensitive: boolean

  constructor(options: { bytes: number[]; rules: CompiledRule[]; end: number; caseInsensitive: boolean }) {
    this.bytes = options.bytes
    this.rules = options.rules
    this.end = options.end
    this.caseInsensitive = options.caseInsensitive
  }

  private matchesRule(index: number, rule: CompiledRule): boolean {
    if (index + rule.bytes.length > this.end) return false
    if (wordBefore(this.bytes, index)) return false
    if (wordAfter(this.bytes, index, rule.bytes.length)) return false
    for (let i = 0; i < rule.bytes.length; i++) {
      const actual = this.bytes[index + i]
      const expected = rule.bytes[i]
      if (actual === expected) continue
      if (!this.caseInsensitive) return false
      if (!lowerByteMatches(actual, expected)) return false
    }
    return true
  }

  /** Emit the annotated bytes for the configured window. */
  static annotate(options: { bytes: number[]; rules: CompiledRule[]; end: number; caseInsensitive: boolean }): number[] {
    const annotator = new Annotator(options)
    while (annotator.index < annotator.end) {
      if (annotator.bytes[annotator.index] === ESC) {
        const { limit, advance } = annotator.escapeBounds()
        for (let i = annotator.index; i < limit; i++) annotator.output.push(annotator.bytes[i])
        annotator.index = advance
        continue
      }
      const rule = annotator.rules.find((candidate) => annotator.matchesRule(annotator.index, candidate))
      if (!rule) {
        annotator.output.push(annotator.bytes[annotator.index])
        annotator.index += 1
        continue
      }
      annotator.injectRule(rule)
    }
    return annotator.output
  }

  private escapeBounds(): { limit: number; advance: number } {
    const next = this.bytes[this.index + 1]
    let limit = this.end
    let advance = this.end
    if (next === 0x5d) {
      let current = this.index + 2
      while (current < this.bytes.length) {
        if (this.bytes[current] === 8 || this.bytes[current] === ESC) {
          advance = current + 1
          break
        }
        current += 1
      }
      limit = advance
    } else if (next === 0x5b) {
      let current = this.index + 2
      while (current < this.bytes.length && (this.bytes[current] < 0x40 || this.bytes[current] > 0x7e)) current += 1
      advance = current < this.bytes.length ? current + 1 : this.bytes.length
      limit = advance
    } else {
      advance = this.index + 1
      limit = advance
    }
    return { limit, advance }
  }

  private injectRule(rule: CompiledRule): void {
    // Emit the source bytes actually matched (preserves the original case) rather
    // than the rule keyword, so case-insensitive matches never rewrite the text.
    const end = this.index + rule.bytes.length
    for (const byte of rule.sgr) this.output.push(byte)
    for (let i = this.index; i < end; i++) this.output.push(this.bytes[i])
    for (const byte of SGR_RESET) this.output.push(byte)
    this.index = end
  }
}

/**
 * Streaming highlighter for raw terminal byte output.
 * - Matches keywords case-insensitively, only on whole words.
 * - Never matches inside or splits ANSI escape sequences.
 * - Holds a small lookahead so keywords split across output chunks are still colored.
 */
export class TerminalKeywordHighlighter {
  private rules: CompiledRule[] = []
  private maxLength = 1
  private window: number[] = []
  private caseInsensitive = true

  constructor(rules: KeywordRuleInput[], caseInsensitive = true) {
    this.applyConfig(rules, caseInsensitive)
  }

  applyConfig(rules: KeywordRuleInput[], caseInsensitive = true): void {
    this.caseInsensitive = caseInsensitive
    this.rules = rules.map(compileRule).filter((rule): rule is CompiledRule => rule !== null)
      .sort((left, right) => right.bytes.length - left.bytes.length)
    this.maxLength = this.rules.reduce((max, rule) => Math.max(max, rule.bytes.length), 1)
  }

  /** Feed a decoded chunk; returns the bytes that are safe to write immediately. */
  push(bytes: number[] | Uint8Array, enabled: boolean): Uint8Array {
    if (!enabled) {
      this.window = []
      return bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
    }
    const incoming = bytes instanceof Uint8Array ? Array.from(bytes) : bytes
    for (const byte of incoming) this.window.push(byte)
    return this.emitSafe()
  }

  /** Emit any remaining buffered bytes (used on config change or disconnect). */
  flush(): Uint8Array {
    const output = Annotator.annotate({ bytes: this.window, rules: this.rules, end: this.window.length, caseInsensitive: this.caseInsensitive })
    this.window = []
    return Uint8Array.from(output)
  }

  private emitSafe(): Uint8Array {
    if (this.window.length === 0) return new Uint8Array(0)
    const keep = this.longestKeywordPrefixLength(this.window)
    const bound = this.window.length - keep
    if (bound <= 0) return new Uint8Array(0)
    const crossingEscape = firstEscapeCrossingBoundary(this.window, bound)
    const finalBound = crossingEscape === -1 ? bound : crossingEscape
    if (finalBound <= 0) return new Uint8Array(0)
    const output = Annotator.annotate({ bytes: this.window, rules: this.rules, end: finalBound, caseInsensitive: this.caseInsensitive })
    this.window = this.window.slice(finalBound)
    return Uint8Array.from(output)
  }

  /**
   * Length of the longest suffix of `window` that is a prefix of some rule keyword
   * (respecting `caseInsensitive`). Such a tail could still grow into a keyword, so it
   * is retained while everything before it can be safely emitted as-is.
   */
  private longestKeywordPrefixLength(window: number[]): number {
    const maxScan = Math.min(this.maxLength, window.length)
    for (let size = maxScan; size >= 2; size--) {
      for (const rule of this.rules) {
        if (rule.bytes.length < size) continue
        let matches = true
        for (let i = 0; i < size; i++) {
          const actual = window[window.length - size + i]
          const expected = rule.bytes[i]
          if (actual === expected) continue
          if (this.caseInsensitive && lowerByte(actual) === lowerByte(expected)) continue
          matches = false
          break
        }
        if (matches) return size
      }
    }
    return 0
  }
}
