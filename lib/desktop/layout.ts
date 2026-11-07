import {
  DOCK_DEFAULT,
  ICONS,
  PAGE_1_DEFAULT,
  PAGE_2_DEFAULT,
  PAGE_3_DEFAULT,
  isFolderIconId,
  type DesktopIconId,
  type IconId,
  type IconPosition,
} from "@/lib/desktop-config";
import { isCustomAppIconId, toCustomAppIconId } from "@/lib/custom-app-types";
import { loadInstalledCustomApps } from "@/lib/custom-app-storage";
import { GRID_COLS, GRID_ROWS, WIDGET_SIZE_CELLS, type WidgetInstance } from "@/lib/widget-types";
import { buildOccupancyGrid, canPlaceWidget, createDefaultWidgets } from "@/lib/widget-storage";
import {
  createDefaultDesktopIconLayout,
  getDesktopIconLayoutItems,
  getDesktopPageKey,
  getDesktopPageKeys,
  getDesktopPageNumber,
  type DesktopFolderMap,
  type DesktopIconLayout,
  type DesktopPageKey,
} from "@/lib/desktop-layout-storage";

export const ICON_LAYOUT_STORAGE_KEY = "ai_phone_icon_layout_v2";

export const ICON_LAYOUT_STORAGE_KEY_V1 = "ai_phone_icon_layout_v1";

// Sentinel "page" used by the drag engine to mean "the dock". getDesktopPageNumber
// returns 0 for it and getDesktopPageKeys filters it out, so page iteration never
// treats the dock as a real page.
export const DOCK_PAGE_KEY = "dock" as const;

export type DragPageKey = DesktopPageKey | typeof DOCK_PAGE_KEY;

export type DesktopLayout = DesktopIconLayout;

/** Convert an IconId array into absolute positions (flow left-to-right, top-to-bottom) */
function flowIconsToPositions(icons: IconId[]): IconPosition[] {
  const result: IconPosition[] = [];
  let idx = 0;
  for (let r = 0; r < GRID_ROWS && idx < icons.length; r++) {
    for (let c = 0; c < GRID_COLS && idx < icons.length; c++) {
      result.push({ id: icons[idx], row: r + 1, col: c + 1 });
      idx++;
    }
  }
  return result;
}

export const DEFAULT_LAYOUT: DesktopLayout = createDefaultDesktopIconLayout(createDefaultWidgets());

export function getDesktopPageKeysForState(layout: DesktopLayout, widgets: WidgetInstance[] = []): DesktopPageKey[] {
  const maxPage = Math.max(
    2,
    ...getDesktopPageKeys(layout).map(getDesktopPageNumber),
    ...widgets.map((widget) => widget.page).filter((page) => Number.isInteger(page) && page >= 1)
  );
  return Array.from({ length: maxPage }, (_, index) => getDesktopPageKey(index + 1));
}

export function cloneDesktopLayout(layout: DesktopLayout, widgets: WidgetInstance[] = []): DesktopLayout {
  const next = {} as DesktopLayout;
  for (const pageKey of getDesktopPageKeysForState(layout, widgets)) {
    next[pageKey] = [...(layout[pageKey] ?? [])];
  }
  return next;
}

export function ensureDesktopPage(layout: DesktopLayout, pageKey: DesktopPageKey): void {
  if (!layout[pageKey]) layout[pageKey] = [];
}

export function trimEmptyTrailingPages(layout: DesktopLayout, widgets: WidgetInstance[]): DesktopLayout {
  const next = cloneDesktopLayout(layout, widgets);
  let maxPage = Math.max(2, ...getDesktopPageKeysForState(next, widgets).map(getDesktopPageNumber));
  while (maxPage > 2) {
    const pageKey = getDesktopPageKey(maxPage);
    const hasIcons = (next[pageKey] ?? []).length > 0;
    const hasWidgets = widgets.some((widget) => widget.page === maxPage);
    if (hasIcons || hasWidgets) break;
    delete next[pageKey];
    maxPage -= 1;
  }
  return next;
}

export function getInstalledCustomIconIds(): Set<string> {
  return new Set(loadInstalledCustomApps().map(app => toCustomAppIconId(app.id)));
}

