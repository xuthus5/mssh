package event

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func BenchmarkWailsEventBusEmit1KiB(b *testing.B) {
	app := application.New(application.Options{Name: "mssh-event-benchmark"})
	b.Cleanup(app.Quit)
	bus := NewWailsEventBus(nil)
	payload := TerminalOutputPayload{TerminalID: "benchmark", Data: make([]byte, 1024)}

	b.ReportAllocs()
	for b.Loop() {
		bus.Emit(TerminalOutput, payload)
	}
}
