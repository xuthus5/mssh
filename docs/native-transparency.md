# Native Window Transparency

MSSH uses Wails window options for native transparency. The setting is stored as `appearance.native_transparency` and takes effect after restarting the application.

On Windows, the startup check requires:

- Windows 11 build 22621 or newer
- DWM composition enabled
- Windows "Transparency effects" enabled

When all checks pass, Wails creates the main window with `BackgroundTypeTranslucent` and the Acrylic backdrop. The WebView background is made transparent only for that active main window so the native backdrop can be displayed. The settings window remains opaque.

WebView2 does not support arbitrary alpha values for `DefaultBackgroundColor`; only `0` and `255` are valid. Therefore MSSH no longer exposes a percentage opacity slider. Unsupported environments fall back to a solid window and the settings page displays the detected reason.
