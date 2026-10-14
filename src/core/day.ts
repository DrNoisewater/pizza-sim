// Day cycle: opening, closing, nightly bookkeeping, and random events.
import { ING } from '../data/catalog';
import { LOC, LOYALTY, OPEN_MIN, PREP_MIN, WEATHER, type WeatherId, ROLES } from '../data/world';
import type { DayReport, EventKind, GameState, PendingChoice, Store } from './types';
import { emptyDay, loc, stockOf, storageCap, storageUsed, up, activeStaff } from './state';
import { autoReorder, addStock, receiveDeliveries, spoil } from './inventory';
import { nightlyStaff, rollCandidates } from './staff';
import { updateMarket } from './economy';
import { checkGoals } from './progression';
import { emit, money, news, now, pickOne, rand, randInt, weighted, clamp } from './util';
import { spawnCustomer } from './sim';

export function openForBusiness(s: GameState): { ok: boolean; msg?: string } {
  if (s.phase !== 'prep') return { ok: false, msg: 'The store is already open.' };
  if (s.choice) return { ok: false, msg: 'Decide on the pending event first.' };
  s.phase = 'open';
  s.minute = OPEN_MIN;
  for (const st of s.stores) {
    if (!st.staff.some((x) => x.status === 'active')) news(s, `${loc(st).name} has nobody working today!`, 'bad');
  }
  news(s, `Day ${s.day}: doors open.`, 'info', false);
  return { ok: true };
}

/** Close the books for the day and build the report. */
export function endDay(s: GameState) {
  const report: DayReport = { day: s.day, stores: [], cashStart: 0, cashEnd: 0, levelStart: s.level, notes: [], tomorrow: [] };
  const openMinutes = Math.max(1, s.minute - OPEN_MIN);
  let revenue = 0, profit = 0;
  for (const st of s.stores) {
    const ratingStart = st.history.length ? st.history[st.history.length - 1].ratingEnd : 3;
    // anything still in progress at hard close is refunded
    for (const o of st.orders) {
      if (o.state !== 'done') {
        s.cash -= o.total;
        st.today.revenue -= o.total;
        s.stats.revenue -= o.total;
        st.today.refunds++;
      }
    }
    st.orders = [];
    st.customers = [];
    st.deliveryQueue = [];
    st.kiosk = null;
    for (const x of st.staff) x.task = null;
    // costs
    let wages = 0;
    for (const x of st.staff) wages += x.wage * 12;
    st.today.wages += wages;
    s.cash -= wages;
    const rent = LOC[st.locationId].rent + (s.loyalty ? LOYALTY.dailyFee : 0);
    st.today.rent += rent;
    s.cash -= rent;
    st.today.waste = spoil(s, st);
    for (const c of st.campaigns) c.daysLeft--;
    st.campaigns = st.campaigns.filter((c) => c.daysLeft > 0);
    const quit = nightlyStaff(s, st, openMinutes);
    if (quit.length) report.notes.push(`${quit.map((q) => q.name).join(', ')} quit at ${loc(st).name}.`);
    st.cleanliness = clamp(st.cleanliness + 35, 0, 100);
    st.ovenPenalty = 0;
    st.today.ratingEnd = st.rating;
    const auto = autoReorder(s, st);
    if (auto > 0) report.notes.push(`Auto-reorder at ${loc(st).name}: ${money(auto)} of supplies arriving tomorrow.`);
    report.stores.push({ storeId: st.id, stats: { ...st.today, sold: { ...st.today.sold } }, ratingStart });
    revenue += st.today.revenue;
    profit += st.today.revenue - (st.today.supplies + st.today.wages + st.today.rent + st.today.marketing + st.today.other + st.today.loan);
  }
  // loan
  if (s.loan) {
    const pay = Math.min(s.loan.daily, s.loan.remaining);
    s.cash -= pay;
    s.loan.remaining -= pay;
    s.loan.daysLeft--;
    s.stores[0].today.loan += pay;
    report.stores[0].stats.loan += pay;
    profit -= pay;
    if (s.loan.remaining <= 0.01) {
      s.loan = null;
      report.notes.push('Loan fully repaid.');
    }
  }
  if (revenue > s.stats.bestDayRevenue) s.stats.bestDayRevenue = revenue;
  if (profit > s.stats.bestDayProfit) s.stats.bestDayProfit = profit;
  s.stats.daysCompleted++;
  for (const st of s.stores) {
    st.history.push(st.today);
    if (st.history.length > 30) st.history.shift();
  }
  // bankruptcy check
  if (s.cash < 0) {
    s.negativeDays++;
    report.notes.push(s.negativeDays >= 3 ? 'The bank has called in your debts.' : `You are ${money(-s.cash)} in the red. ${3 - s.negativeDays} more day${3 - s.negativeDays === 1 ? '' : 's'} like this and the bank shuts you down.`);
    if (s.negativeDays >= 3) s.gameOver = true;
  } else s.negativeDays = 0;
  // tomorrow
  rollTomorrow(s, report);
  report.cashEnd = s.cash;
  report.cashStart = s.dayStartCash;
  s.report = report;
  s.phase = 'report';
  checkGoals(s);
  emit({ type: 'dayEnd' });
}

