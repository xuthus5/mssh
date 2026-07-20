package windowing

const windowsAcrylicMinimumBuild = 22621

type NativeTransparencySupport struct {
	Supported bool
	Platform  string
	Reason    string
}

func DetectNativeTransparencySupport() NativeTransparencySupport {
	return detectNativeTransparencySupport()
}

func evaluateWindowsTransparencySupport(build uint32, compositionEnabled, effectsEnabled bool) NativeTransparencySupport {
	support := NativeTransparencySupport{Platform: "windows"}
	if build < windowsAcrylicMinimumBuild {
		support.Reason = "需要 Windows 11 22H2（build 22621）或更高版本"
		return support
	}
	if !compositionEnabled {
		support.Reason = "桌面窗口管理器（DWM）合成未启用"
		return support
	}
	if !effectsEnabled {
		support.Reason = "Windows 系统设置中的“透明效果”已关闭"
		return support
	}
	support.Supported = true
	support.Reason = "支持 Wails Acrylic 原生透明背景"
	return support
}
