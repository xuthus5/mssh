package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestS3CustomEndpointDoesNotFollowMovedUploadRedirect(t *testing.T) {
	var attackerCalls atomic.Int32
	attacker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attackerCalls.Add(1)
		_, readErr := io.ReadAll(request.Body)
		if readErr != nil {
			t.Errorf("read redirected S3 body: %v", readErr)
		}
		writer.Header().Set("ETag", `"stolen"`)
		writer.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(attacker.Close)

	origin := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, attacker.URL+"/stolen", http.StatusMovedPermanently)
	}))
	t.Cleanup(origin.Close)

	config := model.S3SyncConfig{
		Endpoint: origin.URL, Region: "us-east-1", Bucket: "backup", AccessKeyID: "access", PathStyle: true,
	}
	provider, err := newS3SyncProvider(t.Context(), config, "secret", sharedHTTPClient(2*time.Second, nil))
	require.NoError(t, err)

	_, err = provider.Put(t.Context(), []byte("encrypted-backup"), "")
	require.Error(t, err)
	assert.Zero(t, attackerCalls.Load())
}

func TestS3CustomEndpointRejectsCrossOriginHeadRedirect(t *testing.T) {
	var attackerCalls atomic.Int32
	attacker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		attackerCalls.Add(1)
		writer.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(attacker.Close)
	origin := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, attacker.URL+"/bucket", http.StatusTemporaryRedirect)
	}))
	t.Cleanup(origin.Close)

	config := model.S3SyncConfig{
		Endpoint: origin.URL, Region: "us-east-1", Bucket: "backup", AccessKeyID: "access", PathStyle: true,
	}
	provider, err := newS3SyncProvider(t.Context(), config, "secret", sharedHTTPClient(2*time.Second, nil))
	require.NoError(t, err)

	err = provider.Test(t.Context())
	require.ErrorContains(t, err, "different origin")
	assert.Zero(t, attackerCalls.Load())
}

func TestS3CustomEndpointAllowsSameOriginTemporaryRedirect(t *testing.T) {
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/storage" {
			http.Redirect(writer, request, serverURL+"/storage", http.StatusTemporaryRedirect)
			return
		}
		writer.WriteHeader(http.StatusOK)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)

	config := model.S3SyncConfig{
		Endpoint: server.URL, Region: "us-east-1", Bucket: "backup", AccessKeyID: "access", PathStyle: true,
	}
	provider, err := newS3SyncProvider(t.Context(), config, "secret", sharedHTTPClient(2*time.Second, nil))
	require.NoError(t, err)
	require.NoError(t, provider.Test(t.Context()))
}

func TestS3HTTPClientRedirectPolicy(t *testing.T) {
	baseCalls := 0
	base := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		baseCalls++
		return nil
	}}
	client, err := s3HTTPClient(base, "https://s3.example.com")
	require.NoError(t, err)
	via := []*http.Request{mustRequest(t, "https://s3.example.com/start")}

	moved := mustRedirectRequest(t, "https://s3.example.com/next", http.StatusMovedPermanently)
	assert.ErrorIs(t, client.CheckRedirect(moved, via), http.ErrUseLastResponse)

	crossOrigin := mustRedirectRequest(t, "https://other.example.com/next", http.StatusTemporaryRedirect)
	require.ErrorContains(t, client.CheckRedirect(crossOrigin, via), "different origin")

	sameOrigin := mustRedirectRequest(t, "https://s3.example.com:443/next", http.StatusTemporaryRedirect)
	require.NoError(t, client.CheckRedirect(sameOrigin, via))
	assert.Equal(t, 1, baseCalls)

	missingResponse := mustRequest(t, "https://s3.example.com/next")
	require.ErrorContains(t, client.CheckRedirect(missingResponse, via), "response")

	_, err = s3HTTPClient(base, "://bad")
	require.Error(t, err)
}

func TestS3DefaultEndpointRedirectStripsSessionToken(t *testing.T) {
	client, err := s3HTTPClient(&http.Client{}, "")
	require.NoError(t, err)
	via := []*http.Request{mustRequest(t, "https://s3.us-east-1.amazonaws.com/start")}
	redirect := mustRedirectRequest(t, "https://s3.us-west-2.amazonaws.com/next", http.StatusPermanentRedirect)
	redirect.Header.Set("X-Amz-Security-Token", "secret")

	require.NoError(t, client.CheckRedirect(redirect, via))
	assert.Empty(t, redirect.Header.Get("X-Amz-Security-Token"))
}

func mustRequest(t *testing.T, endpoint string) *http.Request {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, endpoint, nil)
	require.NoError(t, err)
	return request
}

func mustRedirectRequest(t *testing.T, endpoint string, status int) *http.Request {
	t.Helper()
	request := mustRequest(t, endpoint)
	request.Response = &http.Response{StatusCode: status, Header: make(http.Header)}
	return request
}
