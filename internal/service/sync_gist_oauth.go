package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	// GitHubOAuthClientID is public by design. Device Flow does not use a client secret.
	GitHubOAuthClientID  = "Ov23li9dUPSrPBysVKls"
	githubOAuthWebBase   = "https://github.com"
	gistOAuthScope       = "gist offline_access"
	gistOAuthMaxBody     = 1 << 20
	gistOAuthRefreshSkew = time.Minute
)

type gistOAuthFlow struct {
	id              string
	deviceCode      string
	userCode        string
	verificationURI string
	expiresAt       time.Time
	interval        time.Duration
	nextPoll        time.Time
	polling         bool
}

type gistOAuthState struct {
	gistOAuthClientID string
	gistOAuthWebBase  string
	gistOAuthAPIBase  string
	gistOAuthStartMu  sync.Mutex
	gistOAuthMu       sync.Mutex
	gistOAuthFlows    map[string]gistOAuthFlow
}

func newGistOAuthState() gistOAuthState {
	return gistOAuthState{
		gistOAuthClientID: GitHubOAuthClientID,
		gistOAuthWebBase:  githubOAuthWebBase,
		gistOAuthAPIBase:  "https://" + githubAPIHost,
		gistOAuthFlows:    make(map[string]gistOAuthFlow),
	}
}

type gistDeviceCodeResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