function rollTomorrow(s: GameState, report: DayReport) {
  const r = rand(s);
  const wt: WeatherId = r < 0.4 ? 'sunny' : r < 0.7 ? 'cloudy' : r < 0.92 ? 'rainy' : 'hot';
  s.weather = s.forecast;
  s.forecast = wt;
  report.tomorrow.push(`Forecast: ${WEATHER[s.weather].name}.`);
  if (s.weather === 'rainy') report.tomorrow.push('Rain keeps walk-ins home but delivery orders jump.');
  if (s.weather === 'hot') report.tomorrow.push('Heatwave: expect to sell a lot of drinks.');
  const dow = s.day % 7;
  if (dow === 4 || dow === 5) report.tomorrow.push('Weekend crowds are coming.');
  s.tomorrowEvent = null;
  if (s.day >= 2 && rand(s) < 0.55) {
    const totalStaff = s.stores.reduce((n, st) => n + st.staff.length, 0);
    const best = Math.max(...s.stores.map((st) => st.rating));
    const k = weighted<EventKind>(s, [
      { v: 'inspection', w: 3 },
      { v: 'critic', w: s.stats.served > 40 ? 2 : 0 },
      { v: 'biggame', w: 2 },
      { v: 'festival', w: 1.5 },
      { v: 'cheese', w: 1 },
      { v: 'oven', w: 1.1 },
      { v: 'sick', w: totalStaff >= 3 ? 1.2 : 0 },
      { v: 'rival', w: s.day > 5 ? 1 : 0 },
      { v: 'wholesale', w: 1.2 },
      { v: 'raise', w: totalStaff >= 3 ? 1 : 0 },
      { v: 'viral', w: best >= 4 ? 0.7 : 0 },
      { v: 'sale', w: s.level >= 2 ? 0.8 : 0 },
    ]);
    s.tomorrowEvent = k;
    s.tomorrowStore = pickOne(s, s.stores).id;
    const st = s.stores.find((x) => x.id === s.tomorrowStore)!;
    const where = s.stores.length > 1 ? ` near ${loc(st).name}` : '';
    if (k === 'biggame') report.tomorrow.push('Big game on TV tomorrow night: dinner rush will be huge.');
    if (k === 'festival') report.tomorrow.push(`Street festival tomorrow${where}: extra foot traffic all day.`);
    if (k === 'cheese') report.tomorrow.push('Dairy shortage: mozzarella prices spike for 3 days. Stock up tonight?');
    if (k === 'sale') report.tomorrow.push('Restaurant supply sale tomorrow: 20% off all upgrades.');
  }
}

/** Dismiss the report and roll into the next day's prep phase. */
export function beginNextDay(s: GameState) {
  if (s.phase !== 'report' || s.gameOver) return;
  s.report = null;
  s.dayStartCash = s.cash;
  s.day++;
  s.minute = PREP_MIN;
  s.phase = 'prep';
  updateMarket(s);
  for (const e of s.effects) e.daysLeft--;
  s.effects = s.effects.filter((e) => e.daysLeft > 0);
  s.scheduled = [];
  for (const st of s.stores) {
    st.today = emptyDay(s.day, st.rating);
    st.usage.push({});
    if (st.usage.length > 3) st.usage.shift();
    receiveDeliveries(s, st, true);
    st.candidates = rollCandidates(s, st);
    // random sick days
    for (const x of st.staff) {
      if (x.status === 'active' && !x.traits.includes('reliable') && rand(s) < 0.025) {
        x.status = 'sick';
        x.statusDays = 1;
        news(s, `${x.name} called in sick today.`, 'bad');
      }
    }
  }
  if (s.tomorrowEvent) applyEvent(s, s.tomorrowEvent, s.tomorrowStore);
  s.tomorrowEvent = null;
}

