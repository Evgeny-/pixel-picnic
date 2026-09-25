import { h, button } from './dom';
import { lineIcon } from './icons';
import { audio } from '../audio/audio';

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
  const overlay = h('div', { class: 'overlay' });
  const dlg = h('div', { class: 'dialog' + (opts.scroll ? ' scroll' : '') });
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
      setTimeout(() => overlay.remove(), 180);
    },
  };
  if (opts.closable !== false && opts.onClose) {
    const x = h('button', { class: 'btn close-x', html: lineIcon('close', 22) });
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
