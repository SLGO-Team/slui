//! World blur under overlay panels, rendered by SLUI itself.
//!
//! CS2 draws many HUD panels on a blur of the game world. The overlay is a transparent WebView2
//! window and cannot read the game behind it, and DWM's accent blur refreshes at only ~30 Hz over a
//! running game (task research `own-blur-wgc.md`). So SLUI captures the game window with
//! Windows.Graphics.Capture, blurs the panels' regions on the GPU for every frame the game presents,
//! and shows the result in a click-through DirectComposition window directly under the overlay.
//! Each panel that CS2 blurs reports its rect (`set_backdrop_regions`); the page draws the panel's
//! fill on top.
//!
//! Threads: the blur window and visibility belong to the main thread (`apply`, via `refresh`);
//! frames are blurred and presented on the capture callback's thread. Both share the engine under
//! one mutex. Without a blur (switched off, no borderless capture before Windows 11, any failure)
//! no blur window shows and the page draws its dense fills.

use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

/// More than any HUD state needs (ten equipment boxes, kill cards, killfeed rows, boxes).
const MAX_REGIONS: usize = 64;
pub const AVAILABLE_EVENT: &str = "slgo-backdrop-available";
/// Gaussian σ at 1080p for strength 1-3, scaled with the window height. 1 (σ ≈ 30 px at 1600p)
/// is the strength the user chose in game on 2026-10-21.
const SIGMA_AT_1080: [f64; 3] = [20.0, 30.0, 40.0];
/// The capture stops after this long without a visible blurred panel.
#[cfg_attr(not(windows), allow(dead_code))]
const IDLE_STOP_MS: u128 = 5_000;

/// Most samples a vertical opacity profile keeps: the shader's `float4 fade[4]`.
const MAX_FADE_STOPS: usize = 16;

/// A panel box in overlay CSS px, its corner radius (CSS px) and effective opacity. `angle` turns
/// the box about its centre (radians, clockwise on screen, as CSS `rotate`); `fade` is an opacity
/// mask down the box (CSS `mask` with a vertical gradient).
#[derive(Clone, Debug, PartialEq, serde::Deserialize)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub radius: f64,
    pub alpha: f64,
    #[serde(default)]
    pub angle: f64,
    #[serde(default)]
    pub fade: Option<Fade>,
}

/// Opacity samples evenly spaced from `offset` to `offset + length` (CSS px from the box's top edge,
/// in the box's own frame), linear between samples, clamped beyond.
#[derive(Clone, Debug, PartialEq, serde::Deserialize)]
pub struct Fade {
    pub offset: f64,
    pub length: f64,
    pub stops: Vec<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    fn right(&self) -> i32 {
        self.x + self.w
    }
    fn bottom(&self) -> i32 {
        self.y + self.h
    }
}

/// A region ready to draw, in blur-window px: `rect` is drawn (it holds the turned box), the box
/// has its centre at `centre` (from `rect`'s origin), half size `half` and direction `rot`
/// (cos, sin). Radius in px, opacity 0-1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub rect: Rect,
    pub centre: [f32; 2],
    pub half: [f32; 2],
    pub rot: [f32; 2],
    pub radius: f32,
    pub alpha: f32,
    pub fade: Option<PlacedFade>,
}

/// `Fade` in blur-window px; `count` of `stops` are used.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlacedFade {
    pub offset: f32,
    pub length: f32,
    pub stops: [f32; MAX_FADE_STOPS],
    pub count: u32,
}

#[derive(Clone, Debug)]
struct Shared {
    regions: Vec<Region>,
    enabled: bool,
    strength: u8,
    /// The game window the overlay aligns to (0 until the game has been in front once).
    game: isize,
    /// Device, shaders and blur window created.
    engine_ok: bool,
    /// Borderless capture allowed (Windows 11); None while the request is pending.
    borderless: Option<bool>,
    /// Capturing the current game window failed.
    capture_failed: bool,
    /// Last availability sent to the page.
    published: Option<bool>,
}

static SHARED: Mutex<Shared> = Mutex::new(Shared {
    regions: Vec::new(),
    enabled: true,
    strength: 1,
    game: 0,
    engine_ok: false,
    borderless: None,
    capture_failed: false,
    published: None,
});
static APP: OnceLock<AppHandle> = OnceLock::new();

fn shared() -> Shared {
    SHARED.lock().map(|state| state.clone()).unwrap_or_else(|poisoned| poisoned.into_inner().clone())
}

fn with_shared<R>(update: impl FnOnce(&mut Shared) -> R) -> R {
    let mut guard = SHARED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    update(&mut guard)
}

fn available(state: &Shared) -> bool {
    state.engine_ok && state.borderless == Some(true) && !state.capture_failed
}

/// Drops unusable regions (non-finite, empty, invisible) and fades, clamps radius and opacity, caps
/// the count.
fn sanitize(regions: Vec<Region>) -> Vec<Region> {
    regions
        .into_iter()
        .filter(|region| {
            [region.x, region.y, region.w, region.h, region.radius, region.alpha, region.angle]
                .iter()
                .all(|value| value.is_finite())
                && region.w >= 1.0
                && region.h >= 1.0
                && region.alpha > 0.0
        })
        .map(|region| Region {
            radius: region.radius.max(0.0),
            alpha: region.alpha.min(1.0),
            fade: region.fade.and_then(sanitize_fade),
            ..region
        })
        .take(MAX_REGIONS)
        .collect()
}

/// A fade needs a finite span of at least a pixel and 2-16 finite samples, clamped to 0-1.
fn sanitize_fade(fade: Fade) -> Option<Fade> {
    let usable = fade.offset.is_finite()
        && fade.length.is_finite()
        && fade.length >= 1.0
        && (2..=MAX_FADE_STOPS).contains(&fade.stops.len())
        && fade.stops.iter().all(|stop| stop.is_finite());
    usable.then(|| Fade { stops: fade.stops.iter().map(|stop| stop.clamp(0.0, 1.0)).collect(), ..fade })
}

