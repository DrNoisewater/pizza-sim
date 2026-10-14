// Demand, pricing, quality and satisfaction formulas.
import { ING, ITEM, MENU, SUPPLIERS, ingredientCost, type IngId, type ItemId } from '../data/catalog';
import { CAMPAIGN, DAY_TRAFFIC, HOUR_CURVES, LOYALTY, OPEN_MIN, WEATHER } from '../data/world';
import type { GameState, Order, Store } from './types';
import { DIFFICULTY, loc, onMenu, up } from './state';
import { clamp, gauss, rand } from './util';

/** Effective sale price (coupon days discount everything). */
export function salePrice(st: Store, id: ItemId) {
  let p = st.menu[id].price;
  for (const c of st.campaigns) {
    const m = CAMPAIGN[c.id].priceMult;
    if (m) p *= m;
  }
  return Math.round(p * 100) / 100;
}

/** How attractive an item's price is: 1 at the fair price, lower when expensive. */
export function priceWeight(st: Store, id: ItemId) {
  const ratio = salePrice(st, id) / ITEM[id].fair;
  const sens = loc(st).priceSens;
  return clamp(Math.exp(-2.4 * (ratio - 1) * sens), 0.15, 1.8);
}

export function ingredientPrice(s: GameState, st: Store, ing: IngId) {
  let m = s.market[ing] * SUPPLIERS[st.supplier].priceMult;
  for (const e of s.effects) if (e.kind === 'price' && e.ing === ing) m *= e.mult;
  return ING[ing].cost * m;
}

export function itemFoodCost(s: GameState, st: Store, id: ItemId) {
  return ingredientCost(ITEM[id], (k) => ingredientPrice(s, st, k) / ING[k].cost);
}

export function marketingBoost(st: Store) {
  let b = 0;
  for (const c of st.campaigns) b += CAMPAIGN[c.id].boost;
  return Math.min(1.3, b);
}
export function deliveryMarketing(st: Store) {
  let b = 0;
  for (const c of st.campaigns) b += CAMPAIGN[c.id].deliveryBoost ?? 0;
  return b;
}

export function ratingFactor(r: number) {
  return 0.35 + 0.28 * r;
}

/** Combined effect of menu prices and variety on traffic. */
export function menuFactor(s: GameState, st: Store) {
  let wSum = 0, pw = 0, pizzas = 0;
  for (const m of MENU) {
    if (m.type !== 'pizza' || !onMenu(s, st, m.id)) continue;
    pizzas++;
    wSum += m.appeal;
    pw += m.appeal * priceWeight(st, m.id);
  }
  if (!pizzas) return 0;
  const price = clamp(Math.pow(pw / wSum, 0.6), 0.45, 1.35);
  const variety = Math.min(1.25, 0.85 + 0.06 * pizzas);
  return price * variety;
}

export function effectMult(s: GameState, st: Store, kind: 'traffic' | 'dinner') {
  let m = 1;
  for (const e of s.effects) if (e.kind === kind && (e.storeId === null || e.storeId === st.id)) m *= e.mult;
  return m;
}

/** Walk-in customers per hour right now. */
export function walkInRate(s: GameState, st: Store) {
  const L = loc(st);
  const hourIdx = Math.floor((s.minute - OPEN_MIN) / 60);
  if (hourIdx < 0 || hourIdx > 11) return 0;
  const curve = HOUR_CURVES[L.curve][hourIdx];
  const dow = (s.day - 1) % 7;
  let dayMult = DAY_TRAFFIC[dow];
  if (dow >= 4) dayMult *= L.weekendBoost;
  const w = WEATHER[s.weather].walk;
  const weather = 1 + (w - 1) * L.weatherSens;
  let r = L.traffic * curve * dayMult * weather * ratingFactor(st.rating);
  r *= 1 + marketingBoost(st) + (up(st, 'sign').traffic ?? 0) + (s.loyalty ? LOYALTY.boost : 0);
  r *= menuFactor(s, st);
  r *= DIFFICULTY[s.difficulty].traffic;
  r *= effectMult(s, st, 'traffic');
  if (s.minute >= 17 * 60) r *= effectMult(s, st, 'dinner');
  return r;
}

export function deliveryRate(s: GameState, st: Store, hasDriver: boolean) {
  if (st.upgrades.delivery < 1 || !hasDriver) return 0;
  const L = loc(st);
  if (L.deliveryShare <= 0) return 0;
  const hourIdx = Math.floor((s.minute - OPEN_MIN) / 60);
  if (hourIdx < 0 || hourIdx > 11) return 0;
  const curve = HOUR_CURVES[L.curve][hourIdx];
  const dow = (s.day - 1) % 7;
  let r = L.traffic * curve * DAY_TRAFFIC[dow] * L.deliveryShare * ratingFactor(st.rating);
  r *= up(st, 'online').onlineMult ?? 1;
  r *= WEATHER[s.weather].delivery;
  r *= 1 + marketingBoost(st) * 0.5 + deliveryMarketing(st) + (s.loyalty ? LOYALTY.boost : 0);
  r *= menuFactor(s, st);
  r *= DIFFICULTY[s.difficulty].traffic;
  r *= effectMult(s, st, 'traffic');
  if (s.minute >= 17 * 60) r *= effectMult(s, st, 'dinner');
  return r;
}

