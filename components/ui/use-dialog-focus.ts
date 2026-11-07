"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

const dialogs: HTMLElement[] = [];
const selector = 'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';
const focusable = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(selector)]
  .filter(node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[inert],[aria-hidden="true"]'));

export function useDialogFocus(rootRef: RefObject<HTMLElement | null>, onDismiss: () => void) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.dataset.dialogFocusManaged = 'true';
    dialogs.push(root);
    const top = () => {
      const visible = dialogs.filter(node => node.isConnected && node.getClientRects().length > 0);
      return visible.filter(node => !visible.some(other => other !== node && node.contains(other))).at(-1) === root;
    };
    const cancel = (event: Event) => {
      if (!top() || event.defaultPrevented) return;
      event.preventDefault(); event.stopImmediatePropagation(); dismiss.current();
    };
    const keys = (event: KeyboardEvent) => {
      if (!top() || event.isComposing) return;
      if (event.key === 'Escape') { cancel(event); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusable(root), first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); root.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const frame = requestAnimationFrame(() => {
      if (top()) (root.querySelector<HTMLElement>('[autofocus]')
        || (!matchMedia('(any-pointer: fine)').matches ? root.querySelector<HTMLElement>('button:not(:disabled)') : focusable(root)[0])
        || root).focus({ preventScroll: true });
    });
    document.addEventListener('keydown', keys, true);
    window.addEventListener('android-shell-back', cancel, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keys, true);
      window.removeEventListener('android-shell-back', cancel, true);
      const index = dialogs.indexOf(root);
      if (index >= 0) dialogs.splice(index, 1);
      delete root.dataset.dialogFocusManaged;
      if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
    };
  }, [rootRef]);
}
