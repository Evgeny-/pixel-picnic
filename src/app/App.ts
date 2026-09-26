import * as THREE from 'three';
import { GameView } from '../render/GameView';
import { Game } from '../game/Game';
import { themeForWorld } from '../render/themes';
import { loadFonts } from '../render/textures';
import { audio } from '../audio/audio';
import { h, button } from '../ui/dom';
import { emoji, lineIcon } from '../ui/icons';
import { Hud, boosterIcon, type BoosterView } from '../ui/Hud';
import { MapScreen } from '../ui/MapScreen';
import { AlbumScreen } from '../ui/AlbumScreen';
import { DebugScreen } from '../ui/DebugScreen';
import { openDialog, initDialogs, toast, closeAllDialogs, dialogOpen } from '../ui/dialogs';
import { pictureCanvas } from '../ui/pictureCanvas';
import { t, loc, setLang, getLang, type Lang } from './i18n';
import { loadSave, writeSave, resetSave, type SaveData } from './save';
import { loadCampaign, getLevel, prefetch } from './levels';
import {
  BOOSTERS,
  BOOSTER_GIFT,
  BOOSTER_PRICE,
  BOOSTER_UNLOCK,
  boostersUnlockedAt,
  coinsFor,
  parTime,
  type Reward,
  mechanicsIntroducedAt,
  type BoosterId,
  type MechanicId,
} from '../core/progression';
import type { LevelDef } from '../core/types';
import { BOX_LOOKS, HAT_LOOKS, HOUSE_LOOKS, lookKey, type LookItem } from '../core/looks';
import { lookPreview } from '../render/preview';
import type { EmojiName } from '../ui/emoji.generated';

const MECH_ICON: Record<MechanicId, EmojiName> = {
  hidden: 'red-question-mark',
  fence: 'construction',
  link: 'link',
  frozen: 'snowflake',
  gate: 'door',
};

export class App {
  private save: SaveData = loadSave();
  private levels: LevelDef[] = [];
  private stage = document.getElementById('stage')!;
  private ui = document.getElementById('ui')!;
  private view: GameView | null = null;
  private game: Game | null = null;
  private hud: Hud | null = null;
  private map!: MapScreen;
  private album!: AlbumScreen;
  private debugList!: DebugScreen;
  private autoTimer = 0;
  private raf = 0;
  private last = 0;
  private rescued = false;
  private tutorial = 0;
  private loadingEl: HTMLElement | null = null;

  private darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

  /** Night mode on? ("auto" follows the system's dark theme) */
  private isNight(): boolean {
    const mode = this.save.settings.night ?? 'auto';
    return mode === 'on' || (mode === 'auto' && !!this.darkQuery?.matches);
  }

  private applyNight(): void {
    const on = this.isNight();
    document.documentElement.classList.toggle('night', on);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#171a2b' : '#86c45b');
    this.view?.setNight(on);
  }

