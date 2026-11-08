package service

import (
	"context"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

// UpdateReadyEvent is emitted after an update has been downloaded and staged.
const UpdateReadyEvent = "mssh:update-ready"

type autoUpdateSettingSource interface {
	AutoUpdateEnabled() (bool, error)
}

// StartAutoUpdate starts the hourly background update worker. It is safe to
// call more than once.
//
//wails:ignore
func (a *AboutService) StartAutoUpdate() {
	if a == nil {
		return
	}
	a.autoUpdateOnce.Do(func() {
		a.lifecycle.initialize()
		a.lifecycle.workers.Add(1)
		go a.autoUpdateLoop(a.lifecycle.ctx)
	})
}

// RequestAutoUpdateCheck asks the background worker to re-evaluate the setting
// immediately. It is used when the user enables automatic updates.
func (a *AboutService) RequestAutoUpdateCheck() {
	if a == nil || a.autoUpdateWake == nil {
		return
	}
	select {
	case a.autoUpdateWake <- struct{}{}:
	default:
	}
}

func (a *AboutService) autoUpdateLoop(ctx context.Context) {
	defer a.lifecycle.workers.Done()
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		case <-a.autoUpdateWake:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
		}
		a.runAutoUpdate(ctx)
		timer.Reset(a.autoUpdateEvery)
	}
}

func (a *AboutService) runAutoUpdate(ctx context.Context) {
	if a.autoUpdateSource == nil {
		a.logAutoUpdateError("automatic update setting source is not configured", nil)
		return
	}
	enabled, err := a.autoUpdateSource.AutoUpdateEnabled()
	if err != nil {
		a.logAutoUpdateError("read automatic update setting failed", err)
		return
	}
	if !enabled {
		return
	}
	if a.ReadyUpdate() != nil {
		return
	}
	if a.updater == nil {
		a.logAutoUpdateError("updater is not configured", nil)
		return
	}
	operationContext, finish, err := a.beginOperation(ctx)
	if err != nil {
		return
	}
	defer finish()
	if a.ReadyUpdate() != nil {
		return
	}
	release, err := a.updater.Check(operationContext)
	if err != nil {
		a.logAutoUpdateError("check for automatic update failed", err)
		return
	}
	if release == nil {
		return
	}
	if err := a.updater.DownloadAndInstall(operationContext); err != nil {
		a.logAutoUpdateError("download automatic update failed", err)
		return
	}
	info := updateInfoFromRelease(release)
	a.setReadyUpdate(info)
	a.notifyUpdateReady(info)
}

func (a *AboutService) logAutoUpdateError(message string, err error) {
	if a.logger == nil {
		return
	}
	if err == nil {
		a.logger.Warn(message)
		return
	}
	a.logger.Warn(message, "error", err)
}

func (a *AboutService) notifyUpdateReady(info model.UpdateInfo) {
	a.readyMu.Lock()
	handler := a.readyHandler
	a.readyMu.Unlock()
	if handler != nil {
		handler(info)
	}
}

// SetUpdateReadyHandler installs the callback used to notify the UI after an
// update has been staged.
//
//wails:ignore
func (a *AboutService) SetUpdateReadyHandler(handler func(model.UpdateInfo)) {
	if a == nil {
		return
	}
	a.readyMu.Lock()
	a.readyHandler = handler
	a.readyMu.Unlock()
}
