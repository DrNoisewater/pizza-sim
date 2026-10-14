// App controller: owns the game state, runs the loop, routes input to core actions,
// and keeps the HUD, panels and 3D view in sync.
import { World } from '../render/world';
import { createGame, loc, activeStaff, stockOf, up, SAVE_VERSION, seatsTotal } from '../core/state';
import { advance, ovenSlots, itemsInStage } from '../core/sim';
import { openForBusiness, beginNextDay, resolveChoice } from '../core/day';
import * as A from '../core/actions';
import { outbox, money, clock, plural } from '../core/util';
import { suggestOrder, estimateDailyNeed, neededIngredients } from '../core/inventory';
import { ingredientPrice } from '../core/economy';
import { resetDressingTextures } from '../render/dressing';
import { xpForLevel } from '../core/progression';
import { ING, ITEM, type IngId, type ItemId, type SupplierId } from '../data/catalog';
import { UPG, type UpgradeId } from '../data/upgrades';
import { DAY_NAMES, LOC, WEATHER, type CampaignId, type LocationId } from '../data/world';
import type { GameState, Store, Difficulty } from '../core/types';
import { saves, native, loadSettings, storeSettings, type Settings, type SaveMeta } from '../platform/storage';
import { audio } from '../platform/audio';
import { $, esc, icon, stars } from './dom';
import { TABS, renderPanel, panelTitle, type TabId, type PanelCtx } from './panels';
import * as S from './screens';

const MIN_PER_SEC = 4;

type ModalKind = 'report' | 'choice' | 'pause' | 'settings' | 'help' | 'gameover' | 'stockcheck' | null;

export class App {
  el: HTMLElement;
  world!: World;
  s: GameState | null = null;
  demo: GameState;
  settings: Settings;
  speed = 1;
  paused = false;
  tab: TabId | null = null;
  sub: Record<string, string> = {};
  carts = new Map<number, Partial<Record<IngId, number>>>();
  confirmFire: number | null = null;
  focusUpgrade: string | null = null;
  storeIdx = 0;
  modal: ModalKind = null;
  modalBack = 'pause';
  titleView: 'main' | 'new' | 'load' | null = 'main';
  loadFromGame = false;
  newName = "Tony's Pizza";
  newDiff: Difficulty = 'standard';
  private lastT = 0;
  private panelAt = 0;
  private hudAt = 0;
  private lastPhase = '';
  private shownCash = 0;
  private saveList: SaveMeta[] = [];
  private hoverAt = 0;
  private lastRatingKey = '';
  private lastWeather = '';
  private lastStoreKey = '';
  private lastPanelHtml = '';
  private refundToastAt = 0;
  private refundBurst = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    this.settings = loadSettings();
    audio.enabled = this.settings.sound;
    audio.setVolume(this.settings.volume);
    audio.musicOn = this.settings.music;
    el.innerHTML = this.skeleton();
    try {
      this.world = new World($('#view', el) as unknown as HTMLCanvasElement);
    } catch (e) {
      el.innerHTML = `<div class="scrim" style="position:fixed"><div class="modal"><h2>3D graphics unavailable</h2><p>Pizza SIM needs WebGL 2. Try a current version of Chrome, Edge, Firefox or Safari, or turn on hardware acceleration.</p><p class="t-meta">${esc(String(e))}</p></div></div>`;
      throw e;
    }
    this.applySettings();
    this.demo = this.makeDemo();
    this.world.controls.autoRotate = 0.05;
    this.world.envOverride = 19 * 60 + 50;
    this.bind();
    this.world.resize();
    this.refreshTitle();
    saves.ready.then(() => this.refreshTitle());
    requestAnimationFrame(this.frame);
    // canvas-drawn signs need the web fonts; redraw them once fonts arrive
    let fontsDone = false;
    const refreshFonts = () => {
      if (fontsDone || !document.fonts) return;
      const loaded = [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Lilita One' && f.status === 'loaded');
      if (!loaded) return;
      fontsDone = true;
      resetDressingTextures();
      this.world.reset();
    };
    document.fonts?.addEventListener?.('loadingdone', refreshFonts);
    document.fonts?.ready.then(refreshFonts);
  }

  // =============================================================== skeleton

  private skeleton() {
    return `
    <canvas id="view" aria-label="3D view of your pizzeria"></canvas>
    <header id="hud" hidden>
      <div class="brand"><div class="brand-mark" aria-hidden="true"></div><div class="brand-text"><div class="brand-name" id="h-name"></div><div id="h-store"></div></div></div>
      <div class="hud-group">
        <div class="hud-stat"><span class="hud-label">Cash</span><span class="hud-value cash" id="h-cash">$0</span></div>
        <button class="hud-btn" data-act="menu" aria-label="Game menu">${icon('burger', 20)}</button>
      </div>
      <div class="hud-group hud-row2">
        <div class="hud-stat"><span class="hud-label" id="h-day">Day 1</span><span class="hud-value" id="h-clock"></span></div>
        <div class="hud-stat"><span class="hud-label">Rating</span><span class="hud-value" id="h-rating"></span></div>
        <div class="hud-stat hide-phone"><span class="hud-label" id="h-level">Level 1</span><span class="lvl-bar"><span id="h-xp"></span></span></div>
        <div class="speed" role="group" aria-label="Game speed">
          <button data-act="pause-toggle" id="sp-0" aria-label="Pause">${icon('pause', 16)}</button>
          <button data-act="speed" data-v="1" id="sp-1" aria-label="Normal speed">${icon('play', 14)}</button>
          <button data-act="speed" data-v="2" id="sp-2" aria-label="Fast">${icon('fast', 16)}</button>
          <button data-act="speed" data-v="4" id="sp-4" aria-label="Fastest">${icon('faster', 18)}</button>
        </div>
      </div>
    </header>
    <nav id="rail" role="tablist" hidden>${TABS.map((t) => `<button class="tab" role="tab" data-act="tab" data-tab="${t.id}" id="tab-${t.id}" aria-selected="false" title="${t.label} (${t.key.toUpperCase()})">${icon(t.icon, 22)}<span class="only-desktop">${t.label}</span><span class="only-mobile">${t.short}</span></button>`).join('')}</nav>
    <section id="panel" hidden aria-live="off">
      <div class="panel-head"><div class="grow"><h2 class="panel-title" id="p-title"></h2><div class="panel-sub" id="p-sub"></div></div><button class="icon-btn" data-act="close-panel" aria-label="Close panel">${icon('close', 18)}</button></div>
      <div class="panel-body" id="p-body"></div>
    </section>
    <div id="floor" hidden></div>
    <div id="cta" hidden></div>
    <div id="toasts" aria-live="polite"></div>
    <div id="tip" hidden></div>
    <div id="modal" hidden></div>
    <div id="title"></div>`;
  }

