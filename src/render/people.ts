// Low-poly people with simple walk/sit/work animation.
import { box, cached, cylinder, merge, sphere, type Part } from '../engine/geometry';
import { Material, Mesh, Node, Sprite } from '../engine/scene';
import type { V3 } from '../engine/math';
import type { Look } from '../core/types';
import type { Role } from '../data/world';
import { moodTex } from './textures';
import { WHITE, pizzaBox } from './props';

const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#9d6a48', '#7a4e33', '#5a3825'];
const HAIR = ['#2b1d14', '#5a3825', '#a5682f', '#d9b36a', '#1c1c1c', '#8a8a8a', '#7a2f1f'];
const SHIRT = ['#2f6fd1', '#3f9b4a', '#e3a21a', '#8e5bb5', '#d8402b', '#2a9d8f', '#f4a261', '#264653', '#e76f51', '#6d597a'];
const PANTS = ['#2b3a55', '#3a3a3a', '#6b4a2e', '#4a5b3a', '#1d2a3a'];

const ROLE_SHIRT: Record<Role, string> = { cook: '#f6f4ee', cashier: '#c8352a', driver: '#2f6fd1', cleaner: '#3f9b4a', manager: '#2b2724' };

const boxG = () => cached('pbox', () => box(1, 1, 1));
const head = () => cached('phead', () => sphere(0.5, 10, 7, true));
const torso = () => cached('ptorso', () => cylinder(0.5, 0.42, 1, 8, { smooth: true }));
const hatChef = () => cached('phatchef', () => merge([{ geo: cylinder(0.5, 0.5, 1, 10, { smooth: true }), pos: [0, 0.5, 0], scale: [0.26, 0.28, 0.26] }, { geo: sphere(0.5, 10, 6, true), pos: [0, 0.68, 0], scale: [0.34, 0.2, 0.34] }]));
const capG = () => cached('pcap', () => merge([{ geo: sphere(0.5, 10, 6, true, Math.PI / 2), pos: [0, 0, 0], scale: [0.27, 0.22, 0.27] }, { geo: box(1, 1, 1), pos: [0, 0.02, 0.15], scale: [0.2, 0.02, 0.16] }]));
const helmetG = () => cached('phelm', () => sphere(0.5, 10, 6, true, Math.PI / 2));
const hairG = () => cached('phair', () => sphere(0.5, 10, 6, true, Math.PI * 0.55));

const matCache = new Map<string, Material>();
function mat(c: string) {
  let m = matCache.get(c);
  if (!m) {
    m = new Material({ color: c });
    matCache.set(c, m);
  }
  return m;
}

export class Person extends Node {
  legL: Mesh;
  legR: Mesh;
  armL: Mesh;
  armR: Mesh;
  bodyGroup = new Node();
  shL: Node;
  shR: Node;
  bubble: Sprite;
  carry: Mesh;
  tool: Mesh | null = null;
  phase = Math.random() * 10;
  walking = false;
  sitting = false;
  working = false;
  /** Waypoints to follow (world x,z). */
  path: [number, number][] = [];
  dest: [number, number] = [0, 0];
  facing = 0;
  targetFacing = 0;
  despawn = false;
  heightScale: number;
  constructor(look: Look, role: Role | null) {
    super();
    const skin = SKIN[look.skin % SKIN.length];
    const shirt = role ? ROLE_SHIRT[role] : SHIRT[look.shirt % SHIRT.length];
    const pants = role === 'cook' ? '#3a3a3a' : PANTS[look.pants % PANTS.length];
    this.heightScale = look.height;
    this.add(this.bodyGroup);
    const B = this.bodyGroup;
    const leg = (x: number) => {
      const m = new Mesh(boxG(), mat(pants));
      m.position = [x, 0.38, 0];
      m.scale = [0.14, 0.76, 0.16];
      return m;
    };
    // legs pivot from the hip: wrap in nodes
    const hipL = new Node().at(-0.1, 0.76, 0);
    const hipR = new Node().at(0.1, 0.76, 0);
    this.legL = leg(0);
    this.legR = leg(0);
    this.legL.position = [0, -0.38, 0];
    this.legR.position = [0, -0.38, 0];
    hipL.add(this.legL);
    hipR.add(this.legR);
    B.add(hipL, hipR);
    // body, head and headwear share one baked mesh per look (fewer draw calls)
    const hairCol = HAIR[look.hair % HAIR.length];
    const key = `${role ?? 'guest'}|${skin}|${shirt}|${hairCol}`;
    const body = cached('pbody|' + key, () => {
      const parts: Part[] = [
        { geo: torso(), pos: [0, 1.06, 0], scale: [0.46, 0.62, 0.3], color: shirt },
        { geo: head(), pos: [0, 1.58, 0], scale: [0.3, 0.32, 0.3], color: skin },
        { geo: boxG(), pos: [-0.065, 1.6, 0.142], scale: [0.035, 0.05, 0.02], color: '#2b1d14' },
        { geo: boxG(), pos: [0.065, 1.6, 0.142], scale: [0.035, 0.05, 0.02], color: '#2b1d14' },
      ];
      if (role === 'cook') parts.push({ geo: boxG(), pos: [0, 0.92, 0.135], scale: [0.34, 0.62, 0.02], color: '#ffffff' });
      if (role === 'manager') parts.push({ geo: boxG(), pos: [0, 1.12, 0.15], scale: [0.06, 0.4, 0.02], color: '#c8352a' });
      if (role === 'cook') parts.push({ geo: hatChef(), pos: [0, 1.66, 0], color: '#ffffff' });
      else if (role === 'cashier' || role === 'cleaner') parts.push({ geo: capG(), pos: [0, 1.66, 0], color: role === 'cashier' ? '#c8352a' : '#2a7a3c' });
      else if (role === 'driver') parts.push({ geo: helmetG(), pos: [0, 1.6, 0], scale: [0.36, 0.34, 0.36], color: '#f2b33d' });
      else parts.push({ geo: hairG(), pos: [0, 1.6, -0.01], scale: [0.33, 0.33, 0.33], color: hairCol });
      return merge(parts);
    });
    B.add(new Mesh(body, WHITE));
    const armGeo = cached('parm|' + shirt + '|' + skin, () =>
      merge([
        { geo: boxG(), pos: [0, -0.27, 0], scale: [0.11, 0.56, 0.12], color: shirt },
        { geo: boxG(), pos: [0, -0.58, 0], scale: [0.1, 0.1, 0.1], color: skin },
      ]),
    );
    const shL = new Node().at(-0.29, 1.32, 0);
    const shR = new Node().at(0.29, 1.32, 0);
    this.armL = new Mesh(armGeo, WHITE);
    this.armR = new Mesh(armGeo, WHITE);
    shL.add(this.armL);
    shR.add(this.armR);
    B.add(shL, shR);
    this.shL = shL;
    this.shR = shR;
    if (role === 'cleaner') {
      this.tool = new Mesh(cached('mop', () => merge([{ geo: box(1, 1, 1), pos: [0, 0.6, 0], scale: [0.04, 1.3, 0.04], color: '#8a5a35' }, { geo: box(1, 1, 1), pos: [0, 0, 0], scale: [0.3, 0.06, 0.12], color: '#d9d2c3' }])), WHITE);
      this.tool.position = [0.36, 0.02, 0.25];
      B.add(this.tool);
    }
    this.carry = new Mesh(cached('carrybox', () => merge(pizzaBox())), WHITE);
    this.carry.position = [0, 0.92, 0.32];
    this.carry.visible = false;
    B.add(this.carry);
    this.bubble = new Sprite(moodTex('happy'), 0.55, 0.55);
    this.bubble.position = [0, 2.25, 0];
    this.bubble.visible = false;
    this.add(this.bubble);
    this.scale = [look.height, look.height, look.height];
  }