type gistTokenResponse struct {
	AccessToken      string `json:"access_token"`
	RefreshToken     string `json:"refresh_token"`
	ExpiresIn        int64  `json:"expires_in"`
	TokenType        string `json:"token_type"`
	Scope            string `json:"scope"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

type gistOAuthUser struct {
	Login string `json:"login"`
}

// StartGistOAuth begins GitHub's Device Flow without exposing the device code to the frontend.
func (s *SyncService) StartGistOAuth() (model.GistOAuthStart, error) {
	if s == nil {
		return model.GistOAuthStart{}, errSyncServiceStopped
	}
	s.gistOAuthStartMu.Lock()
	defer s.gistOAuthStartMu.Unlock()
	if s.isStopped() {
		return model.GistOAuthStart{}, errSyncServiceStopped
	}
	if strings.TrimSpace(s.gistOAuthClientID) == "" {
		return model.GistOAuthStart{}, errors.New("GitHub OAuth is not configured")
	}
	now := time.Now()
	if start, ok := s.currentGistOAuthStart(now); ok {
		return start, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), syncNetworkTimeout)
	defer cancel()
	response, err := s.requestGistDeviceCode(ctx)
	if err != nil {
		return model.GistOAuthStart{}, err
	}
	if s.isStopped() {
		return model.GistOAuthStart{}, errSyncServiceStopped
	}
	flow, err := newGistOAuthFlow(response, now, s.gistOAuthWebBase)
	if err != nil {
		return model.GistOAuthStart{}, err
	}
	return s.storeGistOAuthFlow(flow, now)
}

func newGistOAuthFlow(response gistDeviceCodeResponse, now time.Time, allowedBase string) (gistOAuthFlow, error) {
	if strings.TrimSpace(response.DeviceCode) == "" || strings.TrimSpace(response.UserCode) == "" {
		return gistOAuthFlow{}, errors.New("GitHub returned an incomplete device authorization")
	}
	verificationURI := strings.TrimSpace(response.VerificationURI)
	if err := validateOutboundHTTPURL(verificationURI); err != nil {
		return gistOAuthFlow{}, fmt.Errorf("GitHub verification URL is invalid: %w", err)
	}
	if err := requireSameGistOAuthOrigin(verificationURI, allowedBase); err != nil {
		return gistOAuthFlow{}, err
	}
	if response.ExpiresIn <= 0 || response.ExpiresIn > 3600 {
		return gistOAuthFlow{}, errors.New("GitHub device authorization expiry is invalid")
	}
	interval := response.Interval
	if interval <= 0 {
		interval = 5
	}
	if interval > 60 {
		interval = 60
	}
	return gistOAuthFlow{
		id: uuid.NewString(), deviceCode: response.DeviceCode, userCode: response.UserCode,
		verificationURI: verificationURI, expiresAt: now.Add(time.Duration(response.ExpiresIn) * time.Second),
		interval: time.Duration(interval) * time.Second, nextPoll: now.Add(time.Duration(interval) * time.Second),
	}, nil
}

func requireSameGistOAuthOrigin(rawURL, allowedBase string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return errors.New("GitHub verification URL is invalid")
	}
	base, err := url.Parse(allowedBase)
	if err != nil || base.Host == "" {
		return errors.New("GitHub OAuth base URL is invalid")
	}
	if !sameHTTPHost(parsed.Host, base.Host) || !strings.EqualFold(parsed.Scheme, base.Scheme) {
		return errors.New("GitHub verification URL is not trusted")
	}
	return nil
}

func (s *SyncService) requestGistDeviceCode(ctx context.Context) (gistDeviceCodeResponse, error) {
	endpoint := strings.TrimRight(s.gistOAuthWebBase, "/") + "/login/device/code"
	values := url.Values{"client_id": {s.gistOAuthClientID}, "scope": {gistOAuthScope}}
	var response gistDeviceCodeResponse
	if err := s.postGitHubOAuthForm(ctx, endpoint, values, &response); err != nil {
		return gistDeviceCodeResponse{}, err
	}
	return response, nil
}

func (s *SyncService) currentGistOAuthStart(now time.Time) (model.GistOAuthStart, bool) {
	s.gistOAuthMu.Lock()
	defer s.gistOAuthMu.Unlock()
	s.removeExpiredGistOAuthFlowsLocked(now)
	for _, flow := range s.gistOAuthFlows {
		return gistOAuthStartFromFlow(flow), true
	}
	return model.GistOAuthStart{}, false
}

func (s *SyncService) storeGistOAuthFlow(flow gistOAuthFlow, now time.Time) (model.GistOAuthStart, error) {
	s.gistOAuthMu.Lock()
	defer s.gistOAuthMu.Unlock()
	s.removeExpiredGistOAuthFlowsLocked(now)
	for _, existing := range s.gistOAuthFlows {
		return gistOAuthStartFromFlow(existing), nil
	}
	s.gistOAuthFlows[flow.id] = flow
	return gistOAuthStartFromFlow(flow), nil
}

func (s *SyncService) removeExpiredGistOAuthFlowsLocked(now time.Time) {
	for id, flow := range s.gistOAuthFlows {
		if !now.Before(flow.expiresAt) {
			delete(s.gistOAuthFlows, id)
		}
	}
}

func gistOAuthStartFromFlow(flow gistOAuthFlow) model.GistOAuthStart {
	return model.GistOAuthStart{
		FlowID: flow.id, UserCode: flow.userCode, VerificationURI: flow.verificationURI,
		ExpiresAt: flow.expiresAt, IntervalSeconds: int(flow.interval / time.Second),
	}
}

// PollGistOAuth exchanges a pending device code once and stores the resulting token only on success.
func (s *SyncService) PollGistOAuth(flowID string) (model.GistOAuthResult, error) {
	if s == nil || s.isStopped() {
		return model.GistOAuthResult{}, errSyncServiceStopped
	}
	flow, retry, err := s.beginGistOAuthPoll(strings.TrimSpace(flowID), time.Now())
	if err != nil {
		return model.GistOAuthResult{}, err
	}
	if retry > 0 {
		return model.GistOAuthResult{Status: model.GistOAuthPending, Message: "等待 GitHub 授权", RetryAfterSeconds: retry}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), syncNetworkTimeout)
	defer cancel()
	response, err := s.requestGistOAuthToken(ctx, flow.deviceCode)
	if err != nil {
		s.finishGistOAuthPoll(flowID, 0, false)
		return model.GistOAuthResult{}, err
	}
	return s.handleGistOAuthTokenResponse(ctx, flowID, response)
}

func (s *SyncService) beginGistOAuthPoll(flowID string, now time.Time) (gistOAuthFlow, int, error) {
	if flowID == "" {
		return gistOAuthFlow{}, 0, errors.New("GitHub OAuth flow is required")
	}
	s.gistOAuthMu.Lock()
	defer s.gistOAuthMu.Unlock()
	flow, ok := s.gistOAuthFlows[flowID]
	if !ok {
		return gistOAuthFlow{}, 0, errors.New("GitHub OAuth flow is missing or cancelled")
	}
	if !now.Before(flow.expiresAt) {
		delete(s.gistOAuthFlows, flowID)
		return gistOAuthFlow{}, 0, errors.New("GitHub OAuth flow expired")
	}
	if flow.polling {
		return gistOAuthFlow{}, maxSeconds(flow.nextPoll.Sub(now)), nil
	}
	if retry := flow.nextPoll.Sub(now); retry > 0 {
		return gistOAuthFlow{}, maxSeconds(retry), nil
	}
	flow.polling = true
	s.gistOAuthFlows[flowID] = flow
	return flow, 0, nil
}

func maxSeconds(duration time.Duration) int {
	seconds := int((duration + time.Second - 1) / time.Second)
	if seconds < 1 {
		return 1
	}
	return seconds
}

func (s *SyncService) finishGistOAuthPoll(flowID string, interval time.Duration, keep bool) bool {
	s.gistOAuthMu.Lock()
	defer s.gistOAuthMu.Unlock()
	if !keep {
		_, exists := s.gistOAuthFlows[flowID]
		delete(s.gistOAuthFlows, flowID)
		return exists
	}
	flow, ok := s.gistOAuthFlows[flowID]
	if !ok {
		return false
	}
	flow.polling = false
	if interval > 0 {
		flow.interval = interval
	}
	flow.nextPoll = time.Now().Add(flow.interval)
	s.gistOAuthFlows[flowID] = flow
	return true
}

// CancelGistOAuth drops a pending Device Flow and its in-memory device code.
func (s *SyncService) CancelGistOAuth(flowID string) error {
	if s == nil || s.isStopped() {
		return errSyncServiceStopped
	}
	flowID = strings.TrimSpace(flowID)
	if flowID == "" {
		return errors.New("GitHub OAuth flow is required")
	}
	s.gistOAuthMu.Lock()
	defer s.gistOAuthMu.Unlock()
	delete(s.gistOAuthFlows, flowID)
	return nil
}

func (s *SyncService) clearGistOAuthFlows() {
	if s == nil {
		return
	}
	s.gistOAuthMu.Lock()
	defer s.gistOAuthMu.Unlock()
	s.gistOAuthFlows = make(map[string]gistOAuthFlow)
}