function migrateLegacyDesktopIconId(id: string, customIconIds = getInstalledCustomIconIds()): DesktopIconId | null {
  if (id === "weibo") return "game";
  if (id === "fortune") return "interview_magazine";
  if (id === "forum") return "cocreate";
  if (isCustomAppIconId(id) && customIconIds.has(id)) return id;
  return id in ICONS ? id as IconId : null;
}

/** Validate an IconPosition[] page, dedup by id and position */
function normalizePageV2(raw: unknown, pageWidgets: WidgetInstance[], folderIds: Set<string> = new Set()): IconPosition[] {
  if (!Array.isArray(raw)) return [];

  const allKnown = new Set<string>(Object.keys(ICONS));
  const customIconIds = getInstalledCustomIconIds();
  const seenIds = new Set<DesktopIconId>();
  const seenCells = new Set<string>();
  const widgetOcc = buildWidgetOccupancy(pageWidgets);
  const result: IconPosition[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { id, row, col } = item as { id: string; row: number; col: number };
    if (typeof id !== "string" || typeof row !== "number" || typeof col !== "number") continue;
    // 文件夹 tile：只认内容表里真实存在的文件夹，防止幽灵 tile
    const iconId = isFolderIconId(id)
      ? (folderIds.has(id) ? id : null)
      : migrateLegacyDesktopIconId(id, customIconIds);
    if (!iconId || (!isFolderIconId(iconId) && !allKnown.has(iconId) && !customIconIds.has(iconId))) continue;
    if (seenIds.has(iconId)) continue;
    if (row < 1 || row > GRID_ROWS || col < 1 || col > GRID_COLS) continue;
    const cellKey = `${row},${col}`;
    if (seenCells.has(cellKey)) continue;
    if (widgetOcc[row - 1][col - 1]) continue;
    seenIds.add(iconId);
    seenCells.add(cellKey);
    result.push({ id: iconId, row, col });
  }

  return result;
}

/** Migrate v1 (array of IconId|null) to v2 (IconPosition[]) */
export function migratePageV1(raw: unknown, defaults: IconId[], pageWidgets: WidgetInstance[]): IconPosition[] {
  const allowed = new Set<IconId>(defaults);
  const seen = new Set<IconId>();
  const ordered: (IconId | null)[] = [];

  const rawItems = Array.isArray(raw) ? raw : [];
  for (const item of rawItems) {
    if (item === null) { ordered.push(null); continue; }
    if (typeof item !== "string") continue;
    const id = migrateLegacyDesktopIconId(item);
    if (!id || !(id in ICONS)) continue;
    const builtinId = id as IconId;
    if (!allowed.has(builtinId) || seen.has(builtinId)) continue;
    seen.add(builtinId);
    ordered.push(builtinId);
  }
  for (const id of defaults) {
    if (!seen.has(id)) ordered.push(id);
  }

  // Flow into absolute positions (same as old computeIconPositions)
  const widgetOcc = buildWidgetOccupancy(pageWidgets);
  const freeCells: { row: number; col: number }[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (!widgetOcc[r][c]) freeCells.push({ row: r + 1, col: c + 1 });
    }
  }
  const result: IconPosition[] = [];
  let fi = 0;
  for (const slot of ordered) {
    if (fi >= freeCells.length) break;
    if (slot === null) { fi++; continue; }
    result.push({ id: slot, ...freeCells[fi] });
    fi++;
  }
  return result;
}

