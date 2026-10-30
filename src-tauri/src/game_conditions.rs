//! Conditions under which SLUI cannot take input over the game, published to both pages (`slgo-game-conditions`):
//!
//! - the game runs elevated and SLUI does not: the keyboard hook sees no keys sent to the game and Windows refuses
//!   the overlay the foreground (UIPI);
//! - the game runs in exclusive fullscreen: it minimizes itself as soon as it loses the foreground, which every
//!   overlay panel that takes input makes it do.
//!
//! Rust only detects them. The overlay page hands the input-taking features back to the plugin's in-game UI while
//! one holds, and the home page explains it.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameConditions {
    /// The current game process runs elevated and SLUI does not. False when unknown or without a game.
    elevated_game: bool,
    /// The latched display-mode verdict; false while unknown or without a game.
    exclusive_fullscreen: bool,
    revision: u64,
}

#[tauri::command]
pub fn get_game_conditions(state: tauri::State<'_, Mutex<GameConditions>>) -> Result<GameConditions, String> {
    state
        .lock()
        .map(|state| *state)
        .map_err(|_| "Game conditions unavailable".into())
}

/// Stores and emits the conditions when they change.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn publish(app: &AppHandle, elevated_game: bool, exclusive_fullscreen: bool) {
    let state = app.state::<Mutex<GameConditions>>();
    let Ok(mut state) = state.lock() else {
        diag!("SLGO: game conditions unavailable");
        return;
    };
    if state.elevated_game == elevated_game && state.exclusive_fullscreen == exclusive_fullscreen {
        return;
    }
    state.elevated_game = elevated_game;
    state.exclusive_fullscreen = exclusive_fullscreen;
    state.revision += 1;
    let snapshot = *state;
    drop(state);
    diag!(
        "SLGO: game conditions: elevated game {elevated_game}, exclusive fullscreen {exclusive_fullscreen} \
         (revision {}); SLUI input {}",
        snapshot.revision,
        if elevated_game || exclusive_fullscreen { "blocked" } else { "available" }
    );
    if let Err(error) = app.emit("slgo-game-conditions", snapshot) {
        diag!("SLGO: failed to emit game conditions: {error}");
    }
}

/// The game's display mode, latched from `SHQueryUserNotificationState` readings taken while the game holds the
/// foreground and is not minimized (in any other state the shell reports the window in front, not the game).
/// Exclusive fullscreen reads `QUNS_RUNNING_D3D_FULL_SCREEN` steadily, borderless and windowed modes `QUNS_BUSY`;
/// mode switches show short (<= ~0.25 s) other readings, so a verdict is adopted only after one reading has held
/// for `STABLE` without a gap.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Default)]
pub struct DisplayModeLatch {
    verdict: Option<bool>,
    candidate: Option<(bool, Instant)>,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl DisplayModeLatch {
    pub const STABLE: Duration = Duration::from_secs(1);

    /// One reading (`exclusive`: the state was `QUNS_RUNNING_D3D_FULL_SCREEN`). Returns the verdict it adopts.
    pub fn sample(&mut self, exclusive: bool, now: Instant) -> Option<bool> {
        if self.verdict == Some(exclusive) {
            self.candidate = None;
            return None;
        }
        match self.candidate {
            Some((candidate, since)) if candidate == exclusive => {
                if now.saturating_duration_since(since) < Self::STABLE {
                    return None;
                }
                self.verdict = Some(exclusive);
                self.candidate = None;
                Some(exclusive)
            }
            _ => {
                self.candidate = Some((exclusive, now));
                None
            }
        }
    }

    /// No reading (the game is not in front, is minimized, or the query failed): only continuous agreement counts.
    pub fn gap(&mut self) {
        self.candidate = None;
    }

    /// Unknown again: the game process changed or exited.
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn exclusive(&self) -> bool {
        self.verdict == Some(true)
    }
}

/// The foreground thread's view of the game window: its minimized state (logged on change, the evidence for the
/// exclusive-fullscreen hand-back) and its display mode. Sampled every `SAMPLE_EVERY` foreground ticks while the game
/// holds the foreground.
#[cfg(windows)]
pub struct GameWindowWatch {
    window: isize,
    iconic: Option<bool>,
    ticks: u32,
    latch: DisplayModeLatch,
}

#[cfg(windows)]
impl GameWindowWatch {
    const SAMPLE_EVERY: u32 = 3;

    pub fn new() -> Self {
        Self { window: 0, iconic: None, ticks: 0, latch: DisplayModeLatch::default() }
    }

    /// The game process changed or exited.
    pub fn reset(&mut self) {
        self.window = 0;
        self.iconic = None;
        self.ticks = 0;
        self.latch.reset();
    }

    pub fn exclusive(&self) -> bool {
        self.latch.exclusive()
    }

    /// One foreground tick. `game_window`: the foreground window when it is the game's, else null.
    pub fn tick(&mut self, game_window: windows_sys::Win32::Foundation::HWND, now: Instant) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, IsWindow};

