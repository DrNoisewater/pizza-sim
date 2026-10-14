// Management panels rendered as HTML strings. Buttons carry data-act attributes that
// the app routes to core actions (see ui/app.ts handleAction).
import { INGREDIENTS, ING, ITEM, MENU, SUPPLIERS, type IngId, type ItemId, type SupplierId } from '../data/catalog';
import { UPGRADES, UPG } from '../data/upgrades';
import { CAMPAIGNS, LOCATIONS, LOANS, LOAN_DAYS, LOAN_INTEREST, LOYALTY, ROLES, TRAITS, MAX_STAFF, LOC } from '../data/world';
import type { GameState, Store, Staff } from '../core/types';
import { activeStaff, canAutoReorder, dailyWages, loc, stockOf, storageCap, storageUsed, up } from '../core/state';
import { estimateDailyNeed, expiringSoon, neededIngredients } from '../core/inventory';
import { ingredientPrice, itemFoodCost, priceWeight, salePrice, marketingBoost, walkInRate } from '../core/economy';
import { marketWage, trainingCost, trainingReq, xpToNext } from '../core/staff';
import { activeGoals, unlocksAt, xpForLevel, GOALS } from '../core/progression';
import { upgradeCost } from '../core/actions';
import { money, compactMoney, clock, plural } from '../core/util';
import { esc, icon, meter, stars } from './dom';

export type TabId = 'staff' | 'stock' | 'menu' | 'upgrades' | 'marketing' | 'finance' | 'empire' | 'goals';
export const TABS: { id: TabId; label: string; short: string; icon: string; key: string }[] = [
  { id: 'staff', label: 'Staff', short: 'Staff', icon: 'staff', key: 's' },
  { id: 'stock', label: 'Stock', short: 'Stock', icon: 'stock', key: 'i' },
  { id: 'menu', label: 'Menu', short: 'Menu', icon: 'menu', key: 'm' },
  { id: 'upgrades', label: 'Upgrades', short: 'Build', icon: 'upgrades', key: 'u' },
  { id: 'marketing', label: 'Marketing', short: 'Promo', icon: 'marketing', key: 'k' },
  { id: 'finance', label: 'Finance', short: 'Money', icon: 'finance', key: 'f' },
  { id: 'empire', label: 'Empire', short: 'Stores', icon: 'empire', key: 'e' },
  { id: 'goals', label: 'Goals', short: 'Goals', icon: 'goals', key: 'g' },
];

export interface PanelCtx {
  s: GameState;
  st: Store;
  sub: Record<string, string>;
  cart: Partial<Record<IngId, number>>;
  confirmFire: number | null;
  focusUpgrade: string | null;
}

const ROLE_COLOR: Record<string, string> = { cook: '#8a6f5a', cashier: '#c8352a', driver: '#2f6fd1', cleaner: '#2f7a3b', manager: '#2b1d14' };
const initials = (n: string) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);

