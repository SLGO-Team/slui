import { useState } from "react";
import type { CareerSource } from "../../../platform/career.ts";
import { CareerMatchView } from "./CareerMatchView";
import { CareerHeader, CareerNotice } from "./CareerParts";
import { CareerProfileView } from "./CareerProfileView";
import "./career.css";

/** Whose career the page opens on: the Steam account of the overlay's session. */
export type CareerViewer =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; playerId: string };

/**
 * The career page of the home window: overview, recent matches and a match's scoreboard, read from the public
 * career API. Opens on the viewer's own career; a named player in a scoreboard opens theirs.
 */
export function CareerPage({ source, viewer }: { source: CareerSource | null; viewer: CareerViewer }) {
  const ownId = viewer.kind === "signed-in" ? viewer.playerId : null;
  const [otherId, setOtherId] = useState<string | null>(null);
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const playerId = otherId ?? ownId;

  if (!source) {
    return <Placeholder title="生涯不可用" detail="这个版本没有配置生涯服务。" />;
  }
  if (!playerId) {
    return viewer.kind === "loading" ? <Placeholder title="正在读取 Steam 账号…" />
      : <Placeholder title="未登录 Steam" detail="登录 Steam 后，这里会显示你在 SLGO 服务器上的生涯。" />;
  }
  const openPlayer = (id: string) => {
    setOpenMatchId(null);
    setOtherId(id === ownId ? null : id);
  };
  return <>
    <CareerProfileView key={playerId} source={source} playerId={playerId} self={playerId === ownId} hidden={openMatchId !== null}
      onOpenMatch={setOpenMatchId} onBackToSelf={otherId !== null && ownId !== null ? () => openPlayer(ownId) : undefined} />
    {openMatchId !== null ? <CareerMatchView key={openMatchId} source={source} matchId={openMatchId} viewerId={ownId}
      onBack={() => setOpenMatchId(null)} onOpenPlayer={openPlayer} /> : null}
  </>;
}

function Placeholder({ title, detail }: { title: string; detail?: string }) {
  return <>
    <CareerHeader title="生涯" subtitle="SLGO 比赛统计" />
    <div className="home-main__scroll">
      <div className="home-page home-page--below-header"><CareerNotice title={title} detail={detail} /></div>
    </div>
  </>;
}
