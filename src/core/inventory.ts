// Stock: consumption (first-expiring first), deliveries, spoilage, auto-reorder.
import { ING, INGREDIENTS, ITEM, type IngId, type ItemId } from '../data/catalog';
import { LOC, HOUR_CURVES, DAY_TRAFFIC } from '../data/world';
import type { GameState, Store } from './types';
import { canAutoReorder, hasManager, shelfDays, stockOf, storageCap, storageUsed, avgUsage } from './state';
import { ingredientPrice } from './economy';
import { now } from './util';

export function consume(st: Store, ing: IngId, qty: number): boolean {
  if (stockOf(st, ing) < qty) return false;
  const batches = st.inventory[ing].sort((a, b) => a.exp - b.exp);
  let need = qty;
  for (const b of batches) {
    const take = Math.min(b.qty, need);
    b.qty -= take;
    need -= take;
    if (need <= 0) break;
  }
  st.inventory[ing] = batches.filter((b) => b.qty > 0);
  const u = st.usage[st.usage.length - 1];
  if (u) u[ing] = (u[ing] ?? 0) + qty;
  return true;
}

/** Consume everything an item needs. Caller must check availability first. */
export function consumeItem(s: GameState, st: Store, id: ItemId, boxed: boolean): number {
  let cost = 0;
  for (const [k, q] of Object.entries(ITEM[id].recipe) as [IngId, number][]) {
    consume(st, k, q);
    cost += ingredientPrice(s, st, k) * q;
  }
  if (boxed && ITEM[id].type !== 'drink') {
    consume(st, 'box', 1);
    cost += ingredientPrice(s, st, 'box');
  }
  return cost;
}

export function addStock(s: GameState, st: Store, ing: IngId, qty: number) {
  if (qty <= 0) return;
  const exp = s.day + shelfDays(st, ing) - 1 + (s.phase === 'prep' ? 0 : 0);
  const same = st.inventory[ing].find((b) => b.exp === exp);
  if (same) same.qty += qty;
  else st.inventory[ing].push({ qty, exp });
}

export interface OrderResult {
  ok: boolean;
  cost: number;
  reason?: string;
}

/** Place a supply order. During prep it arrives immediately; while open it arrives next morning, or in 1h if express. */
export function placeSupplyOrder(s: GameState, st: Store, lines: Partial<Record<IngId, number>>, express: boolean): OrderResult {
  let cost = 0, space = 0;
  for (const [k, q] of Object.entries(lines) as [IngId, number][]) {
    if (!q || q <= 0) continue;
    cost += ingredientPrice(s, st, k) * q * (express ? 1.3 : 1);
    space += ING[k].space * q;
  }
  if (cost <= 0) return { ok: false, cost: 0, reason: 'Nothing in the cart.' };
  if (storageUsed(st) + space > storageCap(st) + 1e-6) return { ok: false, cost, reason: 'Not enough storage space.' };
  if (s.cash < cost) return { ok: false, cost, reason: 'Not enough cash.' };
  s.cash -= cost;
  st.today.supplies += cost;
  for (const [k, q] of Object.entries(lines) as [IngId, number][]) {
    if (!q || q <= 0) continue;
    if (s.phase === 'prep') addStock(s, st, k, q);
    else st.incoming.push({ ing: k, qty: q, at: express ? now(s) + 60 : -1 });
  }
  s.stats.ordersPlaced++;
  return { ok: true, cost };
}

/** Deliver anything due. morning=true delivers next-morning orders too. */
export function receiveDeliveries(s: GameState, st: Store, morning: boolean) {
  const t = now(s);
  const keep = [];
  let got = false;
  for (const inc of st.incoming) {
    if ((morning && inc.at < 0) || (inc.at >= 0 && inc.at <= t)) {
      addStock(s, st, inc.ing, inc.qty);
      got = true;
    } else keep.push(inc);
  }
  st.incoming = keep;
  return got;
}

/** Remove expired batches at the end of a day. Returns wasted value. */
export function spoil(s: GameState, st: Store): number {
  let waste = 0;
  const mgr = hasManager(st);
  for (const i of INGREDIENTS) {
    const keep = [];
    for (const b of st.inventory[i.id]) {
      if (b.exp <= s.day) {
        // a manager rescues some product (staff meals, specials)
        const lost = mgr ? Math.ceil(b.qty * 0.7) : b.qty;
        waste += lost * i.cost;
      } else keep.push(b);
    }
    st.inventory[i.id] = keep;
  }
  return waste;
}

/** Suggested par level: ~1.3 days of recent usage. */
export function suggestedPar(st: Store, ing: IngId) {
  const u = avgUsage(st, ing);
  return Math.ceil(u * 1.3 / 5) * 5;
}

