// Player commands. Every UI button routes through here; each returns a result for feedback.
import { ITEM, type IngId, type ItemId, type SupplierId } from '../data/catalog';
import { UPG, type UpgradeId } from '../data/upgrades';
import { CAMPAIGN, LOANS, LOAN_DAYS, LOAN_INTEREST, LOC, LOYALTY, MAX_STAFF, ROLES, type CampaignId, type LocationId } from '../data/world';
import type { GameState, Store } from './types';
import { createStore, loc, storeById } from './state';
import { makeStaffFromCandidate, trainingCost, trainingReq } from './staff';
import { placeSupplyOrder } from './inventory';
import { checkGoals } from './progression';
import { clamp, money, news } from './util';

export interface Result {
  ok: boolean;
  msg: string;
}
const ok = (msg: string): Result => ({ ok: true, msg });
const fail = (msg: string): Result => ({ ok: false, msg });

function done(s: GameState, r: Result) {
  if (r.ok) checkGoals(s);
  return r;
}

// ------------------------------------------------------------- staff

export function hire(s: GameState, st: Store, candidateId: number): Result {
  const c = st.candidates.find((x) => x.id === candidateId);
  if (!c) return fail('That candidate is no longer available.');
  if (st.staff.length >= MAX_STAFF) return fail(`This store can hold at most ${MAX_STAFF} staff.`);
  if (s.level < ROLES[c.role].req) return fail(`${ROLES[c.role].name}s unlock at level ${ROLES[c.role].req}.`);
  if (c.role === 'manager' && st.staff.some((x) => x.role === 'manager')) return fail('This store already has a manager.');
  if (c.role === 'driver' && st.upgrades.delivery < 1) return fail('Buy a delivery vehicle first (Upgrades → Delivery).');
  st.candidates = st.candidates.filter((x) => x !== c);
  const x = makeStaffFromCandidate(s, c);
  st.staff.push(x);
  s.stats.hires++;
  return done(s, ok(`Hired ${c.name} as ${ROLES[c.role].name.toLowerCase()} at ${money(c.wage, true)}/hr.`));
}

export function releaseTask(st: Store, staffId: number) {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x || !x.task) return;
  const t = x.task;
  if (t.kind === 'order') {
    const c = st.customers.find((q) => q.id === t.customerId);
    if (c && c.state === 'ordering') c.state = 'queue';
  } else if (t.kind === 'prep') {
    const o = st.orders.find((q) => q.id === t.orderId);
    const it = o?.items[t.itemIdx ?? 0];
    if (it && it.stage === 'prep') it.stage = 'queued';
  } else if (t.kind === 'deliver' && !t.dropped) {
    for (const id of t.orderIds ?? []) {
      const o = st.orders.find((q) => q.id === id);
      if (o) {
        o.state = 'ready';
        st.deliveryQueue.unshift(id);
      }
    }
  }
  x.task = null;
}

export function fire(s: GameState, st: Store, staffId: number): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  if (x.task?.kind === 'deliver') return fail(`${x.name} is out on a delivery. Try again when they're back.`);
  releaseTask(st, staffId);
  st.staff = st.staff.filter((q) => q !== x);
  for (const y of st.staff) y.morale = clamp(y.morale - 2, 0, 100);
  return ok(`${x.name} was let go.`);
}

export function train(s: GameState, st: Store, staffId: number): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  if (x.skill >= 5) return fail(`${x.name} is already at max skill.`);
  if (x.status !== 'active') return fail(`${x.name} is not available.`);
  const req = trainingReq(x.skill);
  if (s.level < req) return fail(`Training to skill ${x.skill + 1} unlocks at level ${req}.`);
  if (x.task?.kind === 'deliver') return fail(`${x.name} is out on a delivery.`);
  const cost = trainingCost(x.skill);
  if (s.cash < cost) return fail(`Training costs ${money(cost)}.`);
  s.cash -= cost;
  st.today.other += cost;
  releaseTask(st, staffId);
  x.status = 'training';
  // training takes one full working day
  x.statusDays = s.phase === 'prep' ? 1 : 2;
  s.stats.trained++;
  return done(s, ok(`${x.name} is off at a training course${s.phase === 'prep' ? ' today' : ' through tomorrow'}.`));
}

