package event

import (
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type WailsEventBus struct {
	logger *slog.Logger
}

func NewWailsEventBus(logger *slog.Logger) *WailsEventBus {
	return &WailsEventBus{logger: logger}
}

func (w *WailsEventBus) Emit(name string, payload interface{}) {
	app := application.Get()
	if app == nil {
		if w.logger != nil {
			w.logger.Warn("event dropped — no Wails application", "event", name)
		}
		return
	}
	w.logger.Info("emitting event", "name", name)
	app.Event.Emit(name, payload)
}
