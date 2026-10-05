// Pure uninstaller model: the screen reducer and the request built from the toggles.
// No DOM, Tauri or React here; scripts/uninstaller-model-smoke.mjs runs it under node.

export type InstalledEntry = { version: string; dir: string };

/** `uninstall_detect` command result. */
export type UninstallDetect = {
  installed: InstalledEntry | null;
  /** `<dir>\theme-pack` exists. */
  themePack: boolean;
  /** One of the user's SLUI data directories exists. */
  userData: boolean;
  appRunning: boolean;
};

export type Stage = "preparing" | "elevating" | "uninstalling" | "cleaning";

export type FailReason =
  | "not_installed"
  | "copy_failed"
  | "launch_failed"
  | "exit_code"
  | "verify_failed"
  | "busy"
  | "internal";

export type UninstallOutcome =
  | { kind: "ok"; dir: string; themePackKept: boolean; userDataError: string | null }
  | { kind: "cancelled" }
  | { kind: "failed"; code: number | null; reason: FailReason; detail: string | null };

export type UninstallRequest = { themePack: boolean; userData: boolean };

export type UninstallOption = keyof UninstallRequest;

export type Screen = "confirm" | "progress" | "done" | "error";

/** One uninstall attempt; `id` changes per attempt so the App effect starts exactly one. */
export type Run = UninstallRequest & { id: number };

export type State = {
  detect: UninstallDetect | null;
  detectError: string | null;
  screen: Screen;
  /** Toggle state; only applies while the option is offered (see `offered`). */
  themePack: boolean;
  userData: boolean;
  run: Run | null;
  stage: Stage | null;
  outcome: UninstallOutcome | null;
  notice: string | null;
  nextRunId: number;
};

export type Action =
  | { type: "detected"; detect: UninstallDetect }
  | { type: "detectFailed"; message: string }
  | { type: "optionChanged"; option: UninstallOption; value: boolean }
  | { type: "start" }
  | { type: "stage"; runId: number; stage: Stage }
  | { type: "finished"; runId: number; outcome: UninstallOutcome }
  | { type: "retry" };

export const initialState: State = {
  detect: null,
  detectError: null,
  screen: "confirm",
  // Both default to keeping: the theme pack is content the user added, the data is theirs.
  themePack: false,
  userData: false,
  run: null,
  stage: null,
  outcome: null,
  notice: null,
  nextRunId: 1,
};

export const CANCELLED_NOTICE = "已取消授权，未卸载任何内容。";

/** Whether the confirm screen offers a toggle: only for something that is there. */
export function offered(detect: UninstallDetect, option: UninstallOption): boolean {
  return option === "themePack" ? detect.themePack : detect.userData;
}

/** What 卸载 asks for: the toggles that are both offered and on. */
export function request(state: State): UninstallRequest | null {
  const detect = state.detect;
  if (!detect?.installed) return null;
  return {
    themePack: state.themePack && offered(detect, "themePack"),
    userData: state.userData && offered(detect, "userData"),
  };
}

/** Stages a run goes through; cleaning only when the user data goes too. */
export function stages(run: UninstallRequest | null): Stage[] {
  const base: Stage[] = ["preparing", "elevating", "uninstalling"];
  return run?.userData ? [...base, "cleaning"] : base;
}

export function stageText(stage: Stage | null): string {
  switch (stage) {
    case null:
    case "preparing":
      return "准备卸载";
    case "elevating":
      return "等待授权";
    case "uninstalling":
      return "正在卸载";
    case "cleaning":
      return "清理用户数据";
  }
}

export function failureSummary(outcome: Extract<UninstallOutcome, { kind: "failed" }>): string {
  switch (outcome.reason) {
    case "not_installed":
      return "未找到已安装的 SLUI。";
    case "copy_failed":
      return "无法准备卸载文件。";
    case "launch_failed":
      return "无法启动卸载程序。";
    case "exit_code":
      return "卸载程序报告失败。";
    case "verify_failed":
      return "卸载已结束，但 SLUI 仍有文件或注册信息残留。";
    case "busy":
      return "已有卸载正在进行。";
    case "internal":
      return "卸载程序内部错误。";
  }
}

function beginRun(state: State, uninstall: UninstallRequest): State {
  return {
    ...state,
    screen: "progress",
    run: { ...uninstall, id: state.nextRunId },
    nextRunId: state.nextRunId + 1,
    stage: null,
    outcome: null,
    notice: null,
  };
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "detected":
      return { ...state, detect: action.detect, detectError: null };
    case "detectFailed":
      return { ...state, detectError: action.message };
    case "optionChanged":
      if (state.screen !== "confirm") return state;
      return action.option === "themePack"
        ? { ...state, themePack: action.value }
        : { ...state, userData: action.value };
    case "start": {
      const uninstall = request(state);
      return state.screen === "confirm" && uninstall ? beginRun(state, uninstall) : state;
    }
    case "stage":
      return state.run?.id === action.runId && state.screen === "progress" ? { ...state, stage: action.stage } : state;
    case "finished": {
      if (state.run?.id !== action.runId || state.screen !== "progress") return state;
      switch (action.outcome.kind) {
        case "ok":
          return { ...state, screen: "done", outcome: action.outcome };
        case "cancelled":
          return { ...state, screen: "confirm", outcome: null, notice: CANCELLED_NOTICE };
        case "failed":
          return { ...state, screen: "error", outcome: action.outcome };
      }
    }
    case "retry": {
      const run = state.run;
      if (state.screen !== "error" || !run) return state;
      const { id: _id, ...uninstall } = run;
      return beginRun(state, uninstall);
    }
  }
}
