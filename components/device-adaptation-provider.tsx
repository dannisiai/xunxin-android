"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { initAdaptiveOverlays } from "@/lib/adaptive-overlays";
import {
  initDeviceAdaptation,
  getDeviceAdaptationSnapshot,
  getServerDeviceAdaptationSnapshot,
  subscribeDeviceAdaptation,
  type DeviceAdaptationState,
} from "@/lib/device-adaptation";

export function DeviceAdaptationProvider() {
  useLayoutEffect(() => {
    initDeviceAdaptation();
    return initAdaptiveOverlays();
  }, []);

  return null;
}

export function useDeviceAdaptation(): DeviceAdaptationState {
  useEffect(() => {
    initDeviceAdaptation();
  }, []);

  return useSyncExternalStore(
    subscribeDeviceAdaptation,
    getDeviceAdaptationSnapshot,
    getServerDeviceAdaptationSnapshot,
  );
}
