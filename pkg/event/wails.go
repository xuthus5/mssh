package event

import "github.com/wailsapp/wails/v3/pkg/application"

type WailsEventBus struct{}

func NewWailsEventBus() *WailsEventBus {
	return &WailsEventBus{}
}

func (w *WailsEventBus) Emit(name string, payload interface{}) {
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit(name, payload)
}