/// Overlay CSS px to blur-window px (the blur window has the overlay's rect). An upright box keeps
/// its edges, rounded separately so adjacent regions stay adjacent; a turned box is drawn in its
/// bounds plus a pixel for the antialiased edge.
pub fn place(region: &Region, scale: f64) -> Option<Placed> {
    let (sin, cos) = region.angle.sin_cos();
    let (rect, centre, half) = if region.angle == 0.0 {
        let left = (region.x * scale).round();
        let top = (region.y * scale).round();
        let right = ((region.x + region.w) * scale).round();
        let bottom = ((region.y + region.h) * scale).round();
        let half = [(right - left) / 2.0, (bottom - top) / 2.0];
        ([left, top, right, bottom], half, half)
    } else {
        let (w, h) = (region.w * scale, region.h * scale);
        let cx = (region.x + region.w / 2.0) * scale;
        let cy = (region.y + region.h / 2.0) * scale;
        let reach_x = (cos.abs() * w + sin.abs() * h) / 2.0 + 1.0;
        let reach_y = (sin.abs() * w + cos.abs() * h) / 2.0 + 1.0;
        let (left, top) = ((cx - reach_x).floor(), (cy - reach_y).floor());
        let (right, bottom) = ((cx + reach_x).ceil(), (cy + reach_y).ceil());
        ([left, top, right, bottom], [cx - left, cy - top], [w / 2.0, h / 2.0])
    };
    let [left, top, right, bottom] = rect;
    let (w, h) = (right - left, bottom - top);
    if !(w >= 1.0 && h >= 1.0 && half[0] >= 0.5 && half[1] >= 0.5)
        || [left, top, w, h].iter().any(|value| value.abs() > 1.0e6)
    {
        return None;
    }
    let fade = region.fade.as_ref().map(|fade| {
        let mut stops = [0.0; MAX_FADE_STOPS];
        for (slot, stop) in stops.iter_mut().zip(&fade.stops) {
            *slot = *stop as f32;
        }
        PlacedFade {
            offset: (fade.offset * scale) as f32,
            length: (fade.length * scale) as f32,
            stops,
            count: fade.stops.len().min(MAX_FADE_STOPS) as u32,
        }
    });
    Some(Placed {
        rect: Rect { x: left as i32, y: top as i32, w: w as i32, h: h as i32 },
        centre: centre.map(|value| value as f32),
        half: half.map(|value| value as f32),
        rot: [cos as f32, sin as f32],
        radius: (region.radius * scale) as f32,
        alpha: region.alpha as f32,
        fade,
    })
}

/// Gaussian σ in screen px for a strength (1-3) and the window height.
pub fn sigma_px(strength: u8, height: i32) -> f32 {
    let index = usize::from(strength.clamp(1, 3)) - 1;
    (SIGMA_AT_1080[index] * f64::from(height.max(1)) / 1080.0) as f32
}

/// The part of the captured frame a region's blur reads: the panel (in capture px) plus a margin,
/// clamped to the frame, with width and height cut to multiples of 4 so every texel of the 1/4
/// mip level averages captured pixels only. None when too little of it is captured.
pub fn source_box(panel: Rect, margin: i32, frame: (i32, i32)) -> Option<Rect> {
    let left = (panel.x - margin).max(0);
    let top = (panel.y - margin).max(0);
    let right = (panel.right() + margin).min(frame.0);
    let bottom = (panel.bottom() + margin).min(frame.1);
    let w = (right - left) / 4 * 4;
    let h = (bottom - top) / 4 * 4;
    (w >= 8 && h >= 8 && panel.right() > left && panel.bottom() > top && panel.x < left + w && panel.y < top + h)
        .then_some(Rect { x: left, y: top, w, h })
}

/// Runs `apply` on the main thread, which owns the blur window. Safe from any thread.
pub fn refresh(app: &AppHandle) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || platform::apply(&handle)) {
        diag!("SLGO: failed to schedule backdrop update: {error}");
    }
}

/// Tells the page whether panels sit on a blur when that changed, and updates the blur window.
fn publish_availability(app: &AppHandle) {
    let change = with_shared(|state| {
        let now = available(state);
        (state.published != Some(now)).then(|| {
            state.published = Some(now);
            now
        })
    });
    if let Some(now) = change {
        diag!("SLGO: world blur {}", if now { "available" } else { "unavailable" });
        if let Err(error) = app.emit(AVAILABLE_EVENT, serde_json::json!({ "available": now })) {
            diag!("SLGO: failed to emit backdrop availability: {error}");
        }
        refresh(app);
    }
}

/// Startup, on the main thread: creates the device, shaders and blur window, and asks for
/// borderless capture in the background.
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let ok = platform::init();
    with_shared(|state| state.engine_ok = ok);
    let handle = app.clone();
    std::thread::spawn(move || {
        let allowed = platform::request_borderless();
        with_shared(|state| state.borderless = Some(allowed));
        publish_availability(&handle);
    });
    publish_availability(app);
}

/// The game window the overlay is aligned to; called by the foreground thread while the game is
/// in front. A new window gets a fresh capture.
pub fn set_game_window(app: &AppHandle, game: isize) {
    let changed = with_shared(|state| {
        let changed = state.game != game;
        if changed {
            state.game = game;
            state.capture_failed = false;
        }
        changed
    });
    if changed {
        platform::stop_capture();
        publish_availability(app);
    }
}

/// Called by the foreground thread every 100 ms: stops an idle capture.
pub fn tick() {
    platform::stop_capture_if_idle();
}