function seg(key: string, cur: string, opts: [string, string][]) {
  return `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-act="sub" data-key="${key}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
}
function pips(n: number, max = 5) {
  let s = '<span class="num" aria-label="skill ' + n + ' of ' + max + '" style="letter-spacing:1px;color:var(--tomato)">';
  for (let i = 1; i <= max; i++) s += i <= n ? '●' : '<span style="color:rgba(138,111,90,0.4)">●</span>';
  return s + '</span>';
}
const lockChip = (lv: number) => `<span class="chip">${icon('lock', 12)} Level ${lv}</span>`;

// =================================================================== STAFF
export function staffPanel(c: PanelCtx): string {
  const { s, st } = c;
  const sub = c.sub.staff ?? 'team';
  let h = seg('staff', sub, [['team', `Team (${st.staff.length})`], ['hire', `Hire (${st.candidates.length})`]]);
  if (sub === 'team') {
    const cooks = st.staff.filter((x) => x.role === 'cook').length;
    const stations = up(st, 'prep').stations ?? 1;
    h += `<p class="hint">Wages <b class="num">${money(dailyWages(st))}</b>/day for ${plural(st.staff.length, 'person', 'people')}. Cooks: ${cooks}/${stations} make-line stations${cooks > stations ? ' (extra cooks wait for a free station)' : ''}.</p>`;
    if (!st.staff.some((x) => x.role === 'cashier')) h += `<div class="ticket"><div class="row">${icon('alert', 18)}<div class="grow t-meta">No cashier: your cook has to run the register too. Hire one from the Hire tab.</div></div></div>`;
    for (const x of st.staff) h += staffCard(c, x);
    if (!st.staff.length) h += `<div class="ticket"><p class="t-meta">Nobody works here yet. Hire a cook and a cashier to open.</p></div>`;
  } else {
    h += `<p class="hint">New applicants show up every morning. Higher-rated stores attract better people.</p>`;
    for (const cd of st.candidates) {
      const r = ROLES[cd.role];
      const locked = s.level < r.req || (cd.role === 'driver' && st.upgrades.delivery < 1) || (cd.role === 'manager' && st.staff.some((y) => y.role === 'manager'));
      const why = s.level < r.req ? `Unlocks at level ${r.req}` : cd.role === 'driver' && st.upgrades.delivery < 1 ? 'Needs a delivery vehicle' : cd.role === 'manager' && st.staff.some((y) => y.role === 'manager') ? 'Already have a manager' : '';
      const market = marketWage(cd.role, cd.skill);
      h += `<div class="ticket perf">
        <div class="row"><div class="avatar" style="background:${ROLE_COLOR[cd.role]}">${esc(initials(cd.name))}</div>
          <div class="grow"><div class="t-name">${esc(cd.name)}</div><div class="t-meta">${r.name} · skill ${pips(cd.skill)}</div></div>
          <div style="text-align:right"><div class="price">${money(cd.wage, true)}<span class="t-meta">/hr</span></div><div class="t-meta">${cd.wage > market + 0.4 ? 'above' : cd.wage < market - 0.4 ? 'below' : 'at'} market</div></div></div>
        ${cd.traits.length ? `<div class="chips">${cd.traits.map((t) => `<span class="chip ${TRAITS[t].good ? 'good' : 'bad'}" title="${esc(TRAITS[t].desc)}">${TRAITS[t].name}</span>`).join('')}</div>` : ''}
        <div class="t-desc">${r.desc}${cd.traits.length ? ' ' + cd.traits.map((t) => TRAITS[t].desc).join(' ') : ''}</div>
        <div class="btns">${locked ? `<span class="chip warn">${esc(why)}</span>` : `<button class="btn buy small" data-act="hire" data-id="${cd.id}" ${st.staff.length >= MAX_STAFF ? 'disabled' : ''}>Hire ${esc(cd.name.split(' ')[0])}</button>`}</div>
      </div>`;
    }
    if (!st.candidates.length) h += `<div class="ticket"><p class="t-meta">No applicants left today. Check back tomorrow morning.</p></div>`;
  }
  return h;
}

function staffStatus(x: Staff): string {
  if (x.status === 'training') return `<span class="chip warn">Training · back in ${plural(x.statusDays, 'day')}</span>`;
  if (x.status === 'sick') return '<span class="chip bad">Off sick today</span>';
  if (!x.task) return '<span class="chip">Idle</span>';
  const label = { order: 'Taking an order', prep: 'Making a pizza', deliver: 'Out delivering', clean: 'Cleaning' }[x.task.kind];
  return `<span class="chip good">${label}</span>`;
}

function staffCard(c: PanelCtx, x: Staff): string {
  const { s } = c;
  const r = ROLES[x.role];
  const market = marketWage(x.role, x.skill);
  const tCost = trainingCost(x.skill);
  const tReq = trainingReq(x.skill);
  const need = xpToNext(x.skill);
  const canTrain = x.skill < 5 && x.status === 'active' && s.level >= tReq;
  const confirming = c.confirmFire === x.id;
  return `<div class="ticket perf">
    <div class="row"><div class="avatar" style="background:${ROLE_COLOR[x.role]}">${esc(initials(x.name))}</div>
      <div class="grow"><div class="t-name">${esc(x.name)}</div><div class="t-meta">${r.name} · skill ${pips(x.skill)}</div></div>
      <div style="text-align:right"><div class="price">${money(x.wage, true)}<span class="t-meta">/hr</span></div><div class="t-meta">market ${money(market, true)}</div></div></div>
    <div class="chips">${staffStatus(x)}${x.traits.map((t) => `<span class="chip ${TRAITS[t].good ? 'good' : 'bad'}" title="${esc(TRAITS[t].desc)}">${TRAITS[t].name}</span>`).join('')}</div>
    <dl class="kv" style="margin:10px 0 0">
      <dt>Morale</dt><dd>${meter(x.morale)} ${Math.round(x.morale)}</dd>
      <dt>Energy</dt><dd>${meter(x.energy)} ${Math.round(x.energy)}</dd>
      <dt>Experience</dt><dd>${x.skill >= 5 ? 'Max skill' : `${meter(x.xp, need, 'gold')} ${Math.floor(x.xp)}/${need}`}</dd>
    </dl>
    <div class="btns">
      ${x.skill < 5 ? `<button class="btn small ${canTrain ? 'gold' : ''}" data-act="train" data-id="${x.id}" ${canTrain ? '' : 'disabled'} title="${s.level < tReq ? 'Unlocks at level ' + tReq : 'Off for a day, returns one skill level higher'}">Train <span class="num">${money(tCost)}</span></button>` : ''}
      <button class="btn small" data-act="wage" data-id="${x.id}" data-d="1" title="Raise $1/hr">${icon('plus', 14)} $1/hr</button>
      <button class="btn small" data-act="wage" data-id="${x.id}" data-d="-1" title="Cut $1/hr">${icon('minus', 14)} $1/hr</button>
      <button class="btn small" data-act="bonus" data-id="${x.id}" ${x.bonusDay === s.day ? 'disabled' : ''}>Bonus $100</button>
      <button class="btn small ${confirming ? 'red' : ''}" data-act="fire" data-id="${x.id}">${confirming ? 'Tap again to confirm' : 'Let go'}</button>
    </div>
  </div>`;
}

// =================================================================== STOCK
export function stockPanel(c: PanelCtx): string {
  const { s, st } = c;
  const sub = c.sub.stock ?? 'order';
  let h = seg('stock', sub, [['order', 'Order supplies'], ['auto', 'Auto-reorder']]);
  const used = storageUsed(st), cap = storageCap(st);
  h += `<div class="ticket"><div class="spread"><span class="t-name">${esc(up(st, 'storage').name)}</span><span class="num">${Math.round(used)} / ${cap} units</span></div>
    <div style="margin-top:6px">${meter(used, cap, used / cap > 0.9 ? 'bad' : used / cap > 0.7 ? 'warn' : 'good').replace('class="meter', 'class="meter wide')}</div>
    <div class="t-meta" style="margin-top:4px">Free space ${Math.max(0, Math.round(cap - used))} units. Bigger storage under Upgrades.</div></div>`;
  if (sub === 'auto') return h + autoPanel(c);

  const need = neededIngredients(s, st);
  const other = INGREDIENTS.map((i) => i.id).filter((id) => !need.includes(id));
  h += `<div class="section-label"><span>Your menu needs</span><span class="row" style="gap:6px"><button class="btn tiny" data-act="cart-suggest">Fill to suggested</button><button class="btn tiny" data-act="cart-clear">Clear</button></span></div>`;
  h += `<div class="ticket" style="padding:0">${need.map((k) => stockRow(c, k)).join('')}</div>`;
  if (other.length) h += `<details class="more"><summary>Other ingredients (${other.length})</summary><div class="ticket" style="padding:0;margin-top:8px">${other.map((k) => stockRow(c, k)).join('')}</div></details>`;
  if (st.incoming.length) {
    const agg: Partial<Record<IngId, number>> = {};
    for (const i of st.incoming) agg[i.ing] = (agg[i.ing] ?? 0) + i.qty;
    h += `<div class="section-label">On the way</div><div class="ticket"><div class="t-meta">${Object.entries(agg).map(([k, q]) => `${q} ${esc(ING[k as IngId].name.toLowerCase())}`).join(', ')}</div></div>`;
  }
  // supplier (collapsed: it is a one-time decision)
  h += `<details class="more" style="margin-top:14px"><summary>Supplier: ${esc(SUPPLIERS[st.supplier].name)} (change)</summary>`;
  h += (Object.keys(SUPPLIERS) as SupplierId[]).map((k) => {
    const sp = SUPPLIERS[k];
    const on = st.supplier === k;
    return `<button class="choice" data-act="supplier" data-v="${k}" aria-pressed="${on}" style="${on ? 'border-color:var(--basil);box-shadow:inset 0 0 0 2px var(--basil)' : ''}">
      <b>${esc(sp.name)} ${on ? '<span class="chip good">Current</span>' : ''}</b>
      <span>Prices ×${sp.priceMult.toFixed(2)} · quality ${sp.quality > 0 ? '+' : ''}${sp.quality}. ${esc(sp.blurb)}</span></button>`;
  }).join('');
  h += `</details>`;

  // cart
  let total = 0, space = 0, lines = 0;
  for (const [k, q] of Object.entries(c.cart) as [IngId, number][]) {
    if (!q) continue;
    total += ingredientPrice(s, st, k) * q;
    space += ING[k].space * q;
    lines++;
  }
  const fits = used + space <= cap + 1e-6;
  const prep = s.phase === 'prep';
  h += `<div class="cart-bar">
    <div class="cart-total">${lines ? `${plural(lines, 'item')} · ${Math.round(space)} units${fits ? '' : ' · <span class="neg">too big for storage</span>'}` : 'Cart is empty'}<b class="num">${money(total, true)}</b></div>
    ${prep
      ? `<button class="btn buy" data-act="order" data-express="0" ${lines && fits ? '' : 'disabled'}>${icon('cart', 16)} Order, arrives now</button>`
      : `<button class="btn buy small" data-act="order" data-express="0" ${lines && fits ? '' : 'disabled'}>Tomorrow AM</button>
         <button class="btn gold small" data-act="order" data-express="1" ${lines && fits ? '' : 'disabled'}>${icon('bolt', 14)} Express 1 hr <span class="num">${money(total * 1.3)}</span></button>`}
  </div>`;
  return h;
}

function stockRow(c: PanelCtx, k: IngId): string {
  const { s, st } = c;
  const d = ING[k];
  const have = stockOf(st, k);
  const exp = expiringSoon(s, st, k);
  const daily = estimateDailyNeed(s, st, k);
  const price = ingredientPrice(s, st, k);
  const trend = s.market[k];
  const q = c.cart[k] ?? 0;
  const low = daily > 0 && have < daily * 0.35;
  const shortage = s.effects.find((e) => e.kind === 'price' && e.ing === k);
  return `<div class="stock-row">
    <span class="swatch" style="background:${d.color}"></span>
    <div class="grow"><div class="t-name" style="font-size:15px">${esc(d.name)} ${low ? '<span class="chip bad">Low</span>' : ''}${shortage ? '<span class="chip warn">Shortage</span>' : ''}</div></div>
    <div class="qty">
      <button data-act="cart" data-k="${k}" data-d="-10" aria-label="Remove 10">−10</button>
      <span class="val">${q}</span>
      <button data-act="cart" data-k="${k}" data-d="10" aria-label="Add 10">+10</button>
      <button class="wide" data-act="cart" data-k="${k}" data-d="50" aria-label="Add 50">+50</button>
    </div>
    <div class="stock-sub"><span>In stock <b class="num">${have}</b>${exp ? ` <span class="neg">(${exp} spoil soon)</span>` : ''}</span><span>Need ~<b class="num">${daily}</b>/day</span><span class="num">${money(price, true)}/${d.unit} ${trend > 1.06 ? '<span class="neg">▲</span>' : trend < 0.94 ? '<span class="pos">▼</span>' : ''}</span><span>Keeps ${d.shelf >= 999 ? 'forever' : plural(d.shelf + (up(st, 'storage').shelfBonus ?? 0), 'day')}</span></div>
  </div>`;
}

function autoPanel(c: PanelCtx): string {
  const { s, st } = c;
  const can = canAutoReorder(st);
  let h = `<div class="ticket"><div class="row"><div class="grow"><div class="t-name">Nightly auto-reorder</div><div class="t-meta">${can ? 'Every night, orders whatever is needed to bring stock back up to your par levels.' : 'Needs Inventory Software (Upgrades, level 5) or a store manager.'}</div></div>
    <button class="toggle" data-act="auto-toggle" aria-pressed="${st.autoReorder && can}" aria-label="Auto-reorder" ${can ? '' : 'disabled'}></button></div></div>`;
  h += `<div class="section-label"><span>Par levels</span><button class="btn tiny" data-act="par-suggest">Use suggested</button></div>`;
  h += `<div class="ticket" style="padding:4px 0">`;
  for (const k of neededIngredients(s, st)) {
    const par = st.par[k] ?? 0;
    h += `<div class="stock-row"><span class="swatch" style="background:${ING[k].color}"></span><div class="grow"><div class="t-name" style="font-size:15px">${esc(ING[k].name)}</div></div>
      <div class="stepper"><button data-act="par" data-k="${k}" data-d="-10" aria-label="Lower">${icon('minus', 14)}</button><span class="val">${par}</span><button data-act="par" data-k="${k}" data-d="10" aria-label="Raise">${icon('plus', 14)}</button></div>
      <div class="stock-sub">In stock ${stockOf(st, k)} · suggested ${Math.ceil(estimateDailyNeed(s, st, k) * 1.1 / 5) * 5}</div></div>`;
  }
  return h + '</div>';
}

// =================================================================== MENU
export function menuPanel(c: PanelCtx): string {
  const { s, st } = c;
  let h = `<p class="hint">Set prices against what customers think is fair. Cheaper pulls more people in; pricier earns more per pizza but annoys them.</p>`;
  for (const m of MENU.filter((m) => s.unlocked.includes(m.id))) {
    const it = st.menu[m.id];
    const price = salePrice(st, m.id);
    const cost = itemFoodCost(s, st, m.id) + (m.type === 'drink' ? 0 : ingredientPrice(s, st, 'box') * 0.5);
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
    const pw = priceWeight(st, m.id);
    const verdict = pw > 1.25 ? ['Bargain', 'good'] : pw > 0.88 ? ['Fair', 'good'] : pw > 0.6 ? ['Pricey', 'warn'] : ['Too expensive', 'bad'];
    const sold = st.today.sold[m.id] ?? 0;
    const missing = (Object.entries(m.recipe) as [IngId, number][]).filter(([k, q]) => stockOf(st, k) < q).map(([k]) => ING[k].name);
    h += `<div class="ticket perf ${it.on ? '' : 'dim'}">
      <div class="row"><div class="grow"><div class="t-name">${esc(m.name)} <span class="chip">${m.type}</span></div><div class="t-desc">${esc(m.desc)}</div></div>
        <button class="toggle" data-act="menu-toggle" data-id="${m.id}" aria-pressed="${it.on}" aria-label="On the menu"></button></div>
      <div class="row wrap" style="margin-top:10px">
        <div class="stepper"><button data-act="price" data-id="${m.id}" data-d="-0.5" aria-label="Lower price">${icon('minus', 14)}</button><span class="val">${money(it.price, true)}</span><button data-act="price" data-id="${m.id}" data-d="0.5" aria-label="Raise price">${icon('plus', 14)}</button></div>
        <span class="chip ${verdict[1]}">${verdict[0]}</span>
        <span class="t-meta">fair ${money(m.fair, true)}</span>
      </div>
      <dl class="kv" style="margin-top:8px"><dt>Food cost</dt><dd>${money(cost, true)}</dd><dt>Margin</dt><dd class="${margin < 55 ? 'neg' : ''}">${margin.toFixed(0)}%</dd><dt>Sold today</dt><dd>${sold}</dd></dl>
      ${missing.length && it.on ? `<div class="chips"><span class="chip bad">Out of ${esc(missing.join(', '))}</span></div>` : ''}
    </div>`;
  }
  const locked = MENU.filter((m) => !s.unlocked.includes(m.id));
  if (locked.length) {
    h += `<div class="section-label">New recipes</div>`;
    for (const m of locked) {
      const ok = s.level >= m.unlockLevel;
      h += `<div class="ticket ${ok ? '' : 'dim'}"><div class="row"><div class="grow"><div class="t-name">${esc(m.name)}</div><div class="t-desc">${esc(m.desc)} Sells for about ${money(m.fair)}.</div>
        <div class="chips">${(Object.keys(m.recipe) as IngId[]).map((k) => `<span class="chip"><span class="swatch" style="background:${ING[k].color};width:8px;height:8px"></span>${esc(ING[k].name)}</span>`).join('')}</div></div></div>
        <div class="btns">${ok ? `<button class="btn buy small" data-act="unlock" data-id="${m.id}">Unlock <span class="num">${money(m.unlockCost)}</span></button>` : lockChip(m.unlockLevel)}</div></div>`;
    }
  }
  return h;
}

// =================================================================== UPGRADES
export function upgradesPanel(c: PanelCtx): string {
  const { s, st } = c;
  const sale = s.effects.find((e) => e.kind === 'upgradeSale');
  let h = sale ? `<div class="ticket"><span class="chip good">${icon('bolt', 12)} Supply sale: 20% off everything today</span></div>` : '';
  const groups = ['Kitchen', 'Front of house', 'Growth', 'Back office'] as const;
  for (const g of groups) {
    h += `<div class="section-label">${g}</div>`;
    for (const u of UPGRADES.filter((x) => x.group === g)) {
      const lv = st.upgrades[u.id];
      const cur = u.levels[lv];
      const next = u.levels[lv + 1];
      const cost = upgradeCost(s, st, u.id);
      const needs = u.needs && st.upgrades[u.needs] < 1;
      const focus = c.focusUpgrade === u.id;
      h += `<div class="ticket perf" id="up-${u.id}" style="${focus ? 'box-shadow:0 0 0 3px var(--crust),0 2px 6px rgba(70,40,15,0.12)' : ''}">
        <div class="row"><div class="grow"><div class="t-name">${esc(u.name)}</div><div class="t-meta">Now: ${esc(cur.name)} · ${esc(cur.desc)}</div></div>
        <span class="num t-meta" aria-label="level ${lv} of ${u.levels.length - 1}">${'■'.repeat(lv)}${'□'.repeat(u.levels.length - 1 - lv)}</span></div>
        ${next ? `<div class="row" style="margin-top:9px;align-items:flex-end"><div class="grow"><div style="font-weight:700">Next: ${esc(next.name)}</div><div class="t-desc">${esc(next.desc)}</div></div>
          ${needs ? `<span class="chip warn">Needs ${esc(UPG[u.needs!].name)}</span>` : s.level < next.req ? lockChip(next.req) : `<button class="btn buy small" data-act="upgrade" data-id="${u.id}" ${s.cash >= (cost ?? 0) ? '' : 'disabled'}>Buy <span class="num">${money(cost ?? 0)}</span></button>`}</div>` : '<div class="chips"><span class="chip good">Fully upgraded</span></div>'}
      </div>`;
    }
  }
  return h;
}

// =================================================================== MARKETING
export function marketingPanel(c: PanelCtx): string {
  const { s, st } = c;
  const boost = marketingBoost(st);
  let h = `<div class="tiles"><div class="tile"><div class="hud-label">Marketing boost</div><div class="v">+${Math.round(boost * 100)}%</div><div class="d">on top of normal traffic</div></div>
    <div class="tile"><div class="hud-label">Customers right now</div><div class="v">${s.phase === 'open' ? walkInRate(s, st).toFixed(0) : '—'}</div><div class="d">walk-ins per hour</div></div></div>`;
  if (st.campaigns.length) {
    h += `<div class="section-label">Running here</div>`;
    for (const r of st.campaigns) {
      const d = CAMPAIGNS.find((x) => x.id === r.id)!;
      h += `<div class="ticket"><div class="spread"><span class="t-name">${esc(d.name)}</span><span class="chip good">${plural(r.daysLeft, 'day')} left</span></div><div class="t-desc">${esc(d.desc)}</div></div>`;
    }
  }
  const fx = s.effects.filter((e) => e.storeId === null || e.storeId === st.id);
  if (fx.length) {
    h += `<div class="section-label">In effect today</div><div class="ticket">${fx.map((e) => `<div class="spread"><span>${esc(e.label)}</span><span class="chip ${e.mult >= 1 && e.kind !== 'price' ? 'good' : 'bad'}">${e.kind === 'price' ? `${ING[e.ing!].name} ×${e.mult}` : e.kind === 'upgradeSale' ? '20% off upgrades' : (e.mult >= 1 ? '+' : '') + Math.round((e.mult - 1) * 100) + '% traffic'}</span></div>`).join('')}</div>`;
  }
  h += `<div class="section-label">Campaigns for ${esc(loc(st).name)}</div>`;
  for (const d of CAMPAIGNS) {
    const running = st.campaigns.some((x) => x.id === d.id);
    h += `<div class="ticket ${s.level < d.req ? 'dim' : ''}"><div class="row"><div class="grow"><div class="t-name">${esc(d.name)}</div><div class="t-desc">${esc(d.desc)}</div></div>
      ${running ? '<span class="chip good">Running</span>' : s.level < d.req ? lockChip(d.req) : `<button class="btn buy small" data-act="campaign" data-id="${d.id}" ${s.cash >= d.cost ? '' : 'disabled'}>${d.cost ? 'Run <span class="num">' + money(d.cost) + '</span>' : 'Run (free)'}</button>`}</div></div>`;
  }
  h += `<div class="section-label">Brand-wide</div><div class="ticket ${s.level < LOYALTY.req ? 'dim' : ''}"><div class="row"><div class="grow"><div class="t-name">Loyalty Card Program</div><div class="t-desc">+${Math.round(LOYALTY.boost * 100)}% customers at every store, forever. ${money(LOYALTY.dailyFee)}/day per store to run.</div></div>
    ${s.loyalty ? '<span class="chip good">Active</span>' : s.level < LOYALTY.req ? lockChip(LOYALTY.req) : `<button class="btn buy small" data-act="loyalty" ${s.cash >= LOYALTY.cost ? '' : 'disabled'}>Launch <span class="num">${money(LOYALTY.cost)}</span></button>`}</div></div>`;
  return h;
}

// =================================================================== FINANCE
export function financePanel(c: PanelCtx): string {
  const { s, st } = c;
  const sub = c.sub.finance ?? 'books';
  let h = seg('finance', sub, [['books', 'Books'], ['reviews', 'Reviews'], ['bank', 'Bank']]);
  if (sub === 'reviews') {
    h += `<div class="tiles"><div class="tile"><div class="hud-label">Rating</div><div class="v">${st.rating.toFixed(2)}</div><div class="d">${stars(st.rating)}</div></div>
      <div class="tile"><div class="hud-label">Cleanliness</div><div class="v">${Math.round(st.cleanliness)}%</div><div class="d">${meter(st.cleanliness)}</div></div></div>
      <p class="hint">Ratings move with every customer: quality, wait time, price, cleanliness and decor all count. Customers who give up and leave drag it down.</p>`;
    h += `<div class="ticket">${st.reviews.length ? st.reviews.slice(0, 25).map((r) => `<div class="review"><div class="spread"><b>${esc(r.name)}</b>${stars(r.stars, 13)}</div><q>${esc(r.text)}</q><div class="t-meta">Day ${r.day}${r.critic ? ' · <span class="chip ink">Critic</span>' : ''}</div></div>`).join('') : '<p class="t-meta">No reviews yet. They roll in as you serve customers.</p>'}</div>`;
    return h;
  }
  if (sub === 'bank') {
    if (s.loan) {
      h += `<div class="ticket perf"><div class="t-name">Current loan</div><dl class="kv" style="margin-top:6px"><dt>Borrowed</dt><dd>${money(s.loan.principal)}</dd><dt>Left to repay</dt><dd>${money(s.loan.remaining, true)}</dd><dt>Daily payment</dt><dd>${money(s.loan.daily, true)}</dd><dt>Days left</dt><dd>${s.loan.daysLeft}</dd></dl>
        <div class="btns"><button class="btn buy small" data-act="repay" ${s.cash >= s.loan.remaining ? '' : 'disabled'}>Repay now <span class="num">${money(s.loan.remaining)}</span></button></div></div>`;
    }
    h += `<p class="hint">Loans cost ${Math.round(LOAN_INTEREST * 100)}% flat, repaid automatically over ${LOAN_DAYS} days. Three days in the red and the bank closes you down.</p>`;
    for (const l of LOANS) {
      const daily = (l.amount * (1 + LOAN_INTEREST)) / LOAN_DAYS;
      h += `<div class="ticket ${s.level < l.req ? 'dim' : ''}"><div class="row"><div class="grow"><div class="t-name num" style="font-size:20px">${money(l.amount)}</div><div class="t-meta">${money(daily, true)}/day for ${LOAN_DAYS} days</div></div>
        ${s.level < l.req ? lockChip(l.req) : `<button class="btn small" data-act="loan" data-v="${l.amount}" ${s.loan ? 'disabled' : ''}>Borrow</button>`}</div></div>`;
    }
    return h;
  }
  // books
  const all = (k: keyof Store['today']) => s.stores.reduce((a, x) => a + (x.today[k] as number), 0);
  const rev = all('revenue');
  const costs = all('supplies') + all('wages') + all('rent') + all('marketing') + all('other');
  const hist = companyHistory(s, 14);
  const y = hist[hist.length - 1];
  h += `<div class="tiles">
    <div class="tile"><div class="hud-label">Sales today</div><div class="v">${compactMoney(rev)}</div><div class="d">${all('served')} served · ${all('lost')} lost</div></div>
    <div class="tile"><div class="hud-label">Spent today</div><div class="v">${compactMoney(costs)}</div><div class="d">wages & rent post at close</div></div>
    <div class="tile"><div class="hud-label">Yesterday</div><div class="v ${y && y.profit < 0 ? 'neg' : ''}">${y ? compactMoney(y.profit) : '—'}</div><div class="d">profit after all costs</div></div>
  </div>`;
  h += `<div class="section-label">Daily profit, last ${hist.length || 14} days</div>`;
  h += hist.length ? profitChart(hist) : `<div class="ticket"><p class="t-meta">Finish your first day to see the chart.</p></div>`;
  if (y) {
    const store = st.history[st.history.length - 1];
    if (store) {
      h += `<div class="section-label">Yesterday at ${esc(loc(st).name)}</div><div class="ticket"><dl class="kv">
        <dt>Sales</dt><dd class="pos">${money(store.revenue)}</dd>
        <dt>Supplies</dt><dd>${cost(store.supplies)}</dd>
        <dt>Wages</dt><dd>${cost(store.wages)}</dd>
        <dt>Rent</dt><dd>${cost(store.rent)}</dd>
        <dt>Marketing</dt><dd>${cost(store.marketing)}</dd>
        <dt>Other (training, fines, bonuses)</dt><dd>${cost(store.other)}</dd>
        ${store.loan ? `<dt>Loan</dt><dd>${cost(store.loan)}</dd>` : ''}
        <dt>Equipment (investment)</dt><dd>${cost(store.equipment)}</dd>
        <dt>Spoiled stock</dt><dd>${money(store.waste)}</dd>
      </dl></div>`;
    }
  }
  return h;
}

const cost = (v: number) => (v > 0.005 ? '−' + money(v) : '$0');

export interface DayPoint { day: number; revenue: number; costs: number; profit: number }
export function companyHistory(s: GameState, n: number): DayPoint[] {
  const days = new Map<number, DayPoint>();
  for (const st of s.stores) for (const d of st.history) {
    const p = days.get(d.day) ?? { day: d.day, revenue: 0, costs: 0, profit: 0 };
    const c = d.supplies + d.wages + d.rent + d.marketing + d.other + d.loan;
    p.revenue += d.revenue;
    p.costs += c;
    p.profit += d.revenue - c;
    days.set(d.day, p);
  }
  return [...days.values()].sort((a, b) => a.day - b.day).slice(-n);
}

function niceStep(range: number) {
  const raw = range / 4;
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function profitChart(pts: DayPoint[]): string {
  const W = 400, H = 170, L = 44, R = 6, Tp = 8, B = 22;
  const max = Math.max(0, ...pts.map((p) => p.profit));
  const min = Math.min(0, ...pts.map((p) => p.profit));
  const step = niceStep(max - min || 100);
  const top = Math.ceil(max / step) * step || step;
  const bot = Math.floor(min / step) * step;
  const y = (v: number) => Tp + ((top - v) / (top - bot)) * (H - Tp - B);
  const slot = (W - L - R) / Math.max(pts.length, 7);
  const bw = Math.max(4, slot - 2);
  let g = '';
  for (let v = bot; v <= top + 1e-6; v += step) {
    g += `<line class="${v === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    g += `<text class="ax" x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${compactMoney(v).replace('$', '$')}</text>`;
  }
  let bars = '';
  pts.forEach((p, i) => {
    const x = L + i * slot + 1;
    const y0 = y(0), y1 = y(p.profit);
    const hgt = Math.max(1, Math.abs(y1 - y0));
    const pos = p.profit >= 0;
    const r = Math.min(4, hgt, bw / 2);
    const yTop = pos ? y1 : y0;
    // rounded data end, square at the baseline
    const d = pos
      ? `M${x},${y0} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${y0} Z`
      : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 - r} V${y0} Z`;
    bars += `<path d="${d}" fill="${pos ? '#2f7a3b' : '#c8352a'}"/>`;
    bars += `<rect class="hit" x="${L + i * slot}" y="${Tp}" width="${slot}" height="${H - Tp - B}" fill="transparent" data-i="${i}"/>`;
    if (i === 0 || i === pts.length - 1 || pts.length <= 7 || i % 3 === 0) bars += `<text class="ax" x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">D${p.day}</text>`;
  });
  const data = esc(JSON.stringify(pts.map((p) => [p.day, Math.round(p.revenue), Math.round(p.costs), Math.round(p.profit)])));
  return `<div class="chart" data-chart="${data}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily profit bar chart">${g}${bars}</svg>
    <details class="more"><summary>Show as table</summary><div class="table-wrap"><table class="chart-table"><thead><tr><th>Day</th><th>Sales</th><th>Costs</th><th>Profit</th></tr></thead><tbody>
    ${pts.slice().reverse().map((p) => `<tr><td>Day ${p.day}</td><td>${money(p.revenue)}</td><td>${money(p.costs)}</td><td class="${p.profit < 0 ? 'neg' : 'pos'}">${money(p.profit)}</td></tr>`).join('')}</tbody></table></div></details></div>`;
}

