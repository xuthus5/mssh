package service

import "strings"

// sanitizeLogValue redacts common secret-bearing substrings from free-form log/audit text.
func sanitizeLogValue(value string) string {
	if value == "" {
		return value
	}
	lower := strings.ToLower(value)
	patterns := []string{"password=", "password:", "passphrase=", "authorization: bearer ", "api_key=", "secret=", "private_key"}
	for _, pattern := range patterns {
		if strings.Contains(lower, pattern) {
			return "[REDACTED]"
		}
	}
	return value
}
