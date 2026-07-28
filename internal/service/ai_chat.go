package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const aiSystemPrompt = `你是 MSSH 中的运维助手。基于用户问题和终端上下文给出简洁、可验证的建议。需要建议命令时，每条命令单独使用以下格式：
COMMAND: <完整命令> | PURPOSE: <用途>
不要假设命令已执行，不要输出密钥、密码或令牌。`

func (s *AIService) Chat(request model.AIChatRequest) (model.AIChatResponse, error) {
	operationContext, finish, err := s.beginOperation()
	if err != nil {
		return model.AIChatResponse{}, err
	}
	defer finish()
	return s.chat(operationContext, request)
}

func (s *AIService) chat(ctx context.Context, request model.AIChatRequest) (model.AIChatResponse, error) {
	if strings.TrimSpace(request.Prompt) == "" || request.SessionID <= 0 || strings.TrimSpace(request.TerminalID) == "" {
		return model.AIChatResponse{}, errors.New("session, terminal and prompt are required")
	}
	if err := validateAIChatRequestSize(request); err != nil {
		return model.AIChatResponse{}, err
	}
	if err := s.validateAITarget(request.ConversationID, request.SessionID, request.TerminalID); err != nil {
		return model.AIChatResponse{}, err
	}
	settings, err := store.LoadAISettings(s.db, defaultAISettings())
	if err != nil {
		return model.AIChatResponse{}, err
	}
	prompt := redactAIText(request.Prompt, settings.Security.RedactionPatterns)
	terminalContext := redactAIText(request.TerminalContext, settings.Security.RedactionPatterns)
	terminalContext = clampAITextBytes(terminalContext, settings.Security.MaxOutputBytes)
	terminalContext = s.appendAIContext(request, settings, terminalContext)
	// Re-clamp after metadata/system summary may have expanded context.
	terminalContext = clampAITextBytes(terminalContext, settings.Security.MaxOutputBytes)
	citations, searchContext, err := s.chatSearchContext(ctx, request, settings, prompt)
	if err != nil {
		return model.AIChatResponse{}, err
	}
	systemPrompt, err := prepareAICitationPolicy(request, settings, citations)
	if err != nil {
		s.auditAIChat(request.SessionID, "failed")
		return model.AIChatResponse{}, err
	}
	nativeSearch := request.UseSearch && settings.Search.Enabled && settings.Search.Mode == model.AISearchNative
	requiredCitationCount := 0
	if requiresAICitations(request, settings) {
		requiredCitationCount = len(citations)
	}
	answer, providerID, err := s.chatWithFallbackContext(ctx, settings, aiChatInput{System: systemPrompt, Prompt: prompt, Context: terminalContext + searchContext, NativeSearch: nativeSearch, RequiredCitationCount: requiredCitationCount})
	if err != nil {
		s.auditAIChat(request.SessionID, "failed")
		return model.AIChatResponse{}, err
	}
	conversationID, err := s.saveAIChat(request, settings, prompt, answer)
	if err != nil {
		return model.AIChatResponse{}, err
	}
	commands := extractAICommands(answer, settings.Security, settings.Security.MaxPlanSteps)
	s.auditAIChat(request.SessionID, "success")
	return model.AIChatResponse{ConversationID: conversationID, Answer: answer, Commands: commands, Citations: citations, ProviderID: providerID}, nil
}

func (s *AIService) appendAIContext(request model.AIChatRequest, settings model.AISettings, contextText string) string {
	var builder strings.Builder
	if settings.Interaction.IncludeSessionMetadata {
		if session, err := store.GetSession(s.db, request.SessionID); err == nil {
			fmt.Fprintf(&builder, "会话信息: %s @ %s:%d 用户 %s\n", session.Name, session.Host, session.Port, session.Username)
		}
	}
	if settings.Interaction.IncludeSystemSummary && s.terminals != nil {
		if info, err := s.terminals.SystemInfo(request.TerminalID); err == nil {
			fmt.Fprintf(&builder, "系统摘要: %s, kernel %s, CPU %.1f%%, load %.2f, memory %d/%d bytes\n", info.OSName, info.KernelVersion, info.CPUPercent, info.Load1, info.MemoryUsed, info.MemoryTotal)
		}
	}
	if builder.Len() == 0 {
		return contextText
	}
	return builder.String() + "终端上下文:\n" + contextText
}

