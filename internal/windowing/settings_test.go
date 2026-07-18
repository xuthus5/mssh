package windowing

import (
	"errors"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type fakeWindow struct {
	showCount   int
	focusCount  int
	hideCount   int
	closeCount  int
	centerCount int
	positionX   int
	positionY   int
	width       int
	height      int
	screen      *application.Screen
	screenErr   error
	closing     []func() bool
}

func (w *fakeWindow) Show() { w.showCount++ }

func (w *fakeWindow) Focus() { w.focusCount++ }

func (w *fakeWindow) Hide() { w.hideCount++ }

func (w *fakeWindow) Close() {
	w.closeCount++
	w.emitClosing()
}

func (w *fakeWindow) Center() { w.centerCount++ }

func (w *fakeWindow) Position() (int, int) { return w.positionX, w.positionY }

func (w *fakeWindow) Size() (int, int) { return w.width, w.height }

func (w *fakeWindow) GetScreen() (*application.Screen, error) { return w.screen, w.screenErr }

func (w *fakeWindow) SetPosition(x, y int) { w.positionX, w.positionY = x, y }

func (w *fakeWindow) OnClosing(callback func() bool) { w.closing = append(w.closing, callback) }

func (w *fakeWindow) emitClosing() bool {
	for _, callback := range w.closing {
		if callback() {
			return true
		}
	}
	return false
}

type fakeRegistry struct {
	windows map[string]*fakeWindow
	created int
	options []application.WebviewWindowOptions
}

func newFakeRegistry() *fakeRegistry {
	return &fakeRegistry{windows: make(map[string]*fakeWindow)}
}

func (r *fakeRegistry) Get(name string) (windowHandle, bool) {
	window, exists := r.windows[name]
	return window, exists
}

func (r *fakeRegistry) Create(options application.WebviewWindowOptions) windowHandle {
	r.created++
	r.options = append(r.options, options)
	window := &fakeWindow{width: options.Width, height: options.Height}
	r.windows[options.Name] = window
	return window
}

func TestSettingsWindowOptions(t *testing.T) {
	options := settingsWindowOptions()

	assert.Equal(t, SettingsWindowName, options.Name)
	assert.Equal(t, "MSSH 设置", options.Title)
	assert.Equal(t, "/?window=settings", options.URL)
	assert.Equal(t, 980, options.Width)
	assert.Equal(t, 720, options.Height)
	assert.Equal(t, 820, options.MinWidth)
	assert.Equal(t, 600, options.MinHeight)
	assert.True(t, options.Frameless)
	assert.True(t, options.Hidden)
	assert.True(t, options.Windows.NonClientRegionSupport)
	assert.False(t, options.Windows.WebView2CompositionHosting)
	assert.Equal(t, application.BackgroundTypeSolid, options.BackgroundType)
	assert.Equal(t, application.WebviewGpuPolicyNever, options.Linux.WebviewGpuPolicy)
}

func TestSettingsWindowControllerPreloadsAndReusesWindow(t *testing.T) {
	registry := newFakeRegistry()
	mainWindow := &fakeWindow{positionX: 200, positionY: 100, width: 1200, height: 800, screen: testScreen()}
	controller := newSettingsWindowController(registry, mainWindow, nil)

	controller.Preload()
	created := registry.windows[SettingsWindowName]
	require.NotNil(t, created)
	assert.Equal(t, 1, registry.created)
	assert.Zero(t, created.showCount)
	assert.Zero(t, created.focusCount)

	controller.Open()
	assert.Equal(t, 1, registry.created)
	assert.Equal(t, 310, created.positionX)
	assert.Equal(t, 140, created.positionY)
	assert.Equal(t, 1, created.showCount)
	assert.Equal(t, 1, created.focusCount)

	controller.Open()
	assert.Equal(t, 1, registry.created)
	assert.Equal(t, 2, created.showCount)
	assert.Equal(t, 2, created.focusCount)
}

func TestSettingsWindowControllerSerializesConcurrentOpen(t *testing.T) {
	registry := newFakeRegistry()
	controller := newSettingsWindowController(registry, &fakeWindow{screen: testScreen()}, nil)
	var waitGroup sync.WaitGroup

	for range 32 {
		waitGroup.Go(controller.Open)
	}
	waitGroup.Wait()

	assert.Equal(t, 1, registry.created)
}

func TestSettingsWindowControllerHidesExistingWindow(t *testing.T) {
	registry := newFakeRegistry()
	events := make([]string, 0, 1)
	controller := newSettingsWindowController(registry, &fakeWindow{screen: testScreen()}, func(name string) {
		events = append(events, name)
	})
	controller.Preload()
	window := registry.windows[SettingsWindowName]

	controller.Hide()

	assert.Equal(t, []string{SettingsPreviewCancelledEvent}, events)
	assert.Equal(t, 1, window.hideCount)
	assert.Zero(t, window.closeCount)
}

func TestSettingsWindowControllerInterceptsUserClose(t *testing.T) {
	registry := newFakeRegistry()
	events := make([]string, 0, 1)
	controller := newSettingsWindowController(registry, nil, func(name string) { events = append(events, name) })
	controller.Preload()
	window := registry.windows[SettingsWindowName]

	assert.True(t, window.emitClosing())
	assert.Equal(t, []string{SettingsPreviewCancelledEvent}, events)
	assert.Equal(t, 1, window.hideCount)
	assert.Zero(t, window.closeCount)
}

func TestSettingsWindowControllerAllowsApplicationClose(t *testing.T) {
	registry := newFakeRegistry()
	events := make([]string, 0, 1)
	controller := newSettingsWindowController(registry, nil, func(name string) { events = append(events, name) })
	controller.Preload()
	window := registry.windows[SettingsWindowName]

	controller.Close()

	assert.Empty(t, events)
	assert.Zero(t, window.hideCount)
	assert.Equal(t, 1, window.closeCount)
}

func TestCenteredPositionClampsToWorkArea(t *testing.T) {
	workArea := application.Rect{X: 0, Y: 0, Width: 1920, Height: 1080}
	parent := application.Rect{X: 1500, Y: 800, Width: 500, Height: 300}
	windowSize := application.Rect{Width: 980, Height: 720}
	x, y := centeredPosition(parent, windowSize, workArea)

	assert.Equal(t, 940, x)
	assert.Equal(t, 360, y)
}

func TestSettingsWindowControllerFallsBackToScreenCenter(t *testing.T) {
	registry := newFakeRegistry()
	controller := newSettingsWindowController(registry, &fakeWindow{}, nil)

	controller.Open()

	assert.Equal(t, 1, registry.windows[SettingsWindowName].centerCount)
}

func TestSettingsWindowControllerFallsBackWhenScreenLookupFails(t *testing.T) {
	registry := newFakeRegistry()
	mainWindow := &fakeWindow{screenErr: errors.New("screen unavailable")}
	controller := newSettingsWindowController(registry, mainWindow, nil)

	controller.Open()

	assert.Equal(t, 1, registry.windows[SettingsWindowName].centerCount)
}

func TestWailsWindowAdaptersWithoutRunningGUI(t *testing.T) {
	wailsApp := application.New(application.Options{Name: "windowing-test"})
	mainWindow := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{Name: "main", Hidden: true})
	controller := NewSettingsWindowController(wailsApp.Window, mainWindow, wailsApp.Event.Emit)

	controller.Open()
	controller.Open()
	_, exists := wailsApp.Window.GetByName(SettingsWindowName)
	assert.True(t, exists)
	controller.Close()

	handle := wailsWindowHandle{window: mainWindow}
	handle.Show()
	handle.Focus()
	handle.Hide()
	handle.Close()
	handle.Center()
	_, _ = handle.Position()
	_, _ = handle.Size()
	_, _ = handle.GetScreen()
	handle.SetPosition(10, 20)
	handle.OnClosing(func() bool { return false })
}

func testScreen() *application.Screen {
	return &application.Screen{WorkArea: application.Rect{X: 100, Y: 50, Width: 1600, Height: 900}}
}
