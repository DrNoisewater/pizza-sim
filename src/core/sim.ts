// The minute-by-minute store simulation. Pure state in, pure state out (plus outbox events).
import { ITEM, MENU, type ItemId } from '../data/catalog';
import { CLOSE_MIN, HARD_CLOSE_MIN, WEATHER } from '../data/world';
import { REVIEW_LINES, type ReviewTopic } from '../data/text';
import type { Customer, GameState, Order, OrderItem, Staff, Store } from './types';
import { activeStaff, hasManager, itemAvailable, loc, onMenu, seatsTotal, up } from './state';
import { choosePizza, customerPatience, deliveryRate, pizzaQuality, salePrice, satisfaction, walkInRate } from './economy';
import { consumeItem, receiveDeliveries } from './inventory';
import { gainXp, randomLook, randomName, staffSpeed } from './staff';
import { addXp, checkGoals } from './progression';
import { clamp, emit, news, newId, now, pickOne, poisson, rand } from './util';
import { endDay, runScheduled } from './day';

export const STEP = 0.25;
const MAX_LINE = 10;
const WAIT_SPOTS = 10;

/** Advance the world by `minutes` of game time. */
export function advance(s: GameState, minutes: number) {
  if ((s.phase !== 'open' && s.phase !== 'closing') || s.choice || s.gameOver) return;
  let left = minutes;
  let guard = 0;
  while (left > 1e-9 && guard++ < 2000) {
    const dt = Math.min(STEP, left);
    step(s, dt);
    left -= dt;
    if (s.phase !== 'open' && s.phase !== 'closing') break;
    if (s.choice) break;
  }
}

function step(s: GameState, dt: number) {
  s.minute += dt;
  if (s.phase === 'open' && s.minute >= CLOSE_MIN) {
    s.phase = 'closing';
    news(s, 'Doors closed for the night. Finishing the last orders.', 'info', false);
  }
  for (const st of s.stores) stepStore(s, st, dt);
  runScheduled(s);
  if (Math.floor(s.minute) % 15 === 0 && Math.floor(s.minute - dt) % 15 !== 0) checkGoals(s);
  if (s.phase === 'closing') {
    const busy = s.stores.some((st) => st.customers.some((c) => c.state !== 'leave') || st.orders.length > 0);
    if (!busy || s.minute >= HARD_CLOSE_MIN) endDay(s);
  }
}

// ------------------------------------------------------------------ store step

function stepStore(s: GameState, st: Store, dt: number) {
  receiveDeliveries(s, st, false);
  if (s.phase === 'open') {
    const nWalk = poisson(s, (walkInRate(s, st) * dt) / 60);
    for (let i = 0; i < nWalk; i++) spawnCustomer(s, st, false);
    const hasDriver = activeStaff(st, 'driver').length > 0;
    const nDel = poisson(s, (deliveryRate(s, st, hasDriver) * dt) / 60);
    for (let i = 0; i < nDel; i++) spawnDelivery(s, st);
  }
  updateCustomers(s, st, dt);
  progressTasks(s, st, dt);
  assignTasks(s, st);
  updateOvens(s, st, dt);
  checkOrders(s, st);
  // cleanliness & energy
  const decay = up(st, 'cleaning').decay ?? 1;
  const present = st.customers.length;
  st.cleanliness -= 0.006 * dt * decay * (1 + present * 0.2);
  const brk = up(st, 'breakroom').energy ?? 0;
  for (const x of st.staff) {
    if (x.status !== 'active') continue;
    const busy = x.task !== null || (x.role === 'cleaner' && st.cleanliness < 98);
    if (busy) x.busyMin += dt;
    x.energy = clamp(x.energy - (busy ? 0.07 : 0.025) * dt + (brk / 60) * dt * (busy ? 0.4 : 1), 0, 100);
    if (x.role === 'cleaner' && st.cleanliness < 100) {
      st.cleanliness += 0.6 * staffSpeed(s, st, x) * dt;
    } else if (!x.task && (x.role === 'cashier' || x.role === 'cook') && st.cleanliness < 92) {
      st.cleanliness += 0.05 * staffSpeed(s, st, x) * dt;
    }
  }
  st.cleanliness = clamp(st.cleanliness, 0, 100);
}