function applyEvent(s: GameState, kind: EventKind, storeId: number) {
  const st = s.stores.find((x) => x.id === storeId) ?? s.stores[0];
  const L = loc(st);
  const at = (a: number, b: number) => s.day * 1440 + randInt(s, a, b);
  switch (kind) {
    case 'inspection':
      s.scheduled.push({ kind, storeId: st.id, at: at(11 * 60 + 30, 19 * 60 + 30), done: false });
      break;
    case 'critic':
      s.scheduled.push({ kind, storeId: st.id, at: at(12 * 60, 20 * 60), done: false });
      break;
    case 'biggame':
      s.effects.push({ kind: 'dinner', storeId: null, mult: 1.7, daysLeft: 1, label: 'Big game night' });
      news(s, 'Big game tonight! Expect a monster dinner rush.', 'info');
      break;
    case 'festival':
      s.effects.push({ kind: 'traffic', storeId: st.id, mult: 1.4, daysLeft: 1, label: 'Street festival' });
      news(s, `Street festival outside ${L.name}: +40% foot traffic today.`, 'good');
      break;
    case 'cheese':
      s.effects.push({ kind: 'price', storeId: null, mult: 1.8, ing: 'cheese', daysLeft: 3, label: 'Mozzarella shortage' });
      news(s, 'Mozzarella shortage: cheese costs 80% more for 3 days.', 'bad');
      break;
    case 'viral':
      s.effects.push({ kind: 'traffic', storeId: st.id, mult: 1.6, daysLeft: 2, label: 'Viral video' });
      news(s, `A video of your pizza at ${L.name} went viral! +60% traffic for 2 days.`, 'good');
      break;
    case 'sale':
      s.effects.push({ kind: 'upgradeSale', storeId: null, mult: 0.8, daysLeft: 1, label: 'Supply sale' });
      news(s, 'Restaurant supply sale: all upgrades 20% off today.', 'good');
      break;
    case 'sick': {
      const pool = activeStaff(st).filter((x) => !x.traits.includes('reliable'));
      if (pool.length) {
        const x = pickOne(s, pool);
        x.status = 'sick';
        x.statusDays = 1;
        news(s, `${x.name} has the flu and is out today.`, 'bad');
      }
      break;
    }
    case 'oven': {
      const repair = 220 + 40 * s.level;
      setChoice(s, {
        kind, storeId: st.id, title: 'The oven is acting up',
        body: `${L.name}: the oven thermostat is flickering. Left alone, it will run at half capacity today.`,
        options: [
          { id: 'repair', label: `Call a technician (${money(repair)})`, detail: 'Fixed before opening.' },
          { id: 'patch', label: 'Patch it yourself ($60)', detail: '50% chance it holds.' },
          { id: 'ignore', label: 'Live with it', detail: 'Half oven capacity today.' },
        ],
        data: { repair },
      });
      break;
    }
    case 'rival':
      setChoice(s, {
        kind, storeId: st.id, title: 'A rival is undercutting you',
        body: `Pizza Pronto opened two blocks from ${L.name} and is running a 2-for-1 promo.`,
        options: [
          { id: 'coupon', label: 'Answer with a Coupon Day', detail: '+60% customers today, prices 20% off.' },
          { id: 'ignore', label: 'Ignore them', detail: '-15% traffic for 3 days.' },
        ],
      });
      break;
    case 'wholesale': {
      const qty = 60;
      const price = Math.round(ING.cheese.cost * qty * 0.55);
      setChoice(s, {
        kind, storeId: st.id, title: 'Wholesale clearance',
        body: `Bellini Foods is clearing ${qty} portions of mozzarella at 45% off for ${L.name}.`,
        options: [
          { id: 'buy', label: `Buy it (${money(price)})`, detail: 'Delivered right away, needs storage space.' },
          { id: 'pass', label: 'Pass', detail: 'No thanks.' },
        ],
        data: { qty, price },
      });
      break;
    }
    case 'raise': {
      const pool = st.staff.filter((x) => x.role !== 'manager');
      if (!pool.length) break;
      const x = pickOne(s, pool);
      setChoice(s, {
        kind, storeId: st.id, title: `${x.name} asks for a raise`,
        body: `${x.name} (${ROLES[x.role].name}, skill ${x.skill}) wants $2/hr more, currently ${money(x.wage, true)}/hr.`,
        options: [
          { id: 'accept', label: 'Give the raise', detail: '+$2/hr, big morale boost.' },
          { id: 'decline', label: 'Not right now', detail: 'Morale drops.' },
        ],
        data: { staffId: x.id },
      });
      break;
    }
  }
}