#[tauri::command]
pub fn set_backdrop_regions(app: AppHandle, regions: Vec<Region>) {
    let regions = sanitize(regions);
    let changed = with_shared(|state| {
        let changed = state.regions != regions;
        state.regions = regions;
        changed
    });
    if changed {
        refresh(&app);
    }
}

#[tauri::command]
pub fn set_backdrop_options(app: AppHandle, enabled: bool, strength: u8) {
    with_shared(|state| {
        state.enabled = enabled;
        state.strength = strength.clamp(1, 3);
    });
    refresh(&app);
}

#[tauri::command]
pub fn get_backdrop_available() -> bool {
    available(&shared())
}

#[cfg(windows)]
mod platform {
    use std::sync::Mutex;
    use std::time::Instant;

    use tauri::{AppHandle, Manager};
    use windows::core::{s, w, Interface, PCSTR};
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Graphics::Capture::{
        Direct3D11CaptureFramePool, GraphicsCaptureAccess, GraphicsCaptureAccessKind, GraphicsCaptureItem,
        GraphicsCaptureSession,
    };
    use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
    use windows::Graphics::DirectX::DirectXPixelFormat;
    use windows::Graphics::SizeInt32;
    use windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus;
    use windows::Win32::Foundation::{COLORREF, HMODULE, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Direct3D::Fxc::D3DCompile;
    use windows::Win32::Graphics::Direct3D::{ID3DBlob, D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST, D3D_DRIVER_TYPE_HARDWARE};
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::DirectComposition::{
        DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual,
    };
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Dxgi::Common::*;
    use windows::Win32::Graphics::Dxgi::*;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
    use windows::Win32::UI::WindowsAndMessaging::*;

    use super::{
        publish_availability, refresh, shared, sigma_px, source_box, with_shared, Placed, Rect, APP, IDLE_STOP_MS,
    };

    const SHADER: &str = r#"
cbuffer Params : register(b0) {
    float2 dir; float sigma; float lod;
    float4 uvRect;
    float2 clampMin; float2 clampMax;
    float2 size; float radius; float alpha;
    float2 centre; float2 halfBox;
    float2 rot; float mask; float fadeCount;
    float fadeOffset; float fadeLength; float2 pad;
    float4 fade[4];
};
Texture2D src : register(t0);
SamplerState samp : register(s0);
struct VSOut { float4 pos : SV_Position; float2 uv : TEXCOORD0; };
VSOut vs(uint id : SV_VertexID) {
    VSOut o;
    float2 uv = float2((id << 1) & 2, id & 2);
    o.pos = float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
    o.uv = uv;
    return o;
}
float3 tap(float2 uv) { return src.SampleLevel(samp, clamp(uv, clampMin, clampMax), lod).rgb; }
float fadeAt(uint k) {
    float4 v = fade[k >> 2];
    uint c = k & 3;
    return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w;
}
float4 ps(VSOut i) : SV_Target {
    float2 uv = uvRect.xy + i.uv * uvRect.zw;
    float3 color;
    if (sigma <= 0) {
        color = tap(uv);
    } else {
        float r = ceil(sigma * 3.0);
        float3 sum = 0;
        float total = 0;
        [loop] for (float k = -r; k <= r; k += 1.0) {
            float weight = exp(-0.5 * k * k / (sigma * sigma));
            sum += tap(uv + dir * k) * weight;
            total += weight;
        }
        color = sum / total;
    }
    if (mask < 0.5) return float4(color, 1);
    // The pixel in the box's own frame: turned back about the box centre.
    float2 p = i.uv * size - centre;
    float2 local = float2(p.x * rot.x + p.y * rot.y, p.y * rot.x - p.x * rot.y);
    // Rounded-rect coverage with a one-pixel antialiased edge; a radius of half the short side
    // makes a circle.
    float r = min(radius, min(halfBox.x, halfBox.y));
    float2 q = abs(local) - (halfBox - r);
    float d = length(max(q, 0)) + min(max(q.x, q.y), 0) - r;
    float a = saturate(0.5 - d) * alpha;
    // Vertical opacity mask: samples evenly spaced down the box, linear between them.
    if (fadeCount >= 2) {
        float t = saturate((local.y + halfBox.y - fadeOffset) / fadeLength) * (fadeCount - 1);
        uint k = min((uint)t, (uint)fadeCount - 2);
        a *= lerp(fadeAt(k), fadeAt(k + 1), t - (float)k);
    }
    return float4(color * a, a);
}
"#;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Params {
        dir: [f32; 2],
        sigma: f32,
        lod: f32,
        uv_rect: [f32; 4],
        clamp_min: [f32; 2],
        clamp_max: [f32; 2],
        size: [f32; 2],
        radius: f32,
        alpha: f32,
        centre: [f32; 2],
        half: [f32; 2],
        rot: [f32; 2],
        mask: f32,
        fade_count: f32,
        fade_offset: f32,
        fade_length: f32,
        pad: [f32; 2],
        fade: [f32; super::MAX_FADE_STOPS],
    }

    struct Target {
        size: (u32, u32),
        texture: ID3D11Texture2D,
        srv: ID3D11ShaderResourceView,
        rtv: Option<ID3D11RenderTargetView>,
    }