function lineLength(st: Store) {
  let n = 0;
  for (const c of st.customers) if (c.state === 'enter' || c.state === 'queue' || c.state === 'ordering') n++;
  return n;
}

export function spawnCustomer(s: GameState, st: Store, critic: boolean) {
  if (!critic && lineLength(st) >= MAX_LINE) {
    st.today.lost++;
    s.stats.lost++;
    rateLost(st, 0.003);
    if (rand(s) < 0.05) addReview(s, st, 1, 'walkout');
    return;
  }
  const c: Customer = {
    id: newId(s),
    kind: critic || rand(s) < 0.55 ? 'dine' : 'takeout',
    state: 'enter',
    t: 0,
    patience: customerPatience(s, st) * (critic ? 1.5 : 1),
    arrived: now(s),
    mood: 'none',
    look: randomLook(s),
    critic,
  };
  st.customers.push(c);
}

function rateLost(st: Store, w: number) {
  st.rating = clamp(st.rating + (1 - st.rating) * w, 1, 5);
}

function spawnDelivery(s: GameState, st: Store) {
  const items = buildItems(s, st, true, 0, true);
  if (!items) {
    st.today.lost++;
    st.today.soldOut++;
    s.stats.lost++;
    return;
  }
  const o = createOrder(s, st, 'delivery', items, undefined, 0);
  o.expected = 38 * loc(st).deliveryDist;
}

/** Choose and reserve items for a new order. Returns null if no pizza can be made. */
function buildItems(s: GameState, st: Store, boxed: boolean, upsell: number, delivery: boolean): OrderItem[] | null {
  const r = rand(s);
  const nP = delivery ? (r < 0.55 ? 1 : r < 0.9 ? 2 : 3) : r < 0.78 ? 1 : r < 0.96 ? 2 : 3;
  const items: OrderItem[] = [];
  let cost = 0;
  for (let i = 0; i < nP; i++) {
    let id = choosePizza(s, st);
    if (!id) break;
    if (!itemAvailable(st, id, boxed)) {
      if (rand(s) < 0.65) {
        const alts = MENU.filter((m) => m.type === 'pizza' && onMenu(s, st, m.id) && itemAvailable(st, m.id, boxed));
        id = alts.length ? pickOne(s, alts).id : null;
      } else id = null;
    }
    if (!id) continue;
    cost += consumeItem(s, st, id, boxed);
    items.push({ item: id, stage: 'queued', progress: 0, quality: 60 });
  }
  if (!items.length) return null;
  if (onMenu(s, st, 'knots') && rand(s) < 0.28 + upsell && itemAvailable(st, 'knots', boxed)) {
    cost += consumeItem(s, st, 'knots', boxed);
    items.push({ item: 'knots', stage: 'queued', progress: 0, quality: 60 });
  }
  const drinkChance = (0.4 + upsell) * WEATHER[s.weather].drinks * (loc(st).prefs.soda ?? 1);
  if (onMenu(s, st, 'soda') && rand(s) < drinkChance && itemAvailable(st, 'soda', false)) {
    cost += consumeItem(s, st, 'soda', false);
    items.push({ item: 'soda', stage: 'done', progress: 1, quality: 70 });
    if (rand(s) < drinkChance * 0.3 && itemAvailable(st, 'soda', false)) {
      cost += consumeItem(s, st, 'soda', false);
      items.push({ item: 'soda', stage: 'done', progress: 1, quality: 70 });
    }
  }
  st.today.foodCost += cost;
  return items;
}

