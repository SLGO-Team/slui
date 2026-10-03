// Pure installer model: classification, the screen reducer and the install-options gate.
// No DOM, Tauri or React here; scripts/installer-model-smoke.mjs runs it under node.

/** Installed version relative to the payload, decided by the Rust semver comparison. */
export type Relation = "older" | "same" | "newer";

export type Installed = { version: string; dir: string; relation: Relation };

/** `detect` command result. */
export type Detect = {
  payloadVersion: string;
  requiredBytes: number;
  defaultDir: string;
  installed: Installed | null;
  appRunning: boolean;
};

export type DirError = "not_absolute" | "invalid_chars" | "not_local" | "drive_root" | "not_directory";

/** `check_dir` command result. */
export type DirCheck = { normalized: string; freeBytes: number | null; error: DirError | null };

export type InstallMode = "fresh" | "update" | "reinstall";
export type Stage = "extracting" | "elevating" | "installing";

export type FailReason =
  | "downgrade"
  | "mode_mismatch"
  | "invalid_dir"
  | "insufficient_space"
  | "no_payload"
  | "extract_failed"
  | "launch_failed"
  | "exit_code"
  | "verify_failed"
  | "busy"
  | "internal";

export type InstallOutcome =
  | { kind: "ok"; dir: string }
  | { kind: "cancelled" }
  | { kind: "failed"; code: number | null; reason: FailReason; detail: string | null };

export type InstallRequest = { dir: string; mode: InstallMode; startMenuShortcut: boolean; desktopShortcut: boolean };

export type Shortcut = "startMenu" | "desktop";

/** What the welcome screen offers. */
export type Kind = "fresh" | "update" | "same" | "newerInstalled";

export function classify(detect: Detect): Kind {
  switch (detect.installed?.relation) {
    case undefined:
      return "fresh";
    case "older":
      return "update";
    case "same":
      return "same";
    case "newer":
      return "newerInstalled";
  }
}

export type Screen = "welcome" | "progress" | "done" | "error";

/** One install attempt; `id` changes per attempt so the App effect starts exactly one. */
export type Run = InstallRequest & { id: number };

export type State = {
  detect: Detect | null;
  detectError: string | null;
  screen: Screen;
  /** Install-options input and the check result for a given input. */
  dir: string;
  check: { input: string; result: DirCheck } | null;
  startMenuShortcut: boolean;
  desktopShortcut: boolean;
  /** Same version installed and the user opened the reinstall options. */
  reinstalling: boolean;
  run: Run | null;
  stage: Stage | null;
  outcome: InstallOutcome | null;
  notice: string | null;
  nextRunId: number;
};

export type Action =
  | { type: "detected"; detect: Detect }
  | { type: "detectFailed"; message: string }
  | { type: "openReinstall" }
  | { type: "closeReinstall" }
  | { type: "dirChanged"; dir: string }
  | { type: "dirChecked"; input: string; result: DirCheck }
  | { type: "shortcutChanged"; shortcut: Shortcut; value: boolean }
  | { type: "start"; mode: InstallMode }
  | { type: "stage"; runId: number; stage: Stage }
  | { type: "finished"; runId: number; outcome: InstallOutcome }
  | { type: "retry" };

export const initialState: State = {
  detect: null,
  detectError: null,
  screen: "welcome",
  dir: "",
  check: null,
  startMenuShortcut: true,
  desktopShortcut: true,
  reinstalling: false,
  run: null,
  stage: null,
  outcome: null,
  notice: null,
  nextRunId: 1,
};

export const CANCELLED_NOTICE = "已取消授权，未安装任何内容。";

/** Modes the welcome screen may start for a classification. */
export function welcomeModes(kind: Kind): InstallMode[] {
  switch (kind) {
    case "fresh":
      return ["fresh"];
    case "update":
      return ["update"];
    case "same":
      return ["reinstall"];
    case "newerInstalled":
      return [];
  }
}

/** Directory the install options start with: the default for a fresh install, else the installed one. */
export function initialDir(detect: Detect): string {
  return detect.installed?.dir ?? detect.defaultDir;
}

/** Whether the welcome screen shows the editable install options (location and shortcuts). */
export function optionsVisible(state: State): boolean {
  if (!state.detect || state.screen !== "welcome") return false;
  const kind = classify(state.detect);
  return kind === "fresh" || (kind === "same" && state.reinstalling);
}

export type Gate = { ok: true } | { ok: false; reason: string | null };