  async init(): Promise<void> {
    this.applyNight();
    this.darkQuery?.addEventListener('change', () => this.applyNight());
    if (this.save.settings.lang) setLang(this.save.settings.lang);
    this.loadingEl = h(
      'div',
      { class: 'loading' },
      h('div', { class: 'logo', html: `${emoji('ant', 96)}<h1>${t('title')}</h1><p>${t('loading')}</p>` }),
    );
    document.getElementById('app')!.append(this.loadingEl);
    if (this.save.settings.lang) setLang(this.save.settings.lang);
    else setLang(getLang());
    initDialogs(this.ui);
    await loadFonts();
    this.levels = await loadCampaign();
    audio.setMusicVolume(this.save.settings.music);
    audio.setSfxVolume(this.save.settings.sfx);

    this.map = new MapScreen(this.ui, {
      onPlay: (n) => this.play(n),
      onShop: () => this.openLooksShop('house'),
      onSettings: () => this.openSettings(),
      onAlbum: () => this.openAlbum(),
      onDebug: () => this.openDebugList(),
    });
    this.album = new AlbumScreen(this.ui, () => {
      this.album.hide();
      this.showMap();
    });
    this.debugList = new DebugScreen(
      this.ui,
      () => {
        this.debugList.hide();
        this.showMap();
      },
      (n) => {
        this.debugList.hide();
        void this.play(n);
      },
    );
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('resize', () => this.onResize());
    // Pick up new deployments: check when the tab comes back and every few minutes.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.checkUpdate();
    });
    window.setInterval(() => void this.checkUpdate(), 5 * 60_000);
    window.setTimeout(() => void this.checkUpdate(), 4000);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.game && !dialogOpen()) this.openPause();
    });
    this.stage.addEventListener('pointerdown', (e) => this.onStageTap(e));
    this.stage.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.game || dialogOpen()) return;
      const r = this.stage.getBoundingClientRect();
      const id = this.game.paused ? null : this.game.view.pickBox(e.clientX - r.left, e.clientY - r.top);
      this.stage.style.cursor = id !== null && (this.game.grabMode || this.game.sim.canTake(id)) ? 'pointer' : '';
    });
    this.stage.addEventListener('pointerleave', () => { this.stage.style.cursor = ''; });
    // Dev helpers: ?reset, ?level=N (jump), ?boosters=K, ?coins=K, ?debug=1|0
    const q = new URLSearchParams(location.search);
    if (q.has('reset')) this.save = resetSave();
    if (q.has('debug')) {
      this.save.settings.debug = q.get('debug') !== '0';
      writeSave(this.save);
    }
    const kb = Number(q.get('boosters'));
    if (kb > 0) for (const b of BOOSTERS) this.save.boosters[b] = kb;
    const kc = Number(q.get('coins'));
    if (kc > 0) this.save.coins = kc;
    // ?looks=mushroom,party,basket — try a house, hat and boxes (testing)
    const lk = q.get('looks')?.split(',');
    if (lk?.[0]) this.save.looks.house = lk[0];
    if (lk?.[1]) this.save.looks.hat = lk[1];
    if (lk?.[2]) this.save.looks.box = lk[2];
    const prog = Number(q.get('progress'));
    if (prog > 1) {
      for (let n = 1; n < prog; n++) this.save.stars[n] = this.save.stars[n] ?? (n % 4 === 0 ? 2 : 3);
      this.save.level = Math.max(this.save.level, prog);
      for (const s of ['tutorial', ...BOOSTERS.map((b) => 'booster:' + b)]) if (!this.save.seen.includes(s)) this.save.seen.push(s);
      writeSave(this.save);
    }
    // ?demo — the colony plays the solver's moves by itself (attract mode / screenshots)
    if (q.has('demo')) this.startDemo(Number(q.get('demo')) || 0);
    const jump = Number(q.get('level'));
    if (jump > 0) {
      this.save.level = Math.max(this.save.level, jump);
      for (const s of ['tutorial', ...BOOSTERS.map((b) => 'booster:' + b)]) if (!this.save.seen.includes(s)) this.save.seen.push(s);
      writeSave(this.save);
      void this.play(jump);
    } else this.showMap();
    const ld = this.loadingEl;
    setTimeout(() => {
      ld?.classList.add('out');
      setTimeout(() => ld?.remove(), 450);
    }, 150);
  }

  private startDemo(maxMoves: number): void {
    let played = 0;
    let level = -1;
    // Headless browsers may starve requestAnimationFrame: keep the demo moving with a timer.
    setInterval(() => {
      if (this.game && performance.now() - this.last > 120) {
        this.last = performance.now();
        this.game.update(0.05, this.last / 1000);
      }
    }, 50);
    setInterval(() => {
      const g = this.game;
      if (!g || dialogOpen() || g.status !== 'playing') return;
      if (g.level.n !== level) {
        level = g.level.n;
        played = 0;
      }
      if (maxMoves && played >= maxMoves) return;
      const next = g.level.solution?.[played];
      if (next !== undefined && g.sim.isQuiet() && g.takeBox(next)) played++;
    }, 250);
  }

  // ------------------------------------------------------------------ screens

  private mapData() {
    return {
      unlocked: this.save.level,
      stars: this.save.stars,
      coins: this.save.coins,
      total: this.levels.length,
      picture: (n: number) => this.levels[n - 1]?.picture ?? null,
      debug: this.save.settings.debug,
      stats: (n: number) => this.levels[n - 1]?.stats,
    };
  }

  private openDebugList(): void {
    this.map.hide();
    this.debugList.show(this.levels, this.save.stars);
  }

  private updateReady = false;

  /** A newer build is deployed: reload right away on the map, or as soon as the level is left. */
  private async checkUpdate(): Promise<void> {
    if (import.meta.env.DEV || this.updateReady) return;
    try {
      const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { id } = (await res.json()) as { id?: string };
      if (!id || id === __BUILD_ID__) return;
      this.updateReady = true;
      if (!this.game) this.reloadForUpdate();
    } catch {
      // offline: try again later
    }
  }

  private reloadForUpdate(): void {
    toast(this.ui, t('newVersion'), 2000);
    window.setTimeout(() => location.reload(), 700);
  }

  private showMap(): void {
    if (this.updateReady) return this.reloadForUpdate();
    this.stopLoop();
    this.stopAuto();
    this.game?.dispose();
    this.game = null;
    this.hud?.destroy();
    this.hud = null;
    this.stage.style.visibility = 'hidden';
    this.map.show(this.mapData());
    audio.startMusic(themeForWorld(Math.floor((this.save.level - 1) / 20)).music);
  }

  private openAlbum(): void {
    this.map.hide();
    this.album.show(this.levels, this.save.stars);
  }

  // ------------------------------------------------------------------ game

  private ensureView(): GameView {
    if (!this.view) {
      this.view = new GameView(this.stage, {
        onPick: () => this.game?.onPick(),
        onDeliver: () => this.game?.onDeliver(),
      });
      this.view.setNight(this.isNight());
      this.view.resize(window.innerWidth, window.innerHeight);
    }
    return this.view;
  }

  async play(n: number): Promise<void> {
    closeAllDialogs();
    const level = await getLevel(n);
    // Boosters that unlock at this level come with a small gift.
    const newBoosters = boostersUnlockedAt(n).filter((b) => !this.save.seen.includes('booster:' + b));
    const newMechs = mechanicsIntroducedAt(n).filter((m) => !this.save.seen.includes('mech:' + m));
    this.startLevel(level);
    for (const m of newMechs) this.introMechanic(m);
    for (const b of newBoosters) this.introBooster(b);
    prefetch(n + 1);
  }

  private startLevel(level: LevelDef): void {
    this.map.hide();
    this.album.hide();
    this.game?.dispose();
    this.hud?.destroy();
    const view = this.ensureView();
    view.looks = { house: this.save.looks.house, hat: this.save.looks.hat, box: this.save.looks.box };
    this.stage.style.visibility = 'visible';
    const theme = themeForWorld(level.world);
    this.hud = new Hud(this.ui, {
      onPause: () => this.openPause(),
      onHome: () => this.confirmLeave(),
      onSpeed: () => this.cycleSpeed(),
      onBooster: (b) => this.onBooster(b),
    });
    this.hud.setLevel(level.n, level.tier);
    this.hud.setProgress(0, 1);
    this.stopAuto();
    if (this.save.settings.debug) {
      const st = level.stats;
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      this.hud.setDebug(
        st
          ? `random ${st.random === undefined ? '?' : pct(st.random)} · casual ${pct(st.casual)} · greedy ${pct(st.greedy)} · planner ${st.planner === undefined ? '?' : pct(st.planner)} · 🧠${st.critical ?? '?'}/${st.decisions ?? '?'} · ${level.boxes.length} boxes`
          : `${level.boxes.length} boxes · ${level.picture.palette.length} col`,
      );
    }
    const ins = this.hud.insets();
    view.insets = { top: ins.top, bottom: ins.bottom, left: 0, right: 0 };
    // The HUD can grow after the font loads or the debug line wraps: keep the picture clear of it.
    this.hud.observe(() => this.onResize());
    this.rescued = false;
    if (import.meta.env.DEV) Object.assign(window, { app: this, audio });
    this.game = new Game(view, level, theme, {
      onWin: (g) => this.onWin(g),
      onStuck: () => this.onStuck(),
      onProgress: (e, tot) => this.hud?.setProgress(e, tot),
      onToast: (k) => this.toast(k),
      onChange: () => this.refreshBoosters(),
    });
    this.game.speed = this.save.settings.speed;
    this.hud.setSpeed(this.game.speed);
    this.refreshBoosters();
    audio.startMusic(theme.music);
    if (level.tier !== 'normal') {
      setTimeout(() => {
        this.hud?.banner(t(level.tier === 'superhard' ? 'superhardLevel' : 'hardLevel'), level.tier);
        audio.play('unlock', { volume: 0.6 });
      }, 350);
    }
    this.tutorial = level.n === 1 && !this.save.seen.includes('tutorial') ? 1 : 0;
    if (this.tutorial) setTimeout(() => this.showTutorialStep(), 600);
    this.startLoop();
  }

  private startLoop(): void {
    this.stopLoop();
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.game?.update(dt, now / 1000);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private onResize(): void {
    if (this.view) {
      this.view.resize(window.innerWidth, window.innerHeight);
      if (this.hud && this.game) {
        const ins = this.hud.insets();
        this.view.insets = { top: ins.top, bottom: ins.bottom, left: 0, right: 0 };
        this.view.relayout(false);
      }
    }
    if (this.map.visible) this.map.render();
  }

  private onStageTap(e: PointerEvent): void {
    if (!this.game || dialogOpen()) return;
    const r = this.stage.getBoundingClientRect();
    const before = this.game.taps;
    this.game.tap(e.clientX - r.left, e.clientY - r.top);
    if (this.game.taps !== before && this.tutorial) {
      this.tutorial++;
      this.showTutorialStep();
    }
  }

  private cycleSpeed(): void {
    if (!this.game) return;
    const s = this.game.speed >= 3 ? 1 : this.game.speed + 1;
    this.game.speed = s;
    this.save.settings.speed = s;
    writeSave(this.save);
    this.hud?.setSpeed(s);
  }

  private toast(k: 'blocked' | 'frozen' | 'slots' | 'link' | 'nohint' | 'grab'): void {
    const map = {
      blocked: 'toastBlocked',
      frozen: 'toastFrozen',
      slots: 'toastSlots',
      link: 'toastLink',
      nohint: 'toastNoHint',
      grab: 'toastGrab',
    } as const;
    let key: Parameters<typeof t>[0] = map[k];
    if (k === 'slots' && this.game && this.game.sim.freeSlots() === 1) key = 'toastLinkSlots';
    toast(this.ui, t(key), k === 'nohint' ? 3000 : 1800);
  }

  private showTutorialStep(): void {
    const g = this.game;
    const hud = this.hud;
    if (!g || !hud) return;
    const y = Math.max(90, hud.insets().top + 4);
    if (this.tutorial === 1) {
      // Point at the solver's first move: even level 1 has a box that would be a mistake.
      const probe = g.sim.clone();
      const moves = probe.legalMoves();
      const exposed = probe.exposedCounts();
      const planned = g.level.solution?.[0];
      const best =
        planned !== undefined && probe.canTake(planned) ? planned : (moves.find((m) => exposed[probe.boxColor(m)] > 0) ?? moves[0]);
      const p = g.view.toScreen(g.view.queue.boxTop(best, new THREE.Vector3()));
      hud.showTutorial(t('tutorial1'), y, p);
    } else if (this.tutorial === 2) {
      hud.showTutorial(t('tutorial2'), y);
      setTimeout(() => this.tutorial === 2 && hud.hideTutorial(), 5000);
    } else if (this.tutorial === 3) {
      hud.showTutorial(t('tutorial3'), y);
      setTimeout(() => this.tutorial === 3 && hud.hideTutorial(), 5000);
    } else {
      hud.hideTutorial();
      this.tutorial = 0;
      this.markSeen('tutorial');
    }
  }

  private markSeen(key: string): void {
    if (!this.save.seen.includes(key)) {
      this.save.seen.push(key);
      writeSave(this.save);
    }
  }

  // ------------------------------------------------------------------ boosters

  private boosterState(): Record<BoosterId, BoosterView> {
    const g = this.game;
    const n = g?.level.n ?? 1;
    const out = {} as Record<BoosterId, BoosterView>;
    for (const b of BOOSTERS) {
      out[b] = {
        count: this.save.boosters[b],
        locked: n < BOOSTER_UNLOCK[b],
        unlockAt: BOOSTER_UNLOCK[b],
        active: b === 'grab' && !!g?.grabMode,
        usable: !!g && g.canUse(b),
      };
    }
    return out;
  }

  private refreshBoosters(): void {
    this.hud?.setBoosters(this.boosterState());
  }

  private onBooster(b: BoosterId): void {
    const g = this.game;
    if (!g) return;
    if (g.level.n < BOOSTER_UNLOCK[b]) {
      audio.play('invalid');
      toast(this.ui, t('locked', { n: BOOSTER_UNLOCK[b] }));
      return;
    }
    if (b === 'grab' && g.grabMode) {
      g.cancelGrab();
      this.save.boosters.grab++;
      writeSave(this.save);
      this.refreshBoosters();
      return;
    }
    if (this.save.boosters[b] <= 0) {
      this.openShop(b);
      return;
    }
    if (!g.canUse(b)) {
      audio.play('invalid');
      if (b === 'grab') toast(this.ui, t('toastSlots'));
      return;
    }
    this.spendBooster(b);
  }

  /** Uses one booster from the inventory. Returns true if it had an effect. */
  private spendBooster(b: BoosterId, fromStuck = false): boolean {
    const g = this.game;
    if (!g) return false;
    const ok = g.use(b);
    if (ok) {
      this.save.boosters[b]--;
      if (fromStuck) this.rescued = true;
      writeSave(this.save);
    }
    this.refreshBoosters();
    return ok;
  }

  /** Keep the shop open while its tabs, balance and item states change. */
  private openLooksShop(tab: LookItem['kind'] | 'booster'): void {
    const coins = h('p', { class: 'shop-coins', attrs: { 'aria-live': 'polite' } });
    const tabs = h('div', { class: 'seg shop-tabs', attrs: { role: 'tablist', 'aria-label': t('shop') } });
    const grid = h('div', { class: 'shop-grid', attrs: { id: 'shop-items', role: 'tabpanel' } });
    const tabDefs: [typeof tab, string][] = [
      ['house', t('shopHouses')], ['hat', t('shopAnts')], ['box', t('shopBoxes')], ['booster', t('shopBoosters')],
    ];
    const tabButtons = new Map<typeof tab, HTMLButtonElement>();
    const scrollTop = new Map<typeof tab, number>();
    let updates: (() => void)[] = [];
    const refresh = () => {
      coins.innerHTML = `${emoji('coin', 26)} ${this.save.coins}`;
      for (const update of updates) update();
    };
    const savePurchase = () => {
      writeSave(this.save);
      refresh();
      this.map.refreshTop(this.save.coins);
    };
    const renderItems = () => {
      grid.replaceChildren();
      updates = [];
      for (const [id, b] of tabButtons) {
        b.classList.toggle('on', id === tab);
        b.setAttribute('aria-selected', String(id === tab));
        b.tabIndex = id === tab ? 0 : -1;
      }
      grid.setAttribute('aria-labelledby', `shop-tab-${tab}`);
      if (tab === 'booster') {
        for (const b of BOOSTERS) {
          const price = h('span', { class: 'price' });
          const card = h('button', { class: 'look-card' },
            h('span', { class: 'look-pic booster-pic', html: boosterArt(b) }),
            h('span', { class: 'nm', text: t(`booster_${b}`) }), price,
          );
          updates.push(() => { price.innerHTML = `×${this.save.boosters[b]} · ${emoji('coin', 18)} ${BOOSTER_PRICE[b]}`; });
          card.addEventListener('click', () => {
            if (this.save.coins < BOOSTER_PRICE[b]) {
              audio.play('invalid');
              toast(this.ui, t('notEnough'));
              return;
            }
            this.save.coins -= BOOSTER_PRICE[b];
            this.save.boosters[b]++;
            audio.play('coin');
            savePurchase();
          });
          grid.append(card);
        }
      } else {
        const items = tab === 'house' ? HOUSE_LOOKS : tab === 'hat' ? HAT_LOOKS : BOX_LOOKS;
        const looks = this.save.looks;
        for (const item of items) {
          const owned = () => item.price === 0 || looks.owned.includes(lookKey(item));
          const price = h('span', { class: 'price' });
          const card = h('button', { class: 'look-card' },
            h('img', { class: 'look-pic', attrs: { src: lookPreview(item.kind, item.id), alt: '' } }),
            h('span', { class: 'nm', text: loc(item.name) }), price,
          );
          updates.push(() => {
            const worn = looks[item.kind] === item.id;
            card.classList.toggle('worn', worn);
            card.classList.toggle('owned', !worn && owned());
            card.setAttribute('aria-pressed', String(worn));
            price.innerHTML = worn ? `${lineIcon('check', 16)} ${t('worn')}`
              : owned() ? t('wear') : `${emoji('coin', 18)} ${item.price}`;
          });
          card.addEventListener('click', () => {
            if (looks[item.kind] === item.id) return;
            if (!owned()) {
              if (this.save.coins < item.price) {
                audio.play('invalid');
                toast(this.ui, t('notEnough'));
                return;
              }
              this.save.coins -= item.price;
              looks.owned.push(lookKey(item));
              audio.play('unlock');
              toast(this.ui, t('bought'));
            } else audio.play('button');
            looks[item.kind] = item.id;
            savePurchase();
          });
          grid.append(card);
        }
      }
      refresh();
      grid.scrollTop = scrollTop.get(tab) ?? 0;
    };
    for (const [id, label] of tabDefs) {
      const b = h('button', { text: label, attrs: { id: `shop-tab-${id}`, role: 'tab', 'aria-controls': 'shop-items' } });
      b.addEventListener('click', () => {
        if (tab === id) return;
        scrollTop.set(tab, grid.scrollTop);
        tab = id;
        audio.play('button');
        renderItems();
      });
      b.addEventListener('keydown', (e) => {
        const index = tabDefs.findIndex(([key]) => key === id);
        const next = e.key === 'ArrowRight' ? (index + 1) % tabDefs.length
          : e.key === 'ArrowLeft' ? (index + tabDefs.length - 1) % tabDefs.length
            : e.key === 'Home' ? 0 : e.key === 'End' ? tabDefs.length - 1 : -1;
        if (next < 0) return;
        e.preventDefault();
        const button = tabButtons.get(tabDefs[next][0])!;
        button.focus();
        button.click();
      });
      tabButtons.set(id, b);
      tabs.append(b);
    }
    openDialog({ title: t('shop'), head: 'purple', body: [coins, tabs, grid], onClose: () => undefined, cls: 'wide shop-dialog' });
    renderItems();
  }

  private openShop(b: BoosterId, fromStuck = false): void {
    const price = BOOSTER_PRICE[b];
    const g = this.game;
    if (g) g.paused = true;
    const art = h('div', { class: 'mech-art', html: boosterArt(b) });
    openDialog({
      title: t(`booster_${b}`),
      head: 'purple',
      body: [art, t(`boosterDesc_${b}`), h('p', { class: 'subtle', html: `${emoji('coin', 20)} ${this.save.coins}` })],
      buttons: [
        {
          label: `${t('buy')} <span class="price">${emoji('coin', 26)} ${price}</span>`,
          cls: 'green',
          onClick: () => {
            if (this.save.coins < price) {
              audio.play('invalid');
              toast(this.ui, t('notEnough'));
              return false;
            }
            this.save.coins -= price;
            this.save.boosters[b]++;
            writeSave(this.save);
            audio.play('coin');
            if (g) g.paused = false;
            this.spendBooster(b, fromStuck);
            return true;
          },
        },
      ],
      onClose: () => {
        if (g) g.paused = false;
        if (fromStuck && g?.status === 'stuck') this.onStuck();
      },
    });
  }

  // ------------------------------------------------------------------ results

  private onWin(g: Game): void {
    const n = g.level.n;
    const stars = g.stars(this.rescued);
    const prevStars = this.save.stars[n] ?? 0;
    const fast = g.playTime <= parTime(g.level);
    const reward = coinsFor(g.level.tier, stars, fast, prevStars);
    const firstTime = prevStars === 0;
    this.save.stars[n] = Math.max(prevStars, stars);
    this.save.coins += reward.total;
    if (n >= this.save.level) this.save.level = n + 1;
    writeSave(this.save);
    const dur = g.celebrate();
    audio.duck(0.25, 2.5);
    audio.play('win');
    if (this.tutorial) {
      this.hud?.hideTutorial();
      this.tutorial = 0;
      this.markSeen('tutorial');
    }
    const time = g.playTime;
    setTimeout(() => this.showWinDialog(g.level, stars, reward, time, firstTime), Math.max(900, dur * 1000 + 200));
  }

  private showWinDialog(level: LevelDef, stars: number, reward: Reward, time: number, firstTime: boolean): void {
    const pic = pictureCanvas(level.picture, 130, { rounded: true, bg: '#fffaf0' });
    pic.classList.add('pic-thumb');
    const starsEl = h('div', { class: 'stars', html: [1, 2, 3].map(() => emoji('star', 64, 'star')).join('') });
    const name = loc(level.name);
    const clock = `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
    // What the coins were for: the level itself, the stars, and finishing quickly.
    const line = (label: string, v: number) =>
      h('div', { class: 'reward-line' + (v ? '' : ' off'), html: `<span>${label}</span><b>+${v}</b>` });
    const lines = h(
      'div',
      { class: 'reward' },
      line(firstTime ? t(level.tier === 'normal' ? 'rewardLevel' : level.tier === 'hard' ? 'rewardHard' : 'rewardSuperhard') : t('rewardReplay'), reward.base),
      line(t('rewardStars'), reward.stars),
      line(`${t('rewardFast')} · ${clock}`, reward.speed),
    );
    const coinEl = h('div', { class: 'coins-gain', html: `${emoji('coin', 30)} +${reward.total}` });
    const body: (HTMLElement | string)[] = [starsEl, pic];
    if (name) body.push(h('p', { html: `<b>${name}</b>`, style: 'margin:0 0 6px' }));
    body.push(lines, coinEl);
    if (firstTime) body.push(h('p', { class: 'subtle', text: t('addedAlbum') }));
    openDialog({
      title: t(stars === 3 ? 'win3' : stars === 2 ? 'win2' : 'win1'),
      head: 'green',
      body,
      buttons: [
        { label: `${t('next')} ${lineIcon('play', 22)}`, cls: 'green big', onClick: () => void this.play(level.n + 1) },
        { label: `${lineIcon('map', 22)} ${t('map')}`, cls: 'white small', onClick: () => this.showMap() },
      ],
    });
    const starEls = starsEl.querySelectorAll('.star');
    starEls.forEach((el, i) => {
      if (i < stars)
        setTimeout(() => {
          el.classList.add('on');
          audio.play('star', { pitch: i });
        }, 350 + i * 330);
    });
    setTimeout(() => audio.play('coin'), 350 + stars * 330 + 150);
  }

  private onStuck(): void {
    const g = this.game;
    if (!g) return;
    audio.play('lose');
    const buttons = [];
    const n = g.level.n;
    const offer = (b: BoosterId) => {
      if (n < BOOSTER_UNLOCK[b]) return;
      const have = this.save.boosters[b];
      buttons.push({
        label: `${t(`booster_${b}`)} ${have > 0 ? `<span class="price">×${have}</span>` : `<span class="price">${emoji('coin', 24)} ${BOOSTER_PRICE[b]}</span>`}`,
        cls: b === 'slot' ? 'green' : 'blue',
        onClick: () => {
          if (have > 0) this.spendBooster(b, true);
          else setTimeout(() => this.openShop(b, true), 200);
        },
      });
    };
    offer('slot');
    offer('undo');
    offer('shuffle');
    buttons.push({ label: `${lineIcon('restart', 22)} ${t('retry')}`, cls: 'white', onClick: () => void this.restart() });
    openDialog({ title: t('stuckTitle'), head: 'red', body: [t('stuckText')], buttons });
  }

  private async restart(): Promise<void> {
    if (!this.game) return;
    const lv = this.game.level;
    this.startLevel(lv);
  }

  // ------------------------------------------------------------------ dialogs

  private openPause(): void {
    const g = this.game;
    if (!g) return;
    g.paused = true;
    const buttons = [
      { label: `${lineIcon('play', 22)} ${t('resume')}`, cls: 'green', onClick: () => void (g.paused = false) },
      { label: `${lineIcon('restart', 22)} ${t('restart')}`, cls: 'blue', onClick: () => void this.restart() },
      { label: `${lineIcon('home', 22)} ${t('toMap')}`, cls: 'white', onClick: () => this.showMap() },
    ];
    if (this.save.settings.debug) {
      buttons.push(
        {
          label: `${emoji('lady-beetle', 24)} ${t('autoSolve')}`,
          cls: 'purple small',
          onClick: () => {
            g.paused = false;
            this.startAuto();
          },
        },
        { label: `${lineIcon('ff', 20)} ${t('skipLevel')}`, cls: 'purple small', onClick: () => this.skipLevel() },
      );
    }
    openDialog({
      title: t('paused'),
      head: 'purple',
      body: [this.volumeRow('music'), this.volumeRow('sfx')],
      buttons,
      onClose: () => void (g.paused = false),
    });
  }

  /** Home button: back to the map, asking first if the level is under way. */
  private confirmLeave(): void {
    const g = this.game;
    if (!g) return this.showMap();
    if (g.taps === 0) return this.showMap();
    g.paused = true;
    openDialog({
      title: t('toMap'),
      head: 'purple',
      body: [h('p', { text: t('leaveLevel') })],
      buttons: [
        { label: `${lineIcon('home', 22)} ${t('leave')}`, cls: 'blue', onClick: () => this.showMap() },
        { label: `${lineIcon('play', 22)} ${t('stay')}`, cls: 'green', onClick: () => void (g.paused = false) },
      ],
      onClose: () => void (g.paused = false),
    });
  }

  /** Debug: let the solver play the current level. */
  private startAuto(): void {
    this.stopAuto();
    const g = this.game;
    if (!g) return;
    g.speed = 3;
    this.hud?.setSpeed(3);
    this.autoTimer = window.setInterval(() => {
      if (this.game !== g) return this.stopAuto();
      if (dialogOpen()) return;
      const r = g.autoStep();
      if (r === 'stuck') {
        this.stopAuto();
        toast(this.ui, t('noSolution'), 2500);
      } else if (r === 'done') this.stopAuto();
    }, 200);
  }

  private stopAuto(): void {
    clearInterval(this.autoTimer);
    this.autoTimer = 0;
  }

  /** Debug: mark the level as passed and go on. */
  private skipLevel(): void {
    const g = this.game;
    if (!g) return;
    const n = g.level.n;
    this.save.stars[n] = Math.max(this.save.stars[n] ?? 0, 1);
    if (n >= this.save.level) this.save.level = n + 1;
    writeSave(this.save);
    void this.play(n + 1);
  }

  private volumeRow(kind: 'music' | 'sfx'): HTMLElement {
    const name = t(kind === 'music' ? 'music' : 'sounds');
    const input = h('input', { attrs: { id: `volume-${kind}`, type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': name } });
    input.value = String(this.save.settings[kind]);
    const value = h('output', { class: 'volume-value', attrs: { for: input.id } });
    const refresh = () => {
      const percent = `${Math.round(Number(input.value) * 100)}%`;
      value.textContent = percent;
      input.style.setProperty('--volume', percent);
      input.setAttribute('aria-valuetext', percent);
    };
    refresh();
    input.addEventListener('input', () => {
      const v = Number(input.value);
      this.save.settings[kind] = v;
      if (kind === 'music') audio.setMusicVolume(v);
      else audio.setSfxVolume(v);
      refresh();
      writeSave(this.save);
    });
    input.addEventListener('change', () => kind === 'sfx' && audio.play('tap'));
    return h(
      'div',
      { class: 'setting-row volume-setting' },
      h('label', { class: 'setting-name', attrs: { for: input.id } },
        h('span', { class: `setting-icon ${kind}`, html: lineIcon(kind === 'music' ? 'music' : 'sound', 20) }), name),
      h('div', { class: 'volume-control' }, input, value),
    );
  }

  private openSettings(): void {
    const seg = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': t('language') } });
    (['ru', 'en'] as Lang[]).forEach((l) => {
      const b = h('button', { class: getLang() === l ? 'on' : '', text: l === 'ru' ? 'Русский' : 'English', attrs: { 'aria-pressed': String(getLang() === l) } });
      b.addEventListener('click', () => {
        audio.play('button');
        this.save.settings.lang = l;
        writeSave(this.save);
        setLang(l);
        closeAllDialogs();
        this.map.render();
        this.openSettings();
      });
      seg.append(b);
    });
    const langRow = h('div', { class: 'setting-row' }, h('span', { text: t('language') }), seg);
    const select = (group: HTMLElement, selected: HTMLButtonElement) => {
      for (const b of group.querySelectorAll('button')) {
        b.classList.toggle('on', b === selected);
        b.setAttribute('aria-pressed', String(b === selected));
      }
    };
    const dbgSeg = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': t('debug') } });
    ([true, false] as const).forEach((v) => {
      const b = h('button', { class: this.save.settings.debug === v ? 'on' : '', text: t(v ? 'on' : 'off'), attrs: { 'aria-pressed': String(this.save.settings.debug === v) } });
      b.addEventListener('click', () => {
        audio.play('button');
        this.save.settings.debug = v;
        writeSave(this.save);
        select(dbgSeg, b);
        this.map.show(this.mapData());
      });
      dbgSeg.append(b);
    });
    const debugRow = h(
      'div',
      { class: 'setting-row debug-setting' },
      h('span', { class: 'setting-name' }, h('span', { html: emoji('lady-beetle', 24) }), t('debug')),
      dbgSeg,
      h('small', { class: 'setting-hint', text: t('debugHint') }),
    );
    const nightSeg = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': t('nightMode') } });
    (['auto', 'on', 'off'] as const).forEach((v) => {
      const b = h('button', { class: (this.save.settings.night ?? 'auto') === v ? 'on' : '', text: t(v === 'auto' ? 'auto' : v), attrs: { 'aria-pressed': String((this.save.settings.night ?? 'auto') === v) } });
      b.addEventListener('click', () => {
        audio.play('button');
        this.save.settings.night = v;
        writeSave(this.save);
        this.applyNight();
        select(nightSeg, b);
      });
      nightSeg.append(b);
    });
    const nightRow = h('div', { class: 'setting-row' }, h('span', { class: 'setting-name' }, h('span', { html: emoji('crescent-moon', 24) }), t('nightMode')), nightSeg);
    const credits = button(t('credits'), 'white small settings-link', () => this.openCredits());
    credits.append(h('span', { class: 'forward-icon', html: lineIcon('back', 18) }));
    const reset = button(t('resetProgress'), 'red small settings-reset', () => {
      openDialog({
        title: t('resetProgress'),
        head: 'red',
        body: [t('resetConfirm')],
        row: true,
        buttons: [
          {
            label: lineIcon('check', 24),
            cls: 'red',
            onClick: () => {
              this.save = resetSave();
              writeSave(this.save);
              closeAllDialogs();
              this.showMap();
            },
          },
          { label: lineIcon('close', 24), cls: 'white', onClick: () => undefined },
        ],
      });
    });
    openDialog({
      title: t('settings'),
      head: 'purple',
      cls: 'utility-dialog settings-dialog',
      body: [h('div', { class: 'utility-content' },
        h('div', { class: 'settings-section' }, this.volumeRow('music'), this.volumeRow('sfx')),
        h('div', { class: 'settings-section' }, langRow, nightRow),
        h('div', { class: 'settings-section' }, debugRow),
        h('div', { class: 'settings-footer' }, credits, reset))],
      onClose: () => undefined,
    });
  }

  private openCredits(): void {
    const link = (text: string, href: string) => h('a', { text, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
    const entry = (name: string, url: string, license: string, licenseUrl: string, note?: string) =>
      h('li', {}, h('div', { class: 'credit-line' }, link(name, url), link(license, licenseUrl)), note && h('small', { text: note }));
    const pictures = h('section', { class: 'credit-section' }, h('h3', { text: t('creditPictures') }),
      h('ul', { class: 'credit-list' },
        entry('Microsoft Fluent Emoji', 'https://github.com/microsoft/fluentui-emoji', 'MIT', 'https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE'),
        entry('Twemoji', 'https://github.com/jdecked/twemoji', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', t('creditTwemoji')),
        entry('Google Noto Emoji', 'https://github.com/googlefonts/noto-emoji', 'Apache 2.0', 'https://github.com/googlefonts/noto-emoji/blob/main/LICENSE', '© Google Inc.')));
    const tools = h('section', { class: 'credit-section' }, h('h3', { text: t('creditTools') }),
      h('ul', { class: 'credit-list' },
        entry('Nunito', 'https://fonts.google.com/specimen/Nunito', 'SIL OFL 1.1', 'https://openfontlicense.org/'),
        entry('three.js', 'https://threejs.org/', 'MIT', 'https://github.com/mrdoob/three.js/blob/dev/LICENSE')));
    openDialog({
      title: t('credits'),
      head: 'blue',
      cls: 'utility-dialog credits-dialog',
      body: [h('div', { class: 'utility-content' }, pictures, tools,
        h('section', { class: 'credit-section' }, h('h3', { text: t('creditAudio') }), h('p', { text: t('creditAudioNote') })))],
      onClose: () => undefined,
      buttons: [{ label: t('close'), cls: 'white small utility-done', onClick: () => undefined }],
    });
  }

  private introMechanic(m: MechanicId): void {
    const g = this.game;
    if (g) g.paused = true;
    openDialog({
      title: t('newMechanic'),
      head: 'green',
      body: [
        h('div', { class: 'mech-art', html: emoji(MECH_ICON[m], 84) }),
        h('p', { html: `<b style="font-size:21px">${t(`mech_${m}_t`)}</b>` }),
        t(`mech_${m}_d`),
      ],
      buttons: [
        {
          label: t('gotIt'),
          cls: 'green',
          onClick: () => {
            this.markSeen('mech:' + m);
            if (g) g.paused = false;
          },
        },
      ],
    });
    audio.play('unlock');
  }

  private introBooster(b: BoosterId): void {
    const g = this.game;
    if (g) g.paused = true;
    this.save.boosters[b] += BOOSTER_GIFT;
    this.markSeen('booster:' + b);
    writeSave(this.save);
    this.refreshBoosters();
    openDialog({
      title: t('boosterUnlocked'),
      head: 'purple',
      body: [
        h('div', { class: 'mech-art', html: boosterArt(b) }),
        h('p', { html: `<b style="font-size:21px">${t(`booster_${b}`)}</b> · ${t('free', { n: BOOSTER_GIFT })}` }),
        t(`boosterDesc_${b}`),
      ],
      buttons: [{ label: t('gotIt'), cls: 'green', onClick: () => void (g && (g.paused = false)) }],
    });
    audio.play('unlock');
  }
}

function boosterArt(b: BoosterId): string {
  return boosterIcon(b, 84);
}