function createOrder(s: GameState, st: Store, kind: Order['kind'], items: OrderItem[], c: Customer | undefined, charm: number): Order {
  let total = 0;
  for (const it of items) {
    total += salePrice(st, it.item);
    st.today.sold[it.item] = (st.today.sold[it.item] ?? 0) + 1;
  }
  const o: Order = {
    id: newId(s),
    kind,
    customerId: c?.id,
    name: randomName(s),
    items,
    total,
    placed: now(s),
    expected: kind === 'dine' ? 18 : 15,
    state: 'kitchen',
    charm,
    critic: c?.critic,
  };
  st.orders.push(o);
  s.cash += total;
  st.today.revenue += total;
  s.stats.revenue += total;
  const todayAll = s.stores.reduce((a, x) => a + x.today.revenue, 0);
  if (todayAll > s.stats.bestDayRevenue) s.stats.bestDayRevenue = todayAll;
  emit({ type: 'sale', storeId: st.id, amount: total, customerId: c?.id });
  return o;
}

// ------------------------------------------------------------------ customers

function freeSeat(s: GameState, st: Store): number {
  const n = seatsTotal(st);
  const used = new Set<number>();
  for (const c of st.customers) if (c.seat !== undefined && c.state !== 'leave') used.add(c.seat);
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!used.has(i)) free.push(i);
  if (!free.length) return -1;
  return free[Math.floor(rand(s) * free.length)];
}
function freeWaitSpot(st: Store): number {
  const used = new Set<number>();
  for (const c of st.customers) if (c.waitSpot !== undefined && c.state !== 'leave') used.add(c.waitSpot);
  for (let i = 0; i < WAIT_SPOTS; i++) if (!used.has(i)) return i;
  return WAIT_SPOTS - 1;
}

function updateCustomers(s: GameState, st: Store, dt: number) {
  const t = now(s);
  for (const c of st.customers) {
    switch (c.state) {
      case 'enter':
        c.t += dt;
        if (c.t >= 0.8) {
          c.state = 'queue';
          c.t = 0;
        }
        break;
      case 'queue': {
        c.t += dt;
        const f = c.t / c.patience;
        c.mood = f < 0.45 ? 'happy' : f < 0.8 ? 'ok' : 'angry';
        if (c.t > c.patience) {
          c.state = 'leave';
          c.t = 0;
          c.mood = 'angry';
          st.today.lost++;
          s.stats.lost++;
          rateLost(st, c.critic ? 0.25 : 0.008);
          emit({ type: 'walkout', storeId: st.id, customerId: c.id });
          if (c.critic) {
            addReview(s, st, 1, 'walkout', true);
            news(s, 'The food critic gave up on the line and walked out. Ouch.', 'bad');
          } else if (rand(s) < 0.12) addReview(s, st, 1, 'walkout');
        }
        break;
      }
      case 'toSeat':
        c.t += dt;
        if (c.t >= 0.6) {
          c.state = 'waitFood';
          c.t = 0;
        }
        break;
      case 'waitFood': {
        c.t += dt;
        const o = st.orders.find((x) => x.id === c.orderId);
        if (!o) {
          c.state = 'leave';
          c.t = 0;
          break;
        }
        const wait = t - c.arrived;
        const f = wait / o.expected;
        c.mood = f < 0.7 ? 'happy' : f < 1.2 ? 'ok' : 'angry';
        if (wait > o.expected * 2.5) refund(s, st, o, c);
        break;
      }
      case 'eating':
        c.t += dt;
        c.mood = 'none';
        if (c.t >= (c.eatFor ?? 15)) {
          c.state = 'leave';
          c.t = 0;
        }
        break;
      case 'leave':
        c.t += dt;
        break;
      case 'ordering':
        break;
    }
  }
  st.customers = st.customers.filter((c) => !(c.state === 'leave' && c.t > 1.2));
  // delivery orders that waited far too long
  for (const o of st.orders) {
    if (o.kind === 'delivery' && (o.state === 'kitchen' || o.state === 'ready') && t - o.placed > o.expected * 2.5) refund(s, st, o, undefined);
  }
}

