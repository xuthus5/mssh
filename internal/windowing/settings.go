package windowing

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	SettingsWindowName            = "settings"
	OpenSettingsWindowEvent       = "window:open-settings"
	SettingsPreviewCancelledEvent = "settings:preview-cancelled"
	settingsWindowWidth           = 980
	settingsWindowHeight          = 720
)

type windowHandle interface {
	Show()
	Focus()
	Close()
	Center()
	Position() (int, int)
	Size() (int, int)
	GetScreen() (*application.Screen, error)
	SetPosition(x, y int)
	OnClosing(callback func())
}

type windowRegistry interface {
	Get(name string) (windowHandle, bool)
	Create(options application.WebviewWindowOptions) windowHandle
}

type SettingsWindowController struct {
	mu       sync.Mutex
	registry windowRegistry
	main     windowHandle
	emit     func(name string)
}

func NewSettingsWindowController(
	manager *application.WindowManager,
	mainWindow application.Window,
	emit func(string, ...any) bool,
) *SettingsWindowController {
	notify := func(string) {}
	if emit != nil {
		notify = func(name string) { _ = emit(name) }
	}
	return newSettingsWindowController(&wailsWindowRegistry{manager: manager}, wailsWindowHandle{mainWindow}, notify)
}

func newSettingsWindowController(
	registry windowRegistry,
	mainWindow windowHandle,
	emit func(name string),
) *SettingsWindowController {
	if emit == nil {
		emit = func(string) {}
	}
	return &SettingsWindowController{registry: registry, main: mainWindow, emit: emit}
}

func (c *SettingsWindowController) Open() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.registry.Get(SettingsWindowName); ok {
		existing.Show()
		existing.Focus()
		return
	}
	window := c.registry.Create(settingsWindowOptions())
	window.OnClosing(func() { c.emit(SettingsPreviewCancelledEvent) })
	c.position(window)
	window.Show()
	window.Focus()
}

func (c *SettingsWindowController) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if window, ok := c.registry.Get(SettingsWindowName); ok {
		window.Close()
	}
}

func (c *SettingsWindowController) position(window windowHandle) {
	if c.main == nil {
		window.Center()
		return
	}
	screen, err := c.main.GetScreen()
	if err != nil || screen == nil {
		window.Center()
		return
	}
	mainX, mainY := c.main.Position()
	mainWidth, mainHeight := c.main.Size()
	parent := application.Rect{X: mainX, Y: mainY, Width: mainWidth, Height: mainHeight}
	windowSize := application.Rect{Width: settingsWindowWidth, Height: settingsWindowHeight}
	x, y := centeredPosition(parent, windowSize, screen.WorkArea)
	window.SetPosition(x, y)
}

func settingsWindowOptions() application.WebviewWindowOptions {
	return application.WebviewWindowOptions{
		Name:                       SettingsWindowName,
		Title:                      "MSSH 设置",
		URL:                        "/?window=settings",
		Width:                      settingsWindowWidth,
		Height:                     settingsWindowHeight,
		MinWidth:                   820,
		MinHeight:                  600,
		Frameless:                  true,
		Hidden:                     true,
		InitialPosition:            application.WindowCentered,
		BackgroundType:             application.BackgroundTypeSolid,
		BackgroundColour:           application.NewRGB(24, 24, 27),
		DefaultContextMenuDisabled: true,
		Windows:                    application.WindowsWindow{NonClientRegionSupport: true},
		Linux:                      application.LinuxWindow{WebviewGpuPolicy: application.WebviewGpuPolicyNever},
	}
}

func centeredPosition(parent, windowSize, workArea application.Rect) (int, int) {
	x := parent.X + (parent.Width-windowSize.Width)/2
	y := parent.Y + (parent.Height-windowSize.Height)/2
	maxX := workArea.X + max(0, workArea.Width-windowSize.Width)
	maxY := workArea.Y + max(0, workArea.Height-windowSize.Height)
	return min(max(x, workArea.X), maxX), min(max(y, workArea.Y), maxY)
}

type wailsWindowRegistry struct {
	manager *application.WindowManager
}

func (r *wailsWindowRegistry) Get(name string) (windowHandle, bool) {
	window, exists := r.manager.GetByName(name)
	if !exists {
		return nil, false
	}
	return wailsWindowHandle{window}, true
}

func (r *wailsWindowRegistry) Create(options application.WebviewWindowOptions) windowHandle {
	return wailsWindowHandle{r.manager.NewWithOptions(options)}
}

type wailsWindowHandle struct {
	window application.Window
}

func (w wailsWindowHandle) Show() { w.window.Show() }

func (w wailsWindowHandle) Focus() { w.window.Focus() }

func (w wailsWindowHandle) Close() { w.window.Close() }

func (w wailsWindowHandle) Center() { w.window.Center() }

func (w wailsWindowHandle) Position() (int, int) { return w.window.Position() }

func (w wailsWindowHandle) Size() (int, int) { return w.window.Size() }

func (w wailsWindowHandle) GetScreen() (*application.Screen, error) { return w.window.GetScreen() }

func (w wailsWindowHandle) SetPosition(x, y int) { w.window.SetPosition(x, y) }

func (w wailsWindowHandle) OnClosing(callback func()) {
	_ = w.window.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) { callback() })
}
