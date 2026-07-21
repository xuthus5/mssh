package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const syncBackupFileName = ".msshbackup"

type gistSyncProvider struct {
	client  *http.Client
	apiBase string
	gistID  string
	token   string
}

type gistFile struct {
	Content   string `json:"content"`
	Truncated bool   `json:"truncated"`
	RawURL    string `json:"raw_url"`
}

type gistResponse struct {
	ID    string              `json:"id"`
	Files map[string]gistFile `json:"files"`
}

func newGistSyncProvider(client *http.Client, apiBase, gistID, token string) (*gistSyncProvider, error) {
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("GitHub token is required")
	}
	parsed, err := url.ParseRequestURI(strings.TrimRight(apiBase, "/"))
	if err != nil {
		return nil, errors.New("GitHub API URL is invalid")
	}
	if err := requireHTTPSUnlessLoopback(parsed); err != nil {
		return nil, err
	}
	return &gistSyncProvider{client: client, apiBase: parsed.String(), gistID: normalizeGistID(gistID), token: token}, nil
}

func normalizeGistID(value string) string {
	value = strings.TrimSpace(value)
	if parsed, err := url.Parse(value); err == nil && parsed.Host != "" {
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		return parts[len(parts)-1]
	}
	return value
}

func (g *gistSyncProvider) Test(ctx context.Context) error {
	path := "/user"
	if g.gistID != "" {
		path = "/gists/" + url.PathEscape(g.gistID)
	}
	response, err := g.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	return expectHTTPStatus(response, http.StatusOK, "GitHub Gist connection")
}

func (g *gistSyncProvider) Fetch(ctx context.Context) (syncRemoteObject, error) {
	if g.gistID == "" {
		return syncRemoteObject{}, errSyncRemoteNotFound
	}
	response, err := g.do(ctx, http.MethodGet, "/gists/"+url.PathEscape(g.gistID), nil)
	if err != nil {
		return syncRemoteObject{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return syncRemoteObject{}, errSyncRemoteNotFound
	}
	if err := expectHTTPStatus(response, http.StatusOK, "fetch GitHub Gist"); err != nil {
		return syncRemoteObject{}, err
	}
	var gist gistResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, maxCloudBackupSize)).Decode(&gist); err != nil {
		return syncRemoteObject{}, fmt.Errorf("decode GitHub Gist: %w", err)
	}
	file, ok := gist.Files[syncBackupFileName]
	if !ok {
		return syncRemoteObject{}, errSyncRemoteNotFound
	}
	content, err := g.readGistFile(ctx, file)
	if err != nil {
		return syncRemoteObject{}, err
	}
	return syncRemoteObject{Content: content, ETag: response.Header.Get("ETag"), ProviderID: gist.ID}, nil
}

func (g *gistSyncProvider) Put(ctx context.Context, content []byte, etag string) (syncRemoteObject, error) {
	if g.gistID != "" {
		if err := g.ensureGistETag(ctx, etag); err != nil {
			return syncRemoteObject{}, err
		}
	}
	body := map[string]any{
		"description": "MSSH encrypted backup",
		"files":       map[string]any{syncBackupFileName: map[string]string{"content": string(content)}},
	}
	if g.gistID == "" {
		body["public"] = false
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return syncRemoteObject{}, fmt.Errorf("encode GitHub Gist: %w", err)
	}
	method, path := http.MethodPost, "/gists"
	if g.gistID != "" {
		method, path = http.MethodPatch, "/gists/"+url.PathEscape(g.gistID)
	}
	response, err := g.do(ctx, method, path, bytes.NewReader(encoded))
	if err != nil {
		return syncRemoteObject{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusPreconditionFailed || response.StatusCode == http.StatusConflict {
		return syncRemoteObject{}, errSyncConflict
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated {
		return syncRemoteObject{}, gistAPIError(response, "update GitHub Gist")
	}
	var gist gistResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&gist); err != nil {
		return syncRemoteObject{}, fmt.Errorf("decode updated GitHub Gist: %w", err)
	}
	g.gistID = gist.ID
	return syncRemoteObject{Content: content, ETag: response.Header.Get("ETag"), ProviderID: gist.ID}, nil
}

func (g *gistSyncProvider) ensureGistETag(ctx context.Context, etag string) error {
	if etag == "" {
		return nil
	}
	response, err := g.do(ctx, http.MethodGet, "/gists/"+url.PathEscape(g.gistID), nil)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return errSyncRemoteNotFound
	}
	if err := expectHTTPStatus(response, http.StatusOK, "fetch GitHub Gist"); err != nil {
		return err
	}
	current := response.Header.Get("ETag")
	if current != "" && !etagEqual(current, etag) {
		return errSyncConflict
	}
	return nil
}

func etagEqual(left, right string) bool {
	return normalizeETag(left) == normalizeETag(right)
}

func normalizeETag(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "W/") {
		value = strings.TrimSpace(value[2:])
	}
	return strings.Trim(value, `"`)
}

func gistAPIError(response *http.Response, action string) error {
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<10))
	if err != nil {
		return fmt.Errorf("%s returned %s", action, response.Status)
	}
	message := strings.TrimSpace(string(body))
	if message == "" {
		return fmt.Errorf("%s returned %s", action, response.Status)
	}
	return fmt.Errorf("%s returned %s: %s", action, response.Status, message)
}

func (g *gistSyncProvider) readGistFile(ctx context.Context, file gistFile) ([]byte, error) {
	if !file.Truncated {
		if len(file.Content) > maxCloudBackupSize {
			return nil, fmt.Errorf("cloud backup exceeds %d bytes", maxCloudBackupSize)
		}
		return []byte(file.Content), nil
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, file.RawURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+g.token)
	response, err := g.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("fetch GitHub Gist file: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if err := expectHTTPStatus(response, http.StatusOK, "fetch GitHub Gist file"); err != nil {
		return nil, err
	}
	return readCloudBackup(response.Body)
}

func (g *gistSyncProvider) do(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, g.apiBase+path, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("Authorization", "Bearer "+g.token)
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := g.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("GitHub Gist request: %w", err)
	}
	return response, nil
}

func expectHTTPStatus(response *http.Response, expected int, action string) error {
	if response.StatusCode != expected {
		return fmt.Errorf("%s returned %s", action, response.Status)
	}
	return nil
}