function refund(s: GameState, st: Store, o: Order, c: Customer | undefined) {
  o.state = 'refunded';
  s.cash -= o.total;
  st.today.revenue -= o.total;
  s.stats.revenue -= o.total;
  st.today.refunds++;
  st.today.lost++;
  s.stats.lost++;
  st.orders = st.orders.filter((x) => x !== o);
  st.deliveryQueue = st.deliveryQueue.filter((id) => id !== o.id);
  rateLost(st, o.critic ? 0.3 : 0.015);
  if (c) {
    c.state = 'leave';
    c.t = 0;
    c.mood = 'angry';
  }
  // free any cook working on it
  for (const x of st.staff) if (x.task?.kind === 'prep' && x.task.orderId === o.id) x.task = null;
  addReview(s, st, 1, 'refund', o.critic);
  emit({ type: 'walkout', storeId: st.id, customerId: c?.id, text: 'Refund' });
  if (rand(s) < 0.4 || o.critic) news(s, `Refunded ${o.name}: waited too long${o.kind === 'delivery' ? ' for delivery' : ''}.`, 'bad');
}

// ------------------------------------------------------------------ staff tasks

function progressTasks(s: GameState, st: Store, dt: number) {
  for (const x of st.staff) {
    const task = x.task;
    if (!task || x.status !== 'active') continue;
    task.remaining -= dt;
    if (task.kind === 'deliver' && !task.dropped && task.total - task.remaining >= (task.dropAt ?? 0)) {
      task.dropped = true;
      for (const id of task.orderIds ?? []) {
        const o = st.orders.find((q) => q.id === id);
        if (o) completeOrder(s, st, o, now(s) - o.placed);
      }
    }
    if (task.remaining > 0) continue;
    x.task = null;
    x.tasksToday++;
    switch (task.kind) {
      case 'order': {
        const c = st.customers.find((q) => q.id === task.customerId);
        if (c && c.state === 'ordering') takeOrder(s, st, c, x);
        gainXp(s, x, 1);
        break;
      }
      case 'prep': {
        const o = st.orders.find((q) => q.id === task.orderId);
        if (!o) break;
        const it = o.items[task.itemIdx ?? 0];
        if (!it || it.stage !== 'prep') break;
        if (x.traits.includes('clumsy') && rand(s) < 0.06) {
          it.stage = 'queued';
          if (itemAvailable(st, it.item, false)) st.today.foodCost += consumeItem(s, st, it.item, false);
          if (rand(s) < 0.5) news(s, `${x.name} dropped a ${ITEM[it.item].name} on the floor. Remaking it.`, 'bad', false);
          break;
        }
        it.quality = pizzaQuality(s, st, it.item, x.skill, x.traits.includes('perfectionist'), x.energy);
        it.stage = ITEM[it.item].bake > 0 ? 'ovenWait' : 'done';
        it.progress = 0;
        gainXp(s, x, 1);
        break;
      }
      case 'deliver':
        gainXp(s, x, 1.5);
        break;
      case 'clean':
        break;
    }
  }
  // kiosk
  if (st.kiosk) {
    st.kiosk.remaining -= dt;
    if (st.kiosk.remaining <= 0) {
      const c = st.customers.find((q) => q.id === st.kiosk!.customerId);
      st.kiosk = null;
      if (c && c.state === 'ordering') takeOrder(s, st, c, null);
    }
  }
}

function takeOrder(s: GameState, st: Store, c: Customer, taker: Staff | null) {
  let kind = c.kind;
  let seat = -1;
  if (kind === 'dine') {
    seat = freeSeat(s, st);
    if (seat < 0) kind = 'takeout';
  }
  const upsell = taker?.traits.includes('upseller') ? 0.2 : 0;
  const items = buildItems(s, st, kind !== 'dine', upsell, false);
  if (!items) {
    c.state = 'leave';
    c.t = 0;
    c.mood = 'angry';
    st.today.lost++;
    st.today.soldOut++;
    s.stats.lost++;
    rateLost(st, 0.006);
    if (rand(s) < 0.25) addReview(s, st, 1.5, 'soldout');
    emit({ type: 'walkout', storeId: st.id, customerId: c.id, text: 'Sold out' });
    return;
  }
  const charm = taker?.traits.includes('charming') ? 5 : 0;
  c.kind = kind;
  const o = createOrder(s, st, kind, items, c, charm);
  c.orderId = o.id;
  c.t = 0;
  if (kind === 'dine') {
    c.seat = seat;
    c.state = 'toSeat';
  } else {
    c.waitSpot = freeWaitSpot(st);
    c.state = 'waitFood';
  }
}