  setMood(m: 'happy' | 'ok' | 'angry' | 'none') {
    if (m === 'none') {
      this.bubble.visible = false;
      return;
    }
    this.bubble.visible = true;
    this.bubble.texture = moodTex(m);
  }

  goTo(path: [number, number][]) {
    this.path = path.slice();
  }

  update(dt: number, speed: number) {
    this.phase += dt * (this.walking ? 9 : 3);
    // movement along path
    this.walking = false;
    if (this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - this.position[0], dz = tz - this.position[2];
      const d = Math.hypot(dx, dz);
      const step = speed * dt;
      if (d <= step || d < 0.02) {
        this.position = [tx, this.position[1], tz];
        this.path.shift();
      } else {
        this.position = [this.position[0] + (dx / d) * step, this.position[1], this.position[2] + (dz / d) * step];
        this.targetFacing = Math.atan2(dx, dz);
        this.walking = true;
      }
    }
    // turn smoothly
    let df = this.targetFacing - this.facing;
    while (df > Math.PI) df -= Math.PI * 2;
    while (df < -Math.PI) df += Math.PI * 2;
    this.facing += df * Math.min(1, dt * 10);
    this.rotation = [0, this.facing, 0];
    const sh = this;
    const legs = [this.legL.parent!, this.legR.parent!];
    if (this.walking) {
      const sw = Math.sin(this.phase) * 0.6;
      legs[0].rotation = [sw, 0, 0];
      legs[1].rotation = [-sw, 0, 0];
      sh.shL.rotation = [-sw * 0.8, 0, 0];
      sh.shR.rotation = [sw * 0.8, 0, 0];
      this.bodyGroup.position = [0, Math.abs(Math.cos(this.phase)) * 0.05, 0];
    } else if (this.sitting) {
      legs[0].rotation = [-1.45, 0, 0];
      legs[1].rotation = [-1.45, 0, 0];
      sh.shL.rotation = [-0.9, 0, 0];
      sh.shR.rotation = [-0.9 + Math.sin(this.phase) * 0.15, 0, 0];
      this.bodyGroup.position = [0, -0.3, 0];
    } else if (this.working) {
      legs[0].rotation = [0, 0, 0];
      legs[1].rotation = [0, 0, 0];
      sh.shL.rotation = [-1.0 + Math.sin(this.phase * 2.2) * 0.25, 0, 0];
      sh.shR.rotation = [-1.0 + Math.cos(this.phase * 2.6) * 0.25, 0, 0];
      this.bodyGroup.position = [0, Math.abs(Math.sin(this.phase)) * 0.02, 0];
    } else {
      legs[0].rotation = [0, 0, 0];
      legs[1].rotation = [0, 0, 0];
      sh.shL.rotation = [Math.sin(this.phase * 0.5) * 0.05, 0, 0];
      sh.shR.rotation = [-Math.sin(this.phase * 0.5) * 0.05, 0, 0];
      this.bodyGroup.position = [0, Math.sin(this.phase * 0.7) * 0.01, 0];
    }
    if (this.tool && this.working) this.tool.position = [0.36 + Math.sin(this.phase * 1.5) * 0.15, 0.02, 0.35];
    // bubble bob
    this.bubble.position = [0, 2.25 + Math.sin(this.phase * 0.8) * 0.04, 0];
  }

  get atDest() {
    return this.path.length === 0;
  }
}

export function lookFacing(from: V3, x: number, z: number) {
  return Math.atan2(x - from[0], z - from[2]);
}