export function adjustWage(s: GameState, st: Store, staffId: number, delta: number): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  const nw = Math.max(7.25, Math.round((x.wage + delta) * 2) / 2);
  if (nw === x.wage) return fail('Wage cannot go lower.');
  x.wage = nw;
  x.morale = clamp(x.morale + (delta > 0 ? 4 : -8), 0, 100);
  return ok(`${x.name} now earns ${money(nw, true)}/hr.`);
}

export function giveBonus(s: GameState, st: Store, staffId: number): Result {
  const x = st.staff.find((q) => q.id === staffId);
  if (!x) return fail('Not found.');
  if (x.bonusDay === s.day) return fail(`${x.name} already got a bonus today.`);
  if (s.cash < 100) return fail('A bonus costs $100.');
  s.cash -= 100;
  st.today.other += 100;
  x.bonusDay = s.day;
  x.morale = clamp(x.morale + 15, 0, 100);
  return ok(`${x.name} appreciated the $100 bonus.`);
}

// ------------------------------------------------------------- menu

export function setPrice(st: Store, id: ItemId, price: number): Result {
  const fair = ITEM[id].fair;
  const p = clamp(Math.round(price * 4) / 4, Math.max(0.5, fair * 0.4), fair * 2.5);
  st.menu[id].price = p;
  return ok(`${ITEM[id].name} now ${money(p, true)}.`);
}

export function toggleItem(s: GameState, st: Store, id: ItemId): Result {
  if (!s.unlocked.includes(id)) return fail('Unlock the recipe first.');
  const on = !st.menu[id].on;
  if (!on && ITEM[id].type === 'pizza') {
    const others = Object.entries(st.menu).filter(([k, v]) => k !== id && v.on && ITEM[k as ItemId].type === 'pizza' && s.unlocked.includes(k as ItemId));
    if (!others.length) return fail('Keep at least one pizza on the menu.');
  }
  st.menu[id].on = on;
  return ok(`${ITEM[id].name} ${on ? 'added to' : 'removed from'} the menu.`);
}

export function unlockRecipe(s: GameState, id: ItemId): Result {
  const def = ITEM[id];
  if (s.unlocked.includes(id)) return fail('Already unlocked.');
  if (s.level < def.unlockLevel) return fail(`Unlocks at level ${def.unlockLevel}.`);
  if (s.cash < def.unlockCost) return fail(`Costs ${money(def.unlockCost)}.`);
  s.cash -= def.unlockCost;
  s.stores[0].today.equipment += def.unlockCost;
  s.unlocked.push(id);
  for (const st of s.stores) st.menu[id].on = true;
  s.stats.recipesUnlocked++;
  return done(s, ok(`${def.name} is on the menu at every store. Stock its ingredients!`));
}

// ------------------------------------------------------------- upgrades

export function upgradeCost(s: GameState, st: Store, id: UpgradeId): number | null {
  const lv = st.upgrades[id];
  const next = UPG[id].levels[lv + 1];
  if (!next) return null;
  let mult = 1;
  for (const e of s.effects) if (e.kind === 'upgradeSale') mult *= e.mult;
  return Math.round(next.cost * mult);
}

export function buyUpgrade(s: GameState, st: Store, id: UpgradeId): Result {
  const def = UPG[id];
  const lv = st.upgrades[id];
  const next = def.levels[lv + 1];
  if (!next) return fail(`${def.name} is maxed out.`);
  if (s.level < next.req) return fail(`${next.name} unlocks at level ${next.req}.`);
  if (def.needs && st.upgrades[def.needs] < 1) return fail(`Requires ${UPG[def.needs].name} first.`);
  const cost = upgradeCost(s, st, id)!;
  if (s.cash < cost) return fail(`${next.name} costs ${money(cost)}.`);
  s.cash -= cost;
  st.today.equipment += cost;
  st.upgrades[id] = lv + 1;
  s.stats.upgradesBought++;
  return done(s, ok(`Installed: ${next.name}.`));
}

