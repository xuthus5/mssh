package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

type gistOAuthFixture struct {
	t       *testing.T
	server  *httptest.Server
	mu      sync.Mutex
	token   []gistTokenResponse
	refresh gistTokenResponse
	gists   []gistResponse
	user    string
}

func newGistOAuthFixture(t *testing.T) *gistOAuthFixture {
	t.Helper()
	fixture := &gistOAuthFixture{t: t}
	fixture.server = httptest.NewServer(http.HandlerFunc(fixture.serveHTTP))
	t.Cleanup(fixture.server.Close)
	return fixture
}

func (f *gistOAuthFixture) serveHTTP(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Content-Type", "application/json")
	switch request.URL.Path {
	case "/login/device/code":
		writeJSON(f.t, writer, gistDeviceCodeResponse{
			DeviceCode: "device-secret", UserCode: "ABCD-1234", VerificationURI: f.server.URL + "/login/device",
			ExpiresIn: 900, Interval: 5,
		})
	case "/login/oauth/access_token":
		if err := request.ParseForm(); err != nil {
			f.t.Errorf("parse OAuth form: %v", err)
			return
		}
		if request.Form.Get("grant_type") == "refresh_token" {
			writeJSON(f.t, writer, f.refresh)
			return
		}
		f.mu.Lock()
		response := gistTokenResponse{Error: "authorization_pending"}
		if len(f.token) > 0 {
			response = f.token[0]
			f.token = f.token[1:]
		}
		f.mu.Unlock()
		writeJSON(f.t, writer, response)
	case "/user":
		writeJSON(f.t, writer, gistOAuthUser{Login: f.user})
	case "/gists":
		writeJSON(f.t, writer, f.gists)
	default:
		writer.WriteHeader(http.StatusNotFound)
	}
}

func writeJSON(t *testing.T, writer http.ResponseWriter, value any) {
	t.Helper()
	if err := json.NewEncoder(writer).Encode(value); err != nil {
		t.Errorf("encode JSON response: %v", err)
	}
}

func (f *gistOAuthFixture) setTokens(responses ...gistTokenResponse) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.token = append([]gistTokenResponse(nil), responses...)
}

func newGistOAuthService(t *testing.T, fixture *gistOAuthFixture) *SyncService {
	t.Helper()
	db := testutil.NewTestDB(t)
	crypto := syncTestCrypto{key: []byte("01234567890123456789012345678901")}
	service := newTestSyncService(db, syncTestMasterKey, WithSyncCrypto(crypto))
	service.gistOAuthClientID = "client-id"
	service.gistOAuthWebBase = fixture.server.URL
	service.gistOAuthAPIBase = fixture.server.URL
	return service
}

func TestWithSyncGistOAuthClientIDOverridesDefault(t *testing.T) {
	service := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger())
	WithSyncGistOAuthClientID("  client-override  ")(service)
	assert.Equal(t, "client-override", service.gistOAuthClientID)
}

func allowGistOAuthPoll(service *SyncService, flowID string) {
	service.gistOAuthMu.Lock()
	defer service.gistOAuthMu.Unlock()
	flow := service.gistOAuthFlows[flowID]
	flow.nextPoll = time.Now().Add(-time.Second)
	service.gistOAuthFlows[flowID] = flow
}

