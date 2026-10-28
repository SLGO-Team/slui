import { useEffect, useMemo, useState } from "react";
import { createGameProcessSource, isTauri } from "../platform/desktop";

/**
 * Whether the game process runs, as Rust's process probe reports it; null until its first answer. The browser
 * preview and the `mock` mode have no game process and always run.
 */
export function useGameRunning(): boolean | null {
  const tracked = isTauri() && import.meta.env.MODE !== "mock";
  const source = useMemo(() => tracked ? createGameProcessSource() : null, [tracked]);
  const [running, setRunning] = useState<boolean | null>(tracked ? null : true);
  useEffect(() => {
    if (!source) return undefined;
    let active = true;
    let changed = false;
    const unsubscribe = source.subscribe((value) => {
      changed = true;
      setRunning(value);
    });
    void source.get().then((value) => {
      if (active && !changed) setRunning(value);
    }).catch((error: unknown) => {
      console.error("Unable to read the game process state", error);
      // Unknown is treated as running, as before the probe existed: the session never waits on a broken probe.
      if (active && !changed) setRunning(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [source]);
  return running;
}
