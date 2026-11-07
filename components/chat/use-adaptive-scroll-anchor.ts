"use client";

import { useEffect, type RefObject } from "react";
import { DEVICE_ADAPTATION_CHANGED_EVENT, DEVICE_ADAPTATION_WILL_CHANGE_EVENT } from "@/lib/device-adaptation";

/** Preserve the message being read while panes resize, rotate or move around a hinge. */
export function useAdaptiveScrollAnchor(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    let pending: { element: Element | null; top: number; scrollTop: number; atBottom: boolean } | null = null;
    let frame = 0;
    let settleFrame = 0;
    const capture = () => {
      const scroller = ref.current;
      if (pending || !scroller || !scroller.getClientRects().length) return;
      const rect = scroller.getBoundingClientRect();
      const element = [...scroller.querySelectorAll(".chat-msg-wrapper,.chat-offline-entry")]
        .find(el => el.getBoundingClientRect().bottom > rect.top);
      pending = {
        element: element || null, top: element ? element.getBoundingClientRect().top - rect.top : 0,
        scrollTop: scroller.scrollTop,
        atBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120,
      };
    };
    const restore = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settleFrame);
      frame = requestAnimationFrame(() => {
        settleFrame = requestAnimationFrame(() => {
          const scroller = ref.current, saved = pending;
          pending = null;
          if (!scroller || !saved || !scroller.getClientRects().length) return;
          if (saved.atBottom) scroller.scrollTop = scroller.scrollHeight;
          else if (saved.element?.isConnected) scroller.scrollTop += saved.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - saved.top;
          else scroller.scrollTop = saved.scrollTop;
        });
      });
    };
    window.addEventListener(DEVICE_ADAPTATION_WILL_CHANGE_EVENT, capture);
    window.addEventListener(DEVICE_ADAPTATION_CHANGED_EVENT, restore);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settleFrame);
      window.removeEventListener(DEVICE_ADAPTATION_WILL_CHANGE_EVENT, capture);
      window.removeEventListener(DEVICE_ADAPTATION_CHANGED_EVENT, restore);
    };
  }, [ref]);
}
