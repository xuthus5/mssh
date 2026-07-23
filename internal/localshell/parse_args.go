package localshell

import "strings"

// ParseArgs splits a shell-args string with basic single/double quote support.
// It does not expand variables, globs, or escape sequences beyond quote grouping.
func ParseArgs(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var (
		args   []string
		cur    strings.Builder
		quote  rune
		escape bool
	)
	for _, r := range raw {
		args, quote, escape = consumeArgRune(args, &cur, quote, escape, r)
	}
	if escape {
		cur.WriteByte('\\')
	}
	return flushArg(args, &cur)
}

func consumeArgRune(args []string, cur *strings.Builder, quote rune, escape bool, r rune) ([]string, rune, bool) {
	if escape {
		cur.WriteRune(r)
		return args, quote, false
	}
	if quote != 0 {
		return consumeQuotedRune(args, cur, quote, r)
	}
	return consumeUnquotedRune(args, cur, r)
}

func consumeQuotedRune(args []string, cur *strings.Builder, quote rune, r rune) ([]string, rune, bool) {
	if r == quote {
		return args, 0, false
	}
	if r == '\\' && quote == '"' {
		return args, quote, true
	}
	cur.WriteRune(r)
	return args, quote, false
}

func consumeUnquotedRune(args []string, cur *strings.Builder, r rune) ([]string, rune, bool) {
	switch r {
	case '\\':
		return args, 0, true
	case '\'', '"':
		return args, r, false
	case ' ', '\t', '\n', '\r':
		return flushArg(args, cur), 0, false
	default:
		cur.WriteRune(r)
		return args, 0, false
	}
}

func flushArg(args []string, cur *strings.Builder) []string {
	if cur.Len() == 0 {
		return args
	}
	args = append(args, cur.String())
	cur.Reset()
	return args
}
