// Uncaught page errors to the diagnostics log (slui.log): a render error without a boundary unmounts the whole
// window's tree, and a release build has no console anyone reads. Messages and stacks only (no page content).

/** Longest logged line; a stack is cut to its first frames. */
export const MAX_PAGE_ERROR_LENGTH = 600;
/** Lines one page logs; an error repeating every frame must not fill the log. */
export const MAX_PAGE_ERROR_LINES = 20;
const STACK_FRAMES = 4;

/** One line for an error value: its name and message, and the first stack frames. */
export function describePageError(error: unknown): string {
  const text = error instanceof Error
    ? [`${error.name}: ${error.message}`, ...(error.stack ?? "").split("\n").slice(1, 1 + STACK_FRAMES).map((frame) => frame.trim())].filter(Boolean).join(" | ")
    : String(error);
  return text.replace(/\s+/g, " ").slice(0, MAX_PAGE_ERROR_LENGTH);
}

/** The first frames of a React component stack, on one line. */
export function describeComponentStack(stack: string | null | undefined): string {
  if (!stack) return "";
  const frames = stack.split("\n").map((frame) => frame.trim()).filter(Boolean).slice(0, STACK_FRAMES);
  return frames.length > 0 ? ` | components: ${frames.join(" < ")}`.slice(0, MAX_PAGE_ERROR_LENGTH) : "";
}

/** A logger that stops after `limit` lines, saying so once. */
export function createPageErrorLog(write: (message: string) => void, limit = MAX_PAGE_ERROR_LINES): (message: string) => void {
  let count = 0;
  return (message) => {
    count += 1;
    if (count <= limit) write(message.slice(0, MAX_PAGE_ERROR_LENGTH));
    else if (count === limit + 1) write(`page errors: more than ${limit}, later ones not logged`);
  };
}

/** One line to the diagnostics log (slui.log); the browser preview prints it to the console. */
export async function writeDiagnostic(message: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    console.info(`SLGO page: ${message}`);
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("log_overlay_event", { message });
}

/**
 * Logs uncaught errors and unhandled rejections of this window, prefixed with `label()` (the window label once known), and
 * returns React root options that log uncaught and caught render errors the same way.
 */
export function installPageErrorLog(label: () => string) {
  const log = createPageErrorLog((message) => {
    void writeDiagnostic(`${label()} ${message}`).catch((error: unknown) => console.error("Unable to log a page error", error));
  });
  window.addEventListener("error", (event) => {
    const where = event.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : "";
    log(`page error: ${describePageError(event.error ?? event.message)}${where}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    log(`unhandled rejection: ${describePageError(event.reason)}`);
  });
  return {
    onUncaughtError(error: unknown, info: { componentStack?: string }) {
      console.error(error);
      log(`render error (tree unmounted): ${describePageError(error)}${describeComponentStack(info.componentStack)}`);
    },
    onCaughtError(error: unknown, info: { componentStack?: string }) {
      console.error(error);
      log(`render error (caught): ${describePageError(error)}${describeComponentStack(info.componentStack)}`);
    },
  };
}