// ------------------------------------------------------------- marketing

export function runCampaign(s: GameState, st: Store, id: CampaignId): Result {
  const c = CAMPAIGN[id];
  if (s.level < c.req) return fail(`${c.name} unlocks at level ${c.req}.`);
  if (st.campaigns.some((x) => x.id === id)) return fail(`${c.name} is already running here.`);
  if (s.cash < c.cost) return fail(`${c.name} costs ${money(c.cost)}.`);
  s.cash -= c.cost;
  st.today.marketing += c.cost;
  st.campaigns.push({ id, daysLeft: c.days });
  s.stats.campaignsRun++;
  return done(s, ok(`${c.name} is live at ${loc(st).name} for ${c.days} day${c.days > 1 ? 's' : ''}.`));
}

export function buyLoyalty(s: GameState): Result {
  if (s.loyalty) return fail('Already running.');
  if (s.level < LOYALTY.req) return fail(`Unlocks at level ${LOYALTY.req}.`);
  if (s.cash < LOYALTY.cost) return fail(`Costs ${money(LOYALTY.cost)}.`);
  s.cash -= LOYALTY.cost;
  s.stores[0].today.marketing += LOYALTY.cost;
  s.loyalty = true;
  return done(s, ok('Loyalty cards are live at every store.'));
}

// ------------------------------------------------------------- stock

export function orderSupplies(s: GameState, st: Store, lines: Partial<Record<IngId, number>>, express: boolean): Result {
  const r = placeSupplyOrder(s, st, lines, express);
  if (!r.ok) return fail(r.reason ?? 'Order failed.');
  const when = s.phase === 'prep' ? 'delivered now' : express ? 'arriving within the hour' : 'arriving tomorrow morning';
  return done(s, ok(`Ordered ${money(r.cost)} of supplies, ${when}.`));
}

export function setSupplier(st: Store, id: SupplierId): Result {
  st.supplier = id;
  return ok('Supplier changed. New prices apply to future orders.');
}

// ------------------------------------------------------------- finance & expansion

export function takeLoan(s: GameState, amount: number): Result {
  if (s.loan) return fail('Pay off your current loan first.');
  const offer = LOANS.find((l) => l.amount === amount);
  if (!offer || s.level < offer.req) return fail('Loan not available.');
  const total = amount * (1 + LOAN_INTEREST);
  s.loan = { principal: amount, remaining: total, daily: Math.ceil((total / LOAN_DAYS) * 100) / 100, daysLeft: LOAN_DAYS };
  s.cash += amount;
  return ok(`Borrowed ${money(amount)}. ${money(s.loan.daily, true)}/day for ${LOAN_DAYS} days.`);
}

export function repayLoan(s: GameState): Result {
  if (!s.loan) return fail('No loan.');
  const pay = s.loan.remaining;
  if (s.cash < pay) return fail(`You need ${money(pay)} to repay.`);
  s.cash -= pay;
  s.stores[0].today.loan += pay;
  s.loan = null;
  return ok('Loan repaid in full.');
}

export function buyLocation(s: GameState, id: LocationId): Result {
  const L = LOC[id];
  if (s.stores.some((x) => x.locationId === id)) return fail('You already own this location.');
  if (s.level < L.reqLevel) return fail(`${L.name} unlocks at level ${L.reqLevel}.`);
  if (s.cash < L.cost) return fail(`${L.name} costs ${money(L.cost)}.`);
  s.cash -= L.cost;
  const st = createStore(s, id, false);
  st.today.equipment += L.cost;
  s.stores.push(st);
  news(s, `Grand opening: ${L.name}! Hire a team and stock the walk-in.`, 'good', false);
  return done(s, ok(`You bought ${L.name}. Hire staff and order stock before opening.`));
}

export function setPar(st: Store, ing: IngId, par: number) {
  st.par[ing] = Math.max(0, Math.round(par));
}

export { storeById };
