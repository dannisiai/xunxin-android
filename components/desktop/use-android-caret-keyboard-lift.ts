"use client";

import { useEffect } from "react";
import { DEVICE_ADAPTATION_CHANGED_EVENT, isTouchDevice } from "@/lib/device-adaptation";

type KeyboardTargetRect = {
  top: number;
  bottom: number;
};

function isKeyboardEditableElement(element: EventTarget | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLSelectElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;

  const type = element.type.toLowerCase();
  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
}

export function shouldBypassDesktopItemPointerCapture(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("[data-ui='modal'], .modal-overlay, .modal-dialog, .modal-sheet, .modal-expand")) return true;
  return isKeyboardEditableElement(target);
}

function parseCssPixels(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function measureTextareaCaretRect(textarea: HTMLTextAreaElement): KeyboardTargetRect {
  const selectionStart = textarea.selectionStart ?? textarea.value.length;
  const computed = window.getComputedStyle(textarea);
  const rect = textarea.getBoundingClientRect();
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const fontSize = parseCssPixels(computed.fontSize, 14);
  const lineHeight = computed.lineHeight === "normal" ? fontSize * 1.2 : parseCssPixels(computed.lineHeight, fontSize * 1.2);
  const mirrorProperties = [
    "font-family",
    "font-size",
    "font-style",
    "font-variant",
    "font-weight",
    "letter-spacing",
    "text-align",
    "text-indent",
    "text-transform",
    "word-spacing",
    "tab-size",
    "direction",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
  ];

  for (const property of mirrorProperties) {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  }

  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.left = "-10000px";
  mirror.style.top = "0";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.boxSizing = "border-box";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = computed.getPropertyValue("word-break");
  mirror.style.lineHeight = `${lineHeight}px`;
  mirror.textContent = textarea.value.slice(0, selectionStart);
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  document.body.removeChild(mirror);

  const top = rect.top + markerRect.top - mirrorRect.top - textarea.scrollTop;
  return {
    top,
    bottom: top + lineHeight,
  };
}

function getKeyboardTargetRect(element: HTMLElement): KeyboardTargetRect {
  if (element instanceof HTMLTextAreaElement) {
    return measureTextareaCaretRect(element);
  }

  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    bottom: rect.bottom,
  };
}

export function useAndroidCaretKeyboardLift() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const root = document.documentElement;
    if (!/Android/i.test(navigator.userAgent)) {
      root.style.removeProperty("--mobile-keyboard-lift");
      return;
    }

    const viewport = window.visualViewport;
    let focusedElement: HTMLElement | null = null;
    let raf = 0;
    let currentLift = 0;

    const applyLift = (nextLift: number) => {
      const rounded = Math.max(0, Math.round(nextLift));
      if (Math.abs(rounded - currentLift) < 2) return;
      currentLift = rounded;
      if (rounded > 0) {
        root.style.setProperty("--mobile-keyboard-lift", `${rounded}px`);
      } else {
        root.style.removeProperty("--mobile-keyboard-lift");
      }
    };

    const update = () => {
      raf = 0;
      const element = focusedElement;
      // Chat and adapted dialogs fit and scroll their own content above the keyboard.
      // Applying the general caret lift too would move the whole shell offscreen.
      if (element?.closest(".chat-room-wrapper [data-ui='input'],[data-adaptive-overlay='true'],[data-adaptive-card='true']")) {
        applyLift(0);
        return;
      }
      if (!element || document.activeElement !== element || !isTouchDevice() || !viewport) {
        applyLift(0);
        return;
      }

      const keyboardTop = viewport.offsetTop + viewport.height;
      const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const targetRect = getKeyboardTargetRect(element);
      const gap = 36;

      if (keyboardInset < 80) {
        applyLift(0);
        return;
      }

      const naturalBottom = targetRect.bottom + currentLift;
      const neededLift = Math.max(0, naturalBottom + gap - keyboardTop);
      applyLift(Math.min(keyboardInset, neededLift));
    };

    const requestUpdate = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(update);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!isKeyboardEditableElement(target)) return;
      focusedElement = target;
      requestUpdate();
    };

    const handleFocusOut = () => {
      focusedElement = null;
      applyLift(0);
    };

    const handleCaretMove = () => {
      if (focusedElement) requestUpdate();
    };

    const handleViewportChange = () => {
      if (focusedElement) requestUpdate();
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("click", handleCaretMove, true);
    document.addEventListener("keyup", handleCaretMove, true);
    document.addEventListener("input", handleCaretMove, true);
    window.addEventListener(DEVICE_ADAPTATION_CHANGED_EVENT, handleViewportChange);
    viewport?.addEventListener("resize", handleViewportChange);
    viewport?.addEventListener("scroll", handleViewportChange);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("click", handleCaretMove, true);
      document.removeEventListener("keyup", handleCaretMove, true);
      document.removeEventListener("input", handleCaretMove, true);
      window.removeEventListener(DEVICE_ADAPTATION_CHANGED_EVENT, handleViewportChange);
      viewport?.removeEventListener("resize", handleViewportChange);
      viewport?.removeEventListener("scroll", handleViewportChange);
      root.style.removeProperty("--mobile-keyboard-lift");
    };
  }, []);
}
