import contract from "./adaptive-surface-contract.json";

const overlays = ['[data-adaptive-surface="overlay"]', ...contract.overlayClasses.map(name => '.' + name)].join(',');
const surfaces = [overlays, '[data-adaptive-surface="card"]', '[role="dialog"]', '[aria-modal="true"]', ...contract.cardClasses.map(name => '.' + name)].join(',');
const controls = 'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),textarea:not(:disabled),select:not(:disabled),iframe,[tabindex]:not([tabindex="-1"])';
const visible = (node: HTMLElement) => node.isConnected && node.getClientRects().length > 0
  && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[inert],[aria-hidden="true"]');

/** Keyboard behavior for explicitly declared custom dialogs. Reuses each dialog's own dismiss action. */
export function initAdaptiveInput(): () => void {
  let current: HTMLElement | null = null, restore: HTMLElement | null = null, frame = 0;
  const savedAttributes = new Map<HTMLElement, Map<string, string | null>>();
  const previousFocus = new WeakMap<HTMLElement, HTMLElement | null>();
  const candidates = () => [...document.querySelectorAll<HTMLElement>(surfaces)]
    .filter(node => visible(node) && !['content','decoration'].includes(node.dataset.adaptiveSurface || '')
      && (node.matches('[role="dialog"],[aria-modal="true"]') || node.closest(overlays)
        || node.querySelector('[data-adaptive-dismiss],button[aria-label="关闭"],button[aria-label="取消"]')));
  const zOrder = (node: HTMLElement) => {
    const chain: number[] = [];
    for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), value = Number.parseInt(style.zIndex);
      if (Number.isFinite(value)) chain.unshift(value);
    }
    return chain;
  };
  const topSurface = () => {
    const all = candidates();
    return all.filter(node => !all.some(other => node !== other && node.contains(other)))
      .sort((a, b) => {
        const left = zOrder(a), right = zOrder(b);
        for (let i = 0; i < Math.max(left.length, right.length); i++) {
          const difference = (left[i] || 0) - (right[i] || 0);
          if (difference) return difference;
        }
        return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      }).at(-1) || null;
  };
  const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(controls)].filter(visible);
  const setAttribute = (root: HTMLElement, name: string, value: string) => {
    if (!savedAttributes.has(root)) savedAttributes.set(root, new Map());
    const saved = savedAttributes.get(root)!;
    if (!saved.has(name)) saved.set(name, root.getAttribute(name));
    if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  };
  const update = () => {
    frame = 0;
    for (const node of savedAttributes.keys()) if (!node.isConnected) savedAttributes.delete(node);
    const top = topSurface();
    // Shared dialogs already own focus, dismissal and restoration through their React hook.
    const next = top?.dataset.dialogFocusManaged === 'true' ? null : top;
    if (current === next) return;
    if (current && !visible(current)) {
      if (restore && visible(restore)) restore.focus({ preventScroll: true });
      previousFocus.delete(current);
    }
    current = next;
    if (!next) { restore = null; return; }
    if (!previousFocus.has(next)) previousFocus.set(next, document.activeElement instanceof HTMLElement ? document.activeElement : null);
    restore = previousFocus.get(next) || null;
    if (!next.hasAttribute('role')) setAttribute(next, 'role', 'dialog');
    if (next.getAttribute('role') === 'dialog') setAttribute(next, 'aria-modal', 'true');
    if (!next.hasAttribute('tabindex')) setAttribute(next, 'tabindex', '-1');
    if (!next.contains(document.activeElement)) (next.querySelector<HTMLElement>('[autofocus],button:not(:disabled)') || focusables(next)[0] || next).focus({ preventScroll: true });
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const dismiss = (event: Event) => {
    const root = topSurface();
    if (!root || root.dataset.dialogFocusManaged === 'true' || event.defaultPrevented) return;
    const close = root.querySelector<HTMLElement>('[data-adaptive-dismiss],button[aria-label="关闭"],button[aria-label="取消"]');
    const backdrop = root.closest<HTMLElement>(overlays);
    if (!close && !backdrop) return;
    event.preventDefault(); event.stopImmediatePropagation();
    (close || backdrop)?.click();
  };
  const keys = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape') { dismiss(event); return; }
    const root = topSurface();
    if (!root || root.dataset.dialogFocusManaged === 'true' || event.key !== 'Tab') return;
    const nodes = focusables(root), first = nodes[0], last = nodes.at(-1);
    if (!first) { event.preventDefault(); root.focus(); }
    else if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  };
  const activateRoleButton = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || !['Enter', ' '].includes(event.key)) return;
    const node = event.target;
    if (node instanceof HTMLElement && node.matches('[role="button"]:not(button):not(input)') && node.getAttribute('aria-disabled') !== 'true') {
      event.preventDefault(); node.click();
    }
  };
  const observer = new MutationObserver(records => {
    if (records.every(record => record.type === 'childList'
      && [...record.addedNodes,...record.removedNodes].every(node => node instanceof Element && node.hasAttribute('data-adaptive-probe')))) return;
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['class','style','hidden','aria-hidden','data-adaptive-surface','data-dialog-focus-managed'] });
  document.addEventListener('keydown', keys, true);
  document.addEventListener('keydown', activateRoleButton);
  window.addEventListener('android-shell-back', dismiss, true);
  update();
  return () => {
    observer.disconnect(); cancelAnimationFrame(frame);
    document.removeEventListener('keydown', keys, true);
    document.removeEventListener('keydown', activateRoleButton);
    window.removeEventListener('android-shell-back', dismiss, true);
    for (const [node, attributes] of savedAttributes) for (const [name, value] of attributes) {
      if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
    }
  };
}
