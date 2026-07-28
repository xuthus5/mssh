package app

import (
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/service"
)

func defaultProxyManager(manager *netproxy.Manager) *netproxy.Manager {
	if manager != nil {
		return manager
	}
	return netproxy.New()
}

func newSettingService(input serviceInitialization, runtime *service.CryptoRuntime) *service.SettingService {
	return service.NewSettingService(input.db, input.logger, service.SettingServiceOptions{
		Log:    input.opts.LogManager,
		Proxy:  input.opts.ProxyManager,
		Crypto: runtime,
	})
}
