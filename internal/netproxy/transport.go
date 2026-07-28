package netproxy

import (
	"fmt"
	"net/http"
)

func transportForConfig(config Config) *http.Transport {
	var transport *http.Transport
	if defaultTransport, ok := http.DefaultTransport.(*http.Transport); ok {
		transport = defaultTransport.Clone()
	} else {
		transport = &http.Transport{}
	}
	config = Normalize(config)
	transport.Proxy = proxyFuncForConfig(config)
	transport.DialContext = configuredDialer{config: config}.DialContext
	return transport
}

func (m *Manager) currentTransport() *http.Transport {
	m.mu.RLock()
	transport := m.transport
	m.mu.RUnlock()
	if transport != nil {
		return transport
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.transport == nil {
		m.config = Normalize(m.config)
		m.transport = transportForConfig(m.config)
	}
	return m.transport
}

// RoundTrip dispatches each request through the transport generation active when the request starts.
func (m *Manager) RoundTrip(request *http.Request) (*http.Response, error) {
	if m == nil {
		return nil, fmt.Errorf("proxy manager is required")
	}
	if request == nil {
		return nil, fmt.Errorf("HTTP request is required")
	}
	return m.currentTransport().RoundTrip(request)
}

// CloseIdleConnections closes pooled HTTP connections owned by the active transport generation.
func (m *Manager) CloseIdleConnections() {
	if m == nil {
		return
	}
	m.currentTransport().CloseIdleConnections()
}