func TestGistOAuthDeviceFlowStoresEncryptedCredentialsAndDiscoversGist(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	fixture.user = "octocat"
	fixture.gists = []gistResponse{{ID: "gist-1", Files: map[string]gistFile{syncBackupFileName: {}}}}
	fixture.setTokens(
		gistTokenResponse{Error: "authorization_pending"},
		gistTokenResponse{AccessToken: "access-token", RefreshToken: "refresh-token", ExpiresIn: 28800},
	)
	service := newGistOAuthService(t, fixture)

	start, err := service.StartGistOAuth()
	require.NoError(t, err)
	assert.Equal(t, "ABCD-1234", start.UserCode)
	assert.Equal(t, fixture.server.URL+"/login/device", start.VerificationURI)
	assert.Equal(t, 5, start.IntervalSeconds)
	again, err := service.StartGistOAuth()
	require.NoError(t, err)
	assert.Equal(t, start.FlowID, again.FlowID)

	allowGistOAuthPoll(service, start.FlowID)
	pending, err := service.PollGistOAuth(start.FlowID)
	require.NoError(t, err)
	assert.Equal(t, model.GistOAuthPending, pending.Status)
	assert.Positive(t, pending.RetryAfterSeconds)

	allowGistOAuthPoll(service, start.FlowID)
	result, err := service.PollGistOAuth(start.FlowID)
	require.NoError(t, err)
	assert.Equal(t, model.GistOAuthSuccess, result.Status)
	assert.Equal(t, "octocat", result.Account)
	assert.Equal(t, "gist-1", result.GistID)
	assert.Contains(t, result.Message, "现有备份")

	access, err := service.loadSecret(syncGistTokenSetting)
	require.NoError(t, err)
	refresh, err := service.loadSecret(syncGistRefreshTokenSetting)
	require.NoError(t, err)
	assert.Equal(t, "access-token", access)
	assert.Equal(t, "refresh-token", refresh)
	expiresAt, err := service.loadGistTokenExpiry()
	require.NoError(t, err)
	assert.True(t, expiresAt.After(time.Now().Add(7*time.Hour)))
	config, err := service.LoadConfig()
	require.NoError(t, err)
	assert.Equal(t, "gist-1", config.Gist.GistID)
}

func TestGistOAuthRejectsDeniedExpiredAndRateLimitedFlows(t *testing.T) {
	tests := []struct {
		name     string
		response gistTokenResponse
		status   model.GistOAuthStatus
		message  string
	}{
		{name: "denied", response: gistTokenResponse{Error: "access_denied"}, status: model.GistOAuthFailed, message: "取消"},
		{name: "expired", response: gistTokenResponse{Error: "expired_token"}, status: model.GistOAuthFailed, message: "过期"},
		{name: "device flow disabled", response: gistTokenResponse{Error: "device_flow_disabled"}, status: model.GistOAuthFailed, message: "Device Flow"},
		{name: "descriptive error", response: gistTokenResponse{Error: "other", ErrorDescription: "details"}, status: model.GistOAuthFailed, message: "details"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newGistOAuthFixture(t)
			fixture.setTokens(test.response)
			service := newGistOAuthService(t, fixture)
			start, err := service.StartGistOAuth()
			require.NoError(t, err)
			allowGistOAuthPoll(service, start.FlowID)
			result, err := service.PollGistOAuth(start.FlowID)
			require.NoError(t, err)
			assert.Equal(t, test.status, result.Status)
			assert.Contains(t, result.Message, test.message)
			_, exists := service.gistOAuthFlows[start.FlowID]
			assert.False(t, exists)
		})
	}
}

func TestGistOAuthSlowDownAndImmediatePollingStayPending(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	fixture.setTokens(gistTokenResponse{Error: "slow_down"})
	service := newGistOAuthService(t, fixture)
	start, err := service.StartGistOAuth()
	require.NoError(t, err)
	result, err := service.PollGistOAuth(start.FlowID)
	require.NoError(t, err)
	assert.Equal(t, model.GistOAuthPending, result.Status)
	assert.Equal(t, 5, result.RetryAfterSeconds)

	allowGistOAuthPoll(service, start.FlowID)
	result, err = service.PollGistOAuth(start.FlowID)
	require.NoError(t, err)
	assert.Equal(t, model.GistOAuthPending, result.Status)
	assert.Equal(t, 10, result.RetryAfterSeconds)
}