        if !game_window.is_null() && game_window as isize != self.window {
            self.window = game_window as isize;
            self.iconic = None;
        }
        let window = self.window as windows_sys::Win32::Foundation::HWND;
        let mut iconic = false;
        if !window.is_null() {
            if unsafe { IsWindow(window) } == 0 {
                self.window = 0;
                self.iconic = None;
            } else {
                iconic = unsafe { IsIconic(window) } != 0;
                if self.iconic.is_some_and(|was| was != iconic) {
                    diag!("SLGO: game window {}", if iconic { "minimized" } else { "restored" });
                }
                self.iconic = Some(iconic);
            }
        }

        if game_window.is_null() || iconic {
            self.latch.gap();
            return;
        }
        self.ticks = self.ticks.wrapping_add(1);
        if !self.ticks.is_multiple_of(Self::SAMPLE_EVERY) {
            return;
        }
        let Some(state) = notification_state() else {
            self.latch.gap();
            return;
        };
        let exclusive = state == windows_sys::Win32::UI::Shell::QUNS_RUNNING_D3D_FULL_SCREEN;
        if let Some(verdict) = self.latch.sample(exclusive, now) {
            diag!(
                "SLGO: game display mode: {} (notification state {state})",
                if verdict { "exclusive fullscreen" } else { "not exclusive fullscreen" }
            );
        }
    }
}

#[cfg(windows)]
fn notification_state() -> Option<i32> {
    use windows_sys::Win32::UI::Shell::SHQueryUserNotificationState;

    let mut state = 0;
    (unsafe { SHQueryUserNotificationState(&mut state) } >= 0).then_some(state)
}

#[cfg(test)]
mod tests {
    use super::DisplayModeLatch;
    use std::time::{Duration, Instant};

    const EXCLUSIVE: bool = true;
    const BUSY: bool = false;

    /// Feeds readings 300 ms apart (the sampling rate); returns every adopted verdict with its sample index.
    fn feed(latch: &mut DisplayModeLatch, start: Instant, readings: &[bool]) -> Vec<(usize, bool)> {
        readings
            .iter()
            .enumerate()
            .filter_map(|(index, &reading)| {
                latch.sample(reading, start + Duration::from_millis(300 * index as u64)).map(|verdict| (index, verdict))
            })
            .collect()
    }

    #[test]
    fn exclusive_fullscreen_is_adopted_after_a_second_of_agreement() {
        let mut latch = DisplayModeLatch::default();
        let adopted = feed(&mut latch, Instant::now(), &[EXCLUSIVE; 8]);
        assert_eq!(adopted, [(4, EXCLUSIVE)], "1.2 s after the first reading, within the 1.5 s budget");
        assert!(latch.exclusive());
    }

    #[test]
    fn a_steady_busy_reading_is_not_exclusive() {
        let mut latch = DisplayModeLatch::default();
        assert_eq!(feed(&mut latch, Instant::now(), &[BUSY; 8]), [(4, BUSY)]);
        assert!(!latch.exclusive());
    }

    #[test]
    fn short_busy_readings_in_exclusive_mode_never_flip_the_verdict() {
        let mut latch = DisplayModeLatch::default();
        // The probe: a mode switch starts with a short BUSY, then reads exclusive; later transients last one sample.
        let readings = [BUSY, EXCLUSIVE, EXCLUSIVE, EXCLUSIVE, EXCLUSIVE, EXCLUSIVE, BUSY, EXCLUSIVE, EXCLUSIVE, BUSY, EXCLUSIVE];
        assert_eq!(feed(&mut latch, Instant::now(), &readings), [(5, EXCLUSIVE)]);
        assert!(latch.exclusive());
    }

    #[test]
    fn a_gap_ends_the_candidate() {
        let mut latch = DisplayModeLatch::default();
        let start = Instant::now();
        assert!(feed(&mut latch, start, &[BUSY; 3]).is_empty());
        latch.gap();
        assert_eq!(latch.sample(BUSY, start + Duration::from_millis(1_200)), None, "the gap restarted the candidate");
        assert_eq!(latch.sample(BUSY, start + Duration::from_millis(2_200)), Some(BUSY));
    }

    #[test]
    fn switching_to_borderless_flips_the_verdict_and_a_reset_forgets_it() {
        let mut latch = DisplayModeLatch::default();
        let start = Instant::now();
        feed(&mut latch, start, &[EXCLUSIVE; 5]);
        assert!(latch.exclusive());
        let later = start + Duration::from_secs(10);
        assert_eq!(feed(&mut latch, later, &[BUSY; 5]), [(4, BUSY)]);
        assert!(!latch.exclusive());
        feed(&mut latch, later + Duration::from_secs(10), &[EXCLUSIVE; 5]);
        latch.reset();
        assert!(!latch.exclusive(), "unknown again");
    }
}
