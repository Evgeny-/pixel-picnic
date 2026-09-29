import { makeAssets } from './assets.js';
import { scenes } from './scenes.js';
import { planRoutes } from './routing.js';

await document.fonts.load('900 32px Nunito');
const assets = makeAssets();
const variants = ['cord', 'color', 'gold', 'silver'];
const state = { scenario: 'crowded', theme: 'night', selected: null };
const planned = new Map();
const NEUTRAL = '#e5d9c1';

function routesFor(scene) {
  if (!planned.has(state.scenario)) planned.set(state.scenario, planRoutes(scene.boxes, scene.pairs));
  return planned.get(state.scenario);
}
function visibleColor(box) { return box.hidden || box.text === '?' ? NEUTRAL : box.color; }
function darkText(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114) > 185;
}
function pairLabel(pair, scene) {
  return pair.ids.map((id) => {
    const b = scene.boxes.find((item) => item.id === id);
    return b.hidden ? `${b.text} stack` : `box ${b.text}`;
  }).join(' to ');
}

function defs(prefix, routes, scene) {
  const byId = new Map(scene.boxes.map((b) => [b.id, b]));
  return `<defs>
    <linearGradient id="${prefix}-tray" x2="0" y2="1"><stop stop-color="${state.theme === 'night' ? '#8274b5' : '#ffdda2'}"/><stop offset="1" stop-color="${state.theme === 'night' ? '#65558d' : '#efc981'}"/></linearGradient>
    <linearGradient id="${prefix}-metal" x2="0" y2="1"><stop stop-color="${prefix === 'gold' ? '#fff1bc' : '#ffffff'}"/><stop offset=".46" stop-color="${prefix === 'gold' ? '#eac675' : '#c5d0d8'}"/><stop offset="1" stop-color="${prefix === 'gold' ? '#b88a43' : '#8394a4'}"/></linearGradient>
    <filter id="${prefix}-boxShadow" x="-30%" y="-20%" width="160%" height="160%"><feDropShadow dx="2" dy="5" stdDeviation="4" flood-color="#101920" flood-opacity=".35"/></filter>
    ${routes.map((route, i) => `<linearGradient id="${prefix}-color-${i}" gradientUnits="userSpaceOnUse" x1="${route.start.x}" y1="${route.start.y}" x2="${route.end.x}" y2="${route.end.y}">
      <stop stop-color="${visibleColor(byId.get(route.ids[0]))}"/><stop offset="1" stop-color="${visibleColor(byId.get(route.ids[1]))}"/>
    </linearGradient>
    <mask id="${prefix}-crossings-${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="360" height="466"><rect width="360" height="466" fill="white"/>
      ${routes.slice(i + 1).map((upper) => `<path d="${upper.path}" fill="none" stroke="black" stroke-width="${prefix === 'gold' || prefix === 'silver' ? 11 : 8}" stroke-linecap="round"/>`).join('')}
    </mask>`).join('')}
  </defs>`;
}

function boxGraphic(box, selectedIds, prefix) {
  const { x, y, size, color, text } = box;
  const selected = selectedIds.includes(box.id);
  const imageSize = size * 1.25;
  const ink = darkText(color) ? '#76694d' : '#f9f5ff';
  const stroke = darkText(color) ? '#fff8e5' : '#4c3b56';
  return `<g class="box-hit" data-box="${box.id}" tabindex="0" role="button" aria-label="Box ${text}" aria-pressed="${selected}">
    <rect class="focus-ring" x="${x - size / 2 - 3}" y="${y - size / 2 - 6}" width="${size + 6}" height="${size + 10}" rx="17"/>
    ${selected ? `<rect x="${x - size / 2 - 1}" y="${y - size / 2 - 4}" width="${size + 2}" height="${size + 6}" rx="17" fill="none" stroke="#fff4be" stroke-width="2.2"/>` : ''}
    <image href="${assets.images[`${state.theme}-${color}`]}" x="${x - imageSize / 2}" y="${y - imageSize / 2}" width="${imageSize}" height="${imageSize}" filter="url(#${prefix}-boxShadow)"/>
    <text x="${x}" y="${y - 1}" text-anchor="middle" dominant-baseline="central" font-size="${box.slot ? 26 : 28}" font-weight="1000" fill="${ink}" stroke="${stroke}" stroke-width="2.2" paint-order="stroke">${text}</text>
  </g>`;
}