// =================================================================== EMPIRE
export function empirePanel(c: PanelCtx): string {
  const { s, st } = c;
  let h = `<div class="section-label">Your stores</div>`;
  for (const x of s.stores) {
    const L = LOC[x.locationId];
    const here = x === st;
    h += `<div class="ticket perf"><div class="row"><div class="grow"><div class="t-name">${esc(L.name)} ${here ? '<span class="chip ink">Viewing</span>' : ''}</div><div class="t-meta">${esc(L.district)} · rent ${money(L.rent)}/day</div></div>${stars(x.rating)}</div>
      <dl class="kv" style="margin-top:8px"><dt>Sales today</dt><dd>${money(x.today.revenue)}</dd><dt>Served / lost</dt><dd>${x.today.served} / ${x.today.lost}</dd><dt>Staff</dt><dd>${x.staff.length} (${activeStaff(x).length} on shift)</dd><dt>Line right now</dt><dd>${x.customers.filter((q) => q.state === 'queue').length}</dd></dl>
      ${here ? '' : `<div class="btns"><button class="btn small" data-act="goto-store" data-id="${x.id}">${icon('camera', 14)} Go to store</button></div>`}</div>`;
  }
  const avail = LOCATIONS.filter((L) => !s.stores.some((x) => x.locationId === L.id));
  if (avail.length) {
    h += `<div class="section-label">Locations for sale</div>`;
    for (const L of avail) {
      const ok = s.level >= L.reqLevel;
      const sens = L.priceSens >= 1.3 ? 'very price sensitive' : L.priceSens >= 0.9 ? 'price aware' : L.priceSens >= 0.5 ? 'happy to pay more' : 'price is no object';
      h += `<div class="ticket ${ok ? '' : 'dim'}"><div class="row"><div class="grow"><div class="t-name">${esc(L.name)}</div><div class="t-meta">${esc(L.district)}</div></div><div class="price">${money(L.cost)}</div></div>
        <div class="t-desc">${esc(L.blurb)}</div>
        <div class="chips"><span class="chip">${Math.round((L.traffic / 9) * 100)}% of Maple St traffic</span><span class="chip">${sens}</span><span class="chip">${L.deliveryShare ? Math.round(L.deliveryShare * 100) + '% delivery demand' : 'no delivery'}</span><span class="chip">rent ${money(L.rent)}/day</span></div>
        <div class="btns">${ok ? `<button class="btn buy small" data-act="buy-location" data-id="${L.id}" ${s.cash >= L.cost ? '' : 'disabled'}>Buy location</button>` : lockChip(L.reqLevel)}</div></div>`;
    }
  }
  h += `<div class="section-label">Activity</div><div class="ticket">${s.news.slice(0, 18).map((n) => `<div class="review"><span class="t-meta">D${n.day} ${n.minute >= 600 ? clock(n.minute) : ''}</span> <span class="${n.tone === 'bad' ? 'neg' : n.tone === 'good' ? 'pos' : ''}">${esc(n.text)}</span></div>`).join('') || '<p class="t-meta">Nothing yet.</p>'}</div>`;
  return h;
}

