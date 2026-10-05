/// <reference types="vite/client" />

interface Window {
  /** Set by slui-uninstall.exe before the page loads; absent in the installer shell. */
  __SLUI_SETUP_ROLE__?: "uninstall";
}