export function normalizeLayout(raw: unknown, widgets: WidgetInstance[], dockIds: Set<DesktopIconId> = new Set(), folders: DesktopFolderMap = {}): DesktopLayout {
  if (!raw || typeof raw !== "object") return createDefaultDesktopIconLayout(widgets);
  const candidate = raw as Record<string, unknown>;
  const folderIds = new Set(Object.keys(folders));
  const maxPage = Math.max(
    2,
    ...Object.keys(candidate).map(getDesktopPageNumber),
    ...widgets.map((widget) => widget.page).filter((page) => Number.isInteger(page) && page >= 1)
  );
  const layout = {} as DesktopLayout;
  for (let page = 1; page <= maxPage; page += 1) {
    const pageKey = getDesktopPageKey(page);
    // Icons that live in the dock must never also appear on a page.
    layout[pageKey] = normalizePageV2(candidate[pageKey], widgets.filter(w => w.page === page), folderIds)
      .filter((ic) => !dockIds.has(ic.id));
  }

  // Ensure all default icons exist somewhere across desktop pages (but not ones
  // the user has moved into the dock). DOCK_DEFAULT 也纳入兜底：若某默认 dock
  // 图标（如设置）既不在任何页面也不在 dock（如恢复默认/导入主题后 dock 未含它），
  // 就近放回页面，防止图标彻底丢失。
  // 「已放置」包括藏在文件夹里的图标，否则重启后文件夹成员会被兜底复制一份铺回桌面。
  const allPlaced = new Set<DesktopIconId>(getDesktopIconLayoutItems(layout).map(ic => ic.id));
  for (const folder of Object.values(folders)) {
    for (const memberId of folder.icons) allPlaced.add(memberId);
  }
  const allDefaults = [...PAGE_1_DEFAULT, ...PAGE_2_DEFAULT, ...PAGE_3_DEFAULT, ...DOCK_DEFAULT];

  for (const id of allDefaults) {
    if (allPlaced.has(id) || dockIds.has(id)) continue;
    const primaryPage = PAGE_1_DEFAULT.includes(id) ? 1 : PAGE_2_DEFAULT.includes(id) ? 2 : PAGE_3_DEFAULT.includes(id) ? 3 : 1;
    // placeIconOnAvailablePage 页满会顺延到下一页乃至新开一页——
    // 曾经这里只在现有页里找空格，页面被图标和组件占满时就静默放弃，
    // 图标（如外观）从此永久丢失且每次重启都救不回
    placeIconOnAvailablePage(layout, widgets, { id, row: 1, col: 1 }, primaryPage);
    allPlaced.add(id);
  }

  return trimEmptyTrailingPages(layout, widgets);
}

/**
 * 文件夹与布局的一致性收拾：
 * - 成员若已经出现在页面/dock 上（以摆出来的为准），从文件夹里摘除；
 * - 卸载掉的自定义 APP 成员摘除（normalizeDesktopFolders 已管，这里兜底运行时变化）；
 * - 只剩 ≤1 个成员的文件夹解散：剩下的图标顶回 tile 原来的格子；
 * - 布局里指向不存在文件夹的 tile 由 normalizeLayout 过滤，这里不重复。
 * 返回新对象；changed=false 时引用原样返回，调用方可以跳过持久化。
 */
export function sanitizeDesktopFolders(
  folders: DesktopFolderMap,
  layout: DesktopLayout,
  dock: DesktopIconId[],
  widgets: WidgetInstance[],
): { folders: DesktopFolderMap; layout: DesktopLayout; changed: boolean } {
  const placedOutside = new Set<DesktopIconId>([
    ...getDesktopIconLayoutItems(layout).map(ic => ic.id),
    ...dock,
  ]);
  const customIconIds = getInstalledCustomIconIds();
  let changed = false;
  const nextFolders: DesktopFolderMap = {};
  let nextLayout = layout;

  const removeTile = (folderId: string): { pageKey: DesktopPageKey; row: number; col: number } | null => {
    for (const pageKey of getDesktopPageKeysForState(nextLayout, widgets)) {
      const tile = (nextLayout[pageKey] ?? []).find(ic => ic.id === folderId);
      if (!tile) continue;
      if (nextLayout === layout) nextLayout = cloneDesktopLayout(layout, widgets);
      nextLayout[pageKey] = nextLayout[pageKey].filter(ic => ic.id !== folderId);
      return { pageKey, row: tile.row, col: tile.col };
    }
    return null;
  };

  for (const [folderId, folder] of Object.entries(folders)) {
    const members = folder.icons.filter(id =>
      !placedOutside.has(id)
      && !isFolderIconId(id)
      && (id in ICONS || customIconIds.has(id)));
    if (members.length !== folder.icons.length) changed = true;
    if (members.length <= 1) {
      // 解散：tile 换成剩下的那个图标（若有）
      changed = true;
      const spot = removeTile(folderId);
      const remaining = members[0];
      if (remaining) {
        if (nextLayout === layout) nextLayout = cloneDesktopLayout(layout, widgets);
        if (spot) {
          nextLayout[spot.pageKey] = [...(nextLayout[spot.pageKey] ?? []), { id: remaining, row: spot.row, col: spot.col }];
        } else {
          placeIconOnAvailablePage(nextLayout, widgets, { id: remaining, row: 1, col: 1 }, 1);
        }
      }
      continue;
    }
    nextFolders[folderId] = members.length === folder.icons.length ? folder : { ...folder, icons: members };
    // 崩溃等意外可能造成"文件夹记录在、格子却不在任何页面"：成员被文件夹托管着，
    // 桌面上却什么都不渲染，默认图标兜底又把成员算作"已放置"——图标就永久隐身了
    //（用户表现：某图标凭空消失，恢复默认布局才回来）。这里把格子就近放回页面自愈。
    const tilePlaced = getDesktopIconLayoutItems(nextLayout).some(ic => ic.id === folderId);
    if (!tilePlaced) {
      if (nextLayout === layout) nextLayout = cloneDesktopLayout(layout, widgets);
      placeIconOnAvailablePage(nextLayout, widgets, { id: folderId as DesktopIconId, row: 1, col: 1 }, 1);
      changed = true;
    }
  }
  if (!changed) return { folders, layout, changed: false };
  return { folders: nextFolders, layout: trimEmptyTrailingPages(nextLayout, widgets), changed: true };
}

