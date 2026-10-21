//! Native world blur under overlay panels.
//!
//! The overlay is a transparent WebView2 window and cannot read, so cannot blur, the game behind
//! it. Each panel that CS2 draws on a world blur reports its rect (`set_backdrop_regions`), and
//! this module places click-through, never-activated popups with DWM accent blur at those rects,
//! directly under the overlay in z-order. The overlay page then draws the panel's fill on top.
//! Measurements and API findings: task research `dwm-backdrop-blur.md`.
//!
//! The windows belong to the main thread (the tao event loop pumps their messages); every change
//! goes through `refresh`, which runs `apply` there. Without a blur (switched off, Windows
//! transparency effects off, energy saver on, accent API missing) no backdrop shows and the page
//! draws its dense fills instead.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

/// More than any HUD state needs (ten equipment boxes, kill cards, killfeed rows, boxes).
const MAX_REGIONS: usize = 64;
const MAX_LAYERS: u8 = 3;
pub const AVAILABLE_EVENT: &str = "slgo-backdrop-available";

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Corner {
    Square,
    /// DWM's small rounding, about 4 px at 100 % DPI.
    Small,
    /// DWM's default rounding, about 8 px at 100 % DPI.
    Round,
}

/// A panel rect in overlay CSS px, with the panel's effective opacity.
#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub corner: Corner,
    pub alpha: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PhysicalRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Clone, Debug)]
struct State {
    regions: Vec<Region>,
    enabled: bool,
    layers: u8,
    available: bool,
}

static STATE: Mutex<State> = Mutex::new(State {
    regions: Vec::new(),
    enabled: true,
    layers: 1,
    available: false,
});

fn state() -> State {
    STATE.lock().map(|state| state.clone()).unwrap_or(State {
        regions: Vec::new(),
        enabled: false,
        layers: 1,
        available: false,
    })
}

/// Drops unusable regions (non-finite, empty, invisible) and caps the count.
fn sanitize(regions: Vec<Region>) -> Vec<Region> {
    regions
        .into_iter()
        .filter(|region| {
            [region.x, region.y, region.w, region.h, region.alpha]
                .iter()
                .all(|value| value.is_finite())
                && region.w >= 1.0
                && region.h >= 1.0
                && region.alpha > 0.0
        })
        .map(|region| Region {
            alpha: region.alpha.min(1.0),
            ..region
        })
        .take(MAX_REGIONS)
        .collect()
}

fn clamp_layers(layers: u8) -> u8 {
    layers.clamp(1, MAX_LAYERS)
}

/// Overlay CSS px to screen px: the page fills the borderless overlay window, so its origin is
/// the window's origin. Edges are rounded separately so adjacent regions stay adjacent.
pub fn physical_rect(region: &Region, origin: (i32, i32), scale: f64) -> Option<PhysicalRect> {
    let left = (region.x * scale).round();
    let top = (region.y * scale).round();
    let right = ((region.x + region.w) * scale).round();
    let bottom = ((region.y + region.h) * scale).round();
    let (w, h) = (right - left, bottom - top);
    if !(w >= 1.0 && h >= 1.0)
        || [left, top, w, h]
            .iter()
            .any(|value| value.abs() > i32::MAX as f64 / 2.0)
    {
        return None;
    }
    Some(PhysicalRect {
        x: origin.0 + left as i32,
        y: origin.1 + top as i32,
        w: w as i32,
        h: h as i32,
    })
}

pub fn alpha_byte(alpha: f64) -> u8 {
    (alpha.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// Runs `apply` on the main thread, which owns the backdrop windows. Safe from any thread.
pub fn refresh(app: &AppHandle) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || platform::apply(&handle)) {
        eprintln!("SLGO: failed to schedule backdrop update: {error}");
    }
}

#[tauri::command]
pub fn set_backdrop_regions(app: AppHandle, regions: Vec<Region>) {
    let regions = sanitize(regions);
    if let Ok(mut state) = STATE.lock() {
        if state.regions == regions {
            return;
        }
        state.regions = regions;
    }
    refresh(&app);
}

#[tauri::command]
pub fn set_backdrop_options(app: AppHandle, enabled: bool, layers: u8) {
    if let Ok(mut state) = STATE.lock() {
        state.enabled = enabled;
        state.layers = clamp_layers(layers);
    }
    refresh(&app);
}

#[tauri::command]
pub fn get_backdrop_available() -> bool {
    state().available
}

