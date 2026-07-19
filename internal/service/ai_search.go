package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

var (
	braveSearchEndpoint  = "https://api.search.brave.com/res/v1/web/search"
	tavilySearchEndpoint = "https://api.tavily.com/search"
	serperSearchEndpoint = "https://google.serper.dev/search"
)

func searchAI(ctx context.Context, client *http.Client, settings model.AISearchSettings, apiKey, query string) ([]model.AICitation, error) {
	if !settings.Enabled || settings.Mode == model.AISearchDisabled || apiKey == "" || strings.TrimSpace(query) == "" {
		return []model.AICitation{}, nil
	}
	limit := settings.MaxResults
	if limit < 1 || limit > 20 {
		limit = 5
	}
	ctx, cancel := context.WithTimeout(ctx, timeDuration(settings.TimeoutSeconds))
	defer cancel()
	switch settings.Provider {
	case model.AISearchProviderBrave:
		return searchBrave(ctx, client, apiKey, query, limit)
	case model.AISearchProviderTavily:
		return searchTavily(ctx, client, apiKey, query, limit)
	case model.AISearchProviderSerper:
		return searchSerper(ctx, client, apiKey, query, limit)
	default:
		return nil, fmt.Errorf("unsupported AI search provider %s", settings.Provider)
	}
}

func timeDuration(seconds int) time.Duration {
	if seconds < 1 || seconds > 60 {
		seconds = 10
	}
	return time.Duration(seconds) * time.Second
}

func searchBrave(ctx context.Context, client *http.Client, apiKey, query string, limit int) ([]model.AICitation, error) {
	requestURL := braveSearchEndpoint + "?q=" + url.QueryEscape(query) + fmt.Sprintf("&count=%d", limit)
	var response struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
			} `json:"results"`
		} `json:"web"`
	}
	if err := getJSON(ctx, client, requestURL, map[string]string{"X-Subscription-Token": apiKey, "Accept": "application/json"}, &response); err != nil {
		return nil, err
	}
	result := make([]model.AICitation, 0, len(response.Web.Results))
	for _, item := range response.Web.Results {
		result = append(result, model.AICitation{Title: item.Title, URL: item.URL, Snippet: item.Description})
	}
	return result, nil
}

func searchTavily(ctx context.Context, client *http.Client, apiKey, query string, limit int) ([]model.AICitation, error) {
	var response struct {
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"results"`
	}
	payload := map[string]any{"api_key": apiKey, "query": query, "max_results": limit, "search_depth": "basic"}
	if err := postJSON(ctx, client, tavilySearchEndpoint, "", "", payload, &response); err != nil {
		return nil, err
	}
	result := make([]model.AICitation, 0, len(response.Results))
	for _, item := range response.Results {
		result = append(result, model.AICitation{Title: item.Title, URL: item.URL, Snippet: item.Content})
	}
	return result, nil
}

func searchSerper(ctx context.Context, client *http.Client, apiKey, query string, limit int) ([]model.AICitation, error) {
	var response struct {
		Organic []struct {
			Title   string `json:"title"`
			Link    string `json:"link"`
			Snippet string `json:"snippet"`
		} `json:"organic"`
	}
	payload := map[string]any{"q": query, "num": limit}
	if err := postSearchJSON(ctx, client, serperSearchEndpoint, map[string]string{"X-API-KEY": apiKey}, payload, &response); err != nil {
		return nil, err
	}
	result := make([]model.AICitation, 0, len(response.Organic))
	for _, item := range response.Organic {
		result = append(result, model.AICitation{Title: item.Title, URL: item.Link, Snippet: item.Snippet})
	}
	return result, nil
}

func postSearchJSON(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, payload, output any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode search request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create search request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	return executeSearchRequest(client, request, output)
}

func getJSON(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, output any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create search request: %w", err)
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	return executeSearchRequest(client, request, output)
}

func executeSearchRequest(client *http.Client, request *http.Request, output any) error {
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("search request failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("search provider returned HTTP %d", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2*1024*1024)).Decode(output); err != nil {
		return fmt.Errorf("decode search response: %w", err)
	}
	return nil
}