// =================================================================== GOALS
export function goalsPanel(c: PanelCtx): string {
  const { s } = c;
  const cur = xpForLevel(s.level), next = xpForLevel(s.level + 1);
  let h = `<div class="ticket perf"><div class="spread"><span class="t-name">Level ${s.level}</span><span class="num t-meta">${Math.floor(s.xp - cur)} / ${next - cur} XP</span></div>
    <div style="margin-top:6px">${meter(s.xp - cur, next - cur, 'gold').replace('class="meter', 'class="meter wide')}</div>
    <div class="t-meta" style="margin-top:6px">Every satisfied customer earns XP. Next level unlocks: ${esc(unlocksAt(s.level + 1).join(', ') || 'more prestige')}.</div></div>`;
  h += `<div class="section-label"><span>Goals</span><span class="t-meta">${s.goalsDone.length} / ${GOALS.length} done</span></div>`;
  for (const g of activeGoals(s, 3)) {
    const p = g.progress(s);
    const pct = Math.min(1, p.cur / p.target);
    h += `<div class="ticket"><div class="row"><div class="grow"><div class="t-name">${esc(g.title)}</div><div class="t-desc">${esc(g.hint)}</div></div><span class="chip good">+${money(g.reward)}</span></div>
      <div class="row" style="margin-top:8px"><div class="grow">${meter(pct, 1, 'gold').replace('class="meter', 'class="meter wide')}</div><span class="num t-meta">${p.target === 1 ? (pct >= 1 ? 'Done' : 'Not yet') : `${typeof p.cur === 'number' && p.cur % 1 ? p.cur.toFixed(1) : Math.floor(p.cur).toLocaleString()} / ${p.target.toLocaleString()}`}</span></div></div>`;
  }
  if (!activeGoals(s, 1).length) h += `<div class="ticket"><p class="t-name">Every goal complete. You are a pizza legend.</p></div>`;
  h += `<div class="section-label">Career</div><div class="ticket"><dl class="kv">
    <dt>Days in business</dt><dd>${s.stats.daysCompleted}</dd>
    <dt>Customers served</dt><dd>${s.stats.served.toLocaleString()}</dd>
    <dt>Customers lost</dt><dd>${s.stats.lost.toLocaleString()}</dd>
    <dt>Lifetime sales</dt><dd>${money(s.stats.revenue)}</dd>
    <dt>Best day (sales)</dt><dd>${money(s.stats.bestDayRevenue)}</dd>
    <dt>Best day (profit)</dt><dd>${money(s.stats.bestDayProfit)}</dd>
    <dt>Deliveries</dt><dd>${s.stats.deliveries.toLocaleString()}</dd>
  </dl></div>`;
  return h;
}

