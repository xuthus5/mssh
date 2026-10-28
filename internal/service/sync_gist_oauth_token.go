package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func (s *SyncService) requestGistOAuthToken(ctx context.Context, deviceCode string) (gistTokenResponse, error) {
	endpoint := strings.TrimRight(s.gistOAuthWebBase, "/") + "/login/oauth/access_token"
	values := url.Values{
		"client_id":   {s.gistOAuthClientID},
		"device_code": {deviceCode},
		"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
	}
	var response gistTokenResponse
	if err := s.postGitHubOAuthForm(ctx, endpoint, values, &response); err != nil {
		return gistTokenResponse{}, err
	}
	return response, nil
}

func (s *SyncService) postGitHubOAuthForm(ctx context.Context, endpoint string, values url.Values, output any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return fmt.Errorf("create GitHub OAuth request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := sameOriginHTTPClient(s.syncHTTPClient(), request.URL).Do(request)
	if err != nil {
		return fmt.Errorf("GitHub OAuth request: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub OAuth returned %s", response.Status)
	}
	if err := decodeBoundedJSON(response.Body, gistOAuthMaxBody, output); err != nil {
		return fmt.Errorf("decode GitHub OAuth response: %w", err)
	}
	return nil
}

func (s *SyncService) handleGistOAuthTokenResponse(ctx context.Context, flowID string, response gistTokenResponse) (model.GistOAuthResult, error) {
	if response.Error != "" {
		return s.handleGistOAuthError(flowID, response)
	}
	if strings.TrimSpace(response.AccessToken) == "" {
		s.finishGistOAuthPoll(flowID, 0, false)
		return model.GistOAuthResult{}, errors.New("GitHub OAuth returned an empty access token")
	}
	account, err := s.fetchGistOAuthAccount(ctx, response.AccessToken)
	if err != nil {
		s.finishGistOAuthPoll(flowID, 0, false)
		return model.GistOAuthResult{}, err
	}
	gistID, note := s.discoverGistBackup(ctx, response.AccessToken)
	if !s.finishGistOAuthPoll(flowID, 0, false) {
		return model.GistOAuthResult{}, errors.New("GitHub OAuth flow is missing or cancelled")
	}
	if err := s.storeGistOAuthCredentials(response); err != nil {
		return model.GistOAuthResult{}, err
	}
	if gistID != "" {
		if err := s.saveOAuthGistID(gistID); err != nil {
			return model.GistOAuthResult{}, err
		}
	}
	s.recordOAuthAudit(account, true)
	return model.GistOAuthResult{Status: model.GistOAuthSuccess, Account: account, GistID: gistID, Message: note}, nil
}

func (s *SyncService) handleGistOAuthError(flowID string, response gistTokenResponse) (model.GistOAuthResult, error) {
	switch response.Error {
	case "authorization_pending":
		s.finishGistOAuthPoll(flowID, 0, true)
		return model.GistOAuthResult{Status: model.GistOAuthPending, Message: "等待 GitHub 授权", RetryAfterSeconds: s.gistOAuthRetrySeconds(flowID)}, nil
	case "slow_down":
		s.extendGistOAuthInterval(flowID)
		return model.GistOAuthResult{Status: model.GistOAuthPending, Message: "GitHub 请求限流，稍后重试", RetryAfterSeconds: s.gistOAuthRetrySeconds(flowID)}, nil
	default:
		s.finishGistOAuthPoll(flowID, 0, false)
		message := gistOAuthErrorMessage(response)
		s.recordOAuthAudit("", false)
		return model.GistOAuthResult{Status: model.GistOAuthFailed, Message: message}, nil
	}
}

func (s *SyncService) gistOAuthRetrySeconds(flowID string) int {
	s.gistOAuthMu.Lock()
	defer s.gistOAuthMu.Unlock()
	flow, ok := s.gistOAuthFlows[flowID]
	if !ok {
		return 5
	}
	return maxSeconds(flow.interval)
}

func (s *SyncService) extendGistOAuthInterval(flowID string) {
	s.gistOAuthMu.Lock()
	defer s.gistOAuthMu.Unlock()
	flow, ok := s.gistOAuthFlows[flowID]
	if !ok {
		return
	}
	flow.interval += 5 * time.Second
	flow.polling = false
	flow.nextPoll = time.Now().Add(flow.interval)
	s.gistOAuthFlows[flowID] = flow
}

func gistOAuthErrorMessage(response gistTokenResponse) string {
	switch response.Error {
	case "access_denied":
		return "GitHub 授权已取消"
	case "expired_token", "token_expired":
		return "GitHub 授权码已过期，请重新授权"
	case "device_flow_disabled":
		return "GitHub OAuth App 未启用 Device Flow"
	case "incorrect_client_credentials":
		return "GitHub OAuth Client ID 无效"
	default:
		if strings.TrimSpace(response.ErrorDescription) != "" {
			return "GitHub 授权失败: " + response.ErrorDescription
		}
		return "GitHub 授权失败: " + response.Error
	}
}

func (s *SyncService) recordOAuthAudit(account string, success bool) {
	outcome := "failed"
	if success {
		outcome = "success"
	}
	recordAudit(s.db, s.logger, model.AuditEvent{
		Action: "github_oauth", TargetType: "sync", TargetID: account,
		Summary: "GitHub Gist OAuth 授权", Outcome: outcome,
	})
}

func (s *SyncService) fetchGistOAuthAccount(ctx context.Context, token string) (string, error) {
	var user gistOAuthUser
	if err := s.gitHubAPIGet(ctx, "/user", token, &user); err != nil {
		return "", fmt.Errorf("validate GitHub OAuth token: %w", err)
	}
	if strings.TrimSpace(user.Login) == "" {
		return "", errors.New("GitHub OAuth account is missing")
	}
	return user.Login, nil
}

func (s *SyncService) discoverGistBackup(ctx context.Context, token string) (string, string) {
	var gists []gistResponse
	if err := s.gitHubAPIGet(ctx, "/gists?per_page=100", token, &gists); err != nil {
		if s.logger != nil {
			s.logger.Warn("discover GitHub backup gist failed", "error", err)
		}
		return "", "GitHub 授权成功，首次同步将自动创建 Secret Gist"
	}
	matches := make([]string, 0, 1)
	for _, gist := range gists {
		if gist.Public || gist.ID == "" {
			continue
		}
		if _, ok := gist.Files[syncBackupFileName]; ok {
			matches = append(matches, gist.ID)
		}
	}
	switch len(matches) {
	case 1:
		return matches[0], "已连接 GitHub 并找到现有备份 Gist"
	case 0:
		return "", "GitHub 授权成功，首次同步将自动创建 Secret Gist"
	default:
		return "", "检测到多个备份 Gist，请展开手动配置指定 Gist ID"
	}
}

func (s *SyncService) gitHubAPIGet(ctx context.Context, path, token string, output any) error {
	endpoint := strings.TrimRight(s.gistOAuthAPIBase, "/") + path
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	response, err := sameOriginHTTPClient(s.syncHTTPClient(), request.URL).Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub API returned %s", response.Status)
	}
	if err := decodeBoundedJSON(response.Body, gistOAuthMaxBody, output); err != nil {
		return err
	}
	return nil
}

func (s *SyncService) saveOAuthGistID(gistID string) error {
	gistID = normalizeGistID(gistID)
	if gistID == "" {
		return errors.New("GitHub Gist ID is required")
	}
	if err := s.beginSyncOperation(); err != nil {
		return err
	}
	defer s.operationMu.Unlock()
	s.configMu.Lock()
	defer s.configMu.Unlock()
	current, err := s.loadConfig()
	if err != nil {
		return err
	}
	if current.Gist.GistID != "" {
		return nil
	}
	current.Gist.GistID = gistID
	return writeSyncSetting(s.db, syncConfigSetting, current)
}
