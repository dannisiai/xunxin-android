/** Layout-viewport geometry shared by browser, PWA and native Android surfaces. */
export type DeviceType = "mobile" | "tablet" | "desktop";
export type DeviceOrientation = "portrait" | "landscape";
export type DevicePosture = "continuous" | "folded";
export type FoldOrientation = "none" | "vertical" | "horizontal";
export interface ViewportSegment { left: number; top: number; width: number; height: number }
export interface HingeBounds extends ViewportSegment {}
export interface DeviceAdaptationState {
  deviceType: DeviceType;
  orientation: DeviceOrientation;
  isTouch: boolean;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isAdaptive: boolean;
  posture: DevicePosture;
  foldOrientation: FoldOrientation;
  isSeparating: boolean;
  viewportSegments: ViewportSegment[];
  primarySegment: ViewportSegment;
  visibleViewport: ViewportSegment;
  hinge: HingeBounds | null;
  isSplitLayout: boolean;
  screenWidth: number;
  screenHeight: number;
}
interface AndroidFoldPayload {
  hasFold?: boolean;
  posture?: DevicePosture;
  orientation?: FoldOrientation;
  isSeparating?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
  bounds?: HingeBounds;
}
type SegmentWindow = Window & {
  viewport?: { segments?: DOMRect[] };
  getWindowSegments?: () => DOMRect[];
  AndroidShell?: { getFoldInfo?: () => string };
  __updateDeviceFoldInfo?: (payload: AndroidFoldPayload) => void;
};
export const DEVICE_ADAPTATION_CHANGED_EVENT = "device-adaptation-changed";
export const DEVICE_ADAPTATION_WILL_CHANGE_EVENT = "device-adaptation-will-change";
const defaultRect = { left: 0, top: 0, width: 390, height: 844 };
const serverState: DeviceAdaptationState = {
  deviceType: "desktop", orientation: "portrait", isTouch: false,
  isMobile: false, isTablet: false, isDesktop: true, isAdaptive: false,
  posture: "continuous", foldOrientation: "none", isSeparating: false,
  viewportSegments: [defaultRect], primarySegment: defaultRect, visibleViewport: defaultRect,
  hinge: null, isSplitLayout: false, screenWidth: 390, screenHeight: 844,
};
let currentState = serverState;
const listeners = new Set<() => void>();
let initialized = false;
let androidFoldOverride: AndroidFoldPayload | null = null;
let segmentProbe: HTMLDivElement | null = null;
export function getDeviceAdaptationSnapshot(): DeviceAdaptationState { return currentState; }
export function getServerDeviceAdaptationSnapshot(): DeviceAdaptationState { return serverState; }
export function subscribeDeviceAdaptation(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return navigator.maxTouchPoints > 0 || window.matchMedia("(any-pointer: coarse)").matches
    || Boolean((window as SegmentWindow).AndroidShell) || /FloatShell\//.test(navigator.userAgent);
}
function clipRect(rect: ViewportSegment, width: number, height: number): ViewportSegment | null {
  if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) return null;
  const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  const right = Math.min(width, rect.left + rect.width), bottom = Math.min(height, rect.top + rect.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}
