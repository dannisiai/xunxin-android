import type { ViewportSegment } from "./device-adaptation";

export interface Point { x: number; y: number }
export type Polygon = Point[];
const EPSILON = 0.0001;
// Stay inside even tiny scroll containers; measuring points must not extend their scroll range.
const SAMPLE_SIZE = 1;
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export function rectanglePolygon(rect: ViewportSegment): Polygon {
  return [{ x: rect.left, y: rect.top }, { x: rect.left + rect.width, y: rect.top },
    { x: rect.left + rect.width, y: rect.top + rect.height }, { x: rect.left, y: rect.top + rect.height }];
}
function signedArea(points: Polygon) {
  return points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0) / 2;
}
export function polygonArea(points: Polygon): number { return Math.abs(signedArea(points)); }
function counterclockwise(points: Polygon): Polygon { return signedArea(points) < 0 ? [...points].reverse() : points; }
export function polygonBounds(points: Polygon): ViewportSegment {
  if (!points.length) return { left: 0, top: 0, width: 0, height: 0 };
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}
function clipHalfPlane(points: Polygon, distance: (p: Point) => number): Polygon {
  const output: Polygon = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const da = distance(a), db = distance(b), insideA = da >= -EPSILON, insideB = db >= -EPSILON;
    if (insideA) output.push(a);
    if (insideA !== insideB && Math.abs(da - db) > Number.EPSILON) {
      const t = da / (da - db);
      output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return output;
}
/** Convex polygon intersection retains rotated/skewed clipping edges instead of their AABB. */
export function clipPolygon(subject: Polygon, boundary: Polygon): Polygon {
  if (subject.length < 3 || boundary.length < 3) return [];
  let result = subject;
  const edges = counterclockwise(boundary);
  for (let i = 0; i < edges.length && result.length; i++) {
    const a = edges[i], b = edges[(i + 1) % edges.length];
    result = clipHalfPlane(result, p => cross(a, b, p));
  }
  return result.length >= 3 && polygonArea(result) > EPSILON ? counterclockwise(result) : [];
}
function contains(points: Polygon, point: Point): boolean {
  const edges = counterclockwise(points);
  return edges.every((a, i) => cross(a, edges[(i + 1) % edges.length], point) >= -EPSILON);
}
/** A conservative local rectangle wholly inside the available polygon; no bounding-box overflow. */
export function rectangleInside(points: Polygon): ViewportSegment | null {
  if (points.length < 3 || polygonArea(points) < EPSILON) return null;
  const box = polygonBounds(points);
  const average = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
  const centers = [average, { x: box.left + box.width / 2, y: box.top + box.height / 2 }].filter(p => contains(points, p));
  let best: ViewportSegment | null = null;
  for (const center of centers) {
    const halfWidth = Math.min(center.x - box.left, box.left + box.width - center.x);
    const halfHeight = Math.min(center.y - box.top, box.top + box.height - center.y);
    let low = 0, high = 1;
    for (let step = 0; step < 30; step++) {
      const scale = (low + high) / 2;
      const rect = { left: center.x - halfWidth * scale, top: center.y - halfHeight * scale, width: halfWidth * scale * 2, height: halfHeight * scale * 2 };
      if (rectanglePolygon(rect).every(p => contains(points, p))) low = scale; else high = scale;
    }
    const rect = { left: center.x - halfWidth * low, top: center.y - halfHeight * low, width: halfWidth * low * 2, height: halfHeight * low * 2 };
    if (!best || rect.width * rect.height > best.width * best.height) best = rect;
  }
  return best && best.width > EPSILON && best.height > EPSILON ? best : null;
}
/** Intersect all feasible translation half-planes, then choose the shift nearest the original anchor. */
export function fitTranslation(shape: Polygon, boundary: Polygon): Point | null {
  if (shape.length < 3 || boundary.length < 3) return null;
  const outer = polygonBounds(boundary), inner = polygonBounds(shape);
  let feasible = rectanglePolygon({ left: outer.left - inner.left - inner.width, top: outer.top - inner.top - inner.height,
    width: outer.width + inner.width, height: outer.height + inner.height });
  const edges = counterclockwise(boundary);
  for (let i = 0; i < edges.length && feasible.length; i++) {
    const a = edges[i], b = edges[(i + 1) % edges.length];
    const minimum = Math.min(...shape.map(p => cross(a, b, p)));
    feasible = clipHalfPlane(feasible, p => (b.x - a.x) * p.y - (b.y - a.y) * p.x + minimum);
  }
  if (!feasible.length) return null;
  if (feasible.length >= 3 && contains(feasible, { x: 0, y: 0 })) return { x: 0, y: 0 };
  let best = feasible[0];
  for (let i = 0; i < feasible.length; i++) {
    const a = feasible[i], b = feasible[(i + 1) % feasible.length], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1)));
    const p = { x: a.x + t * dx, y: a.y + t * dy };
    if (p.x * p.x + p.y * p.y < best.x * best.x + best.y * best.y) best = p;
  }
  return best;
}