/** Pick a pizza for a customer from what's on the menu (ignores stock). */
export function choosePizza(s: GameState, st: Store): ItemId | null {
  const L = loc(st);
  let total = 0;
  const opts: { id: ItemId; w: number }[] = [];
  for (const m of MENU) {
    if (m.type !== 'pizza' || !onMenu(s, st, m.id)) continue;
    const w = m.appeal * (L.prefs[m.id] ?? 1) * priceWeight(st, m.id);
    opts.push({ id: m.id, w });
    total += w;
  }
  if (!total) return null;
  let r = rand(s) * total;
  for (const o of opts) {
    r -= o.w;
    if (r <= 0) return o.id;
  }
  return opts[opts.length - 1].id;
}

export function pizzaQuality(s: GameState, st: Store, id: ItemId, cookSkill: number, perfectionist: boolean, energy: number) {
  let q = 52 + ITEM[id].craft;
  q += SUPPLIERS[st.supplier].quality;
  q += cookSkill * 5;
  if (perfectionist) q += 6;
  q += up(st, 'oven').quality ?? 0;
  if (energy < 25) q -= 8;
  q += gauss(s) * 4;
  return clamp(q, 5, 100);
}

export interface SatResult {
  sat: number;
  stars: number;
  topic: import('../data/text').ReviewTopic;
}

/** Satisfaction for a completed order. */
export function satisfaction(s: GameState, st: Store, o: Order, waitMin: number): SatResult {
  let quality = 0, n = 0, priceRatio = 0;
  let priceN = 0;
  for (const it of o.items) {
    const def = ITEM[it.item];
    if (def.type === 'pizza' || def.type === 'side') {
      quality += it.quality;
      n++;
    }
    priceRatio += salePrice(st, it.item) / def.fair;
    priceN++;
  }
  quality = n ? quality / n : 60;
  priceRatio = priceN ? priceRatio / priceN : 1;
  const L = loc(st);
  let sat = 60 + (quality - 60) * 0.65;
  const contribs: { t: SatResult['topic']; v: number }[] = [];
  contribs.push({ t: quality >= 72 ? 'tasty' : 'bland', v: (quality - 60) * 0.65 });
  const over = waitMin - o.expected;
  const waitEff = over > 0 ? -over * 2.2 : waitMin < o.expected * 0.6 ? 6 : 0;
  sat += waitEff;
  contribs.push({ t: o.kind === 'delivery' ? (waitEff < 0 ? 'deliverySlow' : 'deliveryFast') : waitEff < 0 ? 'slow' : 'fast', v: waitEff });
  let priceEff = 0;
  if (priceRatio > 1) priceEff = -(priceRatio - 1) * 70 * L.priceSens;
  else if (priceRatio < 0.92) priceEff = 5;
  sat += priceEff;
  contribs.push({ t: priceEff < 0 ? 'pricey' : 'value', v: priceEff });
  if (o.kind !== 'delivery') {
    const clean = (st.cleanliness - 65) * 0.25;
    sat += clean;
    if (clean < -3) contribs.push({ t: 'dirty', v: clean });
  }
  const amb = up(st, 'decor').ambience ?? 0;
  const ambEff = o.kind === 'dine' ? amb * 3 : o.kind === 'takeout' ? amb : 0;
  sat += ambEff;
  if (ambEff >= 6) contribs.push({ t: 'vibe', v: ambEff * 0.8 });
  sat += o.charm;
  sat += gauss(s) * 5;
  sat = clamp(sat, 0, 100);
  const stars = clamp(1 + sat / 25, 1, 5);
  // pick review topic: strongest effect in the direction of the verdict
  const positive = stars >= 3.5;
  let best = contribs[0];
  for (const c of contribs) {
    if (positive ? c.v > best.v : c.v < best.v) best = c;
  }
  return { sat, stars, topic: best.t };
}

/** Daily random walk for wholesale prices. */
export function updateMarket(s: GameState) {
  for (const k of Object.keys(s.market) as IngId[]) {
    let m = s.market[k] * Math.exp(gauss(s) * 0.04);
    m += (1 - m) * 0.15;
    s.market[k] = clamp(m, 0.75, 1.45);
  }
}

export function customerPatience(s: GameState, st: Store) {
  const base = 13 * loc(st).patience * DIFFICULTY[s.difficulty].patience;
  const decor = 1 + (up(st, 'decor').ambience ?? 0) * 0.05;
  return base * decor * (0.7 + rand(s) * 0.6);
}
