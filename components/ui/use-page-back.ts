"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

type BackEntry = { root: HTMLElement; back: () => void };
const pages: BackEntry[] = [];
const visible = (root: HTMLElement) => root.isConnected && root.getClientRects().length > 0
  && getComputedStyle(root).visibility !== "hidden" && !root.closest('[aria-hidden="true"],[inert]');

function navigateBack(event: Event) {
  if (event.defaultPrevented) return;
  const available = pages.filter(entry => visible(entry.root));
  const active = document.activeElement;
  const focused = available.filter(entry => active && entry.root.contains(active));
  const candidates = focused.length ? focused : available;
  const target = candidates.filter(entry => !candidates.some(other => other !== entry && entry.root.contains(other.root))).at(-1);
  if (!target) return;
  event.preventDefault();
  target.back();
}
function keyboardBack(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  if (event.key === "Escape") {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input,textarea,select,[contenteditable="true"]')) {
      active.blur(); event.preventDefault(); return;
    }
    navigateBack(event);
  } else if (event.altKey && event.key === "ArrowLeft") navigateBack(event);
}

export function usePageBack(rootRef: RefObject<HTMLElement | null>, onBack?: () => void) {
  const callback = useRef(onBack);
  callback.current = onBack;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !callback.current) return;
    const entry = { root, back: () => callback.current?.() };
    if (!pages.length) {
      window.addEventListener("android-shell-back", navigateBack);
      document.addEventListener("keydown", keyboardBack);
    }
    pages.push(entry);
    return () => {
      const index = pages.indexOf(entry);
      if (index >= 0) pages.splice(index, 1);
      if (!pages.length) {
        window.removeEventListener("android-shell-back", navigateBack);
        document.removeEventListener("keydown", keyboardBack);
      }
    };
  });
}