function hiddenGraphic(box, selectedIds) {
  const selected = selectedIds.includes(box.id), dark = state.theme === 'night';
  return `<g class="box-hit" data-box="${box.id}" role="button" tabindex="0" aria-label="${box.text} hidden stack" aria-pressed="${selected}">
    <rect x="${box.x - 23}" y="${box.y - 14}" width="46" height="28" rx="12" fill="${dark ? '#172d2b' : '#f5e9bd'}" stroke="${selected ? '#fff3bb' : dark ? '#748577' : '#b5a77c'}" stroke-width="${selected ? 2.2 : 1}"/>
    <rect class="focus-ring" x="${box.x - 26}" y="${box.y - 17}" width="52" height="34" rx="15"/>
    <text x="${box.x}" y="${box.y + 1}" text-anchor="middle" dominant-baseline="central" font-size="21" font-weight="900" fill="${dark ? '#fff6df' : '#786541'}">${box.text}</text>
  </g>`;
}

function routesMarkup(routes, variant) {
  return routes.map((route, i) => {
    const selected = state.selected === i;
    const paint = variant === 'color' ? `url(#${variant}-color-${i})` : NEUTRAL;
    const cord = `<path d="${route.path}" fill="none" stroke="#142a2b" stroke-opacity=".8" stroke-width="6.2" stroke-linecap="round"/>
      <path d="${route.path}" fill="none" stroke="${paint}" stroke-width="3.7" stroke-linecap="round"/>
      <path d="${route.path}" fill="none" stroke="#ffffff" stroke-opacity="${variant === 'color' ? .45 : .6}" stroke-width=".85" stroke-linecap="round" transform="translate(0 -.7)"/>`;
    return `<g class="connection" data-link="${i}" data-selected="${selected}" mask="url(#${variant}-crossings-${i})">
      ${selected ? `<path d="${route.path}" fill="none" stroke="#fff5c0" stroke-opacity=".25" stroke-width="11" stroke-linecap="round"/>` : ''}
      ${variant === 'gold' || variant === 'silver' ? `<path class="chain-guide" d="${route.path}" fill="none" stroke="none"/>` : cord}
    </g>`;
  }).join('');
}

function fillChains(svg, variant) {
  if (variant !== 'gold' && variant !== 'silver') return;
  const gold = variant === 'gold';
  for (const guide of svg.querySelectorAll('.chain-guide')) {
    const length = guide.getTotalLength();
    const count = Math.max(1, Math.round(length / (gold ? 7.2 : 9)));
    const links = [];
    for (let i = 0; i <= count; i++) {
      const dist = i / count * length;
      const p = guide.getPointAtLength(dist);
      const a = guide.getPointAtLength(Math.max(0, dist - .5));
      const b = guide.getPointAtLength(Math.min(length, dist + .5));
      const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      const edge = i % 2 === 1;
      const shape = edge
        ? `<path d="M -4.5 0 H 4.5" stroke="${gold ? '#d5ad60' : '#b8c5cf'}" stroke-width="${gold ? 2 : 2.6}" stroke-linecap="round"/>`
        : `<rect x="${gold ? -5 : -6}" y="${gold ? -2.7 : -3.5}" width="${gold ? 10 : 12}" height="${gold ? 5.4 : 7}" rx="${gold ? 2.7 : 2.8}" fill="none" stroke="url(#${variant}-metal)" stroke-width="${gold ? 1.7 : 2.2}"/>
          <path d="M ${gold ? -2.4 : -3.1} ${gold ? -2.5 : -3.1} H ${gold ? 2.4 : 3.1}" stroke="${gold ? '#fff1b9' : '#f4fbff'}" stroke-width=".65" stroke-linecap="round"/>`;
      links.push(`<g transform="translate(${p.x} ${p.y}) rotate(${angle})">
        ${edge ? '' : `<rect x="${gold ? -5 : -6}" y="${gold ? -2 : -2.8}" width="${gold ? 10 : 12}" height="${gold ? 5.4 : 7}" rx="3" fill="none" stroke="#182521" stroke-opacity=".7" stroke-width="${gold ? 3 : 3.5}"/>`}${shape}
      </g>`);
    }
    guide.parentElement.insertAdjacentHTML('beforeend', links.join(''));
  }
}

