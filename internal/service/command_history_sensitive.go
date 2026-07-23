package service

import (
	"regexp"
	"strings"
)

// sensitiveCommandPatterns mirrors frontend command-history filtering so direct
// backend/API writes cannot persist common secret-bearing commands.
var sensitiveCommandPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(^|\s)(password|passwd|token|secret|--password|--passwd|-p)(=|\s|$)`),
	regexp.MustCompile(`(?i)(curl|wget).*\s(-H|--header)\s+['"]?authorization`),
	regexp.MustCompile(`(?i)export\s+\w*(KEY|TOKEN|SECRET|PASSWORD|PASSWD)\w*=`),
	regexp.MustCompile(`(?i)(^|\s)(mysql|psql|mongo|redis-cli)\b.*\s(-p|--password)(=|\S|$)`),
	regexp.MustCompile(`(?i)(^|\s)sshpass\s+-p\s+`),
	regexp.MustCompile(`(?i)(^|\s)(AWS_|GITHUB_|GH_|OPENAI_|ANTHROPIC_)[A-Z0-9_]*(=|\s)`),
	regexp.MustCompile(`(?i)Bearer\s+[A-Za-z0-9._~+/=-]+`),
}

func isSensitiveCommand(command string) bool {
	value := strings.TrimSpace(command)
	if value == "" {
		return false
	}
	for _, pattern := range sensitiveCommandPatterns {
		if pattern.MatchString(value) {
			return true
		}
	}
	return false
}