const DIR_ERROR_TEXT: Record<DirError, string> = {
  not_absolute: "请输入完整路径，例如 D:\\Program Files\\SLUI",
  invalid_chars: "路径包含 Windows 不允许的字符或名称",
  not_local: "只能安装到本机磁盘",
  drive_root: "不能直接安装到磁盘根目录，请选择一个文件夹",
  not_directory: "该路径已存在同名文件",
};

export function dirErrorText(error: DirError): string {
  return DIR_ERROR_TEXT[error];
}

/** Whether the install options allow installing; `reason: null` while the check is pending. */
export function optionsGate(state: State): Gate {
  const check = state.check;
  if (!state.detect || !check || check.input !== state.dir) return { ok: false, reason: null };
  if (check.result.error) return { ok: false, reason: dirErrorText(check.result.error) };
  const free = check.result.freeBytes;
  const required = state.detect.requiredBytes;
  if (free !== null && free < required) {
    return { ok: false, reason: `磁盘空间不足：需要 ${formatBytes(required)}，可用 ${formatBytes(free)}` };
  }
  return { ok: true };
}

export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function stageText(stage: Stage | null): string {
  switch (stage) {
    case null:
    case "extracting":
      return "准备安装文件";
    case "elevating":
      return "等待授权";
    case "installing":
      return "正在安装";
  }
}

export function failureSummary(outcome: Extract<InstallOutcome, { kind: "failed" }>): string {
  switch (outcome.reason) {
    case "downgrade":
      return "已安装更新版本的 SLUI，不能降级安装。";
    case "mode_mismatch":
      return "安装状态已变化，请重新打开安装程序。";
    case "invalid_dir":
      return "安装位置无效。";
    case "insufficient_space":
      return "磁盘空间不足。";
    case "no_payload":
      return "此安装程序是不含安装包的开发版本。";
    case "extract_failed":
      return "无法解压安装文件。";
    case "launch_failed":
      return "无法启动安装程序。";
    case "exit_code":
      return "安装程序报告失败。";
    case "verify_failed":
      return "安装已结束，但未检测到新版本的 SLUI。";
    case "busy":
      return "已有安装正在进行。";
    case "internal":
      return "安装程序内部错误。";
  }
}

function startRun(state: State, mode: InstallMode): State {
  const detect = state.detect;
  if (!detect || state.screen !== "welcome") return state;
  if (!welcomeModes(classify(detect)).includes(mode)) return state;
  const shortcuts = { startMenuShortcut: state.startMenuShortcut, desktopShortcut: state.desktopShortcut };
  // An update always goes into the installed dir and keeps the existing shortcuts.
  if (mode === "update") return beginRun(state, { dir: initialDir(detect), mode, ...shortcuts });
  if (!optionsVisible(state)) return state;
  const gate = optionsGate(state);
  if (!gate.ok || !state.check) return state;
  return beginRun(state, { dir: state.check.result.normalized, mode, ...shortcuts });
}

function beginRun(state: State, request: InstallRequest): State {
  return {
    ...state,
    screen: "progress",
    run: { ...request, id: state.nextRunId },
    nextRunId: state.nextRunId + 1,
    stage: null,
    outcome: null,
    notice: null,
  };
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "detected": {
      return { ...state, detect: action.detect, detectError: null, dir: initialDir(action.detect), check: null };
    }
    case "detectFailed":
      return { ...state, detectError: action.message };
    case "openReinstall":
      if (state.screen !== "welcome" || !state.detect || classify(state.detect) !== "same") return state;
      return { ...state, reinstalling: true, notice: null };
    case "closeReinstall":
      return state.reinstalling ? { ...state, reinstalling: false, notice: null } : state;
    case "dirChanged":
      return { ...state, dir: action.dir };
    case "dirChecked":
      return action.input === state.dir ? { ...state, check: { input: action.input, result: action.result } } : state;
    case "shortcutChanged":
      return action.shortcut === "startMenu"
        ? { ...state, startMenuShortcut: action.value }
        : { ...state, desktopShortcut: action.value };
    case "start":
      return startRun(state, action.mode);
    case "stage":
      return state.run?.id === action.runId && state.screen === "progress" ? { ...state, stage: action.stage } : state;
    case "finished": {
      const run = state.run;
      if (!run || run.id !== action.runId || state.screen !== "progress") return state;
      switch (action.outcome.kind) {
        case "ok":
          return { ...state, screen: "done", outcome: action.outcome };
        case "cancelled":
          return { ...state, screen: "welcome", outcome: null, notice: CANCELLED_NOTICE };
        case "failed":
          return { ...state, screen: "error", outcome: action.outcome };
      }
    }
    case "retry": {
      const run = state.run;
      if (state.screen !== "error" || !run) return state;
      const { id: _id, ...request } = run;
      return beginRun(state, request);
    }
  }
}
