"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

export type WorkspaceDestination = { id: string; label: string; icon?: ReactNode; description?: string };

/** A persistent navigation pane. Container queries change presentation without remounting the editor. */
export function AdaptiveWorkspace({ title, destinations, selected, onSelect, onClose, children, className = "" }: {
  title: string;
  destinations: WorkspaceDestination[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return <div className={`adaptive-workspace ${className}`}>
    <nav className="adaptive-workspace-nav" aria-label={`${title}分类`}>
      <button type="button" className="adaptive-workspace-home" onClick={onClose}><ChevronLeft size={20} />桌面</button>
      <h2>{title}</h2>
      <div className="adaptive-destination-list" onKeyDown={navigateDestinationKeys}>
        {destinations.map(item => <button type="button" key={item.id} className="adaptive-destination"
          aria-current={selected === item.id ? "page" : undefined}
          onClick={() => onSelect(item.id)}>
          {item.icon && <span className="adaptive-destination-icon" aria-hidden="true">{item.icon}</span>}
          <span><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>
        </button>)}
      </div>
    </nav>
    <div className="adaptive-workspace-content">{children}</div>
  </div>;
}

/** Arrow keys move focus; Enter/Space retain standard button activation. Tab can leave the navigation. */
export function navigateDestinationKeys(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
      || (event.target as HTMLElement).matches('input,textarea,select,[contenteditable="true"]')) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    .filter(button => button.getClientRects().length > 0);
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0 || !buttons.length) return;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (current + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next].focus();
}

/** Spatial navigation follows rendered positions, so widgets and gaps need no separate grid model. */
export function navigateIconGridKeys(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>('button.icon-item');
  if (!button || target.closest('input,textarea,select,[contenteditable="true"]')) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button.icon-item:not(:disabled)')]
    .filter(node => !node.closest('[inert],[aria-hidden="true"]') && node.getClientRects().length > 0);
  let next: HTMLButtonElement | undefined;
  if (event.key === 'Home') next = buttons[0];
  else if (event.key === 'End') next = buttons.at(-1);
  else {
    const rect = button.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const horizontal = ['ArrowLeft','ArrowRight'].includes(event.key), sign = ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1;
    next = buttons.filter(node => node !== button).map(node => {
      const bounds = node.getBoundingClientRect(), dx = bounds.left + bounds.width / 2 - x, dy = bounds.top + bounds.height / 2 - y;
      const forward = (horizontal ? dx : dy) * sign, across = Math.abs(horizontal ? dy : dx);
      return { node, forward, score: forward + across * 4 };
    }).filter(item => item.forward > 1).sort((a, b) => a.score - b.score)[0]?.node;
  }
  if (next) { event.preventDefault(); next.focus(); }
}
