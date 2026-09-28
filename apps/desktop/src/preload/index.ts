import { contextBridge } from 'electron';

/**
 * The renderer-facing bridge.
 *
 * PHASE 0 SCOPE: expose immutable runtime facts and prove the preload wiring.
 *
 * In later phases this is where the shell will hand the renderer the ephemeral
 * loopback port and the per-launch bearer token of the private local API —
 * which is exactly why apps/web never hardcodes an API URL.
 *
 * NOTE: apps/web is deliberately Electron-agnostic and does NOT depend on this
 * shape. It must remain buildable for a plain browser.
 */
const bridge = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
} as const;

contextBridge.exposeInMainWorld('hexpayroll', bridge);

export type HexPayrollBridge = typeof bridge;
