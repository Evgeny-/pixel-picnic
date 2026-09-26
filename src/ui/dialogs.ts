import { h, button } from './dom';
import { lineIcon } from './icons';
import { audio } from '../audio/audio';
import { t } from '../app/i18n';

export interface DialogButton {
  label: string;
  cls?: string;
  onClick: () => void | boolean;
}

export interface DialogOptions {
  title: string;
  head?: 'blue' | 'green' | 'red' | 'purple';
  body?: (HTMLElement | string)[];
  buttons?: DialogButton[];
  row?: boolean;
  closable?: boolean;
  onClose?: () => void;
  scroll?: boolean;
  /** Extra class for the dialog box (e.g. "wide"). */
  cls?: string;
}

export interface DialogHandle {
  el: HTMLElement;
  close(): void;
}

let layer: HTMLElement;
const stack: DialogHandle[] = [];

export function initDialogs(root: HTMLElement): void {
  layer = root;
}

export function dialogOpen(): boolean {
  return stack.length > 0;
}

export function closeAllDialogs(): void {
  while (stack.length) stack[stack.length - 1].close();
}

export function openDialog(opts: DialogOptions): DialogHandle {
  const utility = opts.cls?.split(' ').includes('utility-dialog');
  const previousFocus = document.activeElement as HTMLElement | null;
  const overlay = h('div', { class: 'overlay' });
  const dlg = h('div', { class: 'dialog' + (opts.scroll ? ' scroll' : '') + (opts.cls ? ' ' + opts.cls : ''), attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title } });
  dlg.append(h('div', { class: 'dialog-head ' + (opts.head ?? 'blue'), text: opts.title }));
  let closed = false;
  const handle: DialogHandle = {
    el: dlg,
    close() {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      overlay.classList.add('out');
      if (utility && previousFocus?.isConnected && !previousFocus.closest('.overlay.out')) previousFocus.focus({ preventScroll: true });
      setTimeout(() => overlay.remove(), 180);
    },
  };
  if (opts.closable !== false && opts.onClose) {
    const x = h('button', { class: 'btn close-x', html: lineIcon('close', 22), attrs: { 'aria-label': t('close') } });
    x.addEventListener('click', () => {
      audio.play('button');
      handle.close();
      opts.onClose?.();
    });
    dlg.append(x);
  }
  for (const b of opts.body ?? []) dlg.append(typeof b === 'string' ? h('p', { html: b }) : b);
  if (opts.buttons?.length) {
    const actions = h('div', { class: 'actions' + (opts.row ? ' row' : '') });
    for (const b of opts.buttons) {
      actions.append(
        button(b.label, b.cls ?? '', () => {
          if (b.onClick() !== false) handle.close();
        }),
      );
    }
    dlg.append(actions);
  }
  overlay.append(dlg);
  layer.append(overlay);
  stack.push(handle);
  if (utility) {
    const controls = () => [...dlg.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)')];
    controls()[0]?.focus({ preventScroll: true });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && opts.onClose) {
        e.stopPropagation();
        handle.close();
        opts.onClose();
      } else if (e.key === 'Tab') {
        const items = controls(), first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    });
  }
  audio.play('whoosh', { volume: 0.5 });
  return handle;
}

let toastEl: HTMLElement | null = null;
let toastTimer = 0;

export function toast(root: HTMLElement, text: string, ms = 1800): void {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast' });
  }
  if (toastEl.parentElement !== root) root.append(toastEl);
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), ms);
}
