//go:build windows

package windowing

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	dwmAPI                    = windows.NewLazySystemDLL("dwmapi.dll")
	dwmIsCompositionEnabledFn = dwmAPI.NewProc("DwmIsCompositionEnabled")
)

func detectNativeTransparencySupport() NativeTransparencySupport {
	version := windows.RtlGetVersion()
	compositionEnabled, err := dwmCompositionEnabled()
	if err != nil {
		return NativeTransparencySupport{Platform: "windows", Reason: "无法检测 DWM 合成状态: " + err.Error()}
	}
	effectsEnabled, err := windowsTransparencyEffectsEnabled()
	if err != nil {
		return NativeTransparencySupport{Platform: "windows", Reason: "无法检测 Windows 透明效果设置: " + err.Error()}
	}
	return evaluateWindowsTransparencySupport(version.BuildNumber, compositionEnabled, effectsEnabled)
}

func dwmCompositionEnabled() (bool, error) {
	if err := dwmIsCompositionEnabledFn.Find(); err != nil {
		return false, fmt.Errorf("load DwmIsCompositionEnabled: %w", err)
	}
	var enabled int32
	result, _, _ := dwmIsCompositionEnabledFn.Call(uintptr(unsafe.Pointer(&enabled)))
	if result != 0 {
		return false, fmt.Errorf("DwmIsCompositionEnabled returned HRESULT 0x%x", result)
	}
	return enabled != 0, nil
}

func windowsTransparencyEffectsEnabled() (bool, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE)
	if err != nil {
		return false, fmt.Errorf("open personalization settings: %w", err)
	}
	defer func() { _ = key.Close() }()
	value, _, err := key.GetIntegerValue("EnableTransparency")
	if err != nil {
		return false, fmt.Errorf("read EnableTransparency: %w", err)
	}
	return value != 0, nil
}