function project(matrix: DOMMatrixReadOnly, points: Polygon): Polygon | null {
  const result: Polygon = [];
  let sign = 0;
  for (const point of points) {
    const p = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    if (![p.x, p.y, p.w].every(Number.isFinite) || Math.abs(p.w) < EPSILON) return null;
    if (sign && Math.sign(p.w) !== sign) return null; // A horizon crossing has no finite rectangle.
    sign = Math.sign(p.w);
    result.push({ x: p.x / p.w, y: p.y / p.w });
  }
  return result;
}
export interface CoordinatePlane {
  toLocal(points: Polygon): Polygon | null;
  toViewport(points: Polygon): Polygon | null;
}
/** Four rendered coplanar points define a homography, including perspective and reflections. */
function planeFromSamples(points: Polygon): CoordinatePlane | null {
  if (points.length !== 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const [a, b, c, d] = points;
  const dx = a.x - b.x + c.x - d.x, dy = a.y - b.y + c.y - d.y;
  const x1 = b.x - c.x, x2 = d.x - c.x, y1 = b.y - c.y, y2 = d.y - c.y;
  let g = 0, h = 0;
  if (Math.abs(dx) + Math.abs(dy) > 0.0000001) {
    const determinant = x1 * y2 - x2 * y1;
    if (Math.abs(determinant) < 0.00000001) return null;
    g = (dx * y2 - x2 * dy) / determinant;
    h = (x1 * dy - dx * y1) / determinant;
  }
  const matrix = new DOMMatrix([
    (b.x - a.x + g * b.x) / SAMPLE_SIZE, (b.y - a.y + g * b.y) / SAMPLE_SIZE, 0, g / SAMPLE_SIZE,
    (d.x - a.x + h * d.x) / SAMPLE_SIZE, (d.y - a.y + h * d.y) / SAMPLE_SIZE, 0, h / SAMPLE_SIZE,
    0, 0, 1, 0, a.x, a.y, 0, 1,
  ]);
  // Native inversion handles the complete projective matrix; scale ratios are not an inverse.
  const inverse = matrix.inverse();
  if (!Array.from(inverse.toFloat64Array()).every(Number.isFinite)) return null;
  return { toLocal: p => project(inverse, p), toViewport: p => project(matrix, p) };
}

interface ProbeGroup { nodes: HTMLSpanElement[] }
/** Probes delegate containing blocks, nested transforms, zoom and scroll to the browser layout engine. */
export function createOverlayGeometry() {
  const groups = new Map<HTMLElement, Map<string, ProbeGroup>>();
  const ownStyles = new WeakMap<HTMLElement, string | null>();
  const sample = (parent: HTMLElement, position: "fixed" | "absolute"): CoordinatePlane | null => {
    let byPosition = groups.get(parent);
    if (!byPosition) { byPosition = new Map(); groups.set(parent, byPosition); }
    let group = byPosition.get(position);
    if (group && group.nodes.some(node => node.parentElement !== parent)) {
      group.nodes.forEach(node => node.remove());
      byPosition.delete(position);
      group = undefined;
    }
    if (!group) {
      const coordinates = [[0, 0], [SAMPLE_SIZE, 0], [SAMPLE_SIZE, SAMPLE_SIZE], [0, SAMPLE_SIZE]];
      const nodes = coordinates.map(([left, top]) => {
        const node = document.createElement("span");
        node.dataset.adaptiveProbe = "";
        node.setAttribute("aria-hidden", "true");
        node.style.cssText = `all:initial!important;display:block!important;position:${position}!important;left:${left}px!important;top:${top}px!important;right:auto!important;bottom:auto!important;width:0!important;height:0!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;transform:none!important;translate:none!important;rotate:none!important;scale:none!important;visibility:hidden!important;pointer-events:none!important;`;
        parent.appendChild(node);
        return node;
      });
      group = { nodes };
      byPosition.set(position, group);
    }
    return planeFromSamples(group.nodes.map(node => { const rect = node.getBoundingClientRect(); return { x: rect.left, y: rect.top }; }));
  };
  const positioningPlane = (element: HTMLElement): CoordinatePlane | null => {
    if (typeof DOMMatrix === "undefined" || typeof DOMPoint === "undefined") return null;
    try {
      if (element.matches(":popover-open,dialog:modal")) {
        const matrix = new DOMMatrix();
        return { toLocal: p => project(matrix, p), toViewport: p => project(matrix, p) };
      }
    } catch { /* Older engines do not recognize the top-layer pseudo classes. */ }
    const parent = element.parentElement;
    return parent ? sample(parent, getComputedStyle(element).position === "fixed" ? "fixed" : "absolute") : null;
  };
  const elementPlane = (element: HTMLElement): CoordinatePlane | null => {
    if (typeof DOMMatrix === "undefined" || typeof DOMPoint === "undefined") return null;
    const initial = element.getAttribute("style");
    const staticPosition = getComputedStyle(element).position === "static";
    try {
      if (staticPosition) element.style.setProperty("position", "relative", "important");
      return sample(element, "absolute");
    } finally {
      if (staticPosition) {
        if (initial === null) element.removeAttribute("style"); else element.setAttribute("style", initial);
        ownStyles.set(element, element.getAttribute("style"));
      }
    }
  };
  const boxPolygon = (element: HTMLElement, content: boolean | "padding" = false): Polygon | null => {
    if (typeof DOMMatrix === "undefined" || typeof DOMPoint === "undefined") return null;
    const native = element as HTMLElement & { getBoxQuads?: (options: { box: string }) => ArrayLike<{ p1: Point; p2: Point; p3: Point; p4: Point }> };
    try {
      const quads = native.getBoxQuads?.({ box: content === "padding" ? "padding" : content ? "content" : "border" });
      if (quads?.length === 1) return [quads[0].p1, quads[0].p2, quads[0].p3, quads[0].p4].map(p => ({ x: p.x, y: p.y }));
    } catch { /* Rendered point probes are the cross-browser fallback. */ }
    if (element.matches("input,textarea,select,img,video,canvas,iframe")) {
      // Replaced elements cannot render measuring children. AABB is conservative for focus scrolling.
      return rectanglePolygon(element.getBoundingClientRect());
    }
    const initial = element.getAttribute("style");
    const style = getComputedStyle(element);
    const staticPosition = style.position === "static";
    try {
      if (staticPosition) element.style.setProperty("position", "relative", "important");
      const plane = sample(element, "absolute");
      if (!plane) return null;
      const read = (name: string) => Number.parseFloat(style.getPropertyValue(name)) || 0;
      const usedWidth = Number.parseFloat(style.width), usedHeight = Number.parseFloat(style.height);
      const borderWidth = Number.isFinite(usedWidth) ? usedWidth + (style.boxSizing === "border-box" ? 0 : read("padding-left") + read("padding-right") + read("border-left-width") + read("border-right-width")) : element.offsetWidth;
      const borderHeight = Number.isFinite(usedHeight) ? usedHeight + (style.boxSizing === "border-box" ? 0 : read("padding-top") + read("padding-bottom") + read("border-top-width") + read("border-bottom-width")) : element.offsetHeight;
      const rect = content === "padding"
        ? { left: element.scrollLeft, top: element.scrollTop, width: element.clientWidth, height: element.clientHeight }
        : content
        ? { left: element.scrollLeft + read("padding-left"), top: element.scrollTop + read("padding-top"),
          width: Math.max(0, element.clientWidth - read("padding-left") - read("padding-right")),
          height: Math.max(0, element.clientHeight - read("padding-top") - read("padding-bottom")) }
        : { left: element.scrollLeft - read("border-left-width"), top: element.scrollTop - read("border-top-width"), width: borderWidth, height: borderHeight };
      return plane.toViewport(rectanglePolygon(rect));
    } finally {
      if (staticPosition) {
        if (initial === null) element.removeAttribute("style"); else element.setAttribute("style", initial);
        ownStyles.set(element, element.getAttribute("style"));
      }
    }
  };
  return {
    positioningPlane, elementPlane, boxPolygon,
    isOwnStyle: (element: HTMLElement) => ownStyles.has(element) && ownStyles.get(element) === element.getAttribute("style"),
    isProbeMutation: (record: MutationRecord) => record.target instanceof Element && record.target.hasAttribute("data-adaptive-probe")
      || record.type === "childList" && [...record.addedNodes, ...record.removedNodes].length > 0
        && [...record.addedNodes, ...record.removedNodes].every(node => node instanceof Element && node.hasAttribute("data-adaptive-probe")),
    hasMotion(element: HTMLElement): boolean {
      for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
        if (parent.getAnimations?.().some(animation => animation.playState === "running"
          && (animation.effect as KeyframeEffect | null)?.getKeyframes?.().some(frame => ["transform", "transformOrigin", "translate", "rotate", "scale", "perspective", "perspectiveOrigin", "zoom", "filter", "backdropFilter", "offsetPath", "offsetDistance", "left", "top", "right", "bottom", "width", "height"].some(key => key in frame)))) return true;
      }
      return false;
    },
    prune() {
      for (const [parent, positions] of groups) if (!parent.isConnected) {
        for (const group of positions.values()) group.nodes.forEach(node => node.remove());
        groups.delete(parent);
      }
    },
    dispose() {
      for (const positions of groups.values()) for (const group of positions.values()) group.nodes.forEach(node => node.remove());
      groups.clear();
    },
  };
}
