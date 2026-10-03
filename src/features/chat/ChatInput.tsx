import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useOverlayScale } from "../../shared/overlay";
import { CHAT_LINE_FADE_MS, chatLineFadeDelayMs, visibleChatLines, type ChatCloseReason, type ChatInputState, type ChatLine } from "./model";
import {
  CHAT_GLOBAL_TAG,
  CHAT_NOTICE_TONE_COLORS,
  CHAT_PLACEHOLDER,
  CHAT_SEND_LABEL,
  CHAT_TEAM_FALLBACK_TAG,
  resolveChatSender,
  type ChatRowStyle,
} from "./presentation";
import "./ChatInput.css";

type ChatInputProps = {
  chat: ChatInputState;
  nowMs: number;
  /** How the local player's echoed rows are labelled and coloured. */
  self: ChatRowStyle;
  onDraft(text: string): void;
  onToggleScope(): void;
  /** Called with the raw draft; the caller validates and builds the command. */
  onSubmit(body: string): void;
  onClose(reason: ChatCloseReason): void;
  /** Focus diagnostics for the desktop log. */
  onDiagnostic?(message: string): void;
};

// The keys that open chat; holding one must not type it into the new input.
const OPENING_KEYS = new Set(["KeyY", "KeyU"]);

// CS2 row: "[ALL] ● Name:  body" or "[T] ● Name@Place: body"; every player, the local
// one included, uses this format. Plugin notices are coloured segments without tag or dot.
// A lingering row fades with a compositor animation; its delay is fixed when the row
// mounts, so the 250ms clock that removes finished rows never makes the fade step.
function ChatRow({ line, self, lingering }: { line: ChatLine; self: ChatRowStyle; lingering: boolean }) {
  const [fadeDelayMs] = useState(() => chatLineFadeDelayMs(line, Date.now()));
  const fade: CSSProperties = lingering ? { animationDelay: `${fadeDelayMs}ms`, animationDuration: `${CHAT_LINE_FADE_MS}ms` } : {};
  if (line.kind === "system") return <p className="chat-line" data-kind="system" style={fade}>{line.text}</p>;
  if (line.kind === "notice") {
    return (
      <p className="chat-line" data-kind="notice" style={fade}>
        {line.segments.map((segment, index) => <span key={index} style={{ color: CHAT_NOTICE_TONE_COLORS[segment.tone] }}>{segment.text}</span>)}
      </p>
    );
  }
  const row = line.sender ? resolveChatSender(line.sender) : self;
  const team = line.scope === "team";
  return (
    <p className="chat-line" data-kind="player" data-echo={line.sender === null} style={{ "--chat-team-color": row.teamColor, ...fade } as CSSProperties}>
      <span className="chat-line-tag" data-team={team}>{team ? row.teamTag ?? CHAT_TEAM_FALLBACK_TAG : CHAT_GLOBAL_TAG}</span>
      {" "}<span className="chat-line-dot" style={{ color: row.dotColor }} aria-hidden="true" />
      {" "}<span className="chat-line-name">{row.name}</span>
      {team ? ": " : ":  "}{line.body}
    </p>
  );
}

// A manual React recreation of CS2 layout/hud/hudchat.xml; class names follow the
// Panorama ids (ChatContainer, ChatMain, ChatFG, ChatHistory, ChatTextEntry, ...).
export function ChatInput({ chat, nowMs, self, onDraft, onToggleScope, onSubmit, onClose, onDiagnostic }: ChatInputProps) {
  const scale = useOverlayScale();
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const openingKeyHeldRef = useRef(false);
  const lines = visibleChatLines(chat, nowMs);
  const newestLineId = chat.lines[chat.lines.length - 1]?.id;

  useEffect(() => {
    if (!chat.open) return undefined;
    openingKeyHeldRef.current = true;
    // The desktop overlay becomes the foreground window only after this renders. Until
    // the window has had focus, a blur is part of taking the keyboard, not the player
    // leaving.
    let hasKeyboard = document.hasFocus();
    const openedAt = performance.now();
    const since = () => `${Math.round(performance.now() - openedAt)}ms`;
    onDiagnostic?.(`chat opened (window focused: ${hasKeyboard})`);
    const focusInput = () => inputRef.current?.focus();
    const onWindowFocus = () => {
      onDiagnostic?.(`chat window focus at ${since()}`);
      hasKeyboard = true;
      focusInput();
    };
    // Switching windows hands the keyboard back at once; the draft stays.
    const onWindowBlur = () => {
      onDiagnostic?.(`chat window blur at ${since()} (had keyboard: ${hasKeyboard})`);
      if (hasKeyboard) onClose("blur");
    };
    // The interactive overlay takes every click in its window, so a click outside the
    // panel closes it here.
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node && mainRef.current?.contains(event.target))) onClose("blur");
    };
    focusInput();
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [chat.open, onClose, onDiagnostic]);

  // Rows start at the top; once they overflow, the history follows the newest row.
  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [chat.open, newestLineId]);

  if (!chat.open && lines.length === 0) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // An IME composition owns Enter/Esc until it commits.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.repeat && openingKeyHeldRef.current && OPENING_KEYS.has(event.code)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!event.repeat) onSubmit(chat.draft);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose("escape");
    } else if (event.key === "Tab") {
      // Not in CS2: a hidden switch between global and team.
      event.preventDefault();
      onToggleScope();
    }
  };

  const rows = lines.map((line) => <ChatRow key={line.id} line={line} self={self} lingering={!chat.open} />);
  return (
    <section className="chat-overlay" data-open={chat.open} aria-label="聊天" style={{ "--chat-scale": scale } as CSSProperties}>
      {chat.open ? (
        <div className="chat-container">
          <div className="chat-main" ref={mainRef}>
            <div className="chat-bg" />
            <div className="chat-fg">
              <div className="chat-history">
                <div className="chat-history-text" ref={historyRef} role="log">{rows}</div>
              </div>
              <div className="chat-text-entry">
                <div className="chat-text-entry-fg">
                  <input
                    ref={inputRef}
                    className="chat-text-entry-box"
                    value={chat.draft}
                    placeholder={CHAT_PLACEHOLDER[chat.scope]}
                    aria-label={CHAT_PLACEHOLDER[chat.scope]}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => onDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                    onKeyUp={(event) => {
                      if (OPENING_KEYS.has(event.code)) openingKeyHeldRef.current = false;
                    }}
                    // Focus moved inside the page (WebView2 taking focus, a click on the
                    // history): keep typing here. Leaving is handled at the window level.
                    onBlur={() => window.setTimeout(() => {
                      if (document.hasFocus() && document.activeElement !== inputRef.current) inputRef.current?.focus();
                    }, 0)}
                  />
                  {/* CS2 keeps the button enabled; an empty draft simply sends nothing. */}
                  <button
                    type="button"
                    className="chat-send-button"
                    // Keep focus in the text field so the click does not close the input.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSubmit(chat.draft)}
                  >
                    <span>{CHAT_SEND_LABEL}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        // Closed: recent rows linger at the screen's bottom-left without any panel.
        <div className="chat-recent" role="log">{rows}</div>
      )}
    </section>
  );
}
