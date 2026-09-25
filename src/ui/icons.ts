import { EMOJI, type EmojiName } from './emoji.generated';

/** Chunky line icons drawn with currentColor (for white glyphs on colored buttons). */
const LINE: Record<string, string> = {
  pause: '<path d="M9 6v12M15 6v12"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  ff: '<path d="M4 6.5v11l7.5-5.5zM12.5 6.5v11l7.5-5.5z" fill="currentColor"/>',
  undo: '<path d="M9 13.5L4 8.5l5-5"/><path d="M4.5 8.5H14a5.5 5.5 0 010 11h-3.5"/>',
  shuffle: '<path d="M3.5 7h3.2c2.2 0 3.4 1 4.6 3l1.4 2.4c1.2 2 2.4 3 4.6 3h3.2"/><path d="M3.5 16.4h3.2c1.4 0 2.4-.4 3.2-1.2M13.7 8.2c.8-.8 1.8-1.2 3.2-1.2h3.6"/><path d="M18 4.5l2.5 2.5L18 9.5M18 13l2.5 2.5L18 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  restart: '<path d="M19 12a7 7 0 11-2.05-4.95"/><path d="M19.5 4.5v4h-4"/>',
  map: '<path d="M3.5 6.5l5-2 7 2.5 5-2v13l-5 2-7-2.5-5 2z"/><path d="M8.5 4.5v13M15.5 7v13"/>',
  home: '<path d="M4 11.5L12 4.5l8 7"/><path d="M6.5 10v9.5h11V10"/><path d="M10 19.5v-5h4v5"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  slot: '<rect x="4" y="7" width="12" height="12" rx="3"/><path d="M19.5 3.5v6M16.5 6.5h6"/>',
};

export function lineIcon(name: keyof typeof LINE | string, size = 24): string {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LINE[name] ?? ''}</svg>`;
}

export function emoji(name: EmojiName, size = 28, cls = ''): string {
  return EMOJI[name].replace('<svg ', `<svg class="emo ${cls}" width="${size}" height="${size}" aria-hidden="true" `);
}