func TestGistOAuthCancelAndExpiryRemoveFlow(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	service := newGistOAuthService(t, fixture)
	start, err := service.StartGistOAuth()
	require.NoError(t, err)
	require.NoError(t, service.CancelGistOAuth(start.FlowID))
	_, err = service.PollGistOAuth(start.FlowID)
	require.ErrorContains(t, err, "missing")

	start, err = service.StartGistOAuth()
	require.NoError(t, err)
	service.gistOAuthMu.Lock()
	flow := service.gistOAuthFlows[start.FlowID]
	flow.expiresAt = time.Now().Add(-time.Second)
	service.gistOAuthFlows[start.FlowID] = flow
	service.gistOAuthMu.Unlock()
	_, err = service.PollGistOAuth(start.FlowID)
	require.ErrorContains(t, err, "expired")
}

func TestGistOAuthCancelledFlowDoesNotStoreCredentials(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	fixture.user = "octocat"
	service := newGistOAuthService(t, fixture)
	start, err := service.StartGistOAuth()
	require.NoError(t, err)
	require.NoError(t, service.CancelGistOAuth(start.FlowID))

	_, err = service.handleGistOAuthTokenResponse(context.Background(), start.FlowID, gistTokenResponse{
		AccessToken: "late-token", RefreshToken: "late-refresh", ExpiresIn: 28800,
	})
	require.ErrorContains(t, err, "cancelled")
	assert.False(t, service.secretSaved(syncGistTokenSetting))
	assert.False(t, service.secretSaved(syncGistRefreshTokenSetting))
}

func TestGistOAuthValidatesConfigurationAndInputs(t *testing.T) {
	service := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger())
	service.gistOAuthClientID = ""
	_, err := service.StartGistOAuth()
	assert.ErrorContains(t, err, "not configured")
	_, err = service.PollGistOAuth("")
	assert.ErrorContains(t, err, "required")
	assert.ErrorContains(t, service.CancelGistOAuth(""), "required")
	_, err = newGistOAuthFlow(gistDeviceCodeResponse{}, time.Now(), githubOAuthWebBase)
	assert.ErrorContains(t, err, "incomplete")
	_, err = newGistOAuthFlow(gistDeviceCodeResponse{DeviceCode: "d", UserCode: "u", VerificationURI: "https://evil.example/login/device", ExpiresIn: 900}, time.Now(), githubOAuthWebBase)
	assert.ErrorContains(t, err, "not trusted")
	_, err = newGistOAuthFlow(gistDeviceCodeResponse{DeviceCode: "d", UserCode: "u", VerificationURI: githubOAuthWebBase, ExpiresIn: 0}, time.Now(), githubOAuthWebBase)
	assert.ErrorContains(t, err, "expiry")
}

func TestGistOAuthDiscoveryFallsBackForMissingAmbiguousAndFailedLookups(t *testing.T) {
	tests := []struct {
		name    string
		gists   []gistResponse
		status  int
		message string
	}{
		{name: "none", message: "自动创建"},
		{name: "multiple", gists: []gistResponse{
			{ID: "one", Files: map[string]gistFile{syncBackupFileName: {}}},
			{ID: "two", Files: map[string]gistFile{syncBackupFileName: {}}},
		}, message: "多个"},
		{name: "public ignored", gists: []gistResponse{{ID: "public", Public: true, Files: map[string]gistFile{syncBackupFileName: {}}}}, message: "自动创建"},
		{name: "lookup failure", status: http.StatusInternalServerError, message: "自动创建"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newGistOAuthFixture(t)
			if test.status != 0 {
				fixture.server.Config.Handler = http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
					writer.WriteHeader(test.status)
				})
			} else {
				fixture.gists = test.gists
			}
			service := newGistOAuthService(t, fixture)
			gistID, message := service.discoverGistBackup(context.Background(), "token")
			assert.Empty(t, gistID)
			assert.Contains(t, message, test.message)
		})
	}
}

