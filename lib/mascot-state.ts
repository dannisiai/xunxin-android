// lib/mascot-state.ts
// Global mascot state — shared between widget and floating ball.

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export type MascotState = "widget" | "animating_in" | "animating_out" | "floating";

export const MASCOT_TRANSITION_MS = 320;
export const MASCOT_COMPANION_KEY = "ai_phone_mascot_companion_v1";
export const MASCOT_FLOATING_KEY = "ai_phone_mascot_floating_v1";

registerKvMigration(MASCOT_COMPANION_KEY);
registerKvMigration(MASCOT_FLOATING_KEY);

export type CompanionCharacter = {
  characterId: string;
  name: string;
  avatar: string | null;
  persona?: string;
  personality?: string;
  briefPersona?: string;
  timeZone?: string;
};

let _state: MascotState = "widget";
let _panelOpen = false;
let _widgetRect: DOMRect | null = null;
let _activeCompanion: CompanionCharacter | null = null;
let _companionLoaded = false;
const _listeners = new Set<() => void>();
let _transitionTimer: ReturnType<typeof setTimeout> | null = null;

function notify() { _listeners.forEach((fn) => fn()); }

function scheduleState(nextState: MascotState) {
  if (_transitionTimer) clearTimeout(_transitionTimer);
  _transitionTimer = setTimeout(() => {
    _state = nextState;
    _transitionTimer = null;
    if (nextState === "widget") {
      _activeCompanion = null;
      if (typeof window !== "undefined") {
        kvSet(MASCOT_COMPANION_KEY, "");
      }
    }
    notify();
  }, MASCOT_TRANSITION_MS);
}

export function getMascotState() {
  if (!_companionLoaded && typeof window !== "undefined") {
    getActiveCompanion();
  }
  return _state;
}

export function isMascotPanelOpen() { return _panelOpen; }
export function getMascotWidgetRect() { return _widgetRect; }

export function getActiveCompanion(): CompanionCharacter | null {
  if (!_companionLoaded && typeof window !== "undefined") {
    _companionLoaded = true;
    try {
      const raw = kvGet(MASCOT_COMPANION_KEY);
      if (raw) {
        _activeCompanion = JSON.parse(raw);
      }
      const isFloating = kvGet(MASCOT_FLOATING_KEY) === "1";
      if (isFloating && _state === "widget") {
        _state = "floating";
      }
    } catch {
      _activeCompanion = null;
    }
  }
  return _activeCompanion;
}

export function activateMascot(widgetRect: DOMRect) {
  if (_transitionTimer) clearTimeout(_transitionTimer);
  _widgetRect = widgetRect;
  _state = "animating_in";
  if (typeof window !== "undefined") {
    kvSet(MASCOT_FLOATING_KEY, "1");
  }
  notify();
  scheduleState("floating");
}

export function summonCharacterCompanion(companion: CompanionCharacter, sourceRect?: DOMRect | null) {
  if (_transitionTimer) clearTimeout(_transitionTimer);
  _activeCompanion = companion;
  _companionLoaded = true;
  if (typeof window !== "undefined") {
    kvSet(MASCOT_COMPANION_KEY, JSON.stringify(companion));
    kvSet(MASCOT_FLOATING_KEY, "1");
  }
  _widgetRect = sourceRect || null;
  _state = "animating_in";
  notify();
  scheduleState("floating");
}

export function updateActiveCompanion(companion: Partial<CompanionCharacter> & { characterId: string }) {
  if (!_activeCompanion || _activeCompanion.characterId !== companion.characterId) return;
  _activeCompanion = { ..._activeCompanion, ...companion };
  _companionLoaded = true;
  if (typeof window !== "undefined") {
    kvSet(MASCOT_COMPANION_KEY, JSON.stringify(_activeCompanion));
  }
  notify();
}

export function dismissCompanion(targetRect?: DOMRect | null) {
  if (targetRect) {
    _widgetRect = targetRect;
  }
  if (typeof window !== "undefined") {
    kvSet(MASCOT_FLOATING_KEY, "0");
  }
  deactivateMascot();
}

export function isCompanionSummoned(characterId?: string): boolean {
  const comp = getActiveCompanion();
  if (!comp) return false;
  if (_state !== "floating" && _state !== "animating_in") return false;
  return characterId ? comp.characterId === characterId : true;
}

export function deactivateMascot() {
  if (_transitionTimer) clearTimeout(_transitionTimer);
  _panelOpen = false;
  _state = "animating_out";
  if (typeof window !== "undefined") {
    kvSet(MASCOT_FLOATING_KEY, "0");
  }
  notify();
  scheduleState("widget");
}

export function toggleMascotPanel() {
  _panelOpen = !_panelOpen;
  notify();
}

export function openMascotPanel() {
  _panelOpen = true;
  notify();
}

export function closeMascotPanel() {
  _panelOpen = false;
  notify();
}

export function subscribeMascot(fn: () => void) {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

