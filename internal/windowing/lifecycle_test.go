package windowing

import (
	"errors"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

type fakeCloseEvent struct {
	cancelled bool
}

func (e *fakeCloseEvent) Cancel() { e.cancelled = true }

type fakeSettingReader struct {
	setting *model.Setting
	err     error
}

func (r fakeSettingReader) Get(string) (*model.Setting, error) { return r.setting, r.err }

type lifecycleCounters struct {
	show, hide, focus, closeSettings, quit int
}

func newLifecycleController(reader CloseActionReader, counters *lifecycleCounters) *ApplicationLifecycleController {
	return NewApplicationLifecycleController(ApplicationLifecycleOptions{
		Settings:      reader,
		Logger:        slog.Default(),
		ShowMain:      func() { counters.show++ },
		HideMain:      func() { counters.hide++ },
		FocusMain:     func() { counters.focus++ },
		CloseSettings: func() { counters.closeSettings++ },
		Quit:          func() { counters.quit++ },
	})
}

func TestApplicationLifecycleDefaultsCloseToTray(t *testing.T) {
	counters := &lifecycleCounters{}
	controller := newLifecycleController(fakeSettingReader{}, counters)
	event := &fakeCloseEvent{}

	controller.HandleWindowClosing(event)

	assert.True(t, event.cancelled)
	assert.Equal(t, 1, counters.hide)
	assert.Equal(t, 1, counters.closeSettings)
	assert.Zero(t, counters.quit)
}

func TestApplicationLifecycleHonoursExitCloseAction(t *testing.T) {
	counters := &lifecycleCounters{}
	reader := fakeSettingReader{setting: closeActionSetting(CloseButtonActionExit)}
	controller := newLifecycleController(reader, counters)
	event := &fakeCloseEvent{}

	controller.HandleWindowClosing(event)

	assert.False(t, event.cancelled)
	assert.Equal(t, 1, counters.closeSettings)
	assert.Equal(t, 1, counters.quit)
	assert.Zero(t, counters.hide)
}

func TestApplicationLifecycleTrayActions(t *testing.T) {
	counters := &lifecycleCounters{}
	controller := newLifecycleController(fakeSettingReader{}, counters)

	controller.ShowMainWindow()
	controller.HideMainWindow()
	controller.QuitApplication()
	controller.QuitApplication()

	assert.Equal(t, 1, counters.show)
	assert.Equal(t, 1, counters.focus)
	assert.Equal(t, 1, counters.hide)
	assert.Equal(t, 1, counters.closeSettings)
	assert.Equal(t, 1, counters.quit)
}

func TestApplicationLifecyclePreparesExplicitQuitBeforeQuitting(t *testing.T) {
	counters := &lifecycleCounters{}
	controller := newLifecycleController(fakeSettingReader{}, counters)
	prepared := 0

	controller.QuitApplicationAfter(func() { prepared++ })
	controller.QuitApplicationAfter(func() { prepared++ })

	assert.Equal(t, 1, prepared)
	assert.Equal(t, 1, counters.closeSettings)
	assert.Equal(t, 1, counters.quit)
}

func TestApplicationLifecycleExplicitQuitBypassesCloseInterception(t *testing.T) {
	counters := &lifecycleCounters{}
	controller := newLifecycleController(fakeSettingReader{}, counters)
	controller.QuitApplication()
	event := &fakeCloseEvent{}

	controller.HandleWindowClosing(event)

	assert.False(t, event.cancelled)
	assert.Zero(t, counters.hide)
}

func TestApplicationLifecycleFallsBackToTrayOnInvalidSetting(t *testing.T) {
	tests := []fakeSettingReader{
		{err: errors.New("database unavailable")},
		{setting: &model.Setting{Value: `"invalid"`}},
		{setting: &model.Setting{Value: `{`}},
	}
	for _, reader := range tests {
		counters := &lifecycleCounters{}
		controller := newLifecycleController(reader, counters)
		event := &fakeCloseEvent{}

		controller.HandleWindowClosing(event)

		assert.True(t, event.cancelled)
		assert.Equal(t, 1, counters.hide)
		assert.Zero(t, counters.quit)
	}
}

func TestReadCloseButtonAction(t *testing.T) {
	action, err := readCloseButtonAction(fakeSettingReader{setting: closeActionSetting(CloseButtonActionTray)})
	require.NoError(t, err)
	assert.Equal(t, CloseButtonActionTray, action)
}

func closeActionSetting(action CloseButtonAction) *model.Setting {
	return &model.Setting{Key: CloseButtonActionSettingKey, Namespace: "application", Value: `"` + string(action) + `"`, ValueType: "string", Version: 1}
}
