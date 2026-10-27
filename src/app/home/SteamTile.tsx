import { AccountIcon } from "./icons";
import { steamTone, type SteamAccount } from "./steamAccount";

// The signed-in account as Steam shows it: avatar, persona name, SteamID. The avatar also tints
// the tile through a blurred copy behind it.
export function SteamTile({ account }: { account: SteamAccount }) {
  const signedIn = account.kind === "signed-in" ? account : null;
  const profile = signedIn?.profile ?? null;
  const avatar = profile?.avatarUrl ?? null;
  const name = profile?.personaName ?? null;

  let title: React.ReactNode;
  let detail: React.ReactNode = null;
  if (!signedIn) {
    title = <span className="home-steam__title home-steam__title--muted">{account.kind === "loading" ? "正在获取…" : "未检测到 Steam 登录"}</span>;
    if (account.kind === "signed-out") detail = <span className="home-steam__detail">登录 Steam 后自动识别</span>;
  } else {
    const id = <span className="home-steam__detail home-steam__id" title="SteamID">{signedIn.steamId}</span>;
    // While the profile is read the title line stays empty, so the name does not replace the SteamID.
    title = !profile ? <span className="home-steam__title" aria-hidden="true" />
      : <span key={name ?? signedIn.steamId} className="home-steam__title" title={name ?? signedIn.steamId}>{name ?? signedIn.steamId}</span>;
    detail = !profile || name ? id : null;
  }

  return <div className="home-tile home-steam" data-tone={steamTone(account)} data-signed-in={signedIn !== null}>
    {avatar ? <img key={avatar} className="home-steam__glow" src={avatar} alt="" aria-hidden="true" draggable={false} /> : null}
    <div className="home-steam__frame">
      <div className="home-steam__avatar">
        {avatar ? <img key={avatar} src={avatar} alt="" draggable={false} /> : <AccountIcon size={26} />}
      </div>
    </div>
    <div className="home-steam__body">
      <div className="home-tile__head">
        <span className="home-tile__name">Steam</span>
        <span className="home-dot" aria-hidden="true" />
      </div>
      {title}
      {detail}
    </div>
  </div>;
}
