package service

import "strings"

func mergeTerminalDirectoryIntegration(existing string, shell shellIntegration) (string, bool) {
	block := terminalDirectoryIntegrationBlock(shell)
	start := strings.Index(existing, terminalDirectoryIntegrationStartMarker)
	if start >= 0 {
		end := strings.Index(existing[start:], terminalDirectoryIntegrationEndMarker)
		if end >= 0 {
			end += start + len(terminalDirectoryIntegrationEndMarker)
			merged := existing[:start] + block + existing[end:]
			return merged, merged != existing
		}
	}
	trimmed := strings.TrimRight(existing, "\r\n")
	if trimmed == "" {
		return block + "\n", true
	}
	return trimmed + "\n\n" + block + "\n", true
}

func terminalDirectoryIntegrationBlock(shell shellIntegration) string {
	switch shell {
	case shellIntegrationZsh:
		return zshTerminalDirectoryIntegrationBlock()
	default:
		return bashTerminalDirectoryIntegrationBlock()
	}
}

func bashTerminalDirectoryIntegrationBlock() string {
	return strings.Join([]string{
		terminalDirectoryIntegrationStartMarker,
		"case \"$-\" in",
		"  *i*) ;;",
		"  *) return ;;",
		"esac",
		"",
		"__mssh_escape_osc7_path_bash() {",
		"  local value=${PWD//%/%25}",
		"  value=${value// /%20}",
		"  value=${value//#/%23}",
		"  printf '%s' \"$value\"",
		"}",
		"",
		"__mssh_emit_osc7_bash() {",
		"  local path",
		"  path=$(__mssh_escape_osc7_path_bash)",
		"  printf '\\033]7;file://%s%s\\007' \"${HOSTNAME:-localhost}\" \"$path\"",
		"}",
		"",
		"if [ -n \"${PROMPT_COMMAND:-}\" ]; then",
		"  case \";$PROMPT_COMMAND;\" in",
		"    *\";__mssh_emit_osc7_bash;\"*) ;;",
		"    *) PROMPT_COMMAND=\"__mssh_emit_osc7_bash${PROMPT_COMMAND:+;$PROMPT_COMMAND}\" ;;",
		"  esac",
		"else",
		"  PROMPT_COMMAND=\"__mssh_emit_osc7_bash\"",
		"fi",
		terminalDirectoryIntegrationEndMarker,
	}, "\n")
}

func zshTerminalDirectoryIntegrationBlock() string {
	return strings.Join([]string{
		terminalDirectoryIntegrationStartMarker,
		"case \"$-\" in",
		"  *i*) ;;",
		"  *) return ;;",
		"esac",
		"",
		"autoload -Uz add-zsh-hook 2>/dev/null || return 0",
		"",
		"__mssh_escape_osc7_path_zsh() {",
		"  local value=${PWD//%/%25}",
		"  value=${value// /%20}",
		"  value=${value//#/%23}",
		"  printf '%s' \"$value\"",
		"}",
		"",
		"__mssh_emit_osc7_zsh() {",
		"  local path",
		"  path=$(__mssh_escape_osc7_path_zsh)",
		"  printf '\\033]7;file://%s%s\\007' \"${HOSTNAME:-localhost}\" \"$path\"",
		"}",
		"",
		"typeset -ga precmd_functions",
		"if (( ${precmd_functions[(I)__mssh_emit_osc7_zsh]} == 0 )); then",
		"  precmd_functions=(__mssh_emit_osc7_zsh ${precmd_functions[@]})",
		"fi",
		terminalDirectoryIntegrationEndMarker,
	}, "\n")
}
