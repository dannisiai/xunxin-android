import { DEVICE_ADAPTATION_CHANGED_EVENT, getDeviceAdaptationSnapshot, type ViewportSegment } from "./device-adaptation";
import { clipPolygon, createOverlayGeometry, fitTranslation, polygonArea, polygonBounds, rectangleInside, rectanglePolygon, type Polygon } from "./adaptive-geometry";
import contract from "./adaptive-surface-contract.json";

const overlaySelector = ['[data-adaptive-surface="overlay"]', '[data-adaptive-surface="fullscreen"]', ...contract.overlayClasses.map(name => "." + name)].join(",");
const cardSelector = ['[data-adaptive-surface="card"]', '[role="dialog"]', '[aria-modal="true"]', ...contract.cardClasses.map(name => "." + name)].join(",");
const selector = overlaySelector + "," + cardSelector;
const properties = ["overlay-left", "overlay-top", "overlay-width", "overlay-height", "overlay-padding-top", "overlay-padding-right", "overlay-padding-bottom", "overlay-padding-left", "card-width", "card-height", "card-shift-x", "card-shift-y", "card-base-x", "card-base-y", "card-base-z"];
const editable = "input,textarea,select,[contenteditable='true']";
const optedOut = (element: HTMLElement) => ["decoration", "content"].includes(element.dataset.adaptiveSurface || "");
function translationParts(value: string): string[] {
  if (!value || value === "none") return ["0px", "0px", "0px"];
  const parts: string[] = [];
  let start = 0, depth = 0;
  for (let i = 0; i <= value.length; i++) {
    if (value[i] === "(") depth++;
    if (value[i] === ")") depth--;
    if (i === value.length || !depth && /\s/.test(value[i])) {
      if (i > start) parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  return [parts[0] || "0px", parts[1] || "0px", parts[2] || "0px"];
}
const diagnostic = (element: HTMLElement) => {
  // No text, attributes, form values or chat content enter diagnostics.
  if (process.env.NODE_ENV !== "production") console.warn("[adaptive] A dialog needs data-adaptive-surface=overlay/card or an explicit decoration marker.", element.tagName);
};

/** Geometry stays in the DOM's real projected coordinate system; surface kinds are explicit. */
export function initAdaptiveOverlays(): () => void {
  if (typeof DOMMatrix === "undefined" || typeof DOMPoint === "undefined") return () => {};
  let frame = 0;
  let origin: Element | null = null;
  let point: { x: number; y: number } | null = null;
  let revealFocus = false;
  const geometry = createOverlayGeometry();
  const tagged = new Set<HTMLElement>();
  const reported = new WeakSet<HTMLElement>();
  const ownStyles = new WeakMap<HTMLElement, string | null>();
  const baseTranslations = new WeakMap<HTMLElement, string>();
  const diagnosticRoots = new Set<HTMLElement>(process.env.NODE_ENV !== "production" ? [document.body] : []);
  const queueDiagnostics = (element: HTMLElement) => { if (process.env.NODE_ENV !== "production") diagnosticRoots.add(element); };
  const reset = (element: HTMLElement) => {
    delete element.dataset.adaptiveOverlay;
    delete element.dataset.adaptiveCard;
    delete element.dataset.adaptiveShift;
    delete element.dataset.adaptiveUnavailable;
    for (const property of properties) element.style.removeProperty("--adaptive-" + property);
    ownStyles.delete(element);
    baseTranslations.delete(element);
    resizeObserver?.unobserve(element);
    tagged.delete(element);
  };
  const regionFor = (element: HTMLElement, segment: ViewportSegment, visible: ViewportSegment): Polygon => {
    let region = clipPolygon(rectanglePolygon(segment), rectanglePolygon(visible));
    if (!region.length) return [];
    const owner = element.closest<HTMLElement>(".chat-split-master,.chat-split-detail,.phone-app-pane,.wb-layout,.phone-shell,.vr-root,.ama-root");
    const parentSurface = element.parentElement?.closest<HTMLElement>(selector);
    const boundaries = new Map<HTMLElement, boolean | "padding">();
    if (owner) boundaries.set(owner, false);
    if (parentSurface) boundaries.set(parentSurface, parentSurface.matches(overlaySelector));
    for (let parent = element.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const paintContainment = /\b(paint|strict|content)\b/.test(style.contain) || style.contentVisibility === "auto";
      if ((paintContainment || /hidden|clip|auto|scroll/.test(style.overflowX + " " + style.overflowY)) && !boundaries.has(parent)) boundaries.set(parent, "padding");
    }
    for (const [boundary, box] of boundaries) {
      const polygon = geometry.boxPolygon(boundary, box);
      if (!polygon) return [];
      region = clipPolygon(region, polygon);
      if (!region.length) break;
    }
    return region;
  };
  const update = () => {
    frame = 0;
    geometry.prune();
    try {
      const state = getDeviceAdaptationSnapshot();
      for (const element of tagged) if (!state.isAdaptive || !element.isConnected || !element.matches(selector) || optedOut(element)) reset(element);
      if (!state.isAdaptive) { diagnosticRoots.clear(); return; }
      let preferred = state.primarySegment;
      const originPane = origin?.isConnected ? origin.closest<HTMLElement>(".chat-split-master,.chat-split-detail") : null;
      const originPolygon = originPane ? geometry.boxPolygon(originPane) : null;
      if (originPolygon) preferred = [...state.viewportSegments].sort((a, b) => polygonArea(clipPolygon(rectanglePolygon(b), originPolygon)) - polygonArea(clipPolygon(rectanglePolygon(a), originPolygon)))[0];
      else if (point) preferred = state.viewportSegments.find(s => point!.x >= s.left && point!.x <= s.left + s.width && point!.y >= s.top && point!.y <= s.top + s.height) || preferred;
      const candidates = [...document.querySelectorAll<HTMLElement>(selector)].filter(element => {
        if (optedOut(element) || !element.getClientRects().length) return false;
        return getComputedStyle(element).visibility !== "hidden" || element.dataset.adaptiveUnavailable === "true"
          || Boolean(element.parentElement?.closest('[data-adaptive-unavailable="true"]'));
      });
      let motion = false;
      for (const element of candidates) {
        motion = geometry.hasMotion(element) || motion;
        const fullscreen = element.matches(overlaySelector);
        const parentSurface = element.parentElement?.closest<HTMLElement>(selector);
        if (!fullscreen && parentSurface?.matches(cardSelector) && !parentSurface.matches(overlaySelector)) continue;
        const style = getComputedStyle(element);
        if (fullscreen && style.position !== "fixed" && style.position !== "absolute") {
          if (!reported.has(element)) { reported.add(element); diagnostic(element); }
          continue;
        }
        const regions = state.viewportSegments.map(segment => regionFor(element, segment, state.visibleViewport)).filter(p => p.length >= 3)
          .sort((a, b) => polygonArea(clipPolygon(b, rectanglePolygon(preferred))) - polygonArea(clipPolygon(a, rectanglePolygon(preferred))) || polygonArea(b) - polygonArea(a));
        const region = regions[0];
        const plane = geometry.positioningPlane(element);
        const local = plane && region ? plane.toLocal(region) : null;
        const localRect = local ? rectangleInside(local) : null;
        if (!tagged.has(element)) resizeObserver?.observe(element);
        tagged.add(element);
        // Edge-on/singular transforms have no finite usable rectangle. Never write NaN or stale geometry.
        if (!local || !localRect) { element.dataset.adaptiveUnavailable = "true"; continue; }
        delete element.dataset.adaptiveUnavailable;
        const px = (name: string, value: number) => {
          if (!Number.isFinite(value)) return;
          const key = "--adaptive-" + name, next = value + "px";
          if (element.style.getPropertyValue(key) !== next) element.style.setProperty(key, next);
        };
        if (fullscreen) {
          if (element.dataset.adaptiveOverlay !== "true") for (const side of ["top", "right", "bottom", "left"]) px("overlay-padding-" + side, Number.parseFloat(style.getPropertyValue("padding-" + side)) || 0);
          delete element.dataset.adaptiveCard;
          delete element.dataset.adaptiveShift;
          element.dataset.adaptiveOverlay = "true";
          let rect = { ...localRect }, fitted = false;
          for (let attempt = 0; attempt < 8; attempt++) {
            px("overlay-left", rect.left);
            px("overlay-top", rect.top);
            px("overlay-width", rect.width);
            px("overlay-height", rect.height);
            const quad = geometry.boxPolygon(element);
            const shape = quad && plane ? plane.toLocal(quad) : null;
            const shift = shape ? fitTranslation(shape, local) : null;
            if (shift && Math.abs(shift.x) + Math.abs(shift.y) < .05) { fitted = true; break; }
            if (shift) { rect.left += shift.x; rect.top += shift.y; }
            else {
              rect = { left: rect.left + rect.width * .075, top: rect.top + rect.height * .075, width: rect.width * .85, height: rect.height * .85 };
            }
          }
          if (!fitted) element.dataset.adaptiveUnavailable = "true";
        } else {
          delete element.dataset.adaptiveOverlay;
          // Tailwind's centering uses the same independent translate property. Keep it additive.
          const signature = element.className + "|" + element.style.translate;
          if (baseTranslations.get(element) !== signature) {
            const previous = element.dataset.adaptiveShift;
            delete element.dataset.adaptiveShift;
            const parts = translationParts(getComputedStyle(element).translate);
            if (previous) element.dataset.adaptiveShift = previous;
            for (const [i, axis] of ["x", "y", "z"].entries()) element.style.setProperty("--adaptive-card-base-" + axis, parts[i]);
            baseTranslations.set(element, signature);
          }
          element.dataset.adaptiveCard = "true";
          let width = Math.max(1, localRect.width - (parentSurface ? 0 : 24));
          let height = Math.max(1, localRect.height - (parentSurface ? 0 : 24));
          let fitted = false;
          for (let attempt = 0; attempt < 8; attempt++) {
            px("card-width", width);
            px("card-height", height);
            const quad = geometry.boxPolygon(element);
            const shape = quad && plane ? plane.toLocal(quad) : null;
            if (!shape) break;
            const oldX = element.dataset.adaptiveShift === "true" ? Number.parseFloat(element.style.getPropertyValue("--adaptive-card-shift-x")) || 0 : 0;
            const oldY = element.dataset.adaptiveShift === "true" ? Number.parseFloat(element.style.getPropertyValue("--adaptive-card-shift-y")) || 0 : 0;
            const natural = shape.map(p => ({ x: p.x - oldX, y: p.y - oldY }));
            const shift = fitTranslation(natural, local);
            if (shift) {
              px("card-shift-x", shift.x);
              px("card-shift-y", shift.y);
              if (Math.abs(shift.x) > .01 || Math.abs(shift.y) > .01) element.dataset.adaptiveShift = "true";
              else delete element.dataset.adaptiveShift;
              // Re-measure after applying the shift: 3D child transforms need not share the
              // ancestor's z=0 plane. Accept the result only when its rendered corners fit.
              const moved = geometry.boxPolygon(element);
              const actual = moved && plane ? plane.toLocal(moved) : null;
              const residual = actual ? fitTranslation(actual, local) : null;
              if (residual && Math.abs(residual.x) + Math.abs(residual.y) < .05) { fitted = true; break; }
              if (attempt < 3) continue;
            }
            const bounds = polygonBounds(natural);
            const factor = Math.min(.85, localRect.width / Math.max(1, bounds.width), localRect.height / Math.max(1, bounds.height)) * .95;
            width = Math.max(1, width * factor);
            height = Math.max(1, height * factor);
          }
          if (!fitted) element.dataset.adaptiveUnavailable = "true";
        }
        ownStyles.set(element, element.getAttribute("style"));
      }
      if (revealFocus) {
        revealFocus = false;
        const input = document.activeElement;
        if (input instanceof HTMLElement && input.matches(editable) && input.closest('[data-adaptive-overlay="true"],[data-adaptive-card="true"]')) {
          for (let parent = input.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
            if (!parent.closest('[data-adaptive-overlay="true"],[data-adaptive-card="true"]')) break;
            if (parent.scrollHeight <= parent.clientHeight + 1 || !/auto|scroll/.test(getComputedStyle(parent).overflowY)) continue;
            const polygon = geometry.boxPolygon(parent, true), field = geometry.boxPolygon(input);
            // scrollTop is measured in this scroller's CSS pixels, not the input's offset parent.
            const plane = geometry.elementPlane(parent);
            const visible = polygon ? clipPolygon(polygon, rectanglePolygon(state.visibleViewport)) : null;
            const boundary = visible && plane ? plane.toLocal(visible) : null;
            const shape = field && plane ? plane.toLocal(field) : null;
            if (!boundary || !shape) continue;
            const box = polygonBounds(boundary), rect = polygonBounds(shape);
            const top = box.top + 8, bottom = box.top + box.height - 8;
            if (bottom <= top) continue;
            const delta = rect.height > bottom - top || rect.top < top ? rect.top - top : Math.max(0, rect.top + rect.height - bottom);
            if (Math.abs(delta) > 1) parent.scrollTop += delta;
          }
        }
      }
      if (process.env.NODE_ENV !== "production") {
        // Inspect computed positioning for changed subtrees, including arbitrary CSS module names
        // and runtime style functions. Guessed layers receive diagnostics, never geometry changes.
        for (const root of diagnosticRoots) {
          if (!root.isConnected) continue;
          for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
            if (!(element instanceof HTMLElement) || element.hasAttribute("data-adaptive-probe") || reported.has(element) || !element.getClientRects().length) continue;
            const kind = element.dataset.adaptiveSurface;
            if (kind && contract.surfaceKinds.includes(kind) || element.matches(selector)) continue;
            const style = getComputedStyle(element);
            if (style.visibility === "hidden") continue;
            const named = [...element.classList].some(name => /(?:^|-)(?:overlay|backdrop|dialog|sheet|drawer|mask)$/.test(name));
            if (!kind && style.position !== "fixed" && !(style.position === "absolute" && named)) continue;
            reported.add(element);
            diagnostic(element);
          }
        }
        diagnosticRoots.clear();
      }
      if (motion) schedule();
    } finally {
      // Measuring nodes never survive to a paint or become permanent React-owned children.
      geometry.dispose();
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const invalidateTranslations = () => { for (const element of tagged) baseTranslations.delete(element); };
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  const rememberOrigin = (event: Event) => {
    if (event.target instanceof HTMLElement && event.target.matches(editable)) revealFocus = true;
    if (event.target instanceof Element && !event.target.closest(selector)) {
      origin = event.target;
      if (event instanceof PointerEvent) point = { x: event.clientX, y: event.clientY };
    }
    schedule();
  };
  const observer = new MutationObserver(records => {
    let changed = false;
    for (const record of records) {
      if (geometry.isProbeMutation(record)) continue;
      const element = record.target;
      if (record.type === "characterData") {
        if (!(element.parentElement instanceof HTMLStyleElement)) continue;
        queueDiagnostics(document.body);
      }
      if (record.attributeName === "style" && element instanceof HTMLElement
        && (geometry.isOwnStyle(element) || tagged.has(element) && ownStyles.get(element) === element.getAttribute("style"))) continue;
      if (record.type === "childList") {
        if (element instanceof HTMLStyleElement) queueDiagnostics(document.body);
        for (const node of record.addedNodes) if (node instanceof HTMLElement) {
          queueDiagnostics(node instanceof HTMLStyleElement || node instanceof HTMLLinkElement ? document.body : node);
        }
      } else if (element instanceof HTMLElement) queueDiagnostics(element);
      changed = true;
    }
    if (changed) { invalidateTranslations(); schedule(); }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden", "role", "aria-modal", "data-adaptive-surface"] });
  const headObserver = new MutationObserver(records => {
    const stylesheet = (node: Node) => node instanceof HTMLStyleElement || node instanceof HTMLLinkElement && node.rel === "stylesheet";
    if (records.some(record => stylesheet(record.target) || record.target.parentElement instanceof HTMLStyleElement
      || [...record.addedNodes, ...record.removedNodes].some(stylesheet))) {
      queueDiagnostics(document.body); invalidateTranslations(); schedule();
    }
  });
  headObserver.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "media", "disabled"] });
  const rootObserver = new MutationObserver(() => { queueDiagnostics(document.body); invalidateTranslations(); schedule(); });
  rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-active-app", "data-theme"] });
  const stylesheetLoaded = (event: Event) => { if (event.target instanceof HTMLLinkElement && event.target.rel === "stylesheet") { queueDiagnostics(document.body); schedule(); } };
  const afterAnimation = (event: Event) => { if (event.target instanceof Element && (event.target.matches(selector) || event.target.querySelector(selector))) { invalidateTranslations(); schedule(); } };
  const deviceChanged = () => { revealFocus = true; queueDiagnostics(document.body); invalidateTranslations(); schedule(); };
  document.addEventListener("pointerdown", rememberOrigin, true);
  document.addEventListener("focusin", rememberOrigin, true);
  document.addEventListener("scroll", schedule, true);
  document.addEventListener("load", stylesheetLoaded, true);
  const animationEvents = ["animationstart", "animationend", "animationcancel", "transitionrun", "transitionend", "transitioncancel"];
  for (const name of animationEvents) document.addEventListener(name, afterAnimation, true);
  window.addEventListener(DEVICE_ADAPTATION_CHANGED_EVENT, deviceChanged);
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    headObserver.disconnect();
    rootObserver.disconnect();
    resizeObserver?.disconnect();
    geometry.dispose();
    diagnosticRoots.clear();
    document.removeEventListener("pointerdown", rememberOrigin, true);
    document.removeEventListener("focusin", rememberOrigin, true);
    document.removeEventListener("scroll", schedule, true);
    document.removeEventListener("load", stylesheetLoaded, true);
    for (const name of animationEvents) document.removeEventListener(name, afterAnimation, true);
    window.removeEventListener(DEVICE_ADAPTATION_CHANGED_EVENT, deviceChanged);
    for (const element of tagged) reset(element);
  };
}
