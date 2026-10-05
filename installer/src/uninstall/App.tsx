import { useEffect, useReducer, useRef } from "react";
import { initialState, reduce } from "./model.ts";
import { uninstallPlatform as platform } from "./platform.ts";
import { WindowControls } from "../screens/WindowControls.tsx";
import { LoadFailure } from "../screens/Error.tsx";
import { Confirm } from "./screens/Confirm.tsx";
import { Progress } from "./screens/Progress.tsx";
import { Done } from "./screens/Done.tsx";
import { Failure, NotInstalled } from "./screens/Error.tsx";

// Screen switch and side effects only; every transition lives in model.ts.
export function UninstallApp() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const startedRun = useRef(0);

  useEffect(() => {
    platform.detect().then(
      (detect) => dispatch({ type: "detected", detect }),
      (error) => {
        console.error("slui-uninstall: detect failed", error);
        dispatch({ type: "detectFailed", message: String(error) });
      },
    );
  }, []);

  // One uninstall per run id; the ref keeps StrictMode's double effect from starting two.
  const run = state.run;
  useEffect(() => {
    if (!run || run.id <= startedRun.current) return;
    startedRun.current = run.id;
    const { id, ...request } = run;
    void platform
      .uninstall(request, (stage) => dispatch({ type: "stage", runId: id, stage }))
      .then((outcome) => dispatch({ type: "finished", runId: id, outcome }));
  }, [run]);

  const detect = state.detect;
  const installed = detect?.installed;
  const busy = state.screen === "progress";
  let body: React.ReactNode;
  if (!detect) {
    body = state.detectError
      ? <LoadFailure message={state.detectError} onClose={platform.close} />
      : <div className="setup-loading">正在检查安装状态…</div>;
  } else if (!installed) {
    body = <NotInstalled onClose={platform.close} />;
  } else {
    switch (state.screen) {
      case "confirm":
        body = <Confirm state={state} detect={detect} installed={installed}
          onOption={(option, value) => dispatch({ type: "optionChanged", option, value })}
          onStart={() => dispatch({ type: "start" })} onCancel={platform.close} />;
        break;
      case "progress":
        body = <Progress version={installed.version} run={state.run} stage={state.stage} />;
        break;
      case "done":
        body = state.outcome?.kind === "ok"
          ? <Done version={installed.version} outcome={state.outcome} onClose={platform.close} />
          : null;
        break;
      case "error":
        body = state.outcome?.kind === "failed"
          ? <Failure outcome={state.outcome} onRetry={() => dispatch({ type: "retry" })} onClose={platform.close} />
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
    <WindowControls closeDisabled={busy} busyTitle="卸载进行中，无法关闭"
      onMinimize={platform.minimize} onClose={platform.close} />
  </div>;
}

const NO_DRAG = "button, input, label, a, .setup-path, .setup-summary, .setup-notice, .setup-code";
