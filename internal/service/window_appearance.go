package service

import (
	"encoding/json"
	"log/slog"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/windowing"
)

const nativeTransparencySettingKey = "appearance.native_transparency"

type WindowAppearanceService struct {
	status model.NativeTransparencyStatus
}

func NewWindowAppearanceService(settings *SettingService, logger *slog.Logger) *WindowAppearanceService {
	support := windowing.DetectNativeTransparencySupport()
	requested := readNativeTransparencySetting(settings, logger)
	return &WindowAppearanceService{status: model.NativeTransparencyStatus{
		Supported: support.Supported, Active: requested && support.Supported,
		Platform: support.Platform, Reason: support.Reason, RequiresRestart: true,
	}}
}

func (s *WindowAppearanceService) GetStatus() model.NativeTransparencyStatus {
	return s.status
}

func (s *WindowAppearanceService) NativeTransparencyActive() bool {
	return s.status.Active
}

func readNativeTransparencySetting(settings *SettingService, logger *slog.Logger) bool {
	if settings == nil {
		return false
	}
	setting, err := settings.Get(nativeTransparencySettingKey)
	if err != nil {
		if logger != nil {
			logger.Warn("load native transparency setting failed", "error", err)
		}
		return false
	}
	if setting == nil {
		return false
	}
	var enabled bool
	if err := json.Unmarshal([]byte(setting.Value), &enabled); err != nil {
		if logger != nil {
			logger.Warn("parse native transparency setting failed", "error", err)
		}
		return false
	}
	return enabled
}