func TestGistOAuthIdentityFailureDoesNotStoreToken(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	fixture.server.Config.Handler = http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/login/device/code" {
			writeJSON(t, writer, gistDeviceCodeResponse{DeviceCode: "device", UserCode: "code", VerificationURI: fixture.server.URL + "/login/device", ExpiresIn: 900})
			return
		}
		if request.URL.Path == "/login/oauth/access_token" {
			writeJSON(t, writer, gistTokenResponse{AccessToken: "token"})
			return
		}
		writer.WriteHeader(http.StatusUnauthorized)
	})
	service := newGistOAuthService(t, fixture)
	start, err := service.StartGistOAuth()
	require.NoError(t, err)
	allowGistOAuthPoll(service, start.FlowID)
	_, err = service.PollGistOAuth(start.FlowID)
	require.ErrorContains(t, err, "validate")
	assert.False(t, service.secretSaved(syncGistTokenSetting))
}

func TestGistOAuthRefreshUpdatesCredentials(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	fixture.refresh = gistTokenResponse{AccessToken: "refreshed-token", RefreshToken: "rotated-refresh", ExpiresIn: 28800}
	service := newGistOAuthService(t, fixture)
	require.NoError(t, service.storeGistOAuthCredentials(gistTokenResponse{AccessToken: "old-token", RefreshToken: "old-refresh", ExpiresIn: 60}))
	require.NoError(t, writeSyncSetting(service.db, syncGistTokenExpiresAtSetting, time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)))
	require.NoError(t, service.ensureGistOAuthTokenFresh(context.Background(), nil))
	access, err := service.loadSecret(syncGistTokenSetting)
	require.NoError(t, err)
	refresh, err := service.loadSecret(syncGistRefreshTokenSetting)
	require.NoError(t, err)
	assert.Equal(t, "refreshed-token", access)
	assert.Equal(t, "rotated-refresh", refresh)
}

func TestGistOAuthRefreshKeepsRefreshTokenWhenOmitted(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	fixture.refresh = gistTokenResponse{AccessToken: "refreshed-token", ExpiresIn: 28800}
	service := newGistOAuthService(t, fixture)
	require.NoError(t, service.storeGistOAuthCredentials(gistTokenResponse{AccessToken: "old-token", RefreshToken: "old-refresh", ExpiresIn: 60}))
	require.NoError(t, writeSyncSetting(service.db, syncGistTokenExpiresAtSetting, time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)))
	require.NoError(t, service.ensureGistOAuthTokenFresh(context.Background(), nil))

	access, err := service.loadSecret(syncGistTokenSetting)
	require.NoError(t, err)
	refresh, err := service.loadSecret(syncGistRefreshTokenSetting)
	require.NoError(t, err)
	assert.Equal(t, "refreshed-token", access)
	assert.Equal(t, "old-refresh", refresh)
}

func TestGistOAuthManualTokenSkipsRefresh(t *testing.T) {
	service := newGistOAuthService(t, newGistOAuthFixture(t))
	input := model.SyncConfigInput{Gist: model.GistSyncConfigInput{Token: "manual-token"}}
	require.NoError(t, service.ensureGistOAuthTokenFresh(context.Background(), &input))
}

func TestGistOAuthReauthorizationWithoutRefreshTokenClearsOldRefresh(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	service := newGistOAuthService(t, fixture)
	require.NoError(t, service.storeGistOAuthCredentials(gistTokenResponse{AccessToken: "old-token", RefreshToken: "old-refresh", ExpiresIn: 60}))
	require.NoError(t, service.storeGistOAuthCredentials(gistTokenResponse{AccessToken: "new-token"}))

	access, err := service.loadSecret(syncGistTokenSetting)
	require.NoError(t, err)
	assert.Equal(t, "new-token", access)
	assert.False(t, service.secretSaved(syncGistRefreshTokenSetting))
	expiresAt, err := service.loadGistTokenExpiry()
	require.NoError(t, err)
	assert.True(t, expiresAt.IsZero())
}

