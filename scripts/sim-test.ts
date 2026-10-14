// Headless balance test: a simple bot plays N days and prints a summary per day.
// Run: npx tsx scripts/sim-test.ts [days] [seed]   (or: bun scripts/sim-test.ts)
import { createGame, stockOf, avgUsage, loc, up } from '../src/core/state';
import { advance } from '../src/core/sim';
import { openForBusiness, beginNextDay, resolveChoice } from '../src/core/day';
import * as A from '../src/core/actions';
import { INGREDIENTS, ITEM, MENU, type IngId } from '../src/data/catalog';
import { UPGRADES } from '../src/data/upgrades';
import { LOCATIONS } from '../src/data/world';
import { outbox } from '../src/core/util';
import { suggestOrder } from '../src/core/inventory';
import type { GameState, Store } from '../src/core/types';

const DAYS = Number(process.argv[2] ?? 30);
const SEED = Number(process.argv[3] ?? 7);
const s: GameState = createGame('Bot Pizza', 'standard', SEED);

function neededIngredients(st: Store) {
  const need = new Set<IngId>();
  for (const m of MENU) if (s.unlocked.includes(m.id) && st.menu[m.id].on) for (const k of Object.keys(m.recipe)) need.add(k as IngId);
  need.add('box');
  return need;
}

function botPrep() {
  for (const st of s.stores) {
    const cooks = st.staff.filter((x) => x.role === 'cook').length;
    const cashiers = st.staff.filter((x) => x.role === 'cashier').length;
    const y = st.history[st.history.length - 1];
    const lostRate = y ? y.lost / Math.max(1, y.served + y.lost) : 0;
    const hireRole = (role: string) => {
      const c = st.candidates.filter((q) => q.role === role).sort((a, b) => b.skill - a.skill)[0];
      if (c) A.hire(s, st, c.id);
    };
    if (cashiers < 1) hireRole('cashier');
    if (lostRate > 0.08 && cooks < (up(st, 'prep').stations ?? 1)) hireRole('cook');
    if (lostRate > 0.2 && cashiers < 2 && cooks >= 2) hireRole('cashier');
    if (st.upgrades.delivery > 0 && !st.staff.some((x) => x.role === 'driver')) hireRole('driver');
    if (st.cleanliness < 70 && !st.staff.some((x) => x.role === 'cleaner') && s.level >= 3) hireRole('cleaner');
    // upgrades in priority order when affordable with a reserve
    const prio: string[] = ['prep', 'oven', 'register', 'storage', 'dining', 'delivery', 'sign', 'decor', 'cleaning', 'online', 'breakroom', 'software'];
    const saving = s.level >= 4 && s.stores.length < 2 && s.cash < 22000;
    for (const id of saving ? [] : prio) {
      const cost = A.upgradeCost(s, st, id as never);
      if (cost !== null && s.cash > cost + 1500) A.buyUpgrade(s, st, id as never);
    }
    // stock up to the suggested order
    const lines = suggestOrder(s, st);
    const r = A.orderSupplies(s, st, lines, false);
    if (!r.ok && Object.keys(lines).length) console.log('  order failed:', r.msg);
    if (s.level >= 2 && s.cash > 900 && !st.campaigns.length) A.runCampaign(s, st, 'flyers');
  }
  for (const m of MENU) if (!s.unlocked.includes(m.id) && s.level >= m.unlockLevel && s.cash > m.unlockCost + 2000) A.unlockRecipe(s, m.id);
  for (const L of LOCATIONS) if (!s.stores.some((x) => x.locationId === L.id) && s.level >= L.reqLevel && s.cash > L.cost + 4000) A.buyLocation(s, L.id);
  if (s.choice) resolveChoice(s, s.choice.options[0].id);
}

const t0 = Date.now();
for (let d = 0; d < DAYS && !s.gameOver; d++) {
  botPrep();
  const o = openForBusiness(s);
  if (!o.ok) console.log('open failed', o.msg);
  let guard = 0;
  while ((s.phase === 'open' || s.phase === 'closing') && guard++ < 10000) {
    advance(s, 5);
    if (s.choice) resolveChoice(s, s.choice.options[0].id);
  }
  const rep = s.report!;
  const parts = rep.stores.map((r) => {
    const st = s.stores.find((x) => x.id === r.storeId)!;
    const x = r.stats;
    const sat = x.satCount ? x.satSum / x.satCount : 0;
    return `${loc(st).name.slice(0, 8)} rev $${x.revenue.toFixed(0)} srv ${x.served} lost ${x.lost} ref ${x.refunds} sat ${sat.toFixed(0)} ★${st.rating.toFixed(2)} staff ${st.staff.length} clean ${st.cleanliness.toFixed(0)} waste $${x.waste.toFixed(0)}`;
  });
  console.log(`D${String(rep.day).padStart(2)} lvl ${s.level} cash $${s.cash.toFixed(0).padStart(7)} | ${parts.join(' || ')}`);
  outbox.length = 0;
  beginNextDay(s);
}
console.log(`\nDone in ${Date.now() - t0}ms. Level ${s.level}, cash $${s.cash.toFixed(0)}, stores ${s.stores.length}, goals ${s.goalsDone.length}, served ${s.stats.served}, lost ${s.stats.lost}`);
console.log('Upgrades:', s.stores.map((st) => UPGRADES.map((u) => `${u.id}${st.upgrades[u.id]}`).join(' ')).join(' | '));
console.log('Unlocked:', s.unlocked.map((i) => ITEM[i].name).join(', '));
console.log('Ingredient check:', INGREDIENTS.length);