export function renderPanel(tab: TabId, c: PanelCtx): string {
  switch (tab) {
    case 'staff': return staffPanel(c);
    case 'stock': return stockPanel(c);
    case 'menu': return menuPanel(c);
    case 'upgrades': return upgradesPanel(c);
    case 'marketing': return marketingPanel(c);
    case 'finance': return financePanel(c);
    case 'empire': return empirePanel(c);
    case 'goals': return goalsPanel(c);
  }
}

export function panelTitle(tab: TabId, s: GameState, st: Store): { title: string; sub: string } {
  const where = s.stores.length > 1 ? loc(st).name : '';
  switch (tab) {
    case 'staff': return { title: 'Staff', sub: where || 'Hire, train and keep your team happy' };
    case 'stock': return { title: 'Stock', sub: where || 'Keep the walk-in full' };
    case 'menu': return { title: 'Menu & Prices', sub: where || 'What you sell and for how much' };
    case 'upgrades': return { title: 'Upgrades', sub: where || 'Equipment and improvements' };
    case 'marketing': return { title: 'Marketing', sub: where || 'Bring more customers in' };
    case 'finance': return { title: 'Finance', sub: 'Books, reviews and the bank' };
    case 'empire': return { title: 'Empire', sub: `${plural(s.stores.length, 'store')}` };
    case 'goals': return { title: 'Goals', sub: `Level ${s.level}` };
  }
}

export { TRAITS, ITEM, type ItemId };