func TestGistOAuthRefreshRejectsMissingOrInvalidRefreshToken(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	service := newGistOAuthService(t, fixture)
	require.NoError(t, writeSyncSetting(service.db, syncGistTokenExpiresAtSetting, time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)))
	require.ErrorContains(t, service.ensureGistOAuthTokenFresh(context.Background(), nil), "expired")

	require.NoError(t, service.saveSecret(syncGistRefreshTokenSetting, "refresh"))
	fixture.server.Config.Handler = http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(t, writer, gistTokenResponse{Error: "bad_refresh_token"})
	})
	require.ErrorContains(t, service.ensureGistOAuthTokenFresh(context.Background(), nil), "expired")
}

func TestManualGistTokenClearsOAuthRefreshState(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	service := newGistOAuthService(t, fixture)
	require.NoError(t, service.storeGistOAuthCredentials(gistTokenResponse{AccessToken: "oauth-token", RefreshToken: "refresh", ExpiresIn: 28800}))
	input := model.SyncConfigInput{
		Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart, IntervalMinutes: 15,
		RetentionCount: 30, RetentionDays: 90, Gist: model.GistSyncConfigInput{Token: "manual-token"},
	}
	_, err := service.SaveConfig(input)
	require.NoError(t, err)
	assert.False(t, service.secretSaved(syncGistRefreshTokenSetting))
	var expiry string
	assert.Error(t, readSyncSetting(service.db, syncGistTokenExpiresAtSetting, &expiry))
	access, err := service.loadSecret(syncGistTokenSetting)
	require.NoError(t, err)
	assert.Equal(t, "manual-token", access)
}

func TestPostGitHubOAuthFormRejectsHTTPErrorsAndInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Query().Get("mode") == "bad-json" {
			_, _ = writer.Write([]byte("{"))
			return
		}
		writer.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()
	service := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger())
	var output map[string]any
	err := service.postGitHubOAuthForm(context.Background(), server.URL, url.Values{}, &output)
	require.ErrorContains(t, err, "502")
	err = service.postGitHubOAuthForm(context.Background(), server.URL+"?mode=bad-json", url.Values{}, &output)
	require.ErrorContains(t, err, "decode")
}

func TestGistOAuthFormsRejectUnexpectedResponses(t *testing.T) {
	fixture := newGistOAuthFixture(t)
	fixture.refresh = gistTokenResponse{Error: "authorization_pending"}
	service := newGistOAuthService(t, fixture)
	_, err := service.refreshGistOAuthToken(context.Background(), "refresh")
	require.ErrorContains(t, err, "authorization_pending")
	fixture.setTokens(gistTokenResponse{Error: "other", ErrorDescription: "failed"})
	allow := gistOAuthFlow{id: "flow", deviceCode: "device", expiresAt: time.Now().Add(time.Minute), interval: time.Second}
	service.gistOAuthFlows["flow"] = allow
	result, err := service.PollGistOAuth("flow")
	require.NoError(t, err)
	assert.Equal(t, model.GistOAuthFailed, result.Status)
}

func TestGistOAuthRejectsForeignVerificationOrigin(t *testing.T) {
	err := requireSameGistOAuthOrigin("https://evil.example/login/device", "not-a-url")
	require.ErrorContains(t, err, "base URL")
	err = requireSameGistOAuthOrigin("http://github.com/login/device", githubOAuthWebBase)
	require.ErrorContains(t, err, "not trusted")
}

func TestGistOAuthErrorMessageDefaults(t *testing.T) {
	assert.Contains(t, gistOAuthErrorMessage(gistTokenResponse{Error: "unknown"}), "unknown")
	assert.Contains(t, gistOAuthErrorMessage(gistTokenResponse{Error: "incorrect_client_credentials"}), "Client ID")
}
