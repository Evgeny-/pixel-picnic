import { audio } from '../audio/audio';

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; html?: string; text?: string; style?: string; on?: Record<string, (e: Event) => void>; attrs?: Record<string, string> } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.style) el.setAttribute('style', props.style);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.on) for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** A chunky button with a click sound. */
export function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { class: 'btn ' + cls, html: label });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    audio.unlock();
    audio.play('button');
    onClick();
  });
  return b;
}