function renderVariant(variant) {
  const article = document.querySelector(`[data-variant="${variant}"]`), stage = article.querySelector('.stage');
  const scene = scenes[state.scenario], routes = routesFor(scene);
  const selectedIds = state.selected === null ? [] : routes[state.selected].ids;
  const dark = state.theme === 'night';
  stage.className = `stage ${state.theme}`;
  stage.style.backgroundImage = `${dark ? 'linear-gradient(#001c25d9, #001c25d9),' : ''} url("${assets.ground}")`;
  const tray = `<g><rect x="9" y="20" width="342" height="82" rx="22" fill="${dark ? '#473967' : '#c5a771'}"/>
    <rect x="9" y="15" width="342" height="82" rx="22" fill="url(#${variant}-tray)"/>
    ${[48, 136, 224, 312].map((x) => `<rect x="${x - 33}" y="26" width="66" height="62" rx="13" fill="${dark ? '#44395f' : '#e0b778'}"/>`).join('')}</g>`;
  stage.innerHTML = `<svg viewBox="0 0 360 466" xmlns="http://www.w3.org/2000/svg" aria-label="${variant}, ${scene.title}">
    ${defs(variant, routes, scene)}${tray}${routesMarkup(routes, variant)}
    ${scene.boxes.map((b) => b.hidden ? hiddenGraphic(b, selectedIds) : boxGraphic(b, selectedIds, variant)).join('')}
  </svg>`;
  fillChains(stage.querySelector('svg'), variant);
  article.querySelector('.feedback').textContent = state.selected === null ? '' : `Connected: ${pairLabel(routes[state.selected], scene)}.`;
}

function renderAll() {
  document.querySelector('#scene-title').textContent = scenes[state.scenario].title;
  document.querySelector('#scene-note').textContent = scenes[state.scenario].note;
  variants.forEach(renderVariant);
}
document.querySelectorAll('[data-case]').forEach((button) => button.addEventListener('click', () => {
  state.scenario = button.dataset.case; state.selected = null;
  document.querySelectorAll('[data-case]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
  renderAll();
}));
document.querySelectorAll('[data-theme]').forEach((button) => button.addEventListener('click', () => {
  state.theme = button.dataset.theme;
  document.querySelectorAll('[data-theme]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
  renderAll();
}));
document.querySelector('.reset').addEventListener('click', () => { state.selected = null; renderAll(); });
for (const variant of variants) {
  const stage = document.querySelector(`[data-variant="${variant}"] .stage`);
  const select = (target) => {
    const button = target.closest('[data-box]'), id = button?.dataset.box;
    const scene = scenes[state.scenario];
    const matching = scene.pairs.map((pair, i) => pair.includes(id) ? i : -1).filter((i) => i >= 0);
    // Shared counters cycle through their links without adding pair icons.
    const position = matching.indexOf(state.selected);
    state.selected = matching.length ? matching[position + 1] ?? null : null;
    renderAll();
    if (id) stage.querySelector(`[data-box="${id}"]`)?.focus({ preventScroll: true });
  };
  stage.addEventListener('click', (event) => select(event.target));
  stage.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event.target); }
    if (event.key === 'Escape') { state.selected = null; renderAll(); }
  });
}
renderAll();
