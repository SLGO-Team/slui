import type { ShopDebugOptions } from "./shopDebug";
import { SHOP_DEBUG_AVAILABILITIES, SHOP_DEBUG_ROLES, SHOP_DEBUG_STATES } from "./shopDebug";
import "./ShopDebugPanel.css";

const AVAILABILITY_LABELS: Record<typeof SHOP_DEBUG_AVAILABILITIES[number], string> = { live: "Live", stale: "Stale", offline: "Offline", restarted: "重启", "baseline-required": "待基线", "no-shop": "无数据" };
const STATE_LABELS: Record<typeof SHOP_DEBUG_STATES[number], string> = { standard: "标准", pending: "处理中", rejected: "拒绝", unavailable: "不可购买", owned: "已持有", disconnected: "断线" };
const ROLE_LABELS: Record<typeof SHOP_DEBUG_ROLES[number], string> = { scp: "普通 SCP", scp079: "SCP-079" };

export function ShopDebugPanel({ options, shopVisible, onChange, onToggleShop }: { options: ShopDebugOptions; shopVisible: boolean; onChange(options: ShopDebugOptions): void; onToggleShop(): void }) {
  return (
    <aside className="shop-debug-panel" aria-label="商店调试">
      <div className="shop-debug-panel__title">
        <strong>SHOP DEBUG</strong>
        <button type="button" onClick={onToggleShop}>{shopVisible ? "关闭商店" : "呼出商店"}</button>
      </div>
      <div className="shop-debug-panel__controls">
        <label>
          场景
          <select value={options.role} onChange={(event) => onChange({ ...options, role: event.target.value as ShopDebugOptions["role"] })}>
            {SHOP_DEBUG_ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
          </select>
        </label>
        <label>
          连接
          <select value={options.availability} onChange={(event) => onChange({ ...options, availability: event.target.value as ShopDebugOptions["availability"] })}>
            {SHOP_DEBUG_AVAILABILITIES.map((value) => <option key={value} value={value}>{AVAILABILITY_LABELS[value]}</option>)}
          </select>
        </label>
        <label>
          状态
          <select value={options.state} onChange={(event) => onChange({ ...options, state: event.target.value as ShopDebugOptions["state"] })}>
            {SHOP_DEBUG_STATES.map((value) => <option key={value} value={value}>{STATE_LABELS[value]}</option>)}
          </select>
        </label>
      </div>
    </aside>
  );
}