  // =============================================================== demo for title

  private makeDemo(): GameState {
    const d = createGame('Pizza SIM', 'relaxed', 4242);
    const st = d.stores[0];
    d.level = 9;
    Object.assign(st.upgrades, { oven: 3, prep: 2, register: 2, dining: 3, decor: 3, sign: 3, delivery: 2, cleaning: 1, breakroom: 1 });
    d.unlocked = Object.keys(ITEM) as ItemId[];
    for (const k of Object.keys(st.menu) as ItemId[]) st.menu[k].on = true;
    for (let i = 0; i < 6; i++) {
      const c = st.candidates[0] ?? null;
      if (c) A.hire(d, st, c.id);
      st.candidates = st.candidates.length ? st.candidates : [];
    }
    const roles = ['cook', 'cook', 'cashier', 'driver', 'cleaner'] as const;
    for (const r of roles) {
      if (st.staff.filter((x) => x.role === r).length >= (r === 'cook' ? 3 : 1)) continue;
      st.candidates.push({ id: ++d.nextId, name: 'Demo', role: r, skill: 3, wage: 12, traits: [], look: { skin: d.nextId % 6, hair: d.nextId % 7, shirt: 0, pants: 0, height: 1 } });
      A.hire(d, st, d.nextId);
    }
    for (const k of Object.keys(st.inventory) as IngId[]) st.inventory[k] = [{ qty: 400, exp: 999 }];
    d.cash = 99999;
    openForBusiness(d);
    advance(d, 8 * 60);
    outbox.length = 0;
    return d;
  }

  // =============================================================== input

