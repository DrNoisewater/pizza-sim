// Creating a new game / store and read-only helpers used across the sim and UI.
import { INGREDIENTS, ITEM, MENU, type IngId, type ItemId } from '../data/catalog';
import { UPG, UPGRADES, type UpgradeId, type UpgradeLevel } from '../data/upgrades';
import { LOC, PREP_MIN, type LocationId } from '../data/world';
import type { DayStats, Difficulty, GameState, Store, Staff, Look } from './types';
import { rand, randInt } from './util';
import { makeStaffFromCandidate, rollCandidates, randomLook } from './staff';

export const SAVE_VERSION = 1;

export const DIFFICULTY: Record<Difficulty, { label: string; cash: number; traffic: number; patience: number; desc: string }> = {
  relaxed: { label: 'Relaxed', cash: 5000, traffic: 1.1, patience: 1.25, desc: 'More cash, patient customers.' },
  standard: { label: 'Standard', cash: 3000, traffic: 1, patience: 1, desc: 'The intended experience.' },
  hard: { label: 'Hard', cash: 1800, traffic: 0.92, patience: 0.85, desc: 'Thin margins, short tempers.' },
};

export function emptyDay(day: number, rating: number): DayStats {
  return {
    day, revenue: 0, supplies: 0, wages: 0, rent: 0, marketing: 0, equipment: 0, other: 0, loan: 0, foodCost: 0,
    served: 0, lost: 0, soldOut: 0, refunds: 0, deliveries: 0, satSum: 0, satCount: 0, waste: 0, sold: {}, ratingEnd: rating,
  };
}

export function createStore(s: GameState, locationId: LocationId, starter: boolean): Store {
  const upgrades = Object.fromEntries(UPGRADES.map((u) => [u.id, 0])) as Record<UpgradeId, number>;
  const inventory = Object.fromEntries(INGREDIENTS.map((i) => [i.id, []])) as unknown as Store['inventory'];
  const menu = Object.fromEntries(MENU.map((m) => [m.id, { on: s.unlocked.includes(m.id), price: m.fair }])) as Store['menu'];
  const store: Store = {
    id: ++s.nextId,
    locationId,
    upgrades,
    staff: [],
    candidates: [],
    inventory,
    incoming: [],
    supplier: 'standard',
    autoReorder: false,
    par: {},
    menu,
    customers: [],
    orders: [],
    deliveryQueue: [],
    cleanliness: 85,
    rating: 3,
    campaigns: [],
    today: emptyDay(s.day, 3),
    history: [],
    reviews: [],
    ovenPenalty: 0,
    usage: [{}],
    kiosk: null,
    openedDay: s.day,
  };
  const startStock: Partial<Record<IngId, number>> = starter
    ? { dough: 90, sauce: 90, cheese: 90, pepperoni: 50, basil: 45, soda: 50, box: 60 }
    : { dough: 60, sauce: 60, cheese: 60, pepperoni: 35, basil: 30, soda: 40, box: 50 };
  for (const [k, q] of Object.entries(startStock) as [IngId, number][]) {
    store.inventory[k].push({ qty: q, exp: s.day + shelfDays(store, k) - 1 });
  }
  // a starting cook
  const cook = makeStaffFromCandidate(s, {
    id: ++s.nextId,
    name: starter ? 'Marco R.' : '',
    role: 'cook',
    skill: 1,
    wage: 11,
    traits: starter ? ['reliable'] : [],
    look: randomLook(s),
  });
  if (!cook.name) cook.name = 'New Cook';
  store.staff.push(cook);
  store.candidates = rollCandidates(s, store);
  return store;
}

