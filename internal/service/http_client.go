package service

import (
	"net/http"
	"time"

	"github.com/xuthus5/mssh/internal/netproxy"
)

// sharedHTTPClient builds an HTTP client. When manager is nil, system proxy is used via DefaultTransport.
func sharedHTTPClient(timeout time.Duration, manager *netproxy.Manager) *http.Client {
	if manager == nil {
		return &http.Client{Timeout: timeout}
	}
	return manager.Client(timeout)
}

func firstProxy(proxy ...*netproxy.Manager) *netproxy.Manager {
	if len(proxy) == 0 {
		return nil
	}
	return proxy[0]
}
