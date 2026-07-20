//go:build !windows

package windowing

import "runtime"

func detectNativeTransparencySupport() NativeTransparencySupport {
	if runtime.GOOS == "darwin" {
		return NativeTransparencySupport{Supported: true, Platform: "mac", Reason: "支持 Wails macOS 原生半透明背景"}
	}
	return NativeTransparencySupport{Platform: runtime.GOOS, Reason: "当前平台未提供可靠的 Wails 原生透明窗口合成"}
}