/// Re-reads whether Windows can blur; on a change, tells the page (which switches its fills) and
/// shows or hides the backdrops. Called at startup and from the foreground thread's poll.
pub fn update_availability(app: &AppHandle) {
    let available = platform::blur_available();
    let changed = STATE
        .lock()
        .map(|mut state| std::mem::replace(&mut state.available, available) != available)
        .unwrap_or(false);
    if changed {
        eprintln!(
            "SLGO: world blur {}",
            if available {
                "available"
            } else {
                "unavailable"
            }
        );
        if let Err(error) = app.emit(
            AVAILABLE_EVENT,
            serde_json::json!({ "available": available }),
        ) {
            eprintln!("SLGO: failed to emit backdrop availability: {error}");
        }
        refresh(app);
    }
}

#[cfg(windows)]
mod platform {
    use std::{cell::RefCell, ffi::c_void, sync::OnceLock};

    use tauri::{AppHandle, Manager};
    use windows_sys::{
        core::{s, w},
        Win32::{
            Foundation::{BOOL, HWND, LPARAM, LRESULT, RECT, WPARAM},
            Graphics::{
                Dwm::{
                    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE,
                    DWMWA_WINDOW_CORNER_PREFERENCE,
                },
                Gdi::{
                    BeginPaint, EndPaint, FillRect, GetStockObject, BLACK_BRUSH, HBRUSH,
                    PAINTSTRUCT,
                },
            },
            System::{
                LibraryLoader::{GetModuleHandleW, GetProcAddress},
                Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
                Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
            },
            UI::WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, GetWindowRect, IsWindowVisible, RegisterClassExW,
                SetLayeredWindowAttributes, SetWindowPos, ShowWindow, HTTRANSPARENT, LWA_ALPHA,
                MA_NOACTIVATE, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, WM_ERASEBKGND,
                WM_MOUSEACTIVATE, WM_NCHITTEST, WM_PAINT, WNDCLASSEXW, WS_EX_LAYERED,
                WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
            },
        },
    };

    use super::{alpha_byte, physical_rect, state, Corner};

    // SetWindowCompositionAttribute is undocumented (user32 export since Windows 10); a missing
    // export makes the blur unavailable, and the page keeps its dense fills.
    const WCA_ACCENT_POLICY: u32 = 19;
    const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
    // The configuration the user approved in game (2026-10-21): acrylic, black at 0x40 on the top
    // layer, under the panel's own CSS fill. Lower layers only add blur.
    const TOP_TINT: u32 = 0x4000_0000;
    const DWMWCP_DONOTROUND: u32 = 1;
    const DWMWCP_ROUND: u32 = 2;
    const DWMWCP_ROUNDSMALL: u32 = 3;

    #[repr(C)]
    struct AccentPolicy {
        accent_state: u32,
        accent_flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }

    #[repr(C)]
    struct WindowCompositionAttribData {
        attribute: u32,
        data: *mut c_void,
        size: usize,
    }

    type SetWindowCompositionAttribute =
        unsafe extern "system" fn(HWND, *mut WindowCompositionAttribData) -> BOOL;

    fn swca() -> Option<SetWindowCompositionAttribute> {
        static FUNCTION: OnceLock<Option<usize>> = OnceLock::new();
        let address = *FUNCTION.get_or_init(|| unsafe {
            let user32 = GetModuleHandleW(w!("user32.dll"));
            if user32.is_null() {
                return None;
            }
            GetProcAddress(user32, s!("SetWindowCompositionAttribute"))
                .map(|function| function as usize)
        });
        // SAFETY: the export has this signature on every Windows build that has it.
        address.map(|address| unsafe {
            std::mem::transmute::<usize, SetWindowCompositionAttribute>(address)
        })
    }

    fn set_accent(hwnd: HWND, gradient_color: u32) -> bool {
        let Some(function) = swca() else { return false };
        let mut policy = AccentPolicy {
            accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
            accent_flags: 0,
            gradient_color,
            animation_id: 0,
        };
        let mut data = WindowCompositionAttribData {
            attribute: WCA_ACCENT_POLICY,
            data: &mut policy as *mut AccentPolicy as *mut c_void,
            size: std::mem::size_of::<AccentPolicy>(),
        };
        unsafe { function(hwnd, &mut data) != 0 }
    }

    fn set_dwm_u32(hwnd: HWND, attribute: i32, value: u32) {
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute as _,
                &value as *const u32 as *const c_void,
                4,
            )
        };
    }

    /// Windows "Transparency effects" (missing value: on, the Windows default).
    fn transparency_enabled() -> bool {
        let mut value: u32 = 1;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
                w!("EnableTransparency"),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                &mut value as *mut u32 as *mut c_void,
                &mut size,
            )
        };
        status != 0 || value != 0
    }

    /// Battery saver / energy saver, which turns DWM's blur into a flat tint.
    fn energy_saver_on() -> bool {
        let mut status: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
        unsafe { GetSystemPowerStatus(&mut status) != 0 && status.SystemStatusFlag == 1 }
    }

    pub fn blur_available() -> bool {
        swca().is_some() && transparency_enabled() && !energy_saver_on()
    }

    unsafe extern "system" fn backdrop_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_NCHITTEST => HTTRANSPARENT as LRESULT,
            WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
            WM_ERASEBKGND => 1,
            WM_PAINT => {
                // Black is see-through under the accent, so only the blurred backdrop shows.
                let mut paint: PAINTSTRUCT = std::mem::zeroed();
                let dc = BeginPaint(hwnd, &mut paint);
                FillRect(dc, &paint.rcPaint, GetStockObject(BLACK_BRUSH) as HBRUSH);
                EndPaint(hwnd, &paint);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    const CLASS_NAME: *const u16 = w!("SluiBackdrop");

    fn register_class() -> bool {
        static REGISTERED: OnceLock<bool> = OnceLock::new();
        *REGISTERED.get_or_init(|| unsafe {
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: 0,
                lpfnWndProc: Some(backdrop_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: GetModuleHandleW(std::ptr::null()),
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: GetStockObject(BLACK_BRUSH) as HBRUSH,
                lpszMenuName: std::ptr::null(),
                lpszClassName: CLASS_NAME,
                hIconSm: std::ptr::null_mut(),
            };
            RegisterClassExW(&class) != 0
        })
    }

    /// One pooled backdrop window and the attributes last applied to it.
    struct Backdrop {
        hwnd: HWND,
        corner: Option<Corner>,
        top: Option<bool>,
        alpha: Option<u8>,
        visible: bool,
    }

    impl Backdrop {
        fn create() -> Option<Backdrop> {
            if !register_class() {
                return None;
            }
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_TOOLWINDOW
                        | WS_EX_TOPMOST
                        | WS_EX_NOACTIVATE
                        | WS_EX_LAYERED
                        | WS_EX_TRANSPARENT,
                    CLASS_NAME,
                    w!("SLUI backdrop"),
                    WS_POPUP,
                    0,
                    0,
                    1,
                    1,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    GetModuleHandleW(std::ptr::null()),
                    std::ptr::null(),
                )
            };
            if hwnd.is_null() {
                eprintln!("SLGO: failed to create a backdrop window");
                return None;
            }
            // Windows 11 draws a 1 px border round rounded windows; none here.
            set_dwm_u32(hwnd, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE);
            Some(Backdrop {
                hwnd,
                corner: None,
                top: None,
                alpha: None,
                visible: false,
            })
        }

        fn configure(&mut self, corner: Corner, top: bool, alpha: u8) {
            if self.corner != Some(corner) {
                let preference = match corner {
                    Corner::Square => DWMWCP_DONOTROUND,
                    Corner::Small => DWMWCP_ROUNDSMALL,
                    Corner::Round => DWMWCP_ROUND,
                };
                set_dwm_u32(self.hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, preference);
                self.corner = Some(corner);
            }
            if self.top != Some(top) {
                set_accent(self.hwnd, if top { TOP_TINT } else { 0 });
                self.top = Some(top);
            }
            if self.alpha != Some(alpha) {
                unsafe { SetLayeredWindowAttributes(self.hwnd, 0, alpha, LWA_ALPHA) };
                self.alpha = Some(alpha);
            }
        }

        fn hide(&mut self) {
            if self.visible {
                unsafe { ShowWindow(self.hwnd, SW_HIDE) };
                self.visible = false;
            }
        }
    }

    thread_local! {
        // Main thread only: created once, reused, never destroyed while the app runs (a fresh
        // window's first show is slower than showing a hidden one).
        static POOL: RefCell<Vec<Backdrop>> = const { RefCell::new(Vec::new()) };
    }

    fn hide_all() {
        POOL.with_borrow_mut(|pool| pool.iter_mut().for_each(Backdrop::hide));
    }

    /// Main thread only. Shows a backdrop per region and layer, directly under the overlay, when
    /// the overlay is on screen and the blur is on; hides every backdrop otherwise.
    pub fn apply(app: &AppHandle) {
        let state = state();
        let overlay = app.get_webview_window(crate::OVERLAY_WINDOW);
        let overlay_hwnd = overlay
            .as_ref()
            .and_then(|overlay| overlay.hwnd().ok())
            .map(|hwnd| hwnd.0 as HWND);
        let (Some(overlay), Some(overlay_hwnd)) = (overlay, overlay_hwnd) else {
            hide_all();
            return;
        };
        let shown = state.enabled
            && state.available
            && !state.regions.is_empty()
            && crate::overlay_may_show()
            && unsafe { IsWindowVisible(overlay_hwnd) } != 0;
        let mut overlay_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if !shown || unsafe { GetWindowRect(overlay_hwnd, &mut overlay_rect) } == 0 {
            hide_all();
            return;
        }
        let scale = overlay.scale_factor().unwrap_or(1.0);
        let origin = (overlay_rect.left, overlay_rect.top);
        let layers = usize::from(state.layers);
        let placements: Vec<_> = state
            .regions
            .iter()
            .filter_map(|region| {
                physical_rect(region, origin, scale)
                    .map(|rect| (rect, region.corner, alpha_byte(region.alpha)))
            })
            .collect();
        let needed = placements.len() * layers;

        POOL.with_borrow_mut(|pool| {
            while pool.len() < needed {
                let Some(backdrop) = Backdrop::create() else {
                    break;
                };
                pool.push(backdrop);
            }
            // Each SetWindowPos inserts directly under the overlay, pushing earlier ones down, so
            // going backwards leaves layer 0 (the tinted top layer) of region 0 nearest the overlay.
            for index in (0..needed.min(pool.len())).rev() {
                let (rect, corner, alpha) = placements[index / layers];
                let backdrop = &mut pool[index];
                backdrop.configure(corner, index % layers == 0, alpha);
                unsafe {
                    SetWindowPos(
                        backdrop.hwnd,
                        overlay_hwnd,
                        rect.x,
                        rect.y,
                        rect.w,
                        rect.h,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW,
                    )
                };
                backdrop.visible = true;
            }
            pool.iter_mut().skip(needed).for_each(Backdrop::hide);
        });
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::AppHandle;

    pub fn blur_available() -> bool {
        false
    }

    pub fn apply(_app: &AppHandle) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(x: f64, y: f64, w: f64, h: f64) -> Region {
        Region {
            x,
            y,
            w,
            h,
            corner: Corner::Small,
            alpha: 1.0,
        }
    }

    #[test]
    fn maps_css_px_to_screen_px() {
        let rect = physical_rect(&region(480.0, 278.0, 960.0, 584.0), (100, 50), 1.5).unwrap();
        assert_eq!(
            rect,
            PhysicalRect {
                x: 820,
                y: 467,
                w: 1440,
                h: 876
            }
        );
    }

    #[test]
    fn rounds_edges_so_neighbours_stay_adjacent() {
        let left = physical_rect(&region(0.0, 0.0, 10.3, 5.0), (0, 0), 1.25).unwrap();
        let right = physical_rect(&region(10.3, 0.0, 10.3, 5.0), (0, 0), 1.25).unwrap();
        assert_eq!(left.x + left.w, right.x);
    }

    #[test]
    fn rejects_empty_rects() {
        assert_eq!(
            physical_rect(&region(5.0, 5.0, 0.2, 10.0), (0, 0), 1.0),
            None
        );
    }

    #[test]
    fn sanitize_drops_unusable_regions_and_caps_count() {
        let mut regions = vec![
            region(f64::NAN, 0.0, 10.0, 10.0),
            region(0.0, 0.0, 0.0, 10.0),
            Region {
                alpha: 0.0,
                ..region(0.0, 0.0, 10.0, 10.0)
            },
            Region {
                alpha: 3.0,
                ..region(0.0, 0.0, 10.0, 10.0)
            },
        ];
        let kept = sanitize(regions.clone());
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].alpha, 1.0);
        regions.extend(std::iter::repeat_n(region(0.0, 0.0, 10.0, 10.0), MAX_REGIONS + 5));
        assert_eq!(sanitize(regions).len(), MAX_REGIONS);
    }

    #[test]
    fn clamps_layers_and_alpha() {
        assert_eq!(clamp_layers(0), 1);
        assert_eq!(clamp_layers(9), MAX_LAYERS);
        assert_eq!(alpha_byte(0.5), 128);
        assert_eq!(alpha_byte(-1.0), 0);
    }
}
