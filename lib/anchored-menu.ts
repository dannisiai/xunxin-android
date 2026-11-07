import { getDeviceAdaptationSnapshot } from "./device-adaptation";
import { clipPolygon, createOverlayGeometry, polygonArea, rectangleInside, rectanglePolygon, type Point } from "./adaptive-geometry";

/** Keep bespoke message menus and their arrows in the actual pane, using the shared projection geometry. */
export function positionAnchoredMenu(element: HTMLElement, anchor: Point, preferBelow = false) {
  const geometry = createOverlayGeometry();
  try {
    const state = getDeviceAdaptationSnapshot();
    const plane = geometry.positioningPlane(element);
    const owner = element.closest<HTMLElement>(".chat-split-master,.chat-split-detail,.reading-app-surface,.phone-app-pane,.phone-shell");
    const ownerPolygon = owner && geometry.boxPolygon(owner);
    const regions = state.viewportSegments.map(segment => {
      let polygon = clipPolygon(rectanglePolygon(segment), rectanglePolygon(state.visibleViewport));
      if (ownerPolygon) polygon = clipPolygon(polygon, ownerPolygon);
      for (let parent = element.parentElement; parent && polygon.length; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/hidden|clip|auto|scroll/.test(style.overflowX + style.overflowY) || /\b(paint|strict|content)\b/.test(style.contain)) {
          const boundary = geometry.boxPolygon(parent, "padding");
          if (boundary) polygon = clipPolygon(polygon, boundary);
        }
      }
      const containsAnchor = anchor.x >= segment.left && anchor.x <= segment.left + segment.width
        && anchor.y >= segment.top && anchor.y <= segment.top + segment.height;
      return { polygon, containsAnchor };
    }).filter(region => region.polygon.length >= 3)
      .sort((a, b) => Number(b.containsAnchor) - Number(a.containsAnchor) || polygonArea(b.polygon) - polygonArea(a.polygon));
    const local = plane && regions[0] && plane.toLocal(regions[0].polygon);
    const bounds = local && rectangleInside(local);
    const point = plane?.toLocal([anchor])?.[0];
    if (!bounds || !point) return null;
    const margin = 8, gap = 12;
    const availableWidth = Math.max(1, bounds.width - 2 * margin);
    const availableHeight = Math.max(1, bounds.height - 2 * margin);
    element.style.maxWidth = `${availableWidth}px`;
    element.style.maxHeight = `${availableHeight}px`;
    const overflows = element.scrollWidth > availableWidth || element.scrollHeight > availableHeight;
    element.style.overflow = overflows ? "auto" : "visible";
    const width = element.offsetWidth, height = element.offsetHeight;
    const minX = bounds.left + margin, minY = bounds.top + margin;
    const maxX = Math.max(minX, bounds.left + bounds.width - width - margin);
    const maxY = Math.max(minY, bounds.top + bounds.height - height - margin);
    const placeBelow = preferBelow ? point.y + gap + height <= bounds.top + bounds.height - margin
      : point.y - height - gap < minY;
    const left = Math.max(minX, Math.min(point.x - width / 2, maxX));
    const top = Math.max(minY, Math.min(placeBelow ? point.y + gap : point.y - height - gap, maxY));
    Object.assign(element.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
    return { left, top, anchorX: point.x, width, placeBelow };
  } finally {
    geometry.dispose();
  }
}
