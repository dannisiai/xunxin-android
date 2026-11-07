import { readThemeProfile } from "@/lib/theme-storage";
import { DEFAULT_THEME_PROFILE, normalizeThemeProfile, type ThemeProfile } from "@/lib/theme-types";

export function parseColorAlpha(value: string): { hex: string; alpha: number } {
  const rgbaMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    const r = Number(rgbaMatch[1]);
    const g = Number(rgbaMatch[2]);
    const b = Number(rgbaMatch[3]);
    const alpha = rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1;
    const hex = `#${[r, g, b].map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
    return { hex, alpha: Math.max(0, Math.min(1, alpha)) };
  }

  if (value.startsWith("#")) {
    if (value.length === 9) {
      const alpha = parseInt(value.slice(7, 9), 16) / 255;
      return { hex: value.slice(0, 7), alpha: Math.max(0, Math.min(1, alpha)) };
    }
    if (value.length === 4) {
      return {
        hex: `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`,
        alpha: 1
      };
    }
    return { hex: value, alpha: 1 };
  }

  return { hex: "#000000", alpha: 1 };
}

export function buildRgbaColor(hex: string, alpha: number): string {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (safeAlpha >= 1) return hex;
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

export function toCssPx(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return /[a-z%]/i.test(value) ? value : `${value}px`;
}

export function collectCssOverrides(profile: ThemeProfile): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(profile.cssOverrides)) {
    if (!key.startsWith("--")) continue;
    const normalized = String(value ?? "").trim();
    if (!normalized) continue;
    overrides[key] = normalized;
  }
  return overrides;
}

export function readInitialThemeProfile(): ThemeProfile {
  if (typeof window === "undefined") {
    return normalizeThemeProfile(DEFAULT_THEME_PROFILE);
  }
  return readThemeProfile();
}
