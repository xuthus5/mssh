const escape = '\u001b'
const bell = '\u0007'
const stringTerminator = `${escape}\\`

export const terminalAgentOutputSamples = {
  codex: [
    `${escape}[?2004h${escape}[>4;0m${escape}[>7u${escape}[?1004h${escape}[6n${escape}]10;?${stringTerminator}${escape}]11;?${stringTerminator}${escape}[?u${escape}[c`,
    `${escape}[?2026h${escape}[3;1H${escape}[J${escape}[0m${escape}[KOpenAI Codex${escape}[?2026l`,
  ].join(''),
  claude: [
    `${escape}[?2004h${escape}[?1004h${escape}[?2031h${escape}[<u${escape}[>1u${escape}[>4;2m${escape}[?2026$p`,
    `${escape}[2GAccessing workspace${escape}[K\r\n${escape}]8;id=docs;https://code.claude.com/docs${bell}Security${escape}]8;;${bell}`,
  ].join(''),
  opencode: [
    `${escape}[?1049h${escape}[?1000h${escape}[?1002h${escape}[?1003h${escape}[?1004h${escape}[?1006h${escape}[?1015h${escape}[?2004h`,
    `${escape}[?2026h${escape}[1;1H${escape}[38;2;128;128;128mOpenCode${escape}[14t${escape}[?2026l`,
  ].join(''),
  grok: [
    `${escape}[?1049h${escape}[?1000h${escape}[?1002h${escape}[?1003h${escape}[?1004h${escape}[?1006h${escape}[?1015h`,
    `${escape}[?2026h${escape}[2;3H${escape}[1mGrok Build${escape}[22m${escape}[?2026l`,
  ].join(''),
} as const

export type TerminalAgentName = keyof typeof terminalAgentOutputSamples
