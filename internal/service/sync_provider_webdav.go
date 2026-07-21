package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type webDAVSyncProvider struct {
	client   *http.Client
	baseURL  string
	fileURL  string
	username string
	password string
}

func newWebDAVSyncProvider(client *http.Client, endpoint, username, password string) (*webDAVSyncProvider, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(endpoint))
	if err != nil {
		return nil, errors.New("WebDAV URL is invalid")
	}
	if err := requireHTTPSUnlessLoopback(parsed); err != nil {
		return nil, err
	}
	fileURL, err := url.JoinPath(parsed.String(), syncBackupFileName)
	if err != nil {
		return nil, fmt.Errorf("build WebDAV backup URL: %w", err)
	}
	return &webDAVSyncProvider{client: client, baseURL: parsed.String(), fileURL: fileURL, username: username, password: password}, nil
}

func (w *webDAVSyncProvider) Test(ctx context.Context) error {
	request, err := w.request(ctx, "PROPFIND", w.baseURL, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Depth", "0")
	response, err := w.client.Do(request)
	if err != nil {
		return fmt.Errorf("WebDAV connection: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusMultiStatus {
		return fmt.Errorf("WebDAV connection returned %s", response.Status)
	}
	return nil
}

func (w *webDAVSyncProvider) Fetch(ctx context.Context) (syncRemoteObject, error) {
	request, err := w.request(ctx, http.MethodGet, w.fileURL, nil)
	if err != nil {
		return syncRemoteObject{}, err
	}
	response, err := w.client.Do(request)
	if err != nil {
		return syncRemoteObject{}, fmt.Errorf("WebDAV download: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return syncRemoteObject{}, errSyncRemoteNotFound
	}
	if err := expectHTTPStatus(response, http.StatusOK, "WebDAV download"); err != nil {
		return syncRemoteObject{}, err
	}
	content, err := readCloudBackup(response.Body)
	if err != nil {
		return syncRemoteObject{}, err
	}
	return syncRemoteObject{Content: content, ETag: response.Header.Get("ETag")}, nil
}

func (w *webDAVSyncProvider) Put(ctx context.Context, content []byte, etag string) (syncRemoteObject, error) {
	request, err := w.request(ctx, http.MethodPut, w.fileURL, bytes.NewReader(content))
	if err != nil {
		return syncRemoteObject{}, err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	if etag == "" {
		request.Header.Set("If-None-Match", "*")
	} else {
		request.Header.Set("If-Match", etag)
	}
	response, err := w.client.Do(request)
	if err != nil {
		return syncRemoteObject{}, fmt.Errorf("WebDAV upload: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusPreconditionFailed || response.StatusCode == http.StatusConflict {
		return syncRemoteObject{}, errSyncConflict
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return syncRemoteObject{}, fmt.Errorf("WebDAV upload returned %s", response.Status)
	}
	return syncRemoteObject{Content: content, ETag: response.Header.Get("ETag")}, nil
}

func (w *webDAVSyncProvider) request(ctx context.Context, method, endpoint string, body io.Reader) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	if w.username != "" {
		request.SetBasicAuth(w.username, w.password)
	}
	return request, nil
}