/** Nightly auto-reorder to par for the next morning. */
export function autoReorder(s: GameState, st: Store): number {
  if (!st.autoReorder || !canAutoReorder(st)) return 0;
  const lines: Partial<Record<IngId, number>> = {};
  for (const i of INGREDIENTS) {
    const par = st.par[i.id] ?? 0;
    if (par <= 0) continue;
    // stock that will still be good tomorrow
    let usable = 0;
    for (const b of st.inventory[i.id]) if (b.exp > s.day) usable += b.qty;
    for (const inc of st.incoming) if (inc.ing === i.id) usable += inc.qty;
    const need = par - usable;
    if (need > 0) lines[i.id] = Math.ceil(need);
  }
  if (!Object.keys(lines).length) return 0;
  // fit to storage and cash
  let free = storageCap(st) - storageUsed(st);
  const fitted: Partial<Record<IngId, number>> = {};
  for (const [k, q] of Object.entries(lines) as [IngId, number][]) {
    const fit = Math.min(q, Math.floor(free / ING[k].space));
    if (fit > 0) {
      fitted[k] = fit;
      free -= fit * ING[k].space;
    }
  }
  let cost = 0;
  for (const [k, q] of Object.entries(fitted) as [IngId, number][]) cost += ingredientPrice(s, st, k) * q;
  if (cost <= 0 || s.cash < cost) return 0;
  s.cash -= cost;
  st.today.supplies += cost;
  for (const [k, q] of Object.entries(fitted) as [IngId, number][]) st.incoming.push({ ing: k, qty: q, at: -1 });
  return cost;
}

export function expiringSoon(s: GameState, st: Store, ing: IngId) {
  let n = 0;
  for (const b of st.inventory[ing]) if (b.exp <= s.day + 1) n += b.qty;
  return n;
}

/** Ingredients used by anything currently on the menu (plus boxes). */
export function neededIngredients(s: GameState, st: Store): IngId[] {
  const need = new Set<IngId>();
  for (const m of Object.values(ITEM)) {
    if (!s.unlocked.includes(m.id) || !st.menu[m.id].on) continue;
    for (const k of Object.keys(m.recipe)) need.add(k as IngId);
  }
  if (need.size) need.add('box');
  return INGREDIENTS.map((i) => i.id).filter((id) => need.has(id));
}

/** Estimated units of an ingredient needed for one full day of demand. */
export function estimateDailyNeed(s: GameState, st: Store, ing: IngId): number {
  const hist = st.history.slice(-3);
  const usage = avgUsage(st, ing);
  if (hist.length && usage > 0) {
    let served = 0, lost = 0;
    for (const h of hist) {
      served += h.served;
      lost += h.soldOut + h.lost * 0.35;
    }
    const demandFactor = Math.min(1.7, served ? (served + lost) / served : 1);
    return Math.ceil(usage * demandFactor * 1.15);
  }
  // first days: estimate from location traffic and the menu mix
  const loc = LOC[st.locationId];
  const curve = HOUR_CURVES[loc.curve].reduce((a, b) => a + b, 0);
  const dow = DAY_TRAFFIC[(s.phase === 'prep' ? s.day - 1 : s.day) % 7];
  const orders = loc.traffic * curve * (0.35 + 0.28 * st.rating) * dow * 1.05;
  const pizzas = Object.values(ITEM).filter((m) => m.type === 'pizza' && s.unlocked.includes(m.id) && st.menu[m.id].on);
  const appeal = pizzas.reduce((a, m) => a + m.appeal, 0) || 1;
  let n = 0;
  for (const m of pizzas) n += (m.appeal / appeal) * (m.recipe[ing] ?? 0) * orders * 1.3;
  if (ing === 'box') n = orders * 1.3 * 0.5;
  if (ing === 'soda') n = orders * 0.45;
  if (ing === 'dough' || ing === 'garlic') if (s.unlocked.includes('knots') && st.menu.knots.on) n += orders * 0.28;
  return Math.ceil(n);
}

/** Cart that tops stock up to tomorrow's estimated need, trimmed to fit storage. */
export function suggestOrder(s: GameState, st: Store): Partial<Record<IngId, number>> {
  const lines: Partial<Record<IngId, number>> = {};
  let space = 0;
  for (const k of neededIngredients(s, st)) {
    let usable = 0;
    for (const b of st.inventory[k]) if (b.exp > s.day || s.phase === 'prep') usable += b.qty;
    for (const inc of st.incoming) if (inc.ing === k) usable += inc.qty;
    const want = estimateDailyNeed(s, st, k) - usable;
    if (want > 0) {
      lines[k] = Math.ceil(want / 5) * 5;
      space += lines[k]! * ING[k].space;
    }
  }
  const free = storageCap(st) - storageUsed(st);
  if (space > free && space > 0) {
    const f = Math.max(0, free / space);
    for (const k of Object.keys(lines) as IngId[]) lines[k] = Math.floor(lines[k]! * f);
  }
  for (const k of Object.keys(lines) as IngId[]) if (!lines[k]) delete lines[k];
  return lines;
}
