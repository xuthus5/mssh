package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPostJSONRejectsOversizedTrailingResponse(t *testing.T) {
	client := oversizedJSONClient(http.StatusOK, `{"ok":true}`, 4<<20+1)
	var output map[string]any

	err := postJSON(context.Background(), client, "https://example.com/chat", "", "", nil, map[string]string{}, &output)

	assert.ErrorContains(t, err, "exceeds")
}

func TestSearchRequestRejectsOversizedTrailingResponse(t *testing.T) {
	client := oversizedJSONClient(http.StatusOK, `{"results":[]}`, 2<<20+1)
	var output map[string]any

	err := getJSON(context.Background(), client, "https://example.com/search", nil, &output)

	assert.ErrorContains(t, err, "exceeds")
}

func TestGistFetchRejectsOversizedTrailingResponse(t *testing.T) {
	prefix := `{"id":"gist","files":{".msshbackup":{"content":"backup"}}}`
	provider, err := newGistSyncProvider(oversizedJSONClient(http.StatusOK, prefix, maxCloudBackupSize+1), "https://example.com", "gist", "token")
	require.NoError(t, err)

	_, err = provider.Fetch(context.Background())

	assert.ErrorContains(t, err, "exceeds")
}

func TestGistPutRejectsOversizedTrailingResponse(t *testing.T) {
	provider, err := newGistSyncProvider(oversizedJSONClient(http.StatusCreated, `{"id":"gist"}`, 1<<20+1), "https://example.com", "", "token")
	require.NoError(t, err)

	_, err = provider.Put(context.Background(), []byte("backup"), "")

	assert.ErrorContains(t, err, "exceeds")
}

func oversizedJSONClient(statusCode int, prefix string, trailingBytes int64) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body := io.MultiReader(strings.NewReader(prefix), io.LimitReader(zeroReader{}, trailingBytes))
		return &http.Response{
			StatusCode: statusCode,
			Status:     fmt.Sprintf("%d %s", statusCode, http.StatusText(statusCode)),
			Header:     make(http.Header),
			Body:       io.NopCloser(body),
			Request:    request,
		}, nil
	})}
}
