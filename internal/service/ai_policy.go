package service

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
)

var (
	aiCredentialURLPattern = regexp.MustCompile(`(?i)([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^@\s/]+@`)
	aiEnvSecretPattern     = regexp.MustCompile(`(?i)\b[A-Z0-9_]*(?:PASSWORD|PASSWD|TOKEN|SECRET|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)`)
	aiSecretPatterns       = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(password|passwd|token|api[_-]?key|secret|authorization)\s*[:=]\s*[^\s]+`),
		regexp.MustCompile(`(?i)bearer\s+[a-z0-9._-]+`),
		regexp.MustCompile(`-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----`),
	}
	aiBlockedPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\brm\b[^\r\n;&|]*\s(?:--\s+)?/(?:\*+)?(?:\s|$)`),
		regexp.MustCompile(`(?i)\b(mkfs(?:\.[a-z0-9]+)?|fdisk|cfdisk|sfdisk|parted|sgdisk|wipefs|blkdiscard)\b`),
		regexp.MustCompile(`(?i)\bdd\s+.*\bof\s*=\s*/dev/`),
		regexp.MustCompile(`(?i)\b(shutdown|reboot|poweroff|halt)\b`),
		regexp.MustCompile(`(?i)\b(iptables|nft)\b.*\b(-F|flush|delete)\b`),
	}
	aiReadOnlyPatterns = []*regexp.Regexp{
		regexp.MustCompile(`^(pwd|whoami|id|uname(\s+-a)?|hostname|date|uptime|df(\s+[^|;&]+)?|free(\s+[^|;&]+)?|ps(\s+[^|;&]+)?|top(\s+[^|;&]+)?|env|printenv|systemctl\s+status(\s+[^|;&]+)?|journalctl\s+[^|;&]+|ls(\s+[^|;&]+)?|find\s+[^|;&]+|cat\s+[^|;&]+)$`),
	}
	aiAutoReadOnlyPatterns = []*regexp.Regexp{
		regexp.MustCompile(`^(pwd|whoami|id|uname(\s+-a)?|hostname|date|uptime|df(\s+[^|;&]+)?|free(\s+[^|;&]+)?)$`),
	}
	aiUnsafeReadOnlyPattern = regexp.MustCompile("[\r\n|;&<>`]|\\$\\(")
	aiMutatingReadPatterns  = []*regexp.Regexp{
		regexp.MustCompile(`(?i)^find\b.*\s-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)\b`),
		regexp.MustCompile(`(?i)^journalctl\b.*\s--(vacuum-(size|time|files)|rotate|flush|sync|relinquish-var|setup-keys|update-catalog)\b`),
	}
)

// clampAITextBytes keeps the trailing UTF-8 text within maxBytes, dropping whole runes from the start.
func clampAITextBytes(value string, maxBytes int) string {
	if maxBytes <= 0 || len(value) <= maxBytes {
		return value
	}
	// Fast path when all ASCII / already byte-indexed safely.
	if maxBytes >= len(value) {
		return value
	}
	start := len(value) - maxBytes
	for start < len(value) && !utf8.RuneStart(value[start]) {
		start++
	}
	return strings.TrimSpace(value[start:])
}

func redactAIText(value string, custom []string) string {
	redacted := aiCredentialURLPattern.ReplaceAllString(value, `${1}[REDACTED]@`)
	redacted = aiEnvSecretPattern.ReplaceAllStringFunc(redacted, redactSecretAssignment)
	for _, pattern := range aiSecretPatterns {
		redacted = pattern.ReplaceAllStringFunc(redacted, redactSecretAssignment)
	}
	for _, expression := range custom {
		if err := validateUserRegexp(expression); err != nil {
			continue
		}
		pattern := regexp.MustCompile(expression)
		redacted = pattern.ReplaceAllString(redacted, "[REDACTED]")
	}
	return redacted
}

func redactSecretAssignment(match string) string {
	separator := strings.IndexAny(match, ":=")
	if separator < 0 {
		return "[REDACTED]"
	}
	return match[:separator+1] + "[REDACTED]"
}

func classifyAICommand(command string, security model.AISecuritySettings) model.AICommandProposal {
	command = strings.TrimSpace(command)
	proposal := model.AICommandProposal{Command: command, RequiresConfirmation: true}
	if command == "" {
		return blockedAICommand(proposal, model.AICommandRiskBlocked, "命令不能为空")
	}
	if matchedBuiltinPattern(command, aiBlockedPatterns) {
		return blockedAICommand(proposal, model.AICommandRiskBlocked, "命令触及不可禁用的高风险规则")
	}
	if matchedUserPattern(command, security.DenyPatterns) {
		return blockedAICommand(proposal, model.AICommandRiskHigh, "命令命中自定义禁止规则")
	}
	if matchedUserAllowPattern(command, security.AllowPatterns) || isBuiltinAutoReadOnlyCommand(command) {
		return autoReadOnlyAICommand(proposal, security.AutoExecuteReadOnly)
	}
	if isBuiltinReadOnlyCommand(command) {
		return autoReadOnlyAICommand(proposal, false)
	}
	proposal.Risk = model.AICommandRiskModify
	return proposal
}

func isBuiltinAutoReadOnlyCommand(command string) bool {
	if aiUnsafeReadOnlyPattern.MatchString(command) || matchedBuiltinPattern(command, aiMutatingReadPatterns) {
		return false
	}
	return matchedBuiltinPattern(command, aiAutoReadOnlyPatterns)
}

func isBuiltinReadOnlyCommand(command string) bool {
	if aiUnsafeReadOnlyPattern.MatchString(command) || matchedBuiltinPattern(command, aiMutatingReadPatterns) {
		return false
	}
	return matchedBuiltinPattern(command, aiReadOnlyPatterns)
}

