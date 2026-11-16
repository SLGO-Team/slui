import { memo, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { ReplayCatalogEntry } from "../../contracts";
import { useOverlayScale } from "../../shared/overlay.ts";
import { validatePinReason } from "./commands.ts";
import type { ReplayCatalogFilters, ReplayFeatureState, ReplayTestFilter } from "./model.ts";
import { formatCatalogDuration, formatCatalogPage, formatCatalogStart, REPLAY_TEXT, shortMatchId } from "./presentation.ts";
import "./ReplayCatalogPanel.css";

// The recordings list (design §4.3). CS2 has no in-game equivalent: it uses the demo controller's popup style
// (#303030f0, 18px #e0e0e0 entries) on a centred panel.

export type ReplayCatalogPanelProps = {
  catalog: ReplayFeatureState["catalog"];
  pending: ReplayFeatureState["pending"];
  /** The recording playing now (marked「正在播放」). */
  playingMatchId: string | null;
  onFilters(filters: ReplayCatalogFilters): void;
  /** Query a page with these filters; returns why it was not sent (bad dates), else null. */
  onQuery(page: number, filters: ReplayCatalogFilters): string | null;
  onLoad(matchId: string): void;
  onPin(matchId: string, reason: string): void;
  onUnpin(matchId: string): void;
  onClose(): void;
};

const TEST_OPTIONS: readonly { value: ReplayTestFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "only", label: "只看测试局" },
  { value: "exclude", label: "排除测试局" },
];

export const ReplayCatalogPanel = memo(function ReplayCatalogPanel({ catalog, pending, playingMatchId, onFilters, onQuery, onLoad, onPin, onUnpin, onClose }: ReplayCatalogPanelProps) {
  const scale = useOverlayScale();
  const [draft, setDraft] = useState(catalog.filters);
  const [formError, setFormError] = useState<string | null>(null);
  const [pinning, setPinning] = useState<{ matchId: string; reason: string; error: string | null } | null>(null);
  const page = catalog.page;
  const busy = (matchId: string) => Object.values(pending).some((command) => command.target === matchId);
  const querying = catalog.commandId !== null && page?.command_id !== catalog.commandId;

  // Esc closes the panel first (the console keeps the bar open).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pinning) setPinning(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, pinning]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onFilters(draft);
    setFormError(onQuery(1, draft));
  };
  const confirmPin = (event: FormEvent) => {
    event.preventDefault();
    if (!pinning) return;
    const checked = validatePinReason(pinning.reason);
    if (!checked.ok) return setPinning({ ...pinning, error: checked.error });
    onPin(pinning.matchId, checked.reason);
    setPinning(null);
  };
  const set = <K extends keyof ReplayCatalogFilters>(key: K, value: ReplayCatalogFilters[K]) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <section className="replay-catalog-overlay" aria-label={REPLAY_TEXT.tooltip.catalog}>
      <div className="replay-catalog-canvas" style={{ "--replay-scale": scale } as CSSProperties}>
        <div className="replay-catalog">
          <header className="replay-catalog__header">
            <span>{REPLAY_TEXT.tooltip.catalog}</span>
            <button type="button" className="replay-catalog__button" onClick={onClose}>关闭</button>
          </header>
          <form className="replay-catalog__filters" onSubmit={submit}>
            <label>服务器<input value={draft.serverId} maxLength={64} onChange={(event) => set("serverId", event.target.value)} /></label>
            <label title="17 位数字按 SteamID 精确匹配，否则按昵称包含">玩家<input value={draft.player} maxLength={64} placeholder="SteamID 或昵称"
              onChange={(event) => set("player", event.target.value)} /></label>
            <label>测试局<select value={draft.test} onChange={(event) => set("test", event.target.value as ReplayTestFilter)}>
              {TEST_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>
            <label className="replay-catalog__check"><input type="checkbox" checked={draft.pinnedOnly} onChange={(event) => set("pinnedOnly", event.target.checked)} />只看已 pin</label>
            <label>从<input type="date" value={draft.since} onChange={(event) => set("since", event.target.value)} /></label>
            <label>到<input type="date" value={draft.until} onChange={(event) => set("until", event.target.value)} /></label>
            <button type="submit" className="replay-catalog__button">查询</button>
          </form>
          {formError ?? catalog.rejected ?? page?.error ? <div className="replay-catalog__error">{formError ?? catalog.rejected ?? page?.error}</div> : null}
          <div className="replay-catalog__table" role="table">
            <div className="replay-catalog__row replay-catalog__row--head" role="row">
              <span>开始时间</span><span>服务器</span><span>模式</span><span>时长</span><span>比分</span><span>人数</span><span>标记</span><span />
            </div>
            {page?.entries.map((entry) => (
              <CatalogRow key={entry.match_id} entry={entry} playing={entry.match_id === playingMatchId} busy={busy(entry.match_id)}
                pinning={pinning?.matchId === entry.match_id ? pinning : null}
                onLoad={() => onLoad(entry.match_id)}
                onPin={() => setPinning({ matchId: entry.match_id, reason: "", error: null })}
                onUnpin={() => onUnpin(entry.match_id)}
                onPinReason={(reason) => setPinning({ matchId: entry.match_id, reason, error: null })}
                onPinConfirm={confirmPin}
                onPinCancel={() => setPinning(null)} />
            ))}
            {page && page.entries.length === 0 && !page.error ? <div className="replay-catalog__empty">没有符合条件的录像</div> : null}
            {!page || querying ? <div className="replay-catalog__empty">{querying ? "正在查询…" : "尚未查询"}</div> : null}
          </div>
          {page ? (
            <footer className="replay-catalog__pager">
              <button type="button" className="replay-catalog__button" disabled={page.page <= 1 || querying} onClick={() => setFormError(onQuery(page.page - 1, catalog.filters))}>上一页</button>
              <span>{formatCatalogPage(page.page, page.page_count, page.total)}</span>
              <button type="button" className="replay-catalog__button" disabled={page.page >= page.page_count || querying} onClick={() => setFormError(onQuery(page.page + 1, catalog.filters))}>下一页</button>
            </footer>
          ) : null}
        </div>
      </div>
    </section>
  );
});

