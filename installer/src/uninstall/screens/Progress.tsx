import { stages, stageText, type Run, type Stage } from "../model.ts";
import { Hero } from "../../screens/Hero.tsx";

export function Progress({ version, run, stage }: { version: string; run: Run | null; stage: Stage | null }) {
  const steps = stages(run);
  const current = steps.indexOf(stage ?? "preparing");
  return <div className="setup-page">
    <Hero busy title="正在卸载 SLUI">
      <span className="setup-chip">版本 <b>{version}</b></span>
    </Hero>

    <div className="setup-run">
      <div className="setup-progress" role="progressbar" aria-label={stageText(stage)} aria-busy="true">
        <div className="setup-progress__bar" />
      </div>
      <ol className="setup-steps" aria-live="polite">
        {steps.map((item, index) => <li key={item} className="setup-steps__item"
          data-state={index < current ? "done" : index === current ? "current" : "pending"}>
          <span className="setup-steps__dot" aria-hidden="true" />{stageText(item)}
        </li>)}
      </ol>
    </div>

    <p className="setup-hint">
      {stage === "elevating"
        ? "请在 Windows 用户账户控制窗口中选择“是”以继续。"
        : "卸载期间请勿关闭此窗口。"}
    </p>
  </div>;
}