/** Build a boolean grid marking cells occupied by widgets on one page */
export function buildWidgetOccupancy(pageWidgets: WidgetInstance[]): boolean[][] {
  const grid: boolean[][] = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLS }, () => false)
  );
  for (const w of pageWidgets) {
    const [rows, cols] = WIDGET_SIZE_CELLS[w.size];
    for (let dr = 0; dr < rows; dr++) {
      for (let dc = 0; dc < cols; dc++) {
        const r = w.row - 1 + dr;
        const c = w.col - 1 + dc;
        if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
          grid[r][c] = true;
        }
      }
    }
  }
  return grid;
}

/** Convert IconPosition[] to the Map the renderer consumes */
export function computeIconPositions(
  pageIcons: IconPosition[],
  _pageWidgets: WidgetInstance[]
): Map<DesktopIconId, { row: number; col: number }> {
  const positions = new Map<DesktopIconId, { row: number; col: number }>();
  for (const icon of pageIcons) {
    positions.set(icon.id, { row: icon.row, col: icon.col });
  }
  return positions;
}

/** Find nearest free cell to (fromRow, fromCol). Returns 1-based coords. */
export function findNearestFreeCell(
  fromRow: number, fromCol: number,
  widgetOcc: boolean[][],
  usedCells: Set<string>,
): { row: number; col: number } | null {
  let bestDist = Infinity;
  let best: { row: number; col: number } | null = null;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (widgetOcc[r][c]) continue;
      const key = `${r + 1},${c + 1}`;
      if (usedCells.has(key)) continue;
      const dist = Math.abs(r + 1 - fromRow) * GRID_COLS + Math.abs(c + 1 - fromCol);
      if (dist < bestDist) { bestDist = dist; best = { row: r + 1, col: c + 1 }; }
    }
  }
  return best;
}

/** Displace only icons that overlap with widgets. Others stay put.
 *  Returns { placed, overflow } — overflow icons had no room on this page. */
export function displaceIconsForWidgets(
  icons: IconPosition[],
  pageWidgets: WidgetInstance[],
): { placed: IconPosition[]; overflow: IconPosition[] } {
  const widgetOcc = buildWidgetOccupancy(pageWidgets);
  const placed: IconPosition[] = [];
  const usedCells = new Set<string>();
  const displaced: IconPosition[] = [];

  for (const icon of icons) {
    if (widgetOcc[icon.row - 1]?.[icon.col - 1]) {
      displaced.push(icon);
    } else {
      placed.push(icon);
      usedCells.add(`${icon.row},${icon.col}`);
    }
  }

  const overflow: IconPosition[] = [];
  for (const icon of displaced) {
    const free = findNearestFreeCell(icon.row, icon.col, widgetOcc, usedCells);
    if (free) {
      placed.push({ id: icon.id, row: free.row, col: free.col });
      usedCells.add(`${free.row},${free.col}`);
    } else {
      overflow.push(icon);
    }
  }

  return { placed, overflow };
}