func (s *AIService) chatSearchContext(ctx context.Context, request model.AIChatRequest, settings model.AISettings, prompt string) ([]model.AICitation, string, error) {
	if !request.UseSearch || !settings.Search.Enabled || settings.Search.Mode == model.AISearchDisabled || settings.Search.Mode == model.AISearchNative {
		return []model.AICitation{}, "", nil
	}
	secret, exists, err := s.secrets.get(searchSecretAccount(settings.Search.Provider))
	if err != nil {
		return nil, "", err
	}
	if !exists || strings.TrimSpace(secret) == "" {
		return nil, "", fmt.Errorf("AI search credential is required")
	}
	citations, err := searchAI(ctx, s.httpClient, settings.Search, secret, prompt)
	if err != nil {
		return nil, "", err
	}
	citations = filterValidAICitations(citations)
	var builder strings.Builder
	if len(citations) > 0 {
		builder.WriteString("\n\n网络搜索结果:\n")
	}
	for index, citation := range citations {
		fmt.Fprintf(&builder, "[%d] %s\n%s\n%s\n", index+1, citation.Title, citation.URL, citation.Snippet)
	}
	return citations, builder.String(), nil
}

func (s *AIService) chatWithFallback(settings model.AISettings, input aiChatInput) (string, int64, error) {
	return s.chatWithFallbackContext(context.Background(), settings, input)
}

func (s *AIService) chatWithFallbackContext(ctx context.Context, settings model.AISettings, input aiChatInput) (string, int64, error) {
	ids := providerOrder(settings)
	if len(ids) == 0 {
		return "", 0, errors.New("no AI provider is configured")
	}
	var lastErr error
	for index, id := range ids {
		profile, secret, err := s.loadProvider(id)
		if err == nil {
			requestContext, cancel := context.WithTimeout(ctx, 45*time.Second)
			answer, chatErr := chatWithProvider(requestContext, s.httpClient, *profile, secret, input)
			cancel()
			if chatErr == nil {
				chatErr = validateAIProviderAnswer(input, answer)
			}
			if chatErr == nil {
				return answer, id, nil
			}
			err = chatErr
		}
		lastErr = err
		if ctx.Err() != nil {
			return "", 0, fmt.Errorf("AI request canceled: %w", ctx.Err())
		}
		if index == len(ids)-1 || !canFallbackAI(err) {
			break
		}
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "ai_provider_fallback", TargetType: "ai_provider", TargetID: fmt.Sprint(id), Summary: "AI 提供商故障切换", Outcome: "success"})
	}
	return "", 0, fmt.Errorf("AI request failed: %w", lastErr)
}

func providerOrder(settings model.AISettings) []int64 {
	result := make([]int64, 0, 2)
	if settings.DefaultProviderID != nil {
		result = append(result, *settings.DefaultProviderID)
	}
	if settings.FallbackProviderID != nil && (settings.DefaultProviderID == nil || *settings.FallbackProviderID != *settings.DefaultProviderID) {
		result = append(result, *settings.FallbackProviderID)
	}
	return result
}

func canFallbackAI(err error) bool {
	if errors.Is(err, errAICitationPolicy) || errors.Is(err, errAIProviderProtocol) || errors.Is(err, errAIProviderUnavailable) {
		return true
	}
	var providerErr *aiProviderError
	if !errors.As(err, &providerErr) {
		return false
	}
	return providerErr.status == 0 || providerErr.status == 429 || providerErr.status >= 500
}

func (s *AIService) saveAIChat(request model.AIChatRequest, settings model.AISettings, prompt, answer string) (int64, error) {
	title := []rune(prompt)
	if len(title) > 40 {
		title = title[:40]
	}
	return store.SaveAIConversationExchange(s.db, store.AIConversationExchange{
		ConversationID:   request.ConversationID,
		SessionID:        request.SessionID,
		Title:            string(title),
		UserContent:      prompt,
		AssistantContent: redactAIText(answer, settings.Security.RedactionPatterns),
		RetentionDays:    settings.Interaction.HistoryRetentionDays,
		MaxConversations: settings.Interaction.MaxConversations,
	})
}

func (s *AIService) auditAIChat(sessionID int64, outcome string) {
	recordAudit(s.db, s.logger, model.AuditEvent{Action: "ai_chat", TargetType: "session", TargetID: fmt.Sprint(sessionID), SessionID: &sessionID, Summary: "AI 运维对话", Outcome: outcome})
}

func extractAICommands(answer string, security model.AISecuritySettings, limit int) []model.AICommandProposal {
	commands := make([]model.AICommandProposal, 0)
	for _, line := range strings.Split(answer, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "COMMAND:") {
			continue
		}
		parts := strings.SplitN(strings.TrimSpace(strings.TrimPrefix(line, "COMMAND:")), "| PURPOSE:", 2)
		proposal := classifyAICommand(strings.TrimSpace(parts[0]), security)
		if len(parts) == 2 {
			proposal.Purpose = strings.TrimSpace(parts[1])
		}
		commands = append(commands, proposal)
		if len(commands) >= limit {
			break
		}
	}
	return commands
}
