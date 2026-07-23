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
	mu     sync.RWMutex
	config Config
}

// New returns a manager with system proxy defaults.
func New() *Manager {
	return &Manager{config: DefaultConfig()}
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
	// password may intentionally contain spaces; only strip ends
	config.Password = strings.TrimSpace(config.Password)
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
	normalized := strings.Trim(strings.ToLower(strings.TrimSpace(host)), "[]")
	switch normalized {
	case "metadata", "metadata.google.internal", "metadata.goog":
		return true
	}
	ip := net.ParseIP(normalized)
	if ip == nil {
		return false
	}
	if ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil && ip4[0] == 169 && ip4[1] == 254 {
		return true
	}
	return false
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
	m.mu.Lock()
	m.config = config
	m.mu.Unlock()
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
	return &http.Client{Timeout: timeout, Transport: m.Transport()}
}

// Transport builds a fresh transport bound to the current proxy config.
func (m *Manager) Transport() *http.Transport {
	base := http.DefaultTransport
	transport, ok := base.(*http.Transport)
	if ok {
		transport = transport.Clone()
	} else {
		transport = &http.Transport{}
	}
	transport.Proxy = m.proxyFunc()
	return transport
}

func (m *Manager) proxyFunc() func(*http.Request) (*url.URL, error) {
	return func(req *http.Request) (*url.URL, error) {
		if m == nil {
			return http.ProxyFromEnvironment(req)
		}
		m.mu.RLock()
		config := m.config
		m.mu.RUnlock()
		switch config.Mode {
		case ModeDirect:
			return nil, nil
		case ModeManual:
			if shouldBypass(req.URL, config.NoProxy) {
				return nil, nil
			}
			return manualProxyURL(config)
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
