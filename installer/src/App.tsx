import { useEffect, useReducer, useRef, useState } from "react";
import { classify, initialState, optionsVisible, reduce } from "./model.ts";
import { platform } from "./platform.ts";
import { WindowControls } from "./screens/WindowControls.tsx";
import { Welcome } from "./screens/Welcome.tsx";
import { Progress } from "./screens/Progress.tsx";
import { Done } from "./screens/Done.tsx";
import { Failure, LoadFailure } from "./screens/Error.tsx";

// Screen switch and side effects only; every transition lives in model.ts.
export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const startedRun = useRef(0);

  useEffect(() => {
    platform.detect().then(
      (detect) => dispatch({ type: "detected", detect }),
      (error) => {
        console.error("slui-setup: detect failed", error);
        dispatch({ type: "detectFailed", message: String(error) });
      },
    );
  }, []);

  // The install options re-check the directory as the user types.
  const options = optionsVisible(state);
  useEffect(() => {
    if (!options) return;
    const input = state.dir;
    const timer = window.setTimeout(() => {
      platform.checkDir(input).then(
        (result) => dispatch({ type: "dirChecked", input, result }),
        (error) => console.error("slui-setup: check_dir failed", error),
      );
    }, 120);
    return () => window.clearTimeout(timer);
  }, [options, state.dir]);

  // One install per run id; the ref keeps StrictMode's double effect from starting two.
  const run = state.run;
  useEffect(() => {
    if (!run || run.id <= startedRun.current) return;
    startedRun.current = run.id;
    const { id, ...request } = run;
    void platform
      .install(request, (stage) => dispatch({ type: "stage", runId: id, stage }))
      .then((outcome) => dispatch({ type: "finished", runId: id, outcome }));
  }, [run]);

  const launch = () => {
    setLaunchError(null);
    platform.launch().catch((error) => {
      console.error("slui-setup: launch failed", error);
      setLaunchError(String(error));
    });
  };

  const detect = state.detect;
  const installing = state.screen === "progress";
  let body: React.ReactNode;
  if (!detect) {
    body = state.detectError
      ? <LoadFailure message={state.detectError} onClose={platform.close} />
      : <div className="setup-loading">正在检查安装状态…</div>;
  } else {
    const kind = classify(detect);
    switch (state.screen) {
      case "welcome":
        body = <Welcome state={state} detect={detect} kind={kind} options={options} launchError={launchError}
          onStart={(mode) => dispatch({ type: "start", mode })} onLaunch={launch}
          onReinstall={() => dispatch({ type: "openReinstall" })}
          onCloseReinstall={() => dispatch({ type: "closeReinstall" })}
          onDirChange={(dir) => dispatch({ type: "dirChanged", dir })}
          onBrowse={() => platform.pickDir(state.dir).then(
            (dir) => dir !== null && dispatch({ type: "dirChanged", dir }),
            (error) => console.error("slui-setup: pick_dir failed", error),
          )}
          onShortcutChange={(shortcut, value) => dispatch({ type: "shortcutChanged", shortcut, value })} />;
        break;
      case "progress":
        body = <Progress detect={detect} mode={state.run?.mode ?? "fresh"} stage={state.stage} />;
        break;
      case "done":
        body = <Done detect={detect} mode={state.run?.mode ?? "fresh"}
          dir={state.outcome?.kind === "ok" ? state.outcome.dir : (state.run?.dir ?? "")}
          launchError={launchError} onLaunch={launch} onClose={platform.close} />;
        break;
      case "error":
        body = state.outcome?.kind === "failed"
          ? <Failure outcome={state.outcome} mode={state.run?.mode ?? "fresh"}
            onRetry={() => dispatch({ type: "retry" })} onClose={platform.close} />
          : null;
        break;
    }
  }

  // No title bar: any spot that is not a control or selectable text drags the window.
  const drag = (event: React.MouseEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest(NO_DRAG)) return;
    platform.startDragging();
  };

  return <div className="setup" onMouseDown={drag}>
    <main className="setup-main" key={state.screen}>{body}</main>
    <WindowControls closeDisabled={installing} onMinimize={platform.minimize} onClose={platform.close} />
  </div>;
}

const NO_DRAG = "button, input, label, a, .setup-path, .setup-summary, .setup-notice, .setup-code";
