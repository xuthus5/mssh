package windowing

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestEvaluateWindowsTransparencySupport(t *testing.T) {
	tests := []struct {
		name        string
		build       uint32
		composition bool
		effects     bool
		supported   bool
		reason      string
	}{
		{name: "supported", build: 22621, composition: true, effects: true, supported: true, reason: "Acrylic"},
		{name: "old build", build: 22000, composition: true, effects: true, reason: "22621"},
		{name: "composition disabled", build: 22621, effects: true, reason: "DWM"},
		{name: "effects disabled", build: 22621, composition: true, reason: "透明效果"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			status := evaluateWindowsTransparencySupport(test.build, test.composition, test.effects)
			assert.Equal(t, test.supported, status.Supported)
			assert.Equal(t, "windows", status.Platform)
			assert.Contains(t, status.Reason, test.reason)
		})
	}
}