function prepStationsInUse(st: Store) {
  const used = new Set<number>();
  for (const x of st.staff) if (x.task?.kind === 'prep' && x.task.station !== undefined) used.add(x.task.station);
  return used;
}

function nextQueuedItem(st: Store): { o: Order; idx: number } | null {
  for (const o of st.orders) {
    if (o.state !== 'kitchen') continue;
    const idx = o.items.findIndex((it) => it.stage === 'queued');
    if (idx >= 0) return { o, idx };
  }
  return null;
}

function assignTasks(s: GameState, st: Store) {
  const queue = st.customers.filter((c) => c.state === 'queue').sort((a, b) => a.arrived - b.arrived);
  const active = st.staff.filter((x) => x.status === 'active');
  const regTime = up(st, 'register').orderTime ?? 1.6;
  const startOrder = (x: Staff | null, speed: number) => {
    const c = queue.shift();
    if (!c) return false;
    c.state = 'ordering';
    c.mood = 'happy';
    if (x) {
      const total = regTime / speed;
      x.task = { kind: 'order', remaining: total, total, customerId: c.id };
    } else {
      st.kiosk = { customerId: c.id, remaining: 1.4 };
    }
    return true;
  };
  // cashiers
  for (const x of active) {
    if (x.task || x.role !== 'cashier' || !queue.length) continue;
    startOrder(x, staffSpeed(s, st, x));
  }
  // self-order kiosk
  if (up(st, 'register').kiosk && !st.kiosk && queue.length) startOrder(null, 1);
  // cooks
  const stations = up(st, 'prep').stations ?? 1;
  const prepSpeed = up(st, 'prep').speed ?? 1;
  const inUse = prepStationsInUse(st);
  for (const x of active) {
    if (x.task || x.role !== 'cook') continue;
    const next = nextQueuedItem(st);
    const cashiers = active.some((y) => y.role === 'cashier');
    // a cook covers the register when there is no cashier, or the line is long and the kitchen is clear
    const help = queue.length > 0 && ((!cashiers && (!next || queue.length >= 3)) || (cashiers && !next && queue.length >= 3));
    if (help) {
      startOrder(x, staffSpeed(s, st, x) * 0.6);
      continue;
    }
    if (!next || inUse.size >= stations) continue;
    let station = 0;
    while (inUse.has(station)) station++;
    inUse.add(station);
    const it = next.o.items[next.idx];
    it.stage = 'prep';
    const total = ITEM[it.item].prep / (staffSpeed(s, st, x) * prepSpeed);
    x.task = { kind: 'prep', remaining: total, total, orderId: next.o.id, itemIdx: next.idx, station };
  }
  // managers lend a hand at the register in a rush
  for (const x of active) {
    if (x.task || x.role !== 'manager' || queue.length < 2) continue;
    startOrder(x, staffSpeed(s, st, x) * 0.8);
  }
  // drivers
  const cap = up(st, 'delivery').vehicleCap ?? 0;
  if (cap > 0) {
    for (const x of active) {
      if (x.task || x.role !== 'driver' || !st.deliveryQueue.length) continue;
      const ids = st.deliveryQueue.splice(0, cap);
      for (const id of ids) {
        const o = st.orders.find((q) => q.id === id);
        if (o) o.state = 'out';
      }
      const L = loc(st);
      const total = ((13 + 5 * (ids.length - 1)) * L.deliveryDist * (up(st, 'delivery').vehicleSpeed ?? 1)) / Math.max(0.6, staffSpeed(s, st, x));
      x.task = { kind: 'deliver', remaining: total, total, orderIds: ids, dropAt: total * 0.55, dropped: false };
      emit({ type: 'delivery', storeId: st.id });
    }
  }
}

// ------------------------------------------------------------------ ovens & orders

export function ovenSlots(st: Store) {
  return Math.max(1, (up(st, 'oven').slots ?? 2) - st.ovenPenalty);
}

