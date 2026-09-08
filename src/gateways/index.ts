import type { AppGateways } from "./contracts";
import { createBrowserGateways } from "./browser";
import { createTauriGateways } from "./tauri";
import { isTauriRuntime } from "../platform/runtime";

let gateways: AppGateways | null = null;

export function getGateways() {
  if (!gateways) {
    gateways = isTauriRuntime() ? createTauriGateways() : createBrowserGateways();
  }
  return gateways;
}

export function setGatewaysForTests(nextGateways: AppGateways | null) {
  gateways = nextGateways;
}