func blockedAICommand(proposal model.AICommandProposal, risk model.AICommandRisk, reason string) model.AICommandProposal {
	proposal.Risk = risk
	proposal.Blocked = true
	proposal.BlockedReason = reason
	return proposal
}

func autoReadOnlyAICommand(proposal model.AICommandProposal, autoExecute bool) model.AICommandProposal {
	proposal.Risk = model.AICommandRiskReadOnly
	proposal.CanAutoExecute = autoExecute
	proposal.RequiresConfirmation = !autoExecute
	return proposal
}

func matchedBuiltinPattern(command string, patterns []*regexp.Regexp) bool {
	for _, pattern := range patterns {
		if pattern.MatchString(command) {
			return true
		}
	}
	return false
}

func matchedUserPattern(command string, expressions []string) bool {
	for _, expression := range expressions {
		if err := validateUserRegexp(expression); err != nil {
			continue
		}
		if regexp.MustCompile(expression).MatchString(command) {
			return true
		}
	}
	return false
}

func matchedUserAllowPattern(command string, expressions []string) bool {
	for _, expression := range expressions {
		if err := validateUserRegexp(expression); err != nil {
			continue
		}
		match := regexp.MustCompile(expression).FindStringIndex(command)
		if len(match) == 2 && match[0] == 0 && match[1] == len(command) {
			return true
		}
	}
	return false
}

func validateAISettings(settings model.AISettings) error {
	if settings.DefaultProviderID != nil && *settings.DefaultProviderID <= 0 {
		return fmt.Errorf("invalid default provider id")
	}
	if settings.FallbackProviderID != nil && *settings.FallbackProviderID <= 0 {
		return fmt.Errorf("invalid fallback provider id")
	}
	if err := validateAIInteractionSettings(settings.Interaction); err != nil {
		return err
	}
	if err := validateAISearchSettings(settings.Search); err != nil {
		return err
	}
	return validateAISecuritySettings(settings.Security)
}

func validateAIInteractionSettings(settings model.AIInteractionSettings) error {
	if err := validateAIAgentSettings(settings.Agent); err != nil {
		return err
	}
	if settings.PanelWidth < 300 || settings.PanelWidth > 720 {
		return fmt.Errorf("AI panel width must be between 300 and 720")
	}
	if settings.ContextLines < 0 || settings.ContextLines > 500 {
		return fmt.Errorf("AI context lines must be between 0 and 500")
	}
	if settings.HistoryRetentionDays < 1 || settings.HistoryRetentionDays > 3650 {
		return fmt.Errorf("AI history retention must be between 1 and 3650 days")
	}
	if settings.MaxConversations < 1 || settings.MaxConversations > 1000 {
		return fmt.Errorf("AI max conversations must be between 1 and 1000")
	}
	return nil
}

func validateAIAgentSettings(settings model.AIAgentSettings) error {
	switch settings.DefaultEngine {
	case model.AIAgentEngineNative:
	case model.AIAgentEngineLocalCLI:
		switch settings.DefaultCLI {
		case model.AIAgentCLICodex, model.AIAgentCLIClaude, model.AIAgentCLIOpenCode:
		default:
			return fmt.Errorf("unsupported default AI agent CLI %s", settings.DefaultCLI)
		}
	default:
		return fmt.Errorf("unsupported default AI agent engine %s", settings.DefaultEngine)
	}
	return nil
}

func validateAISearchSettings(settings model.AISearchSettings) error {
	switch settings.Mode {
	case model.AISearchDisabled, model.AISearchAuto, model.AISearchNative, model.AISearchIndependent:
	default:
		return fmt.Errorf("unsupported AI search mode %s", settings.Mode)
	}
	switch settings.Provider {
	case model.AISearchProviderBrave, model.AISearchProviderTavily, model.AISearchProviderSerper:
	default:
		return fmt.Errorf("unsupported AI search provider %s", settings.Provider)
	}
	if settings.TimeoutSeconds < 1 || settings.TimeoutSeconds > 60 {
		return fmt.Errorf("AI search timeout must be between 1 and 60 seconds")
	}
	if settings.MaxResults < 1 || settings.MaxResults > 20 {
		return fmt.Errorf("AI search result limit must be between 1 and 20")
	}
	return nil
}

func validateAISecuritySettings(settings model.AISecuritySettings) error {
	if settings.CommandTimeoutSeconds < 1 || settings.CommandTimeoutSeconds > 300 {
		return fmt.Errorf("AI command timeout must be between 1 and 300 seconds")
	}
	if settings.MaxOutputBytes < 1024 || settings.MaxOutputBytes > 4*1024*1024 {
		return fmt.Errorf("AI max output must be between 1024 and 4194304 bytes")
	}
	if settings.MaxPlanSteps < 1 || settings.MaxPlanSteps > 20 {
		return fmt.Errorf("AI max plan steps must be between 1 and 20")
	}
	return nil
}

func defaultAISettings() model.AISettings {
	return model.AISettings{
		Interaction: model.AIInteractionSettings{PanelWidth: 420, ContextLines: 80, IncludeSessionMetadata: true, IncludeSystemSummary: true, StreamResponses: true, AutoScroll: true, RenderMarkdown: true, HistoryRetentionDays: 30, MaxConversations: 100, Agent: model.AIAgentSettings{DefaultEngine: model.AIAgentEngineNative, DefaultCLI: model.AIAgentCLICodex}},
		Search:      model.AISearchSettings{Mode: model.AISearchAuto, Provider: model.AISearchProviderBrave, TimeoutSeconds: 10, MaxResults: 5, RequireCitations: true},
		Security:    model.AISecuritySettings{CommandTimeoutSeconds: 60, MaxOutputBytes: 64 * 1024, MaxPlanSteps: 5},
	}
}