function updateOvens(s: GameState, st: Store, dt: number) {
  const slots = ovenSlots(st);
  const bakeTime = up(st, 'oven').bakeTime ?? 7;
  let baking = 0;
  for (const o of st.orders) for (const it of o.items) if (it.stage === 'baking') baking++;
  for (const o of st.orders) {
    for (const it of o.items) {
      if (it.stage === 'baking') {
        it.progress += dt / (bakeTime * ITEM[it.item].bake);
        if (it.progress >= 1) {
          it.progress = 1;
          it.stage = 'done';
          baking--;
        }
      }
    }
  }
  if (baking < slots) {
    for (const o of st.orders) {
      for (const it of o.items) {
        if (baking >= slots) return;
        if (it.stage === 'ovenWait') {
          it.stage = 'baking';
          it.progress = 0;
          baking++;
        }
      }
    }
  }
}

function checkOrders(s: GameState, st: Store) {
  const t = now(s);
  for (const o of [...st.orders]) {
    if (o.state !== 'kitchen') continue;
    if (!o.items.every((it) => it.stage === 'done')) continue;
    if (o.kind === 'delivery') {
      o.state = 'ready';
      st.deliveryQueue.push(o.id);
      continue;
    }
    const c = st.customers.find((q) => q.id === o.customerId);
    if (!c) {
      st.orders = st.orders.filter((x) => x !== o);
      continue;
    }
    if (o.kind === 'dine') {
      c.state = 'eating';
      c.t = 0;
      c.eatFor = 12 + rand(s) * 10;
    } else {
      c.state = 'leave';
      c.t = 0;
    }
    completeOrder(s, st, o, t - c.arrived);
  }
}

function completeOrder(s: GameState, st: Store, o: Order, waitMin: number) {
  o.state = 'done';
  st.orders = st.orders.filter((x) => x !== o);
  const r = satisfaction(s, st, o, waitMin);
  const w = o.critic ? 0.3 : 0.02;
  st.rating = clamp(st.rating + (r.stars - st.rating) * w, 1, 5);
  st.today.served++;
  st.today.satSum += r.sat;
  st.today.satCount++;
  s.stats.served++;
  if (o.kind === 'delivery') {
    st.today.deliveries++;
    s.stats.deliveries++;
  }
  const decay = up(st, 'cleaning').decay ?? 1;
  st.cleanliness = clamp(st.cleanliness - (o.kind === 'dine' ? 1.2 : o.kind === 'takeout' ? 0.5 : 0) * decay, 0, 100);
  addXp(s, 1 + (r.stars >= 3.5 ? 1 : 0) + (r.stars >= 4.5 ? 1 : 0));
  if (o.critic) {
    addReview(s, st, r.stars, r.topic, true);
    news(s, `The food critic rated ${loc(st).name} ${r.stars.toFixed(1)}★. ${r.stars >= 4 ? 'Rave review!' : r.stars >= 3 ? 'A fair write-up.' : 'A brutal write-up.'}`, r.stars >= 3.5 ? 'good' : 'bad');
  } else if (rand(s) < 0.12) addReview(s, st, r.stars, r.topic);
  const c = st.customers.find((q) => q.id === o.customerId);
  if (c) c.mood = r.stars >= 3.5 ? 'happy' : r.stars >= 2.5 ? 'ok' : 'angry';
  emit({ type: 'served', storeId: st.id, customerId: o.customerId, stars: r.stars });
  if (hasManager(st) && rand(s) < 0.001) news(s, 'Your manager reorganized the walk-in. Everything runs smoother.', 'info', false);
}

export function addReview(s: GameState, st: Store, stars: number, topic: ReviewTopic, critic = false) {
  const lines = REVIEW_LINES[topic];
  const text = lines[Math.floor(rand(s) * lines.length)];
  st.reviews.unshift({ day: s.day, name: critic ? 'Food critic, The Daily Crust' : randomName(s), stars: Math.round(stars * 2) / 2, topic, text, critic });
  if (st.reviews.length > 40) st.reviews.length = 40;
  emit({ type: 'review', storeId: st.id, stars, text });
}

export function itemsInStage(st: Store, stage: OrderItem['stage']) {
  let n = 0;
  for (const o of st.orders) for (const it of o.items) if (it.stage === stage) n++;
  return n;
}
export type { ItemId };
