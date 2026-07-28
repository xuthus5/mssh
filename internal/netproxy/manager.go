package netproxy

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Mode controls how application HTTP traffic selects a proxy.
type Mode string

const (
	ModeSystem Mode = "system"
	ModeDirect Mode = "direct"
	ModeManual Mode = "manual"
)

// Config is the persisted application network proxy configuration.
type Config struct {
	Mode     Mode   `json:"mode"`
	URL      string `json:"url"`
	NoProxy  string `json:"no_proxy"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// Manager applies a shared proxy configuration to HTTP clients.
type Manager struct {
	mu        sync.RWMutex
	config    Config
	transport *http.Transport
}

// New returns a manager with system proxy defaults.
func New() *Manager {
	manager := &Manager{config: DefaultConfig()}
	manager.transport = transportForConfig(manager.config)
	return manager
}

// DefaultConfig returns system proxy mode with empty manual fields.
func DefaultConfig() Config {
	return Config{Mode: ModeSystem}
}

// Normalize returns a sanitized config with a known mode.
func Normalize(config Config) Config {
	config.Mode = NormalizeMode(config.Mode)
	config.URL = strings.TrimSpace(config.URL)
	config.NoProxy = strings.TrimSpace(config.NoProxy)
	config.Username = strings.TrimSpace(config.Username)
	// Password is opaque credential data; preserve it exactly.
	return config
}

// NormalizeMode maps unknown values to system.
func NormalizeMode(mode Mode) Mode {
	switch Mode(strings.ToLower(strings.TrimSpace(string(mode)))) {
	case ModeDirect:
		return ModeDirect
	case ModeManual:
		return ModeManual
	default:
		return ModeSystem
	}
}

// Validate checks manual proxy URL requirements.
func Validate(config Config) error {
	config = Normalize(config)
	if config.Mode != ModeManual {
		return nil
	}
	if config.URL == "" {
		return fmt.Errorf("proxy URL is required in manual mode")
	}
	parsed, err := url.Parse(config.URL)
	if err != nil {
		return fmt.Errorf("invalid proxy URL: %w", err)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" && scheme != "socks5" && scheme != "socks5h" {
		return fmt.Errorf("unsupported proxy scheme %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return fmt.Errorf("proxy URL host is required")
	}
	// Credentials belong in Username/Password fields, not the proxy URL.
	if parsed.User != nil {
		return fmt.Errorf("proxy URL must not include credentials; use username/password fields")
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return fmt.Errorf("proxy URL host is required")
	}
	if isBlockedProxyHost(host) {
		return fmt.Errorf("proxy URL host is not allowed")
	}
	return nil
}

func isBlockedProxyHost(host string) bool {
	normalized := normalizeHost(strings.Trim(strings.ToLower(strings.TrimSpace(host)), "[]"))
	switch normalized {
	case "metadata", "metadata.google.internal", "metadata.goog":
		return true
	}
	ip := net.ParseIP(normalized)
	if ip == nil {
		return false
	}
	return isBlockedProxyIP(ip)
}

// Configure replaces the active proxy configuration.
func (m *Manager) Configure(config Config) error {
	if m == nil {
		return nil
	}
	config = Normalize(config)
	if err := Validate(config); err != nil {
		return err
	}
	nextTransport := transportForConfig(config)
	m.mu.Lock()
	if m.transport != nil && m.config == config {
		m.mu.Unlock()
		nextTransport.CloseIdleConnections()
		return nil
	}
	previousTransport := m.transport
	m.config = config
	m.transport = nextTransport
	m.mu.Unlock()
	if previousTransport != nil {
		previousTransport.CloseIdleConnections()
	}
	return nil
}

// Config returns a copy of the active configuration (password redacted optional? keep full for runtime).
func (m *Manager) Config() Config {
	if m == nil {
		return DefaultConfig()
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.config
}

// Client returns an HTTP client with the current proxy settings and timeout.
func (m *Manager) Client(timeout time.Duration) *http.Client {
	if m == nil {
		return &http.Client{Timeout: timeout, Transport: transportForConfig(DefaultConfig())}
	}
	_ = m.currentTransport()
	return &http.Client{Timeout: timeout, Transport: m}
}

// Transport builds a fresh transport bound to the current proxy config.
func (m *Manager) Transport() *http.Transport {
	return transportForConfig(m.Config())
}

func (m *Manager) proxyFunc() func(*http.Request) (*url.URL, error) {
	return proxyFuncForConfig(m.Config())
}

func proxyFuncForConfig(config Config) func(*http.Request) (*url.URL, error) {
	config = Normalize(config)
	return func(req *http.Request) (*url.URL, error) {
		if req == nil || req.URL == nil {
			return nil, fmt.Errorf("proxy request URL is required")
		}
		switch config.Mode {
		case ModeDirect:
			return nil, nil
		case ModeManual:
			if shouldBypass(req.URL, config.NoProxy) {
				return nil, nil
			}
			proxyURL, err := manualProxyURL(config)
			if err != nil {
				return nil, err
			}
			if isSOCKSScheme(proxyURL.Scheme) {
				return nil, nil
			}
			return proxyURL, nil
		default:
			return http.ProxyFromEnvironment(req)
		}
	}
}

func manualProxyURL(config Config) (*url.URL, error) {
	parsed, err := url.Parse(config.URL)
	if err != nil {
		return nil, err
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	if config.Username != "" || config.Password != "" {
		if config.Password != "" {
			parsed.User = url.UserPassword(config.Username, config.Password)
		} else {
			parsed.User = url.User(config.Username)
		}
	}
	return parsed, nil
}

func shouldBypass(target *url.URL, noProxy string) bool {
	if target == nil || strings.TrimSpace(noProxy) == "" {
		return false
	}
	host := strings.ToLower(target.Hostname())
	if host == "" {
		return false
	}
	for _, rule := range strings.Split(noProxy, ",") {
		if matchNoProxyRule(host, strings.TrimSpace(strings.ToLower(rule))) {
			return true
		}
	}
	return false
}

func matchNoProxyRule(host, rule string) bool {
	if rule == "" {
		return false
	}
	if rule == "*" {
		return true
	}
	if strings.HasPrefix(rule, ".") {
		return strings.HasSuffix(host, rule) || host == strings.TrimPrefix(rule, ".")
	}
	return host == rule || strings.HasSuffix(host, "."+rule)
}
