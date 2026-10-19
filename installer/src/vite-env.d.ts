/// <reference types="vite/client" />

interface Window {
  /** Set by slui-uninstall.exe before the page loads; absent in the installer shell. */
  __SLUI_SETUP_ROLE__?: "uninstall";
  /** Set by the setup exe started with `--update` (SLUI's updater); absent otherwise. */
  __SLUI_SETUP_UNATTENDED__?: true;
}
