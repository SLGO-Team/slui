//! WebView2's browser accelerator keys (F5 / Ctrl+R reload, Ctrl+F find, Ctrl+P print, Alt+Left back,
//! F7 caret browsing, F12 / Ctrl+Shift+I DevTools, Ctrl+plus zoom...) turned off for every SLUI window: a
//! desktop window has no page to reload or navigate, and the overlay stands in for CS2's own UI. Editing
//! keys (copy, paste, select all) keep working in text fields. Tauri does not expose wry's creation-time
//! option, so it is set on the live WebView2 settings from `setup`. It applies to the loaded page at once
//! (checked 2026-11-18 with real F5 / Ctrl+R into the home window: no reload; without it F5 reloads), although
//! Microsoft's sample says "after the next navigation".

use tauri::{Runtime, WebviewWindow};

pub fn disable_browser_accelerator_keys<R: Runtime>(window: &WebviewWindow<R>) {
    let label = window.label().to_owned();
    let result = window.with_webview(move |webview| {
        #[cfg(windows)]
        if let Err(error) = set_keys_off(&webview) {
            diag!("{label}: unable to turn off browser accelerator keys: {error}");
        }
        #[cfg(not(windows))]
        let _ = (webview, label);
    });
    if let Err(error) = result {
        diag!("{}: unable to reach the webview: {error}", window.label());
    }
}

#[cfg(windows)]
fn set_keys_off(webview: &tauri::webview::PlatformWebview) -> windows::core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;
    // SAFETY: COM calls on the controller Tauri hands out on the main thread, where WebView2 objects live.
    unsafe {
        let settings = webview.controller().CoreWebView2()?.Settings()?;
        settings.cast::<ICoreWebView2Settings3>()?.SetAreBrowserAcceleratorKeysEnabled(false)
    }
}