    fn texture(device: &ID3D11Device, size: (u32, u32), mips: u32) -> windows::core::Result<Target> {
        unsafe {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: size.0,
                Height: size.1,
                MipLevels: mips,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: if mips > 1 { D3D11_RESOURCE_MISC_GENERATE_MIPS.0 as u32 } else { 0 },
            };
            let mut texture = None;
            device.CreateTexture2D(&desc, None, Some(&mut texture))?;
            let texture = texture.unwrap();
            let mut srv = None;
            device.CreateShaderResourceView(&texture, None, Some(&mut srv))?;
            let mut rtv = None;
            if mips == 1 {
                device.CreateRenderTargetView(&texture, None, Some(&mut rtv))?;
            }
            Ok(Target { size, texture, srv: srv.unwrap(), rtv })
        }
    }

    /// What the capture callback draws: the blur window's size, where its px sit in the captured
    /// frame, σ, and the regions.
    #[derive(Clone, Default, PartialEq)]
    struct Plan {
        size: (i32, i32),
        /// Capture px = blur-window px + this.
        offset: (i32, i32),
        sigma: f32,
        regions: Vec<Placed>,
    }

    struct Capture {
        game: isize,
        _item: GraphicsCaptureItem,
        pool: Direct3D11CaptureFramePool,
        session: GraphicsCaptureSession,
        size: SizeInt32,
    }

    struct Engine {
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        winrt_device: IDirect3DDevice,
        vs: ID3D11VertexShader,
        ps: ID3D11PixelShader,
        sampler: ID3D11SamplerState,
        opaque: ID3D11BlendState,
        over: ID3D11BlendState,
        params: ID3D11Buffer,
        swap: IDXGISwapChain1,
        swap_size: (u32, u32),
        back: Option<ID3D11RenderTargetView>,
        _composition: (IDCompositionDevice, IDCompositionTarget, IDCompositionVisual),
        window: HWND,
        /// Full-resolution copy with 3 mips, and two 1/4-resolution blur targets; grown on demand.
        scratch: Option<(Target, Target, Target)>,
        capture: Option<Capture>,
        plan: Plan,
        /// Whether the blur window should show (every condition but a presented frame).
        active: bool,
        /// Bumped whenever the plan changes; `presented` is the plan last drawn.
        generation: u64,
        presented: u64,
        /// The generation that must be presented before a hidden window shows.
        show_after: u64,
        shown: bool,
        idle_since: Option<Instant>,
    }

    // The device is multithread-protected; the engine mutex serialises every other use.
    unsafe impl Send for Engine {}

    static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);

    fn engine() -> std::sync::MutexGuard<'static, Option<Engine>> {
        ENGINE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn compile(entry: PCSTR, target: PCSTR) -> windows::core::Result<Vec<u8>> {
        unsafe {
            let mut code: Option<ID3DBlob> = None;
            let mut errors: Option<ID3DBlob> = None;
            let result = D3DCompile(
                SHADER.as_ptr() as _,
                SHADER.len(),
                s!("backdrop.hlsl"),
                None,
                None,
                entry,
                target,
                0,
                0,
                &mut code,
                Some(&mut errors),
            );
            if let Some(errors) = errors {
                let text = std::slice::from_raw_parts(errors.GetBufferPointer() as *const u8, errors.GetBufferSize());
                diag!("SLGO: backdrop shader: {}", String::from_utf8_lossy(text));
            }
            result?;
            let code = code.unwrap();
            Ok(std::slice::from_raw_parts(code.GetBufferPointer() as *const u8, code.GetBufferSize()).to_vec())
        }
    }

    unsafe extern "system" fn window_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    fn create_window() -> windows::core::Result<HWND> {
        unsafe {
            let instance = GetModuleHandleW(None)?;
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(window_proc),
                hInstance: instance.into(),
                lpszClassName: w!("SluiWorldBlur"),
                ..Default::default()
            };
            RegisterClassExW(&class);
            // Click-through (layered + transparent), never activated, no redirection surface: the
            // DirectComposition swap chain is its only content.
            let hwnd = CreateWindowExW(
                WS_EX_NOREDIRECTIONBITMAP
                    | WS_EX_TOPMOST
                    | WS_EX_TOOLWINDOW
                    | WS_EX_NOACTIVATE
                    | WS_EX_LAYERED
                    | WS_EX_TRANSPARENT,
                w!("SluiWorldBlur"),
                w!("SLUI world blur"),
                WS_POPUP,
                0,
                0,
                1,
                1,
                None,
                None,
                Some(instance.into()),
                None,
            )?;
            SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA)?;
            Ok(hwnd)
        }
    }

    fn blend_state(device: &ID3D11Device, enabled: bool) -> windows::core::Result<ID3D11BlendState> {
        let mut desc = D3D11_BLEND_DESC::default();
        desc.RenderTarget[0] = D3D11_RENDER_TARGET_BLEND_DESC {
            BlendEnable: enabled.into(),
            // Premultiplied "over".
            SrcBlend: D3D11_BLEND_ONE,
            DestBlend: D3D11_BLEND_INV_SRC_ALPHA,
            BlendOp: D3D11_BLEND_OP_ADD,
            SrcBlendAlpha: D3D11_BLEND_ONE,
            DestBlendAlpha: D3D11_BLEND_INV_SRC_ALPHA,
            BlendOpAlpha: D3D11_BLEND_OP_ADD,
            RenderTargetWriteMask: D3D11_COLOR_WRITE_ENABLE_ALL.0 as u8,
        };
        let mut state = None;
        unsafe { device.CreateBlendState(&desc, Some(&mut state))? };
        Ok(state.unwrap())
    }

    fn create_engine() -> windows::core::Result<Engine> {
        unsafe {
            let mut device = None;
            let mut context = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
            let device: ID3D11Device = device.unwrap();
            let context = context.unwrap();
            if let Ok(multithread) = device.cast::<ID3D11Multithread>() {
                let _ = multithread.SetMultithreadProtected(true);
            }
            let dxgi: IDXGIDevice = device.cast()?;
            if let Ok(dxgi1) = dxgi.cast::<IDXGIDevice1>() {
                let _ = dxgi1.SetMaximumFrameLatency(1);
            }
            let winrt_device: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()?;

            let vs_code = compile(s!("vs"), s!("vs_5_0"))?;
            let ps_code = compile(s!("ps"), s!("ps_5_0"))?;
            let mut vs = None;
            device.CreateVertexShader(&vs_code, None, Some(&mut vs))?;
            let mut ps = None;
            device.CreatePixelShader(&ps_code, None, Some(&mut ps))?;
            let sampler_desc = D3D11_SAMPLER_DESC {
                Filter: D3D11_FILTER_MIN_MAG_MIP_LINEAR,
                AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
                MaxLOD: f32::MAX,
                ..Default::default()
            };
            let mut sampler = None;
            device.CreateSamplerState(&sampler_desc, Some(&mut sampler))?;
            let opaque = blend_state(&device, false)?;
            let over = blend_state(&device, true)?;
            let buffer_desc = D3D11_BUFFER_DESC {
                ByteWidth: std::mem::size_of::<Params>() as u32,
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: D3D11_BIND_CONSTANT_BUFFER.0 as u32,
                ..Default::default()
            };
            let mut params = None;
            device.CreateBuffer(&buffer_desc, None, Some(&mut params))?;

            let window = create_window()?;
            let factory: IDXGIFactory2 = CreateDXGIFactory1()?;
            let swap_desc = DXGI_SWAP_CHAIN_DESC1 {
                Width: 64,
                Height: 64,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
                BufferCount: 2,
                Scaling: DXGI_SCALING_STRETCH,
                SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
                AlphaMode: DXGI_ALPHA_MODE_PREMULTIPLIED,
                ..Default::default()
            };
            let swap = factory.CreateSwapChainForComposition(&device, &swap_desc, None)?;
            let composition: IDCompositionDevice = DCompositionCreateDevice(&dxgi)?;
            let target = composition.CreateTargetForHwnd(window, true)?;
            let visual = composition.CreateVisual()?;
            visual.SetContent(&swap)?;
            target.SetRoot(&visual)?;
            composition.Commit()?;

            Ok(Engine {
                device,
                context,
                winrt_device,
                vs: vs.unwrap(),
                ps: ps.unwrap(),
                sampler: sampler.unwrap(),
                opaque,
                over,
                params: params.unwrap(),
                swap,
                swap_size: (64, 64),
                back: None,
                _composition: (composition, target, visual),
                window,
                scratch: None,
                capture: None,
                plan: Plan::default(),
                active: false,
                generation: 0,
                presented: 0,
                show_after: 0,
                shown: false,
                idle_since: None,
            })
        }
    }

    pub fn init() -> bool {
        match create_engine() {
            Ok(created) => {
                *engine() = Some(created);
                true
            }
            Err(error) => {
                diag!("SLGO: world blur unavailable: {error}");
                false
            }
        }
    }

    /// Borderless capture (no yellow frame round the game): Windows 11 only.
    pub fn request_borderless() -> bool {
        let supported = GraphicsCaptureSession::IsSupported().unwrap_or(false);
        let status =
            GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless).and_then(|operation| operation.join());
        match status {
            Ok(status) => supported && status == AppCapabilityAccessStatus::Allowed,
            Err(error) => {
                diag!("SLGO: borderless capture unavailable: {error}");
                false
            }
        }
    }

    impl Engine {
        fn ensure_swap(&mut self, size: (u32, u32)) -> windows::core::Result<()> {
            if self.swap_size == size && self.back.is_some() {
                return Ok(());
            }
            unsafe {
                self.back = None;
                self.context.OMSetRenderTargets(None, None);
                self.swap.ResizeBuffers(2, size.0, size.1, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SWAP_CHAIN_FLAG(0))?;
                let buffer: ID3D11Texture2D = self.swap.GetBuffer(0)?;
                let mut rtv = None;
                self.device.CreateRenderTargetView(&buffer, None, Some(&mut rtv))?;
                self.back = rtv;
                self.swap_size = size;
            }
            Ok(())
        }

        fn ensure_scratch(&mut self, need: (u32, u32)) -> windows::core::Result<()> {
            if self.scratch.as_ref().is_some_and(|(full, _, _)| full.size.0 >= need.0 && full.size.1 >= need.1) {
                return Ok(());
            }
            let current = self.scratch.as_ref().map_or((0, 0), |(full, _, _)| full.size);
            // Multiples of 4, so the 1/4 targets match the third mip level exactly.
            let size = (need.0.max(current.0).div_ceil(4) * 4, need.1.max(current.1).div_ceil(4) * 4);
            let low = (size.0 / 4, size.1 / 4);
            self.scratch =
                Some((texture(&self.device, size, 3)?, texture(&self.device, low, 1)?, texture(&self.device, low, 1)?));
            Ok(())
        }

        fn pass(
            &self,
            target: &ID3D11RenderTargetView,
            viewport: (f32, f32, f32, f32),
            source: &ID3D11ShaderResourceView,
            blend: &ID3D11BlendState,
            params: Params,
        ) {
            unsafe {
                let context = &self.context;
                context.UpdateSubresource(&self.params, 0, None, &params as *const Params as _, 0, 0);
                context.OMSetRenderTargets(Some(&[Some(target.clone())]), None);
                context.OMSetBlendState(blend, None, 0xffff_ffff);
                let viewport = D3D11_VIEWPORT {
                    TopLeftX: viewport.0,
                    TopLeftY: viewport.1,
                    Width: viewport.2,
                    Height: viewport.3,
                    MinDepth: 0.0,
                    MaxDepth: 1.0,
                };
                context.RSSetViewports(Some(&[viewport]));
                context.IASetInputLayout(None);
                context.IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
                context.VSSetShader(&self.vs, None);
                context.PSSetShader(&self.ps, None);
                context.PSSetShaderResources(0, Some(&[Some(source.clone())]));
                context.PSSetSamplers(0, Some(&[Some(self.sampler.clone())]));
                context.PSSetConstantBuffers(0, Some(&[Some(self.params.clone())]));
                context.Draw(3, 0);
                context.PSSetShaderResources(0, Some(&[None]));
                context.OMSetRenderTargets(None, None);
            }
        }

        /// Blurs every region of the plan out of `frame` and presents the result.
        fn render(&mut self, frame: &ID3D11Texture2D, frame_size: (i32, i32)) -> windows::core::Result<()> {
            let plan = self.plan.clone();
            self.ensure_swap((plan.size.0.max(1) as u32, plan.size.1.max(1) as u32))?;
            let back = self.back.clone().unwrap();
            unsafe { self.context.ClearRenderTargetView(&back, &[0.0, 0.0, 0.0, 0.0]) };
            let margin = (plan.sigma * 3.0).ceil() as i32;
            for region in &plan.regions {
                let panel = Rect { x: region.rect.x + plan.offset.0, y: region.rect.y + plan.offset.1, ..region.rect };
                let Some(source) = source_box(panel, margin, frame_size) else { continue };
                self.ensure_scratch((source.w as u32, source.h as u32))?;
                let (full, low_a, low_b) = self.scratch.as_ref().unwrap();
                let (fw, fh) = (full.size.0 as f32, full.size.1 as f32);
                let (lw, lh) = (low_a.size.0 as f32, low_a.size.1 as f32);
                let (uw, uh) = (source.w as f32, source.h as f32);
                unsafe {
                    let copied = D3D11_BOX {
                        left: source.x as u32,
                        top: source.y as u32,
                        front: 0,
                        right: source.right() as u32,
                        bottom: source.bottom() as u32,
                        back: 1,
                    };
                    self.context.CopySubresourceRegion(&full.texture, 0, 0, 0, 0, frame, 0, Some(&copied));
                    self.context.GenerateMips(&full.srv);
                }
                let low_sigma = plan.sigma / 4.0;
                let low_view = (0.0, 0.0, uw / 4.0, uh / 4.0);
                // Horizontal blur from the third mip level (1/4 resolution), sampling copied texels only.
                self.pass(
                    low_a.rtv.as_ref().unwrap(),
                    low_view,
                    &full.srv,
                    &self.opaque,
                    Params {
                        dir: [4.0 / fw, 0.0],
                        sigma: low_sigma,
                        lod: 2.0,
                        uv_rect: [0.0, 0.0, uw / fw, uh / fh],
                        clamp_min: [2.0 / fw, 2.0 / fh],
                        clamp_max: [(uw - 2.0) / fw, (uh - 2.0) / fh],
                        ..Default::default()
                    },
                );
                let low_clamp_min = [0.5 / lw, 0.5 / lh];
                let low_clamp_max = [(uw / 4.0 - 0.5) / lw, (uh / 4.0 - 0.5) / lh];
                self.pass(
                    low_b.rtv.as_ref().unwrap(),
                    low_view,
                    &low_a.srv,
                    &self.opaque,
                    Params {
                        dir: [0.0, 1.0 / lh],
                        sigma: low_sigma,
                        uv_rect: [0.0, 0.0, uw / 4.0 / lw, uh / 4.0 / lh],
                        clamp_min: low_clamp_min,
                        clamp_max: low_clamp_max,
                        ..Default::default()
                    },
                );
                // Upscale into the panel's rect, masked to its (turned) corners and faded with it.
                let r = region.rect;
                let fade = region.fade.unwrap_or(super::PlacedFade {
                    offset: 0.0,
                    length: 1.0,
                    stops: [0.0; super::MAX_FADE_STOPS],
                    count: 0,
                });
                self.pass(
                    &back,
                    (r.x as f32, r.y as f32, r.w as f32, r.h as f32),
                    &low_b.srv,
                    &self.over,
                    Params {
                        uv_rect: [
                            (panel.x - source.x) as f32 / 4.0 / lw,
                            (panel.y - source.y) as f32 / 4.0 / lh,
                            r.w as f32 / 4.0 / lw,
                            r.h as f32 / 4.0 / lh,
                        ],
                        clamp_min: low_clamp_min,
                        clamp_max: low_clamp_max,
                        size: [r.w as f32, r.h as f32],
                        radius: region.radius,
                        alpha: region.alpha,
                        centre: region.centre,
                        half: region.half,
                        rot: region.rot,
                        mask: 1.0,
                        fade_count: fade.count as f32,
                        fade_offset: fade.offset,
                        fade_length: fade.length,
                        fade: fade.stops,
                        ..Default::default()
                    },
                );
            }
            unsafe { self.swap.Present(0, DXGI_PRESENT(0)).ok() }
        }
    }

    fn on_frame(pool: &Direct3D11CaptureFramePool) -> windows::core::Result<()> {
        let frame = pool.TryGetNextFrame()?;
        let first_for_plan = {
            let mut guard = engine();
            let Some(engine) = guard.as_mut() else { return Ok(()) };
            let content = frame.ContentSize()?;
            let winrt_device = engine.winrt_device.clone();
            let Some(capture) = engine.capture.as_mut() else { return Ok(()) };
            if content != capture.size {
                capture.size = content;
                capture.pool.Recreate(&winrt_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, content)?;
            }
            if !engine.active || engine.plan.regions.is_empty() {
                return Ok(());
            }
            let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
            let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
            if let Err(error) = engine.render(&texture, (content.Width, content.Height)) {
                diag!("SLGO: world blur frame failed: {error}");
                return Ok(());
            }
            let waiting = !engine.shown && engine.presented < engine.show_after;
            engine.presented = engine.generation;
            waiting && engine.presented >= engine.show_after
        };
        // The first frame with the current plan is on screen: the main thread may show the window.
        if first_for_plan {
            if let Some(app) = APP.get() {
                refresh(app);
            }
        }
        Ok(())
    }

    fn start_capture(engine: &mut Engine, game: isize) -> windows::core::Result<()> {
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(HWND(game as _))? };
        let size = item.Size()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &engine.winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )?;
        let session = pool.CreateCaptureSession(&item)?;
        session.SetIsBorderRequired(false)?;
        let _ = session.SetIsCursorCaptureEnabled(false);
        // Every frame the game presents (the default may skip some).
        let _ = session.SetMinUpdateInterval(TimeSpan { Duration: 10_000 });
        pool.FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, windows::core::IInspectable>::new(|pool, _| {
            if let Some(pool) = pool.as_ref() {
                if let Err(error) = on_frame(pool) {
                    diag!("SLGO: world blur capture frame: {error}");
                }
            }
            Ok(())
        }))?;
        session.StartCapture()?;
        diag!("SLGO: world blur capture started");
        engine.capture = Some(Capture { game, _item: item, pool, session, size });
        Ok(())
    }

    fn close_capture(capture: Capture) {
        let _ = capture.session.Close();
        let _ = capture.pool.Close();
        diag!("SLGO: world blur capture stopped");
    }

    pub fn stop_capture() {
        let capture = engine().as_mut().and_then(|engine| engine.capture.take());
        if let Some(capture) = capture {
            close_capture(capture);
        }
    }

    pub fn stop_capture_if_idle() {
        let capture = {
            let mut guard = engine();
            let Some(engine) = guard.as_mut() else { return };
            let idle = engine.idle_since.is_some_and(|since| since.elapsed().as_millis() >= IDLE_STOP_MS);
            if idle {
                engine.capture.take()
            } else {
                None
            }
        };
        if let Some(capture) = capture {
            close_capture(capture);
        }
    }

    fn hide(engine: &mut Engine) {
        engine.active = false;
        if engine.shown {
            unsafe {
                let _ = ShowWindow(engine.window, SW_HIDE);
            }
            engine.shown = false;
        }
        if engine.idle_since.is_none() {
            engine.idle_since = Some(Instant::now());
        }
    }

    /// Main thread only. Shows the blur window over the overlay's rect, directly under the overlay,
    /// while a blurred panel is on screen; hides it otherwise.
    pub fn apply(app: &AppHandle) {
        let state = shared();
        let overlay = app.get_webview_window(crate::OVERLAY_WINDOW);
        let overlay_hwnd = overlay.as_ref().and_then(|overlay| overlay.hwnd().ok()).map(|hwnd| HWND(hwnd.0 as _));
        let mut failed = false;
        // Closed outside the engine lock: closing may wait for a frame callback that waits for it.
        let mut stale = None;
        {
            let mut guard = engine();
            let Some(engine) = guard.as_mut() else { return };
            let (Some(overlay), Some(overlay_hwnd)) = (overlay, overlay_hwnd) else {
                hide(engine);
                return;
            };
            let wanted = state.enabled
                && super::available(&state)
                && !state.regions.is_empty()
                && state.game != 0
                && crate::overlay_may_show()
                && unsafe { IsWindowVisible(overlay_hwnd) }.as_bool();
            let mut overlay_rect = RECT::default();
            let mut bounds = RECT::default();
            let geometry = wanted
                && unsafe { GetWindowRect(overlay_hwnd, &mut overlay_rect) }.is_ok()
                && unsafe {
                    DwmGetWindowAttribute(
                        HWND(state.game as _),
                        DWMWA_EXTENDED_FRAME_BOUNDS,
                        &mut bounds as *mut RECT as _,
                        std::mem::size_of::<RECT>() as u32,
                    )
                }
                .is_ok();
            if !geometry {
                hide(engine);
                return;
            }
            engine.idle_since = None;
            if engine.capture.as_ref().is_some_and(|capture| capture.game != state.game) {
                stale = engine.capture.take();
            }
            if engine.capture.is_none() {
                if let Err(error) = start_capture(engine, state.game) {
                    diag!("SLGO: world blur capture failed: {error}");
                    failed = true;
                    hide(engine);
                }
            }
            if !failed {
                let scale = overlay.scale_factor().unwrap_or(1.0);
                let size = (overlay_rect.right - overlay_rect.left, overlay_rect.bottom - overlay_rect.top);
                let plan = Plan {
                    size,
                    offset: (overlay_rect.left - bounds.left, overlay_rect.top - bounds.top),
                    sigma: sigma_px(state.strength, size.1),
                    regions: state.regions.iter().filter_map(|region| super::place(region, scale)).collect(),
                };
                if plan != engine.plan {
                    engine.plan = plan;
                    engine.generation += 1;
                }
                if !engine.active {
                    engine.active = true;
                    // A hidden window waits for a freshly captured frame: its swap chain still holds
                    // the last one drawn, possibly seconds old.
                    engine.generation += 1;
                    engine.show_after = engine.generation;
                }
                let ready = engine.shown || engine.presented >= engine.show_after;
                let show = if ready { SWP_SHOWWINDOW } else { SET_WINDOW_POS_FLAGS(0) };
                unsafe {
                    let _ = SetWindowPos(
                        engine.window,
                        Some(overlay_hwnd),
                        overlay_rect.left,
                        overlay_rect.top,
                        size.0,
                        size.1,
                        SWP_NOACTIVATE | show,
                    );
                }
                engine.shown = ready;
            }
        }
        if let Some(capture) = stale {
            close_capture(capture);
        }
        if failed {
            with_shared(|state| state.capture_failed = true);
            publish_availability(app);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn shaders_compile() {
            assert!(compile(s!("vs"), s!("vs_5_0")).is_ok());
            assert!(compile(s!("ps"), s!("ps_5_0")).is_ok());
            // The constant buffer is whole 16-byte registers, as HLSL packs it.
            assert_eq!(std::mem::size_of::<Params>() % 16, 0);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::AppHandle;

    pub fn init() -> bool {
        false
    }
    pub fn request_borderless() -> bool {
        false
    }
    pub fn apply(_app: &AppHandle) {}
    pub fn stop_capture() {}
    pub fn stop_capture_if_idle() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(x: f64, y: f64, w: f64, h: f64) -> Region {
        Region { x, y, w, h, radius: 5.0, alpha: 1.0, angle: 0.0, fade: None }
    }

    #[test]
    fn places_css_px_in_blur_window_px() {
        let placed = place(&region(480.0, 278.0, 960.0, 584.0), 1.5).unwrap();
        assert_eq!(placed.rect, Rect { x: 720, y: 417, w: 1440, h: 876 });
        assert_eq!(placed.radius, 7.5);
        // Upright: the box fills the drawn rect.
        assert_eq!((placed.centre, placed.half, placed.rot), ([720.0, 438.0], [720.0, 438.0], [1.0, 0.0]));
    }

    #[test]
    fn draws_a_turned_box_in_its_bounds() {
        let turned = Region { angle: std::f64::consts::FRAC_PI_4, ..region(0.0, 0.0, 10.0, 10.0) };
        let placed = place(&turned, 1.0).unwrap();
        // A 10 px square turned 45° reaches 7.07 px from its centre (5, 5), plus the antialiased pixel.
        assert_eq!(placed.rect, Rect { x: -4, y: -4, w: 18, h: 18 });
        assert_eq!((placed.centre, placed.half), ([9.0, 9.0], [5.0, 5.0]));
        assert!((placed.rot[0] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
        assert!((placed.rot[1] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
    }

    #[test]
    fn places_a_fade_in_blur_window_px() {
        let faded = Region {
            fade: Some(Fade { offset: -4.0, length: 204.0, stops: vec![1.0, 0.5, 0.0] }),
            ..region(10.0, 10.0, 54.0, 200.0)
        };
        let fade = place(&faded, 1.5).unwrap().fade.unwrap();
        assert_eq!((fade.offset, fade.length, fade.count), (-6.0, 306.0, 3));
        assert_eq!(&fade.stops[..4], &[1.0, 0.5, 0.0, 0.0]);
    }

    #[test]
    fn rounds_edges_so_neighbours_stay_adjacent() {
        let left = place(&region(0.0, 0.0, 10.3, 5.0), 1.25).unwrap().rect;
        let right = place(&region(10.3, 0.0, 10.3, 5.0), 1.25).unwrap().rect;
        assert_eq!(left.right(), right.x);
    }

    #[test]
    fn rejects_empty_rects() {
        assert_eq!(place(&region(5.0, 5.0, 0.2, 10.0), 1.0), None);
    }

    #[test]
    fn sigma_follows_strength_and_height() {
        assert_eq!(sigma_px(1, 1080), 20.0);
        assert!((sigma_px(1, 1600) - 29.63).abs() < 0.01);
        assert_eq!(sigma_px(3, 1080), 40.0);
        assert_eq!(sigma_px(0, 1080), 20.0);
        assert_eq!(sigma_px(9, 1080), 40.0);
    }

    #[test]
    fn source_box_adds_a_clamped_margin_in_multiples_of_four() {
        let panel = Rect { x: 569, y: 412, w: 1422, h: 865 };
        let source = source_box(panel, 90, (2560, 1600)).unwrap();
        assert_eq!((source.x, source.y), (479, 322));
        assert_eq!((source.w % 4, source.h % 4), (0, 0));
        assert!(source.right() <= 2560 && source.bottom() <= 1600);
        // A full-window panel has no margin and loses at most 3 px to the multiple of 4.
        let full = source_box(Rect { x: 0, y: 0, w: 2558, h: 1600 }, 90, (2558, 1600)).unwrap();
        assert_eq!((full.x, full.y, full.w, full.h), (0, 0, 2556, 1600));
        // Entirely outside the frame.
        assert_eq!(source_box(Rect { x: 3000, y: 0, w: 100, h: 100 }, 10, (2560, 1600)), None);
    }

    #[test]
    fn sanitize_drops_unusable_regions_and_caps_count() {
        let mut regions = vec![
            region(f64::NAN, 0.0, 10.0, 10.0),
            region(0.0, 0.0, 0.0, 10.0),
            Region { alpha: 0.0, ..region(0.0, 0.0, 10.0, 10.0) },
            Region { alpha: 3.0, radius: -4.0, ..region(0.0, 0.0, 10.0, 10.0) },
        ];
        let kept = sanitize(regions.clone());
        assert_eq!(kept.len(), 1);
        assert_eq!((kept[0].alpha, kept[0].radius), (1.0, 0.0));
        regions.extend(std::iter::repeat_n(region(0.0, 0.0, 10.0, 10.0), MAX_REGIONS + 5));
        assert_eq!(sanitize(regions).len(), MAX_REGIONS);
        let turned = Region { angle: f64::INFINITY, ..region(0.0, 0.0, 10.0, 10.0) };
        assert!(sanitize(vec![turned]).is_empty());
    }

    #[test]
    fn sanitize_keeps_usable_fades_only() {
        let fade = |offset: f64, length: f64, stops: Vec<f64>| Some(Fade { offset, length, stops });
        let with = |fade: Option<Fade>| sanitize(vec![Region { fade, ..region(0.0, 0.0, 10.0, 10.0) }]).remove(0).fade;
        assert_eq!(with(fade(0.0, 100.0, vec![2.0, -1.0])), fade(0.0, 100.0, vec![1.0, 0.0]));
        assert_eq!(with(fade(0.0, 100.0, vec![1.0])), None, "one sample is not a profile");
        assert_eq!(with(fade(0.0, 100.0, vec![1.0; MAX_FADE_STOPS + 1])), None, "more than the shader holds");
        assert_eq!(with(fade(0.0, 0.0, vec![1.0, 0.0])), None, "an empty span");
        assert_eq!(with(fade(f64::NAN, 100.0, vec![1.0, 0.0])), None);
        assert_eq!(with(fade(0.0, 100.0, vec![1.0, f64::NAN])), None);
    }
}
