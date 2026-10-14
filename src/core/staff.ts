// Staff: candidates, wages, speed, skill growth, morale.
import { FIRST_NAMES, LAST_INITIALS } from '../data/text';
import { ROLES, TRAITS, type Role, type TraitId } from '../data/world';
import type { Candidate, GameState, Look, Staff, Store } from './types';
import { clamp, pickOne, rand, randInt, news } from './util';
import { hasManager, up } from './state';

export function randomLook(s: GameState): Look {
  return { skin: randInt(s, 0, 5), hair: randInt(s, 0, 6), shirt: randInt(s, 0, 9), pants: randInt(s, 0, 4), height: 0.92 + rand(s) * 0.16 };
}

export function marketWage(role: Role, skill: number) {
  const r = ROLES[role];
  return Math.round((r.baseWage + r.perSkill * (skill - 1)) * 2) / 2;
}

export const SKILL_XP = [0, 90, 200, 340, 500];
export function xpToNext(skill: number) {
  return SKILL_XP[Math.min(skill, 4)] || 9999;
}
export function trainingCost(skill: number) {
  return [0, 150, 350, 700, 1200][skill] ?? 0;
}
export function trainingReq(skill: number) {
  return [0, 1, 3, 4, 6][skill] ?? 99;
}

const ROLE_POOL: Role[] = ['cook', 'cook', 'cook', 'cashier', 'cashier', 'driver', 'cleaner'];
const GOOD: TraitId[] = ['speedy', 'charming', 'upseller', 'perfectionist', 'reliable', 'veteran', 'nightowl'];
const BAD: TraitId[] = ['clumsy', 'slacker'];

export function rollCandidates(s: GameState, st: Store): Candidate[] {
  const out: Candidate[] = [];
  const n = 4 + (s.level >= 5 ? 1 : 0);
  const roles: Role[] = [];
  // guarantee useful variety
  roles.push('cook', 'cashier');
  if (st.upgrades.delivery > 0) roles.push('driver');
  if (s.level >= 4 && !st.staff.some((x) => x.role === 'manager') && rand(s) < 0.6) roles.push('manager');
  while (roles.length < n) roles.push(pickOne(s, ROLE_POOL.filter((r) => r !== 'driver' || st.upgrades.delivery > 0)));
  for (const role of roles.slice(0, n)) {
    const r3 = 0.08 + Math.min(0.3, s.level * 0.03) + (st.rating - 3) * 0.05;
    const roll = rand(s);
    let skill = roll < r3 ? 3 : roll < r3 + 0.35 ? 2 : 1;
    if (s.level >= 8 && rand(s) < 0.15) skill = 4;
    if (role === 'manager') skill = Math.max(2, skill);
    const traits: TraitId[] = [];
    const tCount = rand(s) < 0.55 ? 1 : rand(s) < 0.3 ? 2 : 0;
    for (let i = 0; i < tCount; i++) {
      const pool = rand(s) < 0.75 ? GOOD : BAD;
      const t = pickOne(s, pool);
      if (!traits.includes(t) && !(t === 'speedy' && traits.includes('slacker')) && !(t === 'slacker' && traits.includes('speedy'))) traits.push(t);
    }
    const goodCount = traits.filter((t) => TRAITS[t].good).length - traits.filter((t) => !TRAITS[t].good).length;
    const wage = Math.round(marketWage(role, skill) * (0.92 + rand(s) * 0.16 + goodCount * 0.05) * 2) / 2;
    out.push({ id: ++s.nextId, name: randomName(s), role, skill, wage, traits, look: randomLook(s) });
  }
  return out;
}

export function randomName(s: GameState) {
  return `${pickOne(s, FIRST_NAMES)} ${LAST_INITIALS[Math.floor(rand(s) * LAST_INITIALS.length)]}.`;
}

export function makeStaffFromCandidate(s: GameState, c: Candidate): Staff {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    skill: c.skill,
    xp: 0,
    morale: 70,
    energy: 100,
    wage: c.wage,
    traits: c.traits,
    hiredDay: s.day,
    status: 'active',
    statusDays: 0,
    task: null,
    busyMin: 0,
    tasksToday: 0,
    bonusDay: -1,
    look: c.look,
  };
}

/** Work-speed multiplier (1.0 = baseline). */
export function staffSpeed(s: GameState, st: Store, x: Staff): number {
  let v = 0.65 + 0.15 * x.skill;
  v *= 0.8 + 0.4 * (x.morale / 100);
  v *= 0.75 + 0.25 * (x.energy / 100);
  if (x.traits.includes('speedy')) v *= 1.15;
  if (x.traits.includes('slacker')) v *= 0.85;
  if (x.traits.includes('perfectionist')) v *= 0.92;
  if (x.traits.includes('nightowl') && s.minute >= 18 * 60) v *= 1.1;
  if (hasManager(st) && x.role !== 'manager') v *= 1.05;
  return v;
}

export function gainXp(s: GameState, x: Staff, amount: number) {
  if (x.skill >= 5) return;
  x.xp += amount * (x.traits.includes('veteran') ? 1.5 : 1);
  const need = xpToNext(x.skill);
  if (x.xp >= need) {
    x.xp -= need;
    x.skill++;
    news(s, `${x.name} improved to ${ROLES[x.role].name} skill ${x.skill} on the job.`, 'good');
  }
}

/** End-of-day morale/energy/status update. Returns quitters. */
export function nightlyStaff(s: GameState, st: Store, openMinutes: number): Staff[] {
  const quit: Staff[] = [];
  const brk = up(st, 'breakroom');
  const mgr = hasManager(st);
  for (const x of st.staff) {
    // status timers
    if (x.status === 'training') {
      x.statusDays--;
      if (x.statusDays <= 0) {
        x.status = 'active';
        x.skill = Math.min(5, x.skill + 1);
        x.xp = 0;
        news(s, `${x.name} finished training: now skill ${x.skill}.`, 'good');
      }
    } else if (x.status === 'sick') {
      x.statusDays--;
      if (x.statusDays <= 0) x.status = 'active';
    }
    const market = marketWage(x.role, x.skill);
    let d = ((x.wage - market) / market) * 40;
    const busy = openMinutes > 0 ? x.busyMin / openMinutes : 0;
    if (busy > 0.88) d -= 7;
    else if (busy > 0.75) d -= 3;
    else if (busy < 0.35) d += 1;
    d += brk.morale ?? 0;
    if (mgr && x.role !== 'manager') d += 2;
    d += (60 - x.morale) * 0.05;
    if (x.traits.includes('reliable') && d < 0) d *= 0.5;
    x.morale = clamp(x.morale + clamp(d, -15, 10), 0, 100);
    x.energy = 100;
    x.busyMin = 0;
    x.tasksToday = 0;
    x.task = null;
    if (x.morale < 20 && rand(s) < 0.3) quit.push(x);
  }
  for (const q of quit) {
    st.staff.splice(st.staff.indexOf(q), 1);
    news(s, `${q.name} quit. Morale was too low.`, 'bad');
  }
  return quit;
}