function setChoice(s: GameState, c: PendingChoice) {
  s.choice = c;
}

export function resolveChoice(s: GameState, optionId: string): string {
  const c = s.choice;
  if (!c) return '';
  s.choice = null;
  const st = s.stores.find((x) => x.id === c.storeId) ?? s.stores[0];
  switch (c.kind) {
    case 'oven':
      if (optionId === 'repair') {
        const cost = Number(c.data?.repair ?? 300);
        s.cash -= cost;
        st.today.other += cost;
        return 'The technician fixed the oven.';
      }
      if (optionId === 'patch') {
        s.cash -= 60;
        st.today.other += 60;
        if (rand(s) < 0.5) return 'Your patch job is holding. Nice.';
        st.ovenPenalty = Math.floor((up(st, 'oven').slots ?? 2) / 2);
        return 'The patch failed. Oven at half capacity today.';
      }
      st.ovenPenalty = Math.floor((up(st, 'oven').slots ?? 2) / 2);
      return 'Oven running at half capacity today.';
    case 'rival':
      if (optionId === 'coupon') {
        st.campaigns.push({ id: 'coupon', daysLeft: 1 });
        return 'Coupon Day is on. Prices are 20% off today.';
      }
      s.effects.push({ kind: 'traffic', storeId: st.id, mult: 0.85, daysLeft: 3, label: 'Rival promo' });
      return 'Pizza Pronto will pull some customers away for a few days.';
    case 'wholesale': {
      if (optionId !== 'buy') return 'You passed on the deal.';
      const qty = Number(c.data?.qty ?? 60), price = Number(c.data?.price ?? 0);
      const free = Math.floor((storageCap(st) - storageUsed(st)) / ING.cheese.space);
      const take = Math.min(qty, free);
      if (take <= 0) return 'No storage space for the cheese. Deal missed.';
      if (s.cash < price) return 'Not enough cash for the deal.';
      const cost = Math.round((price * take) / qty);
      s.cash -= cost;
      st.today.supplies += cost;
      addStock(s, st, 'cheese', take);
      return `Bought ${take} mozzarella for ${money(cost)}.`;
    }
    case 'raise': {
      const x = st.staff.find((q) => q.id === Number(c.data?.staffId));
      if (!x) return '';
      if (optionId === 'accept') {
        x.wage += 2;
        x.morale = clamp(x.morale + 20, 0, 100);
        return `${x.name} is thrilled with the raise.`;
      }
      x.morale = clamp(x.morale - 20, 0, 100);
      return `${x.name} is disappointed.`;
    }
  }
  return '';
}

/** Timed events during the day (inspections, critics). */
export function runScheduled(s: GameState) {
  const t = now(s);
  for (const ev of s.scheduled) {
    if (ev.done || t < ev.at) continue;
    ev.done = true;
    const st = s.stores.find((x) => x.id === ev.storeId);
    if (!st || s.phase !== 'open') continue;
    if (ev.kind === 'inspection') inspect(s, st);
    if (ev.kind === 'critic') {
      spawnCustomer(s, st, true);
      news(s, `A food critic just walked into ${loc(st).name}. Look sharp!`, 'info');
    }
  }
}

function inspect(s: GameState, st: Store) {
  const c = st.cleanliness;
  const L = loc(st);
  if (c >= 85) {
    st.rating = clamp(st.rating + 0.1, 1, 5);
    news(s, `Health inspection at ${L.name}: Grade A! (+rating)`, 'good');
  } else if (c >= 60) {
    news(s, `Health inspection at ${L.name}: passed.`, 'info');
  } else {
    const fine = 250 + 50 * s.level;
    s.cash -= fine;
    st.today.other += fine;
    st.rating = clamp(st.rating - 0.15, 1, 5);
    news(s, `Health inspection at ${L.name} failed: ${money(fine)} fine. Hire a cleaner!`, 'bad');
  }
}

export { stockOf };