/** CSS env() is the fallback for browsers exposing media features without the JS API. */
function cssSegments(width: number, height: number): ViewportSegment[] {
  const horizontal = window.matchMedia("(horizontal-viewport-segments: 2)").matches
    || window.matchMedia("(screen-spanning: single-fold-vertical)").matches;
  const vertical = window.matchMedia("(vertical-viewport-segments: 2)").matches
    || window.matchMedia("(screen-spanning: single-fold-horizontal)").matches;
  if (!horizontal && !vertical) return [];
  if (!segmentProbe) {
    segmentProbe = document.createElement("div");
    segmentProbe.setAttribute("aria-hidden", "true");
    segmentProbe.style.cssText = "position:fixed;width:0;height:0;visibility:hidden;pointer-events:none;";
    for (let i = 0; i < 2; i++) {
      for (const key of ["left", "top", "width", "height"]) {
        segmentProbe.style.setProperty("--hs-" + key + "-" + i, "env(viewport-segment-" + key + " " + i + " 0, -1px)");
        segmentProbe.style.setProperty("--vs-" + key + "-" + i, "env(viewport-segment-" + key + " 0 " + i + ", -1px)");
      }
    }
    document.documentElement.appendChild(segmentProbe);
  }
  const computed = getComputedStyle(segmentProbe);
  return [0, 1].map(i => {
    const prefix = horizontal ? "--hs-" : "--vs-";
    const read = (key: string) => Number.parseFloat(computed.getPropertyValue(prefix + key + "-" + i));
    return { left: read("left"), top: read("top"), width: read("width"), height: read("height") };
  }).filter(r => r.left >= 0 && r.top >= 0 && r.width > 0 && r.height > 0)
    .map(r => clipRect(r, width, height)).filter((r): r is ViewportSegment => Boolean(r));
}
export function evaluateDeviceAdaptation(): DeviceAdaptationState {
  if (typeof window === "undefined") return serverState;
  const width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
  const full = { left: 0, top: 0, width, height };
  const viewport = window.visualViewport;
  const visibleViewport = viewport && viewport.scale === 1
    ? clipRect({ left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height }, width, height) || full
    : full;
  const isTouch = isTouchDevice();
  const editable = document.activeElement instanceof HTMLElement
    && document.activeElement.matches("input,textarea,select,[contenteditable='true']");
  // Opening a keyboard must not change a tablet into a landscape phone.
  const sameWindowWithKeyboard = editable && currentState.isAdaptive
    && Math.abs(currentState.screenWidth - width) < 2;
  const orientation = sameWindowWithKeyboard ? currentState.orientation
    : width > height ? "landscape" : "portrait";
  const isIPad = /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const phoneSize = width < 600 || (!isIPad && width < 1000 && Math.min(width, height) < 500);
  const deviceType: DeviceType = sameWindowWithKeyboard ? currentState.deviceType
    : phoneSize && (isTouch || width < 600) ? "mobile" : isTouch ? "tablet" : "desktop";
  let posture: DevicePosture = "continuous";
  let foldOrientation: FoldOrientation = "none";
  let hinge: HingeBounds | null = null;
  let segments: ViewportSegment[] = [];
  const host = window as SegmentWindow;
  if (!androidFoldOverride && host.AndroidShell?.getFoldInfo) {
    try { androidFoldOverride = JSON.parse(host.AndroidShell.getFoldInfo()); } catch { /* Wait for the native update. */ }
  }
  if (androidFoldOverride?.hasFold) {
    posture = androidFoldOverride.posture === "folded" ? "folded" : "continuous";
    const b = androidFoldOverride.bounds;
    if (b && androidFoldOverride.isSeparating) {
      const sx = width / (androidFoldOverride.viewportWidth || width);
      const sy = height / (androidFoldOverride.viewportHeight || height);
      const left = Math.max(0, Math.min(width, b.left * sx));
      const top = Math.max(0, Math.min(height, b.top * sy));
      const right = Math.max(left, Math.min(width, (b.left + b.width) * sx));
      const bottom = Math.max(top, Math.min(height, (b.top + b.height) * sy));
      if (androidFoldOverride.orientation === "vertical" && left > 0 && right < width) {
        foldOrientation = "vertical";
        hinge = { left, top: 0, width: right - left, height };
        segments = [{ left: 0, top: 0, width: left, height }, { left: right, top: 0, width: width - right, height }];
      } else if (androidFoldOverride.orientation === "horizontal" && top > 0 && bottom < height) {
        foldOrientation = "horizontal";
        hinge = { left: 0, top, width, height: bottom - top };
        segments = [{ left: 0, top: 0, width, height: top }, { left: 0, top: bottom, width, height: height - bottom }];
      }
    }
  } else {
    const devicePosture = (navigator as Navigator & { devicePosture?: { type?: string } }).devicePosture;
    posture = devicePosture?.type === "folded" || window.matchMedia("(device-posture: folded)").matches ? "folded" : "continuous";
    const raw = host.viewport?.segments
      || (viewport as (VisualViewport & { segments?: DOMRect[] }) | null)?.segments
      || host.getWindowSegments?.();
    segments = Array.isArray(raw) && raw.length > 1
      ? raw.map(r => clipRect(r, width, height)).filter((r): r is ViewportSegment => Boolean(r))
      : cssSegments(width, height);
    if (segments.length > 1) {
      const verticalHinge = Math.abs(segments[0].left - segments[1].left) >= Math.abs(segments[0].top - segments[1].top);
      segments.sort((a, b) => verticalHinge ? a.left - b.left : a.top - b.top);
      const a = segments[0], b = segments[1];
      foldOrientation = verticalHinge ? "vertical" : "horizontal";
      hinge = verticalHinge
        ? { left: a.left + a.width, top: 0, width: Math.max(0, b.left - a.left - a.width), height }
        : { left: 0, top: a.top + a.height, width, height: Math.max(0, b.top - a.top - a.height) };
    }
  }
  const isSeparating = segments.length > 1;
  if (!isSeparating) { segments = [full]; foldOrientation = "none"; hinge = null; }
  const primarySegment = [...segments].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const foldSplit = foldOrientation === "vertical" && segments.length === 2 && segments.every(s => s.width >= 280);
  const isAdaptive = isTouch || width < 600 || isSeparating;
  const isSplitLayout = foldSplit || (!isSeparating && deviceType === "tablet" && width >= 760);
  return {
    deviceType, orientation, isTouch, isMobile: deviceType === "mobile",
    isTablet: deviceType === "tablet", isDesktop: deviceType === "desktop", isAdaptive,
    posture, foldOrientation, isSeparating, viewportSegments: segments, primarySegment,
    visibleViewport, hinge, isSplitLayout, screenWidth: width, screenHeight: height,
  };
}
export function syncRootDeviceAttributes(state: DeviceAdaptationState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.deviceType = state.deviceType;
  root.dataset.orientation = state.orientation;
  root.dataset.devicePosture = state.posture;
  root.dataset.foldOrientation = state.foldOrientation;
  root.dataset.foldSeparating = String(state.isSeparating);
  root.dataset.splitLayout = String(state.isSplitLayout);
  root.dataset.adaptiveWindow = String(state.isAdaptive);
  const px = (name: string, value: number) => root.style.setProperty(name, value + "px");
  px("--app-window-width", state.screenWidth);
  px("--app-window-height", state.screenHeight);
  for (const key of ["left", "top", "width", "height"] as const) {
    px("--app-pane-" + key, state.primarySegment[key]);
    px("--app-visible-" + key, state.visibleViewport[key]);
    px("--hinge-" + key, state.hinge?.[key] || 0);
  }
  state.viewportSegments.slice(0, 2).forEach((segment, index) => {
    for (const key of ["left", "top", "width", "height"] as const) {
      px("--viewport-segment-" + key + "-" + index, segment[key]);
    }
  });
  if (state.viewportSegments.length < 2) {
    for (const key of ["left", "top", "width", "height"]) root.style.removeProperty("--viewport-segment-" + key + "-1");
  }
}
export function initDeviceAdaptation() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;
  let frame = 0;
  const update = () => {
    frame = 0;
    const next = evaluateDeviceAdaptation();
    if (JSON.stringify(next) === JSON.stringify(currentState)) return;
    window.dispatchEvent(new Event(DEVICE_ADAPTATION_WILL_CHANGE_EVENT));
    currentState = next;
    syncRootDeviceAttributes(next);
    listeners.forEach(listener => listener());
    window.dispatchEvent(new CustomEvent(DEVICE_ADAPTATION_CHANGED_EVENT, { detail: next }));
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  (window as SegmentWindow).__updateDeviceFoldInfo = payload => {
    androidFoldOverride = payload;
    schedule();
  };
  for (const event of ["resize", "orientationchange", "pageshow", "focusin", "focusout"]) window.addEventListener(event, schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  for (const query of ["(any-pointer: coarse)", "(horizontal-viewport-segments: 2)", "(vertical-viewport-segments: 2)", "(screen-spanning: single-fold-vertical)", "(screen-spanning: single-fold-horizontal)", "(device-posture: folded)"]) {
    window.matchMedia(query).addEventListener("change", schedule);
  }
  (navigator as Navigator & { devicePosture?: EventTarget }).devicePosture?.addEventListener("change", schedule);
  update();
}
export function isMobileDevice(): boolean {
  return typeof window !== "undefined" && evaluateDeviceAdaptation().isMobile;
}

/** Physical screen segments expressed in an element's unscaled local coordinates. */
export function getElementViewportSegments(element: HTMLElement): ViewportSegment[] {
  const rect = element.getBoundingClientRect();
  const scaleX = rect.width / (element.offsetWidth || rect.width) || 1;
  const scaleY = rect.height / (element.offsetHeight || rect.height) || 1;
  return currentState.viewportSegments.flatMap(segment => {
    const left = Math.max(rect.left, segment.left), top = Math.max(rect.top, segment.top);
    const right = Math.min(rect.right, segment.left + segment.width), bottom = Math.min(rect.bottom, segment.top + segment.height);
    return right > left && bottom > top
      ? [{ left: (left - rect.left) / scaleX, top: (top - rect.top) / scaleY, width: (right - left) / scaleX, height: (bottom - top) / scaleY }]
      : [];
  });
}
