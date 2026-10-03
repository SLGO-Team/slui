import { stageText, type Detect, type InstallMode, type Stage } from "../model.ts";
import { Hero } from "./Hero.tsx";

const STAGES: Stage[] = ["extracting", "elevating", "installing"];

export function Progress({ detect, mode, stage }: { detect: Detect; mode: InstallMode; stage: Stage | null }) {
  const current = STAGES.indexOf(stage ?? "extracting");
  return <div className="setup-page">
    <Hero busy title={`${mode === "update" ? "正在更新" : "正在安装"} SLUI`}>
      <span className="setup-chip">版本 <b>{detect.payloadVersion}</b></span>
    </Hero>

    <div className="setup-run">
      <div className="setup-progress" role="progressbar" aria-label={stageText(stage)} aria-busy="true">
        <div className="setup-progress__bar" />
      </div>
      <ol className="setup-steps" aria-live="polite">
        {STAGES.map((item, index) => <li key={item} className="setup-steps__item"
          data-state={index < current ? "done" : index === current ? "current" : "pending"}>
          <span className="setup-steps__dot" aria-hidden="true" />{stageText(item)}
        </li>)}
      </ol>
    </div>

    <p className="setup-hint">
      {stage === "elevating"
        ? "请在 Windows 用户账户控制窗口中选择“是”以继续。"
        : "安装期间请勿关闭此窗口。"}
    </p>
  </div>;
}
