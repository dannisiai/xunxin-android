"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { DEVICE_ADAPTATION_CHANGED_EVENT, isTouchDevice } from "@/lib/device-adaptation";

const CHAT_BOTTOM_RESERVE_CSS_VAR = "--chat-bottom-reserve";
const STICK_TO_BOTTOM_THRESHOLD = 120;
const CHAT_KEYBOARD_INSET_CSS_VAR = "--chat-keyboard-inset";

function findBottomOverlay(wrapper: HTMLElement): HTMLElement | null {
    for (const child of Array.from(wrapper.children)) {
        if (!(child instanceof HTMLElement)) continue;
        const ui = child.dataset.ui;
        if (ui === "input" || ui === "multi-select") return child;
    }
    return null;
}

export function useChatBottomReserve<TWrapper extends HTMLElement, TScroll extends HTMLElement>(
    wrapperRef: RefObject<TWrapper | null>,
    scrollRef: RefObject<TScroll | null>,
    refreshKey: string,
    onInputFocus?: () => void,
) {
    const followingBottomRef = useRef(true);
    const requestMeasureRef = useRef<(() => void) | null>(null);
    const onInputFocusRef = useRef(onInputFocus);
    onInputFocusRef.current = onInputFocus;

    const scrollToBottom = useCallback(() => {
        followingBottomRef.current = true;
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        requestMeasureRef.current?.();
    }, [scrollRef]);

    useLayoutEffect(() => {
        if (typeof window === "undefined") return;
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        let frame = 0;
        let bottomScrollFrame = 0;
        let observer: ResizeObserver | null = null;
        let keyboardInset = 0;
        let chatInputWasFocused = false;
        let pointerStartY: number | null = null;
        const settleTimers: number[] = [];
        const viewport = window.visualViewport;

        const isChatInput = (target: EventTarget | null): target is HTMLElement => target instanceof HTMLElement
            && target.matches("textarea.chat-input-textarea, input.chat-input-textarea")
            && wrapper.contains(target);

        const followBottom = () => {
            if (!followingBottomRef.current) return;
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
        };

        const scheduleStickToBottom = () => {
            if (bottomScrollFrame) window.cancelAnimationFrame(bottomScrollFrame);
            bottomScrollFrame = window.requestAnimationFrame(() => {
                bottomScrollFrame = 0;
                followBottom();
            });
        };

        const measure = () => {
            frame = 0;
            const overlay = findBottomOverlay(wrapper);
            const rect = wrapper.getBoundingClientRect();
            if (!overlay || rect.height <= 0 || rect.width <= 0) {
                wrapper.style.removeProperty(CHAT_BOTTOM_RESERVE_CSS_VAR);
                wrapper.style.removeProperty(CHAT_KEYBOARD_INSET_CSS_VAR);
                wrapper.removeAttribute("data-keyboard-open");
                keyboardInset = 0;
                return;
            }

            // Fit this chat to the visible viewport. Account for phone-shell
            // scaling and for adjustResize already applied by native Android.
            const focused = isChatInput(document.activeElement);
            if (focused) chatInputWasFocused = true;
            const otherInputFocused = document.activeElement instanceof HTMLElement
                && document.activeElement.matches("input, textarea, select, [contenteditable='true']")
                && !focused;
            const scale = rect.width / (wrapper.offsetWidth || rect.width);
            const naturalBottom = rect.bottom + keyboardInset * scale;
            const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
            const overlap = Math.max(0, naturalBottom - visibleBottom);
            const nextInset = isTouchDevice() && chatInputWasFocused && !otherInputFocused
                ? Math.min(Math.max(0, wrapper.offsetHeight + keyboardInset - 140), Math.ceil(overlap / scale))
                : 0;
            if (nextInset !== keyboardInset) {
                keyboardInset = nextInset;
                wrapper.style.setProperty(CHAT_KEYBOARD_INSET_CSS_VAR, `${nextInset}px`);
            }
            wrapper.toggleAttribute("data-keyboard-open", nextInset > 0);
            if (!focused && overlap < 1) chatInputWasFocused = false;

            const height = Math.ceil(overlay.getBoundingClientRect().height / scale);

            if (height > 0) {
                wrapper.style.setProperty(CHAT_BOTTOM_RESERVE_CSS_VAR, `${height}px`);
            } else {
                wrapper.style.removeProperty(CHAT_BOTTOM_RESERVE_CSS_VAR);
            }

            // Read the follow intent from scroll events, before the viewport
            // shrinks; measuring proximity after a resize loses that intent.
            if (followingBottomRef.current) {
                followBottom();
                scheduleStickToBottom();
            }
        };

        const requestMeasure = () => {
            if (frame) window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(measure);
        };
        requestMeasureRef.current = requestMeasure;

        const onScroll = () => {
            const el = scrollRef.current;
            if (el) followingBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_THRESHOLD;
        };
        const onReadHistory = () => {
            followingBottomRef.current = false;
            if (bottomScrollFrame) window.cancelAnimationFrame(bottomScrollFrame);
            bottomScrollFrame = 0;
        };
        const onPointerDown = (event: PointerEvent) => { pointerStartY = event.clientY; };
        const onPointerMove = (event: PointerEvent) => {
            if (pointerStartY !== null && Math.abs(event.clientY - pointerStartY) > 6) onReadHistory();
        };
        const onPointerEnd = () => { pointerStartY = null; };
        const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) onReadHistory(); };
        const onInputInteraction = (event: Event) => {
            if (!isChatInput(event.target)) return;
            settleTimers.splice(0).forEach(timer => window.clearTimeout(timer));
            chatInputWasFocused = true;
            onInputFocusRef.current?.();
            scrollToBottom();
        };
        const onFocusOut = () => {
            requestMeasure();
            settleTimers.splice(0).forEach(timer => window.clearTimeout(timer));
            // Some mobile keyboard dismissal paths omit the final resize event.
            for (const delay of [80, 250, 600]) {
                settleTimers.push(window.setTimeout(() => {
                    if (delay === 600 && !isChatInput(document.activeElement)) chatInputWasFocused = false;
                    requestMeasure();
                }, delay));
            }
        };

        const overlay = findBottomOverlay(wrapper);
        if (overlay && typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(requestMeasure);
            observer.observe(overlay);
            observer.observe(wrapper);
        }

        measure();
        const el = scrollRef.current;
        el?.addEventListener("scroll", onScroll, { passive: true });
        el?.addEventListener("pointerdown", onPointerDown, { passive: true });
        el?.addEventListener("pointermove", onPointerMove, { passive: true });
        el?.addEventListener("pointerup", onPointerEnd, { passive: true });
        el?.addEventListener("pointercancel", onPointerEnd, { passive: true });
        el?.addEventListener("wheel", onWheel, { passive: true });
        wrapper.addEventListener("focusin", onInputInteraction);
        wrapper.addEventListener("click", onInputInteraction);
        wrapper.addEventListener("focusout", onFocusOut);
        wrapper.addEventListener("load", requestMeasure, true);
        wrapper.addEventListener("error", requestMeasure, true);
        window.addEventListener("resize", requestMeasure);
        window.addEventListener(DEVICE_ADAPTATION_CHANGED_EVENT, requestMeasure);
        viewport?.addEventListener("resize", requestMeasure);
        viewport?.addEventListener("scroll", requestMeasure);

        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            if (bottomScrollFrame) window.cancelAnimationFrame(bottomScrollFrame);
            observer?.disconnect();
            settleTimers.forEach(timer => window.clearTimeout(timer));
            requestMeasureRef.current = null;
            el?.removeEventListener("scroll", onScroll);
            el?.removeEventListener("pointerdown", onPointerDown);
            el?.removeEventListener("pointermove", onPointerMove);
            el?.removeEventListener("pointerup", onPointerEnd);
            el?.removeEventListener("pointercancel", onPointerEnd);
            el?.removeEventListener("wheel", onWheel);
            wrapper.removeEventListener("focusin", onInputInteraction);
            wrapper.removeEventListener("click", onInputInteraction);
            wrapper.removeEventListener("focusout", onFocusOut);
            wrapper.removeEventListener("load", requestMeasure, true);
            wrapper.removeEventListener("error", requestMeasure, true);
            window.removeEventListener("resize", requestMeasure);
            window.removeEventListener(DEVICE_ADAPTATION_CHANGED_EVENT, requestMeasure);
            viewport?.removeEventListener("resize", requestMeasure);
            viewport?.removeEventListener("scroll", requestMeasure);
            wrapper.style.removeProperty(CHAT_KEYBOARD_INSET_CSS_VAR);
            wrapper.removeAttribute("data-keyboard-open");
        };
    }, [wrapperRef, scrollRef, refreshKey, scrollToBottom]);

    return scrollToBottom;
}
