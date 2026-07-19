package service

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

var (
	aiSecretPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(password|passwd|token|api[_-]?key|secret|authorization)\s*[:=]\s*[^\s]+`),
		regexp.MustCompile(`(?i)bearer\s+[a-z0-9._-]+`),
		regexp.MustCompile(`-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----`),
	}
	aiBlockedPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\brm\s+(-[a-z]*f[a-z]*\s+)?/($|\s)`),
		regexp.MustCompile(`(?i)\b(mkfs|fdisk|parted)\b`),
		regexp.MustCompile(`(?i)\bdd\s+.*\bof=/dev/`),
		regexp.MustCompile(`(?i)\b(shutdown|reboot|poweroff|halt)\b`),
		regexp.MustCompile(`(?i)\b(iptables|nft)\b.*\b(-F|flush|delete)\b`),
	}
	aiReadOnlyPatterns = []*regexp.Regexp{
		regexp.MustCompile(`^(pwd|whoami|id|uname(\s+-a)?|hostname|date|uptime|df(\s+[^|;&]+)?|free(\s+[^|;&]+)?|ps(\s+[^|;&]+)?|top(\s+[^|;&]+)?|env|printenv|systemctl\s+status(\s+[^|;&]+)?|journalctl\s+[^|;&]+|ls(\s+[^|;&]+)?|find\s+[^|;&]+|cat\s+[^|;&]+)$`),
	}
)

func redactAIText(value string, custom []string) string {
	redacted := value
	for _, pattern := range aiSecretPatterns {
		redacted = pattern.ReplaceAllStringFunc(redacted, func(match string) string {
			separator := strings.IndexAny(match, ":=")
			if separator < 0 {
				return "[REDACTED]"
			}
			return match[:separator+1] + "[REDACTED]"
		})
	}
	for _, expression := range custom {
		pattern, err := regexp.Compile(expression)
		if err == nil {
			redacted = pattern.ReplaceAllString(redacted, "[REDACTED]")
		}
	}
	return redacted
}

func classifyAICommand(command string, security model.AISecuritySettings) model.AICommandProposal {
	command = strings.TrimSpace(command)
	proposal := model.AICommandProposal{Command: command, RequiresConfirmation: true}
	if command == "" {
		proposal.Risk = model.AICommandRiskBlocked
		proposal.Blocked = true
		proposal.BlockedReason = "命令不能为空"
		return proposal
	}
	for _, pattern := range aiBlockedPatterns {
		if pattern.MatchString(command) {
			proposal.Risk = model.AICommandRiskBlocked
			proposal.Blocked = true
			proposal.BlockedReason = "命令触及不可禁用的高风险规则"
			return proposal
		}
	}
	for _, expression := range security.DenyPatterns {
		pattern, err := regexp.Compile(expression)
		if err == nil && pattern.MatchString(command) {
			proposal.Risk = model.AICommandRiskHigh
			proposal.Blocked = true
			proposal.BlockedReason = "命令命中自定义禁止规则"
			return proposal
		}
	}
	for _, expression := range security.AllowPatterns {
		pattern, err := regexp.Compile(expression)
		if err == nil && pattern.MatchString(command) {
			proposal.Risk = model.AICommandRiskReadOnly
			proposal.CanAutoExecute = security.AutoExecuteReadOnly
			proposal.RequiresConfirmation = !proposal.CanAutoExecute
			return proposal
		}
	}
	for _, pattern := range aiReadOnlyPatterns {
		if pattern.MatchString(command) {
			proposal.Risk = model.AICommandRiskReadOnly
			proposal.CanAutoExecute = security.AutoExecuteReadOnly
			proposal.RequiresConfirmation = !proposal.CanAutoExecute
			return proposal
		}
	}
	proposal.Risk = model.AICommandRiskModify
	return proposal
}

func validateAISettings(settings model.AISettings) error {
	if err := validateAIInteractionSettings(settings.Interaction); err != nil {
		return err
	}
	if err := validateAISearchSettings(settings.Search); err != nil {
		return err
	}
	return validateAISecuritySettings(settings.Security)
}

func validateAIInteractionSettings(settings model.AIInteractionSettings) error {
	if settings.PanelWidth < 300 || settings.PanelWidth > 900 {
		return fmt.Errorf("AI panel width must be between 300 and 900")
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

func validateAISearchSettings(settings model.AISearchSettings) error {
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
		Interaction: model.AIInteractionSettings{PanelWidth: 420, ContextLines: 80, IncludeSessionMetadata: true, IncludeSystemSummary: true, StreamResponses: true, AutoScroll: true, RenderMarkdown: true, HistoryRetentionDays: 30, MaxConversations: 100},
		Search:      model.AISearchSettings{Mode: model.AISearchAuto, Provider: model.AISearchProviderBrave, TimeoutSeconds: 10, MaxResults: 5, RequireCitations: true},
		Security:    model.AISecuritySettings{CommandTimeoutSeconds: 60, MaxOutputBytes: 64 * 1024, MaxPlanSteps: 5},
	}
}
