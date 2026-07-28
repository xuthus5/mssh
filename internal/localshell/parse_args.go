package localshell

import (
	"runtime"
	"strings"
)

// ParseArgs splits configured shell arguments without expanding variables or globs.
// Windows follows CreateProcess argv rules; other platforms support basic single/double quotes.
func ParseArgs(raw string) []string {
	return parseArgsForOS(raw, runtime.GOOS)
}

func parseArgsForOS(raw, goos string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if goos == "windows" {
		return parseWindowsArgs(raw)
	}
	return parsePOSIXArgs(raw)
}

func parsePOSIXArgs(raw string) []string {
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

func parseWindowsArgs(commandLine string) []string {
	var args []string
	for len(commandLine) > 0 {
		if commandLine[0] == ' ' || commandLine[0] == '\t' {
			commandLine = commandLine[1:]
			continue
		}
		argument, remaining := readWindowsArg(commandLine)
		args = append(args, string(argument))
		commandLine = remaining
	}
	return args
}

func readWindowsArg(commandLine string) ([]byte, string) {
	var argument []byte
	inQuote := false
	backslashes := 0
	for len(commandLine) > 0 {
		character := commandLine[0]
		if (character == ' ' || character == '\t') && !inQuote {
			return appendBackslashes(argument, backslashes), commandLine[1:]
		}
		if character == '\\' {
			backslashes++
			commandLine = commandLine[1:]
			continue
		}
		if character == '"' {
			argument, commandLine, inQuote = consumeWindowsQuote(argument, commandLine, backslashes, inQuote)
			backslashes = 0
			continue
		}
		argument = appendBackslashes(argument, backslashes)
		argument = append(argument, character)
		backslashes = 0
		commandLine = commandLine[1:]
	}
	return appendBackslashes(argument, backslashes), ""
}

func consumeWindowsQuote(argument []byte, commandLine string, backslashes int, inQuote bool) ([]byte, string, bool) {
	argument = appendBackslashes(argument, backslashes/2)
	if backslashes%2 != 0 {
		return append(argument, '"'), commandLine[1:], inQuote
	}
	if inQuote && len(commandLine) > 1 && commandLine[1] == '"' {
		return append(argument, '"'), commandLine[2:], inQuote
	}
	return argument, commandLine[1:], !inQuote
}

func appendBackslashes(buffer []byte, count int) []byte {
	for ; count > 0; count-- {
		buffer = append(buffer, '\\')
	}
	return buffer
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
