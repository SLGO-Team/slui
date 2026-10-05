import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import { UninstallApp } from "./uninstall/App.tsx";
import "./installer.css";

// slui-uninstall.exe injects the role before the page loads (installer/src-tauri/src/lib.rs);
// the browser preview takes it from `?role=uninstall`.
const uninstall = window.__SLUI_SETUP_ROLE__ === "uninstall"
  || new URLSearchParams(location.search).get("role") === "uninstall";
document.title = uninstall ? "SLUI 卸载程序" : "SLUI 安装程序";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {uninstall ? <UninstallApp /> : <App />}
  </React.StrictMode>,
);