  private bind() {
    const el = this.el;
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t || (t as HTMLButtonElement).disabled) return;
      audio.unlock();
      this.onAct(t.dataset.act!, t.dataset, t);
    });
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      if (f.dataset.form === 'new-game') {
        const name = ($('#ng-name', f) as HTMLInputElement).value;
        audio.unlock();
        this.startNewGame(name, this.newDiff);
      }
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.id === 'h-select' && this.s) {
        this.storeIdx = Number(t.value);
        this.renderPanel(true);
      }
    });
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'ng-name') this.newName = t.value;
    });
    const view = $('#view', el) as unknown as HTMLCanvasElement;
    view.addEventListener('pointerup', (e) => {
      if (!this.s || this.world.controls.wasDrag || this.modal) return;
      const tag = this.world.pickAt(e.clientX, e.clientY);
      if (tag) this.openFromPick(tag);
    });
    view.addEventListener('pointermove', (e) => {
      if (!this.s || e.pointerType !== 'mouse') return;
      const now = performance.now();
      if (now - this.hoverAt < 60) return;
      this.hoverAt = now;
      const tag = this.world.pickAt(e.clientX, e.clientY);
      const tip = $('#tip');
      const label = tag ? this.pickLabel(tag) : '';
      view.classList.toggle('hover', !!label);
      if (label && e.buttons === 0) {
        tip.hidden = false;
        tip.textContent = label;
        const r = this.el.getBoundingClientRect();
        tip.style.left = e.clientX - r.left + 'px';
        tip.style.top = e.clientY - r.top + 'px';
      } else tip.hidden = true;
    });
    view.addEventListener('pointerleave', () => ($('#tip').hidden = true));
    // chart tooltip
    el.addEventListener('pointermove', (e) => {
      const t = e.target as Element;
      const chart = t.closest?.('.chart') as HTMLElement | null;
      document.querySelectorAll('.chart-tip').forEach((n) => {
        if (!chart || !chart.contains(n)) n.remove();
      });
      if (!chart || !t.classList.contains('hit')) {
        chart?.querySelector('.chart-tip')?.remove();
        return;
      }
      const data = JSON.parse(chart.dataset.chart || '[]') as number[][];
      const row = data[Number((t as HTMLElement).dataset.i)];
      if (!row) return;
      let tip = chart.querySelector('.chart-tip') as HTMLElement | null;
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'chart-tip';
        chart.appendChild(tip);
      }
      tip.innerHTML = `<div><b>Day ${row[0]}</b></div><div class="r"><span>Sales</span><b>${money(row[1])}</b></div><div class="r"><span>Costs</span><b>${money(row[2])}</b></div><div class="r"><span>Profit</span><b>${money(row[3])}</b></div>`;
      const cr = chart.getBoundingClientRect();
      const rr = (t as Element).getBoundingClientRect();
      const x = Math.min(Math.max(rr.left + rr.width / 2 - cr.left, 70), cr.width - 70);
      tip.style.left = x + 'px';
      tip.style.top = rr.top - cr.top + 40 + 'px';
    });
    window.addEventListener('resize', () => this.world.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.s) this.save('auto');
    });
    window.addEventListener('pagehide', () => {
      if (this.s) this.save('auto');
    });
    // keep panel content stable while the pointer is down inside it
    const panel = $('#panel', el);
    panel.addEventListener('pointerdown', () => (this.panelAt = performance.now() + 1200));
  }

  private onKey(e: KeyboardEvent) {
    const tgt = e.target as HTMLElement;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    if (!this.s || this.titleView) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (this.modal === 'pause' || this.modal === 'settings' || this.modal === 'help') this.closeModal();
      else if (this.tab) this.closePanel();
      else if (!this.modal) this.openModal('pause');
      return;
    }
    if (this.modal) return;
    if (k === ' ') {
      e.preventDefault();
      this.paused = !this.paused;
    } else if (k === '1' || k === '2' || k === '3') {
      this.speed = [1, 2, 4][Number(k) - 1];
      this.paused = false;
    } else if (k === 'enter' && this.s.phase === 'prep') this.onAct('open', {});
    else {
      const t = TABS.find((x) => x.key === k);
      if (t) this.toggleTab(t.id);
    }
  }

  // =============================================================== actions

  private result(r: A.Result) {
    this.toast(r.msg, r.ok ? 'good' : 'bad');
    audio.play(r.ok ? 'click' : 'error');
    this.renderPanel(true);
  }

  private onAct(act: string, d: DOMStringMap, el?: HTMLElement) {
    const s = this.s;
    const st = s ? this.store() : null;
    const id = Number(d.id);
    switch (act) {
      // ---- title
      case 'continue':
        if (this.saveList[0]) this.loadSlot(this.saveList[0].slot);
        return;
      case 'new-game':
        this.titleView = 'new';
        this.modal = null;
        this.renderModal();
        this.refreshTitle();
        return;
      case 'title':
        this.titleView = 'main';
        this.modal = null;
        this.renderModal();
        this.refreshTitle();
        return;
      case 'load-screen':
        this.loadFromGame = false;
        this.titleView = 'load';
        this.refreshTitle();
        return;
      case 'load-screen-game':
        this.loadFromGame = true;
        this.modal = null;
        this.renderModal();
        this.titleView = 'load';
        this.refreshTitle();
        return;
      case 'ng-diff':
        this.newDiff = d.v as Difficulty;
        this.refreshTitle();
        return;
      case 'load':
        this.loadSlot(d.slot!);
        return;
      case 'delete-save':
        saves.remove(d.slot!).then(() => this.refreshTitle());
        return;
      case 'quit-app':
        if (this.s) this.save('auto');
        setTimeout(() => native()?.quit(), 200);
        return;
      case 'help':
        this.modalBack = this.s && !this.titleView ? 'pause' : 'close-modal';
        this.openModal('help');
        return;
      case 'settings':
        this.modalBack = this.s && !this.titleView ? 'pause' : 'close-modal';
        this.openModal('settings');
        return;
      case 'close-modal':
        this.closeModal();
        return;
      case 'set': {
        const key = d.key as keyof Settings;
        (this.settings as unknown as Record<string, unknown>)[key] = !this.settings[key];
        this.applySettings();
        this.renderModal();
        return;
      }
      case 'volume':
        this.settings.volume = Math.max(0, Math.min(1, Math.round((this.settings.volume + Number(d.d)) * 10) / 10));
        this.applySettings();
        audio.play('click');
        this.renderModal();
        return;
      case 'quality':
        this.settings.quality = d.v as Settings['quality'];
        this.applySettings();
        this.renderModal();
        return;
    }
    if (!s || !st) return;
    switch (act) {
      case 'tab':
        this.toggleTab(d.tab as TabId);
        return;
      case 'close-panel':
        this.closePanel();
        return;
      case 'sub':
        this.sub[d.key!] = d.v!;
        this.renderPanel(true);
        $('#p-body').scrollTop = 0;
        return;
      case 'speed':
        this.speed = Number(d.v);
        this.paused = false;
        return;
      case 'pause-toggle':
        this.paused = !this.paused;
        return;
      case 'menu':
      case 'pause':
        this.titleView = null;
        this.refreshTitle();
        this.openModal('pause');
        return;
      case 'resume':
        this.closeModal();
        return;
      case 'save':
        this.save(d.slot!).then(() => this.toast(`Saved to slot ${d.slot}. ${saves.where}.`, 'good'));
        audio.play('click');
        return;
      case 'fullscreen': {
        const n = native();
        if (n) n.toggleFullscreen();
        else if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
        else document.documentElement.requestFullscreen?.().catch(() => this.toast('Full screen is not available here.', 'info'));
        return;
      }
      case 'quit-title':
        this.save('auto').then(() => this.toTitle());
        return;
      case 'open': {
        if (d.force !== '1' && this.lowStock(s).length) {
          this.openModal('stockcheck');
          return;
        }
        this.modal = null;
        this.renderModal();
        const r = openForBusiness(s);
        if (!r.ok) return this.toast(r.msg ?? '', 'bad');
        audio.play('open');
        this.paused = false;
        this.updateCta();
        return;
      }
      case 'next-day':
        beginNextDay(s);
        this.modal = null;
        this.renderModal();
        this.save('auto');
        if (s.choice) this.openModal('choice');
        else if (this.settings.autoNextDay) this.onAct('open', {});
        this.renderPanel(true);
        return;
      case 'choose': {
        const msg = resolveChoice(s, d.id!);
        this.modal = null;
        this.renderModal();
        if (msg) this.toast(msg, 'info');
        if (this.settings.autoNextDay && s.phase === 'prep') this.onAct('open', {});
        return;
      }
      case 'order-and-open': {
        for (const x of s.stores) {
          const lines = suggestOrder(s, x);
          if (Object.keys(lines).length) {
            const r = A.orderSupplies(s, x, lines, false);
            if (!r.ok) {
              this.toast(r.msg, 'bad');
              this.renderModal();
              return;
            }
            this.toast(r.msg, 'good');
          }
        }
        this.onAct('open', { force: '1' });
        return;
      }
      case 'goto-stock':
        this.modal = null;
        this.renderModal();
        this.openTab('stock');
        return;
      case 'game-over':
        this.openModal('gameover');
        return;
      // ---- staff
      case 'hire':
        return this.result(A.hire(s, st, id));
      case 'fire':
        if (this.confirmFire !== id) {
          this.confirmFire = id;
          this.renderPanel(true);
          setTimeout(() => {
            if (this.confirmFire === id) {
              this.confirmFire = null;
              this.renderPanel(true);
            }
          }, 3500);
          return;
        }
        this.confirmFire = null;
        return this.result(A.fire(s, st, id));
      case 'train':
        return this.result(A.train(s, st, id));
      case 'wage':
        return this.result(A.adjustWage(s, st, id, Number(d.d)));
      case 'bonus':
        return this.result(A.giveBonus(s, st, id));
      // ---- stock
      case 'cart': {
        const cart = this.cart(st);
        const k = d.k as IngId;
        cart[k] = Math.max(0, (cart[k] ?? 0) + Number(d.d));
        if (!cart[k]) delete cart[k];
        audio.play('click');
        this.renderPanel(true);
        return;
      }
      case 'cart-suggest':
        this.carts.set(st.id, suggestOrder(s, st));
        this.renderPanel(true);
        return;
      case 'cart-clear':
        this.carts.set(st.id, {});
        this.renderPanel(true);
        return;
      case 'order': {
        const r = A.orderSupplies(s, st, this.cart(st), d.express === '1');
        if (r.ok) this.carts.set(st.id, {});
        return this.result(r);
      }
      case 'supplier':
        return this.result(A.setSupplier(st, d.v as SupplierId));
      case 'auto-toggle':
        st.autoReorder = !st.autoReorder;
        if (st.autoReorder && !Object.keys(st.par).length) this.onAct('par-suggest', {});
        this.renderPanel(true);
        return;
      case 'par':
        A.setPar(st, d.k as IngId, (st.par[d.k as IngId] ?? 0) + Number(d.d));
        this.renderPanel(true);
        return;
      case 'par-suggest':
        for (const k of neededIngredients(s, st)) A.setPar(st, k, Math.ceil((estimateDailyNeed(s, st, k) * 1.1) / 5) * 5);
        this.renderPanel(true);
        return;
      // ---- menu
      case 'menu-toggle':
        return this.result(A.toggleItem(s, st, d.id as ItemId));
      case 'price':
        A.setPrice(st, d.id as ItemId, st.menu[d.id as ItemId].price + Number(d.d));
        audio.play('click');
        this.renderPanel(true);
        return;
      case 'unlock':
        return this.result(A.unlockRecipe(s, d.id as ItemId));
      // ---- upgrades & marketing
      case 'upgrade': {
        const r = A.buyUpgrade(s, st, d.id as UpgradeId);
        if (r.ok) {
          audio.play('ding');
          setTimeout(() => this.world.installPuff(), 60);
        }
        return this.result(r);
      }
      case 'campaign':
        return this.result(A.runCampaign(s, st, d.id as CampaignId));
      case 'loyalty':
        return this.result(A.buyLoyalty(s));
      // ---- finance & empire
      case 'loan':
        return this.result(A.takeLoan(s, Number(d.v)));
      case 'repay':
        return this.result(A.repayLoan(s));
      case 'goto-store':
        this.storeIdx = Math.max(0, s.stores.findIndex((x) => x.id === id));
        this.renderPanel(true);
        return;
      case 'buy-location': {
        const r = A.buyLocation(s, d.id as LocationId);
        if (r.ok) {
          this.storeIdx = s.stores.length - 1;
          audio.play('levelup');
          setTimeout(() => this.world.celebrate(), 120);
        }
        return this.result(r);
      }
    }
    void el;
  }

  /** Ingredients each store will likely run out of today. */
  lowStock(s: GameState) {
    const out: { st: Store; k: IngId; have: number; need: number }[] = [];
    for (const st of s.stores) {
      for (const k of neededIngredients(s, st)) {
        const need = estimateDailyNeed(s, st, k);
        const have = stockOf(st, k);
        if (need > 0 && have < need * 0.6) out.push({ st, k, have, need });
      }
    }
    return out;
  }

  private stockCheckModal(s: GameState) {
    const low = this.lowStock(s);
    let cost = 0;
    for (const st of s.stores) {
      const lines = suggestOrder(s, st);
      for (const [k, q] of Object.entries(lines) as [IngId, number][]) cost += ingredientPrice(s, st, k) * q;
    }
    const multi = s.stores.length > 1;
    return `<div class="modal" role="dialog" aria-label="Stock check">
      <h2>You'll run out today</h2>
      <p>Customers who can't get their pizza leave, and your rating drops. Expected demand today:</p>
      <div class="ticket" style="padding:4px 12px">${low.slice(0, 8).map((x) => `<div class="spread review"><span><span class="swatch" style="display:inline-block;vertical-align:-1px;margin-right:6px;background:${ING[x.k].color}"></span>${esc(ING[x.k].name)}${multi ? ` <span class="t-meta">· ${esc(LOC[x.st.locationId].name)}</span>` : ''}</span><span class="num"><b class="neg">${x.have}</b> / ~${x.need}</span></div>`).join('')}</div>
      <div class="btns" style="flex-direction:column">
        <button class="btn buy block" data-act="order-and-open" ${cost > s.cash ? 'disabled' : ''}>${icon('cart', 16)}<span>Order what I need (${money(cost)}) and open</span></button>
        <button class="btn block" data-act="goto-stock">Choose items myself</button>
        <button class="btn block" data-act="open" data-force="1">Open anyway</button>
      </div>
    </div>`;
  }

  private openFromPick(tag: string) {
    if (tag.startsWith('staff')) return this.openTab('staff');
    const map: Record<string, [TabId, string | null]> = {
      oven: ['upgrades', 'oven'], prep: ['upgrades', 'prep'], register: ['upgrades', 'register'], storage: ['stock', null], dining: ['upgrades', 'dining'],
      decor: ['upgrades', 'decor'], sign: ['marketing', null], delivery: ['upgrades', 'delivery'], menu: ['menu', null], cleaning: ['upgrades', 'cleaning'], breakroom: ['upgrades', 'breakroom'],
    };
    const m = map[tag];
    if (!m) return;
    this.focusUpgrade = m[1];
    this.openTab(m[0]);
    if (m[1]) setTimeout(() => document.getElementById('up-' + m[1])?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
  }

  private pickLabel(tag: string): string {
    const st = this.store();
    if (tag.startsWith('staff:')) {
      const x = st.staff.find((q) => 'staff:' + q.id === tag);
      return x ? `${x.name} · ${x.role} · morale ${Math.round(x.morale)}` : '';
    }
    const u = (id: UpgradeId) => `${UPG[id].levels[st.upgrades[id]].name} · click to upgrade`;
    switch (tag) {
      case 'oven': return `${u('oven')} (${itemsInStage(st, 'baking')}/${ovenSlots(st)} baking)`;
      case 'prep': return u('prep');
      case 'register': return u('register');
      case 'storage': return `${UPG.storage.levels[st.upgrades.storage].name} · click to order stock`;
      case 'dining': return `${seatsTotal(st)} seats · click to upgrade`;
      case 'decor': return u('decor');
      case 'sign': return `${UPG.sign.levels[st.upgrades.sign].name} · click for marketing`;
      case 'delivery': return u('delivery');
      case 'menu': return 'Menu & prices';
      case 'cleaning': return u('cleaning');
      case 'breakroom': return u('breakroom');
      case 'staff': return 'Manager desk · staff';
    }
    return '';
  }

  // =============================================================== game lifecycle

  private startNewGame(name: string, diff: Difficulty) {
    this.s = createGame(name, diff, (Date.now() ^ Math.floor(Math.random() * 1e9)) | 0);
    this.enterGame();
    this.toast('Welcome! Morning prep: time is stopped. Hire a cashier, check your stock, then open the doors.', 'gold');
    setTimeout(() => this.openTab('goals'), 300);
  }

  private enterGame() {
    this.titleView = null;
    this.modal = null;
    this.tab = null;
    this.storeIdx = 0;
    this.speed = 1;
    this.paused = false;
    this.carts.clear();
    outbox.length = 0;
    this.world.reset();
    this.world.envOverride = null;
    this.world.controls.autoRotate = 0;
    this.world.controls.reset();
    this.shownCash = this.s!.cash;
    this.lastPhase = '';
    $('#hud').hidden = false;
    $('#rail').hidden = false;
    this.refreshTitle();
    this.renderModal();
    this.closePanel();
    if (this.s!.phase === 'report' && this.s!.report) this.openModal('report');
    else if (this.s!.choice) this.openModal('choice');
    else if (this.s!.gameOver) this.openModal('gameover');
    audio.setMusic(this.settings.music);
  }

  private toTitle() {
    this.s = null;
    this.titleView = 'main';
    this.modal = null;
    this.closePanel();
    $('#hud').hidden = true;
    $('#rail').hidden = true;
    $('#floor').hidden = true;
    $('#cta').hidden = true;
    this.world.reset();
    this.world.envOverride = 19 * 60 + 50;
    this.world.controls.autoRotate = 0.05;
    this.renderModal();
    this.refreshTitle();
  }

  /** Developer helper: fast-forward the current day (used by automated tests). */
  skip(minutes: number) {
    if (this.s) advance(this.s, minutes);
  }

  serialize(s: GameState) {
    return JSON.stringify(s);
  }

  loadState(s: GameState) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.stores)) throw new Error('Not a Pizza SIM save');
    if ((s.version ?? 0) > SAVE_VERSION) throw new Error('Save is from a newer version');
    s.version = SAVE_VERSION;
    this.s = s;
    this.enterGame();
  }

  async save(slot: string) {
    const s = this.s;
    if (!s) return;
    await saves.save({
      meta: { slot, savedAt: Date.now(), company: s.company, day: s.day, cash: Math.round(s.cash), level: s.level, stores: s.stores.length },
      data: this.serialize(s),
    });
  }

  private async loadSlot(slot: string) {
    const f = await saves.load(slot);
    if (!f) return this.toast('That save could not be read.', 'bad');
    try {
      this.loadState(JSON.parse(f.data));
      this.toast(`Loaded ${f.meta.company}, day ${f.meta.day}.`, 'good');
    } catch (e) {
      this.toast('That save could not be read: ' + String((e as Error).message), 'bad');
    }
  }

  private async refreshTitle() {
    const t = $('#title');
    if (!this.titleView) {
      t.hidden = true;
      return;
    }
    t.hidden = false;
    this.saveList = await saves.list();
    if (this.titleView === 'main') {
      t.innerHTML = S.titleScreen({ latest: this.saveList[0] ?? null, hasSaves: this.saveList.length > 0, where: saves.where, desktop: !!native() });
    } else if (this.titleView === 'new') {
      if (!t.querySelector('[data-form="new-game"]')) t.innerHTML = S.newGameScreen(this.newName, this.newDiff);
      else {
        t.innerHTML = S.newGameScreen(this.newName, this.newDiff);
      }
      const inp = $('#ng-name', t) as HTMLInputElement;
      if (inp && !matchMedia('(pointer: coarse)').matches) inp.focus();
    } else {
      t.innerHTML = S.loadScreen(this.saveList, this.loadFromGame && !!this.s);
    }
  }

  // =============================================================== settings

  private applySettings() {
    const st = this.settings;
    storeSettings(st);
    audio.enabled = st.sound;
    audio.setVolume(st.volume);
    if (audio.ctx) audio.setMusic(st.music);
    else audio.musicOn = st.music;
    if (this.world) {
      this.world.opts.shadows = st.shadows;
      this.world.opts.floatingText = st.floatingText;
      const mobile = Math.min(window.innerWidth, window.innerHeight) < 600;
      this.world.opts.maxDpr = st.quality === 'low' ? 1 : mobile ? 1.75 : 2;
      this.world.renderer.setShadowSize(st.quality === 'low' ? 1024 : mobile ? 1024 : 2048);
      this.world.renderer.postOpts.enabled = st.quality === 'high';
      this.world.resize();
    }
  }

  // =============================================================== panels

  store(): Store {
    const s = this.s!;
    if (this.storeIdx >= s.stores.length) this.storeIdx = 0;
    return s.stores[this.storeIdx];
  }
  private cart(st: Store) {
    let c = this.carts.get(st.id);
    if (!c) {
      c = {};
      this.carts.set(st.id, c);
    }
    return c;
  }

  private toggleTab(t: TabId) {
    if (this.tab === t) this.closePanel();
    else this.openTab(t);
  }
  openTab(t: TabId) {
    if (!this.s) return;
    if (this.tab !== t && t !== 'upgrades') this.focusUpgrade = null;
    this.tab = t;
    $('#panel').hidden = false;
    for (const x of TABS) $('#tab-' + x.id).setAttribute('aria-selected', String(x.id === t));
    $('#floor').classList.add('collapsed-by-panel');
    if (t === 'stock') {
      const st = this.store();
      const cart = this.cart(st);
      if (!Object.keys(cart).length && this.s.phase === 'prep') this.carts.set(st.id, suggestOrder(this.s, st));
    }
    this.renderPanel(true);
    $('#p-body').scrollTop = 0;
  }
  closePanel() {
    this.tab = null;
    $('#panel').hidden = true;
    for (const x of TABS) $('#tab-' + x.id)?.setAttribute('aria-selected', 'false');
    $('#floor').classList.remove('collapsed-by-panel');
    $('#tip').hidden = true;
  }

  renderPanel(force = false) {
    if (!this.s || !this.tab) return;
    const now = performance.now();
    if (!force && now < this.panelAt) return;
    const body = $('#p-body');
    if (!force && body.contains(document.activeElement) && document.activeElement !== body && (document.activeElement as HTMLElement).tagName === 'INPUT') return;
    this.panelAt = now + 1000;
    const st = this.store();
    const ctx: PanelCtx = { s: this.s, st, sub: this.sub, cart: this.cart(st), confirmFire: this.confirmFire, focusUpgrade: this.focusUpgrade };
    const t = panelTitle(this.tab, this.s, st);
    $('#p-title').textContent = t.title;
    $('#p-sub').textContent = t.sub;
    const scroll = body.scrollTop;
    const openDetails = [...body.querySelectorAll('details')].map((d) => d.open);
    // keep focus on the same control after re-render
    const fa = document.activeElement as HTMLElement | null;
    const focusKey = fa && body.contains(fa) ? fa.dataset.act + '|' + (fa.dataset.id ?? fa.dataset.k ?? fa.dataset.v ?? '') + '|' + (fa.dataset.d ?? '') : null;
    const html = renderPanel(this.tab, ctx);
    if (!force && html === this.lastPanelHtml) return;
    this.lastPanelHtml = html;
    body.innerHTML = html;
    body.querySelectorAll('details').forEach((d, i) => {
      if (openDetails[i]) d.open = true;
    });
    body.scrollTop = scroll;
    if (focusKey) {
      const [a, idv, dd] = focusKey.split('|');
      const cand = [...body.querySelectorAll<HTMLElement>(`[data-act="${a}"]`)].find((n) => (n.dataset.id ?? n.dataset.k ?? n.dataset.v ?? '') === idv && (n.dataset.d ?? '') === dd);
      cand?.focus({ preventScroll: true });
    }
  }

  // =============================================================== modals

  private openModal(k: ModalKind) {
    this.modal = k;
    this.renderModal();
  }
  private closeModal() {
    if (this.modal === 'settings' || this.modal === 'help') {
      if (this.modalBack === 'pause' && this.s) return this.openModal('pause');
    }
    this.modal = null;
    this.renderModal();
  }
  private renderModal() {
    const m = $('#modal');
    const s = this.s;
    if (!this.modal) {
      m.hidden = true;
      m.innerHTML = '';
      return;
    }
    let inner = '';
    switch (this.modal) {
      case 'report':
        if (s?.report) inner = S.reportModal(s, s.report);
        break;
      case 'choice':
        if (s?.choice) inner = S.choiceModal(s);
        break;
      case 'pause':
        inner = S.pauseModal(saves.where, !!native());
        break;
      case 'settings':
        inner = S.settingsModal(this.settings, this.modalBack === 'pause' ? 'pause' : 'close-modal');
        break;
      case 'help':
        inner = S.helpModal(this.modalBack === 'pause' ? 'pause' : 'close-modal');
        break;
      case 'gameover':
        if (s) inner = S.gameOverModal(s);
        break;
      case 'stockcheck':
        if (s) inner = this.stockCheckModal(s);
        break;
    }
    if (!inner) {
      this.modal = null;
      m.hidden = true;
      return;
    }
    m.hidden = false;
    m.innerHTML = `<div class="scrim">${inner}</div>`;
    const first = m.querySelector<HTMLElement>('button');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus({ preventScroll: true });
  }

  // =============================================================== toasts

  toast(text: string, tone: 'good' | 'bad' | 'info' | 'gold' = 'info') {
    if (!text) return;
    const box = $('#toasts');
    const n = document.createElement('div');
    n.className = 'toast ' + tone;
    const ic = tone === 'good' ? 'check' : tone === 'bad' ? 'alert' : tone === 'gold' ? 'star' : 'info';
    n.innerHTML = `<span class="dot">${icon(ic, 14)}</span><span>${esc(text)}</span>`;
    box.prepend(n);
    while (box.children.length > 4) box.lastElementChild!.remove();
    setTimeout(() => {
      n.classList.add('out');
      setTimeout(() => n.remove(), 260);
    }, tone === 'bad' ? 5200 : 4200);
  }

  private drainEvents() {
    const ev = outbox.splice(0);
    if (!this.s) {
      for (const e of ev) if (e.type === 'sale' && e.amount) this.world.floatText('+$' + e.amount.toFixed(2), '#f2b33d', e.customerId);
      return;
    }
    const cur = this.store().id;
    for (const e of ev) {
      switch (e.type) {
        case 'sale':
          if (e.storeId === cur && e.amount) {
            this.world.floatText('+$' + e.amount.toFixed(2), '#f2b33d', e.customerId);
            audio.play('cash');
          }
          break;
        case 'toast': {
          // collapse bursts of refund notices into one line
          if (e.text?.startsWith('Refunded')) {
            this.refundBurst++;
            const now = performance.now();
            if (now - this.refundToastAt < 6000) break;
            this.refundToastAt = now;
            const n = this.refundBurst;
            this.refundBurst = 0;
            this.toast(n > 1 ? `${n} customers got refunds after waiting too long.` : e.text, 'bad');
            break;
          }
          this.toast(e.text ?? '', e.tone === 'good' ? 'good' : e.tone === 'bad' ? 'bad' : 'info');
          break;
        }
        case 'levelup':
          this.toast(`${e.text} New unlocks are waiting.`, 'gold');
          audio.play('levelup');
          this.world.celebrate();
          break;
        case 'goal':
          this.toast(e.text ?? '', 'gold');
          audio.play('goal');
          this.world.celebrate();
          break;
        case 'walkout':
          if (e.storeId === cur && e.text === 'Sold out') this.world.floatText('Sold out', '#ff7a66', e.customerId);
          break;
      }
    }
  }

  // =============================================================== HUD & floor

  private updateHud(dt: number) {
    const s = this.s!;
    const st = this.store();
    // cash count-up
    const diff = s.cash - this.shownCash;
    this.shownCash += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 8);
    const cashEl = $('#h-cash');
    cashEl.textContent = money(this.shownCash);
    cashEl.classList.toggle('neg', s.cash < 0);
    const storeKey = s.company + '|' + s.stores.length + '|' + this.storeIdx;
    if (storeKey !== this.lastStoreKey) {
      this.lastStoreKey = storeKey;
      $('#h-name').textContent = s.company;
      $('#h-store').innerHTML = s.stores.length > 1
        ? `<select id="h-select" class="store-select" aria-label="Store">${s.stores.map((x, i) => `<option value="${i}" ${i === this.storeIdx ? 'selected' : ''}>${esc(LOC[x.locationId].name)}</option>`).join('')}</select>`
        : `<span class="store-loc">${esc(loc(st).name)}</span>`;
    }
    const sel = document.getElementById('h-select') as HTMLSelectElement | null;
    if (sel && sel.value !== String(this.storeIdx)) sel.value = String(this.storeIdx);
    $('#h-day').textContent = `Day ${s.day} · ${DAY_NAMES[(s.day - 1) % 7]}`;
    const phaseText = s.phase === 'prep' ? 'Morning prep' : s.phase === 'report' ? 'Closed' : clock(s.minute);
    const clk = $('#h-clock');
    if (s.weather !== this.lastWeather || clk.dataset.t !== phaseText) {
      this.lastWeather = s.weather;
      clk.dataset.t = phaseText;
      clk.innerHTML = `${icon(s.weather, 16)}<span>${phaseText}</span>`;
      clk.title = WEATHER[s.weather].name;
    }
    const rk = st.rating.toFixed(2);
    if (rk !== this.lastRatingKey) {
      this.lastRatingKey = rk;
      $('#h-rating').innerHTML = `<span class="only-desktop">${stars(st.rating, 13)}</span><span class="only-mobile" style="color:var(--crust)">★</span><span>${st.rating.toFixed(1)}</span>`;
    }
    const cur = xpForLevel(s.level), next = xpForLevel(s.level + 1);
    $('#h-level').textContent = `Level ${s.level}`;
    ($('#h-xp') as HTMLElement).style.width = `${Math.min(100, ((s.xp - cur) / (next - cur)) * 100)}%`;
    const running = !this.paused;
    $('#sp-0').setAttribute('aria-pressed', String(!running));
    for (const v of [1, 2, 4]) $('#sp-' + v).setAttribute('aria-pressed', String(running && this.speed === v));
  }

  private updateFloor() {
    const s = this.s!;
    const st = this.store();
    const f = $('#floor');
    if (s.phase === 'report' || s.phase === 'prep' || this.titleView) {
      f.hidden = true;
      this.updateBadges(s, this.store());
      return;
    }
    f.hidden = false;
    const line = st.customers.filter((c) => c.state === 'queue' || c.state === 'enter').length;
    const kitchen = itemsInStage(st, 'queued') + itemsInStage(st, 'prep');
    const baking = itemsInStage(st, 'baking');
    const out = st.staff.filter((x) => x.task?.kind === 'deliver').length;
    const stat = (label: string, v: string, title = '') => `<div class="hud-stat" title="${esc(title)}"><span class="hud-label">${label}</span><span class="hud-value">${v}</span></div>`;
    let alert = '';
    const need = neededIngredients(s, st);
    const low = need.filter((k) => stockOf(st, k) < Math.max(4, estimateDailyNeed(s, st, k) * (s.phase === 'prep' ? 0.6 : 0.12)));
    const empty = need.filter((k) => stockOf(st, k) === 0 && k !== 'box');
    if (!activeStaff(st).length) alert = 'Nobody is working. Hire staff.';
    else if (empty.length) alert = `Out of ${empty.map((k) => ING[k].name.toLowerCase()).slice(0, 2).join(' & ')}. Order stock!`;
    else if (low.length) alert = `Running low: ${low.map((k) => ING[k].name.toLowerCase()).slice(0, 2).join(', ')}.`;
    else if (!activeStaff(st, 'cashier').length && !up(st, 'register').kiosk) alert = 'No cashier on shift. Your cook is ringing up orders.';
    else if (line >= 6) alert = 'The line is backing up. More cashiers or a faster register help.';
    else if (kitchen >= 8) alert = 'The kitchen is swamped. Add cooks, stations or a bigger oven.';
    else if (st.cleanliness < 45) alert = 'The store is dirty. Hire a cleaner.';
    else if (st.upgrades.delivery > 0 && !activeStaff(st, 'driver').length) alert = 'You own a delivery vehicle but no driver is on shift.';
    f.innerHTML = `${stat('Line', String(line))}${stat('Kitchen', String(kitchen))}${stat('Oven', `${baking}/${ovenSlots(st)}`)}
      ${stat('Served', String(st.today.served))}${stat('Lost', String(st.today.lost))}${stat(out ? 'Delivering' : 'Clean', out ? String(out) : Math.round(st.cleanliness) + '%')}
      <div class="alert ${alert ? '' : 'ok'}">${icon(alert ? 'alert' : 'check', 14)}<span>${esc(alert || (s.phase === 'closing' ? 'Doors closed. Finishing the last orders.' : 'Running smoothly.'))}</span></div>`;
    this.updateBadges(s, st);
  }

  private updateBadges(s: GameState, st: Store) {
    const badge = (t: TabId, on: boolean) => {
      const b = $('#tab-' + t);
      const has = b.querySelector('.badge');
      if (on && !has) b.insertAdjacentHTML('beforeend', '<span class="badge"></span>');
      if (!on && has) has.remove();
    };
    badge('stock', this.lowStock(s).some((x) => x.st === st));
    badge('staff', !st.staff.some((x) => x.role === 'cashier') || st.staff.some((x) => x.morale < 30));
    badge('goals', s.phase === 'prep' && s.day === 1 && s.goalsDone.length < 2);
  }

  private updateCta() {
    const c = $('#cta');
    const s = this.s;
    if (!s || this.titleView || s.phase !== 'prep' || this.modal) {
      c.hidden = true;
      return;
    }
    c.hidden = false;
    const st = this.store();
    const low = this.lowStock(s).length;
    const staff = activeStaff(st).length;
    const key = `${s.day}|${low}|${staff}|${s.weather}|${this.storeIdx}`;
    if (c.dataset.key !== key) {
      c.dataset.key = key;
      c.innerHTML = `<div class="prep-card" role="status">
        <span class="chip ${staff ? 'good' : 'bad'}">${icon('staff', 13)} ${staff} on shift</span>
        <button class="chip ${low ? 'bad' : 'good'}" data-act="tab" data-tab="stock">${icon('stock', 13)} ${low ? `${low} item${low > 1 ? 's' : ''} running low` : 'Stock ready'}</button>
        <span class="chip">${icon(s.weather, 13)} ${WEATHER[s.weather].name}</span>
      </div>
      <button class="btn red big-cta" data-act="open">${icon('door', 22)} Open for business</button>`;
    }
  }

  // =============================================================== loop

  private frame = (t: number) => {
    const dt = Math.min(0.1, Math.max(0, (t - (this.lastT || t)) / 1000));
    this.lastT = t;
    try {
      const s = this.s;
      if (s) {
        const running = !this.paused && !this.modal && !this.titleView && (s.phase === 'open' || s.phase === 'closing') && !s.choice;
        if (running) advance(s, dt * this.speed * MIN_PER_SEC);
        if (s.phase !== this.lastPhase) {
          if (s.phase === 'report' && s.report) {
            this.openModal('report');
            audio.play('close');
          }
          this.lastPhase = s.phase;
          this.updateCta();
        }
        if (s.choice && this.modal !== 'choice' && !this.titleView && this.modal !== 'report') this.openModal('choice');
        this.drainEvents();
        this.updateHud(dt);
        if (t - this.hudAt > 250) {
          this.hudAt = t;
          this.updateFloor();
          this.updateCta();
        }
        this.renderPanel(false);
        this.world.frame(s, this.store(), dt, this.speed, running);
      } else {
        const d = this.demo;
        advance(d, dt * MIN_PER_SEC * 1.2);
        if (d.phase === 'closing' || d.minute > 21 * 60) {
          d.minute = 17 * 60;
          d.phase = 'open';
        }
        this.drainEvents();
        this.world.frame(d, d.stores[0], dt, 1.2, true);
      }
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(this.frame);
  };
}

export { plural };