export function createGame(company: string, difficulty: Difficulty, seed = Date.now()): GameState {
  const s: GameState = {
    version: SAVE_VERSION,
    company: company.trim() || "Tony's Pizza",
    difficulty,
    rng: seed | 0,
    nextId: 0,
    day: 1,
    minute: PREP_MIN,
    phase: 'prep',
    cash: DIFFICULTY[difficulty].cash,
    dayStartCash: DIFFICULTY[difficulty].cash,
    xp: 0,
    level: 1,
    stores: [],
    unlocked: MENU.filter((m) => m.unlockCost === 0).map((m) => m.id),
    loyalty: false,
    loan: null,
    goalIndex: 0,
    goalsDone: [],
    stats: { served: 0, revenue: 0, lost: 0, bestDayRevenue: 0, bestDayProfit: 0, ordersPlaced: 0, upgradesBought: 0, campaignsRun: 0, trained: 0, recipesUnlocked: 0, hires: 0, daysCompleted: 0, deliveries: 0 },
    weather: 'sunny',
    forecast: 'cloudy',
    effects: [],
    scheduled: [],
    choice: null,
    tomorrowEvent: null,
    tomorrowStore: 0,
    market: Object.fromEntries(INGREDIENTS.map((i) => [i.id, 1])) as Record<IngId, number>,
    report: null,
    news: [],
    negativeDays: 0,
    gameOver: false,
    tutorial: true,
  };
  for (let i = 0; i < 3; i++) rand(s);
  const store = createStore(s, 'maple', true);
  s.stores.push(store);
  return s;
}

// ---------- helpers

export const loc = (st: Store) => LOC[st.locationId];
export function up(st: Store, id: UpgradeId): UpgradeLevel {
  return UPG[id].levels[st.upgrades[id]];
}
export function storeName(s: GameState, st: Store) {
  return `${s.company} · ${LOC[st.locationId].name}`;
}
export function shelfDays(st: Store, ing: IngId) {
  const base = INGREDIENTS.find((i) => i.id === ing)!.shelf;
  if (base >= 999) return 9999;
  return base + (up(st, 'storage').shelfBonus ?? 0);
}
export function stockOf(st: Store, ing: IngId): number {
  let n = 0;
  for (const b of st.inventory[ing]) n += b.qty;
  return n;
}
export function storageUsed(st: Store, includeIncoming = true): number {
  let u = 0;
  for (const i of INGREDIENTS) {
    u += stockOf(st, i.id) * i.space;
    if (includeIncoming) for (const inc of st.incoming) if (inc.ing === i.id) u += inc.qty * i.space;
  }
  return u;
}
export function storageCap(st: Store) {
  return up(st, 'storage').capacity ?? 440;
}
export function activeStaff(st: Store, role?: Staff['role']) {
  return st.staff.filter((x) => x.status === 'active' && (!role || x.role === role));
}
export function hasManager(st: Store) {
  return st.staff.some((x) => x.role === 'manager' && x.status === 'active');
}
export function canAutoReorder(st: Store) {
  return !!up(st, 'software').autoReorder || st.staff.some((x) => x.role === 'manager');
}
export function seatsTotal(st: Store) {
  return up(st, 'dining').seats ?? 4;
}
export function itemAvailable(st: Store, id: ItemId, needBox: boolean): boolean {
  const def = ITEM[id];
  for (const [k, q] of Object.entries(def.recipe) as [IngId, number][]) if (stockOf(st, k) < q) return false;
  if (needBox && def.type !== 'drink' && stockOf(st, 'box') < 1) return false;
  return true;
}
export function onMenu(s: GameState, st: Store, id: ItemId) {
  return s.unlocked.includes(id) && st.menu[id].on;
}
export function selectedLookFallback(): Look {
  return { skin: 0, hair: 0, shirt: 0, pants: 0, height: 1 };
}
export function avgUsage(st: Store, ing: IngId): number {
  if (!st.usage.length) return 0;
  let t = 0;
  for (const u of st.usage) t += u[ing] ?? 0;
  return t / st.usage.length;
}
export function storeById(s: GameState, id: number) {
  return s.stores.find((x) => x.id === id);
}
export function dailyWages(st: Store) {
  let w = 0;
  for (const x of st.staff) w += x.wage * 12;
  return w;
}
export { randInt };
