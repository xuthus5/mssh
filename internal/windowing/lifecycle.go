package windowing

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sync/atomic"

	"github.com/xuthus5/mssh/internal/model"
)

const CloseButtonActionSettingKey = "application.close_button_action"

type CloseButtonAction string

const (
	CloseButtonActionTray CloseButtonAction = "tray"
	CloseButtonActionExit CloseButtonAction = "exit"
)

type CloseActionReader interface {
	Get(key string) (*model.Setting, error)
}

type closeCanceller interface {
	Cancel()
}

type ApplicationLifecycleOptions struct {
	Settings      CloseActionReader
	Logger        *slog.Logger
	ShowMain      func()
	HideMain      func()
	FocusMain     func()
	CloseSettings func()
	Quit          func()
}

type ApplicationLifecycleController struct {
	options  ApplicationLifecycleOptions
	quitting atomic.Bool
}

func NewApplicationLifecycleController(options ApplicationLifecycleOptions) *ApplicationLifecycleController {
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	return &ApplicationLifecycleController{options: options}
}

func (c *ApplicationLifecycleController) HandleWindowClosing(event closeCanceller) {
	if c.quitting.Load() {
		return
	}
	action, err := readCloseButtonAction(c.options.Settings)
	if err != nil {
		c.options.Logger.Error("read close button action failed", "error", err)
		action = CloseButtonActionTray
	}
	if action == CloseButtonActionExit {
		c.QuitApplication()
		return
	}
	c.closeSettings()
	c.HideMainWindow()
	event.Cancel()
}

func (c *ApplicationLifecycleController) ShowMainWindow() {
	call(c.options.ShowMain)
	call(c.options.FocusMain)
}

func (c *ApplicationLifecycleController) HideMainWindow() {
	call(c.options.HideMain)
}

func (c *ApplicationLifecycleController) QuitApplication() {
	if !c.quitting.CompareAndSwap(false, true) {
		return
	}
	c.closeSettings()
	call(c.options.Quit)
}

func (c *ApplicationLifecycleController) closeSettings() {
	call(c.options.CloseSettings)
}

func readCloseButtonAction(reader CloseActionReader) (CloseButtonAction, error) {
	if reader == nil {
		return CloseButtonActionTray, nil
	}
	setting, err := reader.Get(CloseButtonActionSettingKey)
	if err != nil {
		return "", fmt.Errorf("get close button action: %w", err)
	}
	if setting == nil {
		return CloseButtonActionTray, nil
	}
	var action CloseButtonAction
	if err := json.Unmarshal([]byte(setting.Value), &action); err != nil {
		return "", fmt.Errorf("parse close button action: %w", err)
	}
	if action != CloseButtonActionTray && action != CloseButtonActionExit {
		return "", fmt.Errorf("invalid close button action %q", action)
	}
	return action, nil
}

func call(callback func()) {
	if callback != nil {
		callback()
	}
}
