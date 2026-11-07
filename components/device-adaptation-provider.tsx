"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { initAdaptiveOverlays } from "@/lib/adaptive-overlays";
import { initAdaptiveInput } from "@/lib/adaptive-input";
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
    const disposeOverlays = initAdaptiveOverlays();
    const disposeInput = initAdaptiveInput();
    return () => { disposeInput(); disposeOverlays(); };
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