function CatalogRow({ entry, playing, busy, pinning, onLoad, onPin, onUnpin, onPinReason, onPinConfirm, onPinCancel }: {
  entry: ReplayCatalogEntry;
  playing: boolean;
  busy: boolean;
  pinning: { reason: string; error: string | null } | null;
  onLoad(): void;
  onPin(): void;
  onUnpin(): void;
  onPinReason(reason: string): void;
  onPinConfirm(event: FormEvent): void;
  onPinCancel(): void;
}) {
  const tags = [
    playing ? "正在播放" : null,
    entry.recording ? REPLAY_TEXT.recording : null,
    entry.is_test ? REPLAY_TEXT.testMatch : null,
    entry.pinned ? "已 pin" : null,
    entry.readable ? null : "无法读取",
  ].filter((tag): tag is string => tag !== null);
  return (
    <>
      <div className="replay-catalog__row" role="row" data-playing={playing || undefined} title={entry.match_id}>
        <span>{formatCatalogStart(entry.started_at)}</span>
        <span>{entry.server_id}</span>
        <span>{entry.profile_id ?? "—"}</span>
        <span>{formatCatalogDuration(entry.duration_ms)}</span>
        <span>{entry.score ? `${entry.score["team-a"]} : ${entry.score["team-b"]}` : "—"}</span>
        <span>{entry.player_count ?? "—"}</span>
        <span className="replay-catalog__tags">{tags.join(" · ") || shortMatchId(entry.match_id)}</span>
        <span className="replay-catalog__actions">
          <button type="button" className="replay-catalog__button" disabled={!entry.readable || busy || playing} onClick={onLoad}>加载</button>
          {entry.pinned
            ? <button type="button" className="replay-catalog__button" disabled={busy} onClick={onUnpin}>取消 pin</button>
            : <button type="button" className="replay-catalog__button" disabled={busy || pinning !== null} onClick={onPin}>pin</button>}
        </span>
      </div>
      {pinning ? (
        <form className="replay-catalog__pin" onSubmit={onPinConfirm}>
          <input autoFocus value={pinning.reason} maxLength={200} placeholder="pin 原因（必填，128 字以内）" onChange={(event) => onPinReason(event.target.value)} />
          <button type="submit" className="replay-catalog__button">确认 pin</button>
          <button type="button" className="replay-catalog__button" onClick={onPinCancel}>取消</button>
          {pinning.error ? <span className="replay-catalog__error">{pinning.error}</span> : null}
        </form>
      ) : null}
    </>
  );
}