export function placeIconOnAvailablePage(
  layout: DesktopLayout,
  widgets: WidgetInstance[],
  icon: IconPosition,
  startPage: number,
): void {
  const maxPage = Math.max(
    2,
    startPage,
    ...getDesktopPageKeysForState(layout, widgets).map(getDesktopPageNumber)
  );
  for (let page = Math.max(1, startPage); page <= maxPage + 1; page += 1) {
    const pageKey = getDesktopPageKey(page);
    ensureDesktopPage(layout, pageKey);
    const widgetOcc = buildWidgetOccupancy(widgets.filter(w => w.page === page));
    const usedCells = new Set(layout[pageKey].map(ic => `${ic.row},${ic.col}`));
    const free = findNearestFreeCell(icon.row, icon.col, widgetOcc, usedCells);
    if (!free) continue;
    layout[pageKey] = [...layout[pageKey], { id: icon.id, row: free.row, col: free.col }];
    return;
  }
}

/** 网格几何：格子原点/步距/内容尺寸（屏幕像素）。指针→格子换算和
 *  图标矩形碰撞检测共用同一份，保证两套判定不会各说各话。 */
type GridGeometry = {
  originX: number;
  originY: number;
  colStep: number;
  rowStep: number;
  colWidth: number;
  rowHeight: number;
};

export function getGridGeometry(gridEl: HTMLElement): GridGeometry {
  const rect = gridEl.getBoundingClientRect();
  const computed = getComputedStyle(gridEl);
  const scaleX = rect.width / (gridEl.offsetWidth || rect.width) || 1;
  const scaleY = rect.height / (gridEl.offsetHeight || rect.height) || 1;
  const colWidths = computed.gridTemplateColumns.split(/\s+/).map(parseFloat);
  const colWidth = colWidths[0] || 66;
  const colGap = parseFloat(computed.columnGap) || 0;
  const rowGap = parseFloat(computed.rowGap) || 0;
  const padTop = parseFloat(computed.paddingTop) || 0;
  const padBottom = parseFloat(computed.paddingBottom) || 0;
  const contentWidth = colWidths.length * colWidth + (colWidths.length - 1) * colGap;
  const padLeft = parseFloat(computed.paddingLeft) || 0;
  const padRight = parseFloat(computed.paddingRight) || 0;
  const innerWidth = gridEl.clientWidth - padLeft - padRight;
  const originX = rect.left + (gridEl.clientLeft + padLeft + Math.max(0, (innerWidth - contentWidth) / 2) - gridEl.scrollLeft) * scaleX;
  const originY = rect.top + (gridEl.clientTop + padTop - gridEl.scrollTop) * scaleY;
  // Computed tracks remain accurate when short windows scroll the six-row grid.
  const rowHeight = parseFloat(computed.gridTemplateRows.split(/\s+/)[0])
    || (gridEl.clientHeight - padTop - padBottom - (GRID_ROWS - 1) * rowGap) / GRID_ROWS;
  return { originX, originY, colStep: (colWidth + colGap) * scaleX, rowStep: (rowHeight + rowGap) * scaleY, colWidth: colWidth * scaleX, rowHeight: rowHeight * scaleY };
}

/** Convert pointer screen position to a grid cell (0-based) */
export function pointerToGridCell(
  px: number,
  py: number,
  gridEl: HTMLElement
): { row: number; col: number } | null {
  const geom = getGridGeometry(gridEl);
  const col = Math.floor((px - geom.originX) / geom.colStep);
  const row = Math.floor((py - geom.originY) / geom.rowStep);
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null;
  return { row, col };
}

export function sanitizeWidgetsForLayout(_layout: DesktopLayout, widgets: WidgetInstance[]): WidgetInstance[] {
  const normalized: WidgetInstance[] = [];
  const pageNumbers = getDesktopPageKeysForState(_layout, widgets).map(getDesktopPageNumber);

  for (const page of pageNumbers) {
    for (const w of widgets.filter((widget) => widget.page === page)) {
      // Widget-only collision: pass empty icons so icons don't block widget placement
      const grid = buildOccupancyGrid([], normalized, page);
      if (canPlaceWidget(grid, w.size, w.row, w.col)) {
        normalized.push(w);
      }
    }
  }

  return normalized;
}

export function sameWidgetOrder(a: WidgetInstance[], b: WidgetInstance[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.page !== y.page ||
      x.row !== y.row ||
      x.col !== y.col ||
      x.size !== y.size ||
      x.type !== y.type
    ) {
      return false;
    }
  }
  return true;
}
