// The 3D view of the selected store: builds the pizzeria from its upgrades and
// animates customers, staff, vehicles, weather and the day/night cycle.
import { Renderer, Lines } from '../engine/renderer';
import { Camera, Material, Mesh, Node, Sprite, pick, type Environment, type PointLight } from '../engine/scene';
import { OrbitControls } from '../engine/controls';
import { box, panelUV, plane, merge, cached, cylinder } from '../engine/geometry';
import { hex, mixColor, clamp, lerp, v3, type V3 } from '../engine/math';
import type { GameState, Store, Customer, Staff } from '../core/types';
import { ITEM, ING, MENU, type IngId } from '../data/catalog';
import { LOC, type EnvId } from '../data/world';
import { up } from '../core/state';
import { ovenSlots, itemsInStage } from '../core/sim';
import { salePrice } from '../core/economy';
import { Person } from './people';
import { Particles } from './fx';
import { LiveProps, starterProps, streetProps } from './dressing';
import * as P from './props';
import * as T from './textures';

// ---------------------------------------------------------------- layout (meters)
const DOOR_IN: [number, number] = [-0.6, 4.3];
const DOOR_OUT: [number, number] = [-0.6, 6.3];
const QUEUE: [number, number][] = [[-2.4, 0.35], [-2.4, 1.1], [-2.4, 1.85], [-2.4, 2.6], [-2.95, 3.25], [-3.65, 3.65], [-4.35, 4.0], [-5.05, 4.25], [-5.75, 4.45], [-6.4, 4.0]];
const REG_X = [-2.4, -0.8];
const ORDER_Z = -0.42;
const REG_STAFF_Z = -1.85;
const KIOSK_POS: [number, number] = [1.25, -0.45];
const WAIT: [number, number][] = [[-5.6, -0.35], [-4.8, -0.3], [-6.3, 0.35], [-5.5, 0.45], [-4.7, 0.5], [-6.3, 1.25], [-5.5, 1.3], [-4.7, 1.35], [-6.0, 2.1], [-5.2, 2.15]];
const TABLES: [number, number][] = [[2.6, -0.15], [5.4, -0.15], [2.6, 1.4], [5.4, 1.4], [2.6, 2.95], [5.4, 2.95], [2.6, 4.35], [5.4, 4.35]];
const STATIONS_X = [-4.9, -3.15, -1.4, 0.35];
const STATION_Z = -2.75;
const COOK_Z = -3.45;
const EXTRA_COOK: [number, number][] = [[1.4, -3.3], [-0.5, -3.95], [1.6, -2.6], [-2.2, -3.95]];
const DRIVER_IDLE: [number, number][] = [[6.5, -2.2], [6.0, -2.6], [6.5, -2.9], [5.9, -2.0]];
const PARK: [number, number][] = [[8.6, -3.4], [8.6, -1.6], [8.6, 0.2]];
const MANAGER_POS: [number, number] = [4.8, -1.95];
const CLEAN_POINTS: [number, number][] = [[1.6, 0.6], [4.0, 0.6], [4.0, 2.2], [1.8, 3.6], [4.0, 3.7], [-1.0, 2.5], [-4.5, 2.8], [6.4, 2.2], [-3.6, 0.9], [0.4, 1.2]];

function seatPos(seat: number): { x: number; z: number; face: number; table: [number, number] } {
  const t = TABLES[Math.floor(seat / 2) % TABLES.length];
  const left = seat % 2 === 0;
  return { x: t[0] + (left ? -0.62 : 0.62), z: t[1], face: left ? Math.PI / 2 : -Math.PI / 2, table: t };
}

// ---------------------------------------------------------------- day/night keyframes
interface Key { m: number; clear: string; sky: string; ground: string; sun: string; sunI: number; elev: number; az: number; inside: number }
const KEYS: Key[] = [
  { m: 0, clear: '#141a2e', sky: '#2a3555', ground: '#1a1c24', sun: '#7f90c8', sunI: 0.22, elev: 0.75, az: 2.4, inside: 1 },
  { m: 6 * 60, clear: '#3a3f5c', sky: '#4a5576', ground: '#2a2a30', sun: '#c08070', sunI: 0.2, elev: 0.08, az: -1.2, inside: 1 },
  { m: 8 * 60 + 30, clear: '#9fc9ea', sky: '#a8c8e6', ground: '#6f6656', sun: '#ffe0b4', sunI: 0.85, elev: 0.42, az: -0.9, inside: 0.45 },
  { m: 12 * 60, clear: '#8cc6ef', sky: '#b2d2ef', ground: '#7b7262', sun: '#fff6e6', sunI: 1.0, elev: 1.0, az: -0.2, inside: 0.3 },
  { m: 16 * 60 + 30, clear: '#94c2e6', sky: '#aecbe6', ground: '#776c5c', sun: '#ffe9c8', sunI: 0.92, elev: 0.7, az: 0.6, inside: 0.35 },
  { m: 19 * 60, clear: '#f0a46c', sky: '#e7b48e', ground: '#6a4f40', sun: '#ff9a5a', sunI: 0.72, elev: 0.18, az: 1.1, inside: 0.7 },
  { m: 20 * 60 + 15, clear: '#4f4672', sky: '#6a5a86', ground: '#2f2a35', sun: '#c86a6a', sunI: 0.25, elev: 0.04, az: 1.3, inside: 0.95 },
  { m: 21 * 60 + 15, clear: '#18203a', sky: '#2c3658', ground: '#1a1c24', sun: '#7f90c8', sunI: 0.2, elev: 0.75, az: 2.4, inside: 1 },
  { m: 24 * 60, clear: '#141a2e', sky: '#2a3555', ground: '#1a1c24', sun: '#7f90c8', sunI: 0.22, elev: 0.75, az: 2.4, inside: 1 },
];
function keyAt(minute: number) {
  const m = ((minute % 1440) + 1440) % 1440;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].m <= m) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((m - a.m) / (b.m - a.m), 0, 1);
  return {
    clear: mixColor(hex(a.clear), hex(b.clear), t),
    sky: mixColor(hex(a.sky), hex(b.sky), t),
    ground: mixColor(hex(a.ground), hex(b.ground), t),
    sun: mixColor(hex(a.sun), hex(b.sun), t),
    sunI: lerp(a.sunI, b.sunI, t),
    elev: lerp(a.elev, b.elev, t),
    az: lerp(a.az, b.az, t),
    inside: lerp(a.inside, b.inside, t),
  };
}

const ENV_STYLE: Record<EnvId, { ground: 'grass' | 'concrete' | 'wood' | 'tile'; facade: string; trim: string }> = {
  suburb: { ground: 'grass', facade: '#d9c4a0', trim: '#2f4f3a' },
  campus: { ground: 'grass', facade: '#a65a3e', trim: '#1f3a5f' },
  city: { ground: 'concrete', facade: '#8a8f96', trim: '#2b2b2e' },
  harbor: { ground: 'wood', facade: '#d6e3e8', trim: '#1f5f7a' },
  airport: { ground: 'tile', facade: '#c9cdd2', trim: '#3a3f46' },
};

interface Mover {
  node: Node;
  path: [number, number][];
  speed: number;
  onArrive?: () => void;
}

interface Floater {
  s: Sprite;
  t: number;
}

export interface WorldOptions {
  shadows: boolean;
  maxDpr: number;
  floatingText: boolean;
}

export class World {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  camera = new Camera();
  controls: OrbitControls;
  root = new Node();
  staticRoot = new Node();
  actorRoot = new Node();
  fxRoot = new Node();
  opts: WorldOptions = { shadows: true, maxDpr: 2, floatingText: true };
  private storeId = -1;
  private signature = '';
  private customers = new Map<number, Person>();
  private staff = new Map<number, Person>();
  private ghosts: Person[] = [];
  private ovenGlow: Mesh | null = null;
  private fire: Mesh | null = null;
  private ovenPos: V3 = [-5.3, 1, -3.7];
  private neon: Mesh[] = [];
  private signFaces: Mesh[] = [];
  private nightGlow: Mesh[] = [];
  private facades: Mesh[] = [];
  private facadeBase = '#999';
  private slice: Node | null = null;
  private menuBoard: Mesh | null = null;
  private menuSig = '';
  private stationPizzas: Mesh[] = [];
  private tablePizzas: Mesh[] = [];
  private vehicles: { node: Node; home: [number, number]; away: boolean; mover: Mover | null }[] = [];
  private driverWasOut = new Map<number, boolean>();
  private movers: Mover[] = [];
  private cars: { node: Node; dir: number; x: number; speed: number }[] = [];
  private floaters: Floater[] = [];
  private rain: Lines;
  private rainDrops: Float32Array;
  private cleanerTargets = new Map<number, { p: [number, number]; t: number }>();
  private time = 0;
  fx = new Particles();
  private live: LiveProps | null = null;
  private smokeAt: V3 | null = null;
  private smokeKind: 'smoke' | 'steam' = 'smoke';
  private smokeT = 0;
  private woodFired = false;
  envOverride: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.renderer = new Renderer(canvas, { shadowSize: mobile ? 1024 : 2048 });
    this.controls = new OrbitControls(this.camera, canvas);
    this.root.add(this.staticRoot, this.actorRoot, this.fxRoot);
    this.fxRoot.add(this.fx.root);
    this.rain = new Lines();
    this.rain.color = [0.75, 0.82, 0.95, 0.38];
    const N = 700;
    this.rainDrops = new Float32Array(N * 3);
    this.rain.data = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      this.rainDrops[i * 3] = (Math.random() - 0.5) * 34;
      this.rainDrops[i * 3 + 1] = Math.random() * 14;
      this.rainDrops[i * 3 + 2] = (Math.random() - 0.4) * 30;
    }
    this.renderer.lines.push(this.rain);
    for (let i = 0; i < 3; i++) {
      const colors = ['#2f6fd1', '#e3a21a', '#8e5bb5', '#3f9b4a', '#d8402b', '#e9e4da'];
      const n = P.meshOf(P.car(colors[i * 2 % colors.length]));
      const holder = new Node();
      holder.add(n);
      const dir = i % 2 ? 1 : -1;
      this.cars.push({ node: holder, dir, x: (Math.random() - 0.5) * 70, speed: 6 + Math.random() * 4 });
      this.fxRoot.add(holder);
    }
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr);
    this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), dpr);
    this.controls.fit(Math.max(1, r.width) / Math.max(1, r.height));
  }

  /** Tag of the clickable object under the pointer. */
  pickAt(clientX: number, clientY: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((clientY - r.top) / r.height) * 2 - 1);
    const hit = pick(this.root, this.camera, nx, ny);
    return hit ? String(hit.userData.pick) : null;
  }

  /** Screen position of a world point (for HTML overlays). */
  screenOf(p: V3) {
    return this.camera.project(p, this.renderer.width, this.renderer.height);
  }

  // ============================================================== static build

  private storeSignature(s: GameState, st: Store) {
    return [st.id, st.locationId, s.company, ...Object.values(st.upgrades)].join('|');
  }

  private rebuild(s: GameState, st: Store) {
    // free old GPU geometry for meshes that own unique (non-cached) geometry
    this.staticRoot.traverse((n) => {
      if (n instanceof Mesh && n.userData.owned) this.renderer.disposeGeometry(n.geometry);
    });
    this.staticRoot.clear();
    this.neon = [];
    this.signFaces = [];
    this.nightGlow = [];
    this.facades = [];
    this.slice = null;
    this.fire = null;
    this.ovenGlow = null;
    this.menuBoard = null;
    this.menuSig = '';
    this.stationPizzas = [];
    this.tablePizzas = [];
    this.fx.clear();
    const R = this.staticRoot;
    const L = LOC[st.locationId];
    const env = ENV_STYLE[L.env];
    const decor = st.upgrades.decor;
    const add = (n: Node) => {
      R.add(n);
      return n;
    };
    const own = (m: Mesh) => {
      m.userData.owned = true;
      return m;
    };

    // ---- ground & street
    const ground = add(P.texturedPlane(160, 160, T.groundTex(env.ground), 4)) as Mesh;
    ground.position = [0, -0.03, 0];
    ground.receiveShadow = true;
    own(ground);
    const walk = own(P.texturedPlane(60, 3.2, T.sidewalkTex(), 1.6));
    walk.position = [0, 0.02, 6.7];
    add(walk);
    const road = own(P.texturedPlane(160, 6, T.roadTex(), 6));
    road.position = [0, 0.0, 11];
    add(road);
    const walk2 = own(P.texturedPlane(60, 2.4, T.sidewalkTex(), 1.6));
    walk2.position = [0, 0.02, 15.2];
    add(walk2);
    // curbs
    add(own(P.meshOf([P.bx(0, 0, 8.3, 60, 0.12, 0.2, '#a7a297'), P.bx(0, 0, 13.9, 60, 0.12, 0.2, '#a7a297')])));

    // ---- environment props
    const envParts: P.WHITE_PARTS = [];
    const lampsBulbs: ReturnType<typeof P.lamp>['bulb'] = [];
    for (const x of [-9, -1.8, 5.2, 13]) {
      const l = P.lamp(x, 8.0);
      envParts.push(...l.pole);
      lampsBulbs.push(...l.bulb);
    }
    if (L.env === 'suburb' || L.env === 'campus') {
      for (const x of [-12.5, -5, 2.6, 11]) envParts.push(...P.tree(x, 7.6, 0.9 + ((x * 7) % 3) * 0.1));
      envParts.push(...P.bench(-6.6, 7.2), ...P.bench(9.5, 7.2));
      if (L.env === 'suburb') {
        envParts.push(...P.house(-10, 19.5, 6, 5, '#e9dcc4', '#8a3a2a'), ...P.house(-1, 19.5, 6, 5, '#cfe0d4', '#3a4f6a'), ...P.house(8, 19.5, 6, 5, '#f0e2b6', '#6b4a2e'), ...P.house(17, 19.5, 6, 5, '#e2cfe0', '#3a3a3a'));
        for (const x of [-14, -5.5, 3.5, 12.5]) envParts.push(...P.pine(x, 17.4, 0.9));
      } else {
        for (const x of [-12, 0, 12]) envParts.push(P.bx(x, 0, 22, 10, 7, 8, '#a65a3e'), P.bx(x, 7, 22, 10.4, 0.4, 8.4, '#d9c4a0'));
        envParts.push(P.bx(-3, 0, 17, 3, 0.05, 1.2, '#2b2b2e'));
        for (let i = 0; i < 5; i++) envParts.push(...P.vehicle(1).map((p) => ({ ...p, pos: [p.pos![0] - 3.8 + i * 0.6, p.pos![1], p.pos![2] + 17] as V3, rot: [p.rot?.[0] ?? 0, Math.PI / 2, p.rot?.[2] ?? 0] as V3 })));
      }
    } else if (L.env === 'city') {
      for (const x of [-16, -6, 4, 14]) {
        const h = 10 + ((x * 13) % 7 + 7) % 7 * 2;
        const b = own(P.texturedBox(9, h, 8, T.facadeTex('#8a8f96', false), 4));
        b.position = [x, h / 2, 21];
        b.userData.base = '#8a8f96';
        this.facades.push(b);
        add(b);
      }
      for (const x of [-10, -2, 6, 12]) envParts.push(...P.tree(x, 7.6, 0.75, '#4f7a3a'));
    } else if (L.env === 'harbor') {
      const water = own(P.texturedPlane(160, 60, T.waterTex(), 6));
      water.position = [0, -0.4, 47];
      add(water);
      envParts.push(P.bx(0, -0.5, 16.8, 160, 0.5, 2.6, '#7a5c3e'));
      for (const x of [-15, -5, 5, 15]) envParts.push(P.cy(x, -0.5, 18.1, 0.18, 1.6, '#5a3a22', 6));
      const b1 = own(P.meshOf(P.boat()));
      b1.position = [-6, -0.35, 22];
      b1.rotation = [0, 0.3, 0];
      add(b1);
      const b2 = own(P.meshOf(P.boat()));
      b2.position = [9, -0.35, 26];
      b2.rotation = [0, -0.5, 0];
      add(b2);
      for (const x of [-11, -3, 4, 12]) envParts.push(...P.tree(x, 7.6, 0.8, '#3e8a52'));
    } else if (L.env === 'airport') {
      envParts.push(P.bx(0, 0, 18, 80, 0.08, 14, '#5a5d63'));
      for (let x = -30; x <= 30; x += 6) envParts.push(P.bx(x, 0, 16.4, 0.4, 9, 0.4, '#3a3f46'));
      envParts.push(P.bx(0, 9, 16.4, 70, 0.5, 0.6, '#3a3f46'));
      const pl = own(P.meshOf(P.plane3d()));
      pl.position = [4, 0, 25];
      pl.rotation = [0, 0.2, 0];
      add(pl);
      for (const x of [-12, -4, 6, 13]) envParts.push(P.cy(x, 0, 7.6, 0.45, 0.9, '#3a3f46', 10), P.cy(x, 0.9, 7.6, 0.4, 0.2, '#4f9f52', 10));
    }
    // neighbor building on the left
    envParts.push(P.bx(-12.2, 0, -0.4, 9.6, 6.5, 10.8, env.facade), P.bx(-12.2, 6.5, -0.4, 10, 0.35, 11.2, env.trim));
    if (envParts.length) add(own(P.meshOf(envParts)));
    const bulbs = own(P.meshOf(lampsBulbs, new Material({ color: '#fff4d6', emissive: '#ffd27a', emissiveIntensity: 0 })));
    bulbs.castShadow = false;
    this.nightGlow.push(bulbs);
    add(bulbs);
    const nb = own(P.texturedBox(9.7, 6.3, 0.05, T.facadeTex(env.facade, false), 3.2));
    nb.position = [-12.2, 3.25, 4.86];
    nb.userData.base = env.facade;
    this.facades.push(nb);
    this.facadeBase = env.facade;
    add(nb);
    // buildings across the back alley and to the right of the delivery lot
    for (const [x, z, w, h, d, base] of [[-12, -17, 11, 9, 8, '#9c8f80'], [0, -17.5, 12, 12, 8, env.facade], [12.5, -17, 11, 8, 8, '#8f7d6c'], [18.5, 0, 9, 7, 12, '#a39a8c']] as const) {
      const b = own(P.texturedBox(w, h, d, T.facadeTex(base, false), 3.2));
      b.position = [x, h / 2, z];
      b.userData.base = base;
      this.facades.push(b);
      add(b);
    }
    add(own(P.meshOf([P.bx(18.5, 7, 0, 9.4, 0.35, 12.4, env.trim), P.bx(0, 12, -17.5, 12.4, 0.4, 8.4, env.trim)])));
    add(own(P.meshOf([P.bx(0, 0, -4.97, 14, 0.14, 0.05, decor >= 4 ? '#3e2715' : '#4a3b30'), P.bx(-6.97, 0, 0, 0.05, 0.14, 9.9, decor >= 4 ? '#3e2715' : '#4a3b30')])));
    // set dressing
    const dress = [starterProps(), streetProps(decor, L.env)];
    for (const d of dress) {
      d.traverse((n) => {
        if (n instanceof Mesh && !n.userData.shared) n.userData.owned = true;
        if (n instanceof Mesh && n.userData.nightGlow) this.nightGlow.push(n);
      });
      add(d);
    }
    this.live = new LiveProps();
    add(this.live.root);

    // ---- building shell
    const floor = own(P.texturedPlane(14, 10, T.floorTex(decor), 2));
    floor.position = [0, 0.01, 0];
    add(floor);
    const kfloor = own(P.texturedPlane(14, 3.45, T.kitchenFloorTex(), 1));
    kfloor.position = [0, 0.016, -3.27];
    add(kfloor);
    const wallMat = new Material({ map: T.wallTex(decor) });
    const back = own(new Mesh(box(14.4, 3.2, 0.2), new Material({ color: '#cfc7b8' })));
    back.position = [0, 1.6, -5.1];
    add(back);
    const backIn = own(new Mesh(panelUV(14.4, 3.2, 7.2, 1), wallMat));
    backIn.position = [0, 1.6, -4.995];
    backIn.castShadow = false;
    add(backIn);
    const left = own(new Mesh(box(0.2, 3.2, 10.4), new Material({ color: '#cfc7b8' })));
    left.position = [-7.1, 1.6, 0];
    add(left);
    const leftIn = own(new Mesh(panelUV(10.2, 3.2, 5.1, 1), wallMat));
    leftIn.position = [-6.995, 1.6, 0];
    leftIn.rotation = [0, Math.PI / 2, 0];
    leftIn.castShadow = false;
    add(leftIn);
    // storefront: low walls, posts, beam, glass
    const lowColor = decor >= 3 ? '#8a3a2a' : decor >= 4 ? '#5a3a22' : decor >= 1 ? '#2f4f3a' : '#9a958d';
    const trim = decor >= 2 ? '#1f3a2a' : '#3a3a3a';
    const shell: P.WHITE_PARTS = [
      P.bx(-4.35, 0, 5.1, 5.7, 0.6, 0.22, lowColor),
      P.bx(3.75, 0, 5.1, 6.9, 0.6, 0.22, lowColor),
      P.bx(7.1, 0, 0, 0.22, 0.6, 10.4, lowColor),
      P.bx(0, 2.85, 5.1, 14.4, 0.35, 0.26, trim),
      P.bx(7.1, 2.85, 0, 0.26, 0.35, 10.4, trim),
      P.bx(3.0, 0, -1.55, 4.2, 1.1, 0.14, lowColor),
      P.bx(3.0, 1.1, -1.55, 4.3, 0.05, 0.22, '#d9dde1'),
    ];
    for (const x of [-7.1, -5.0, -3.0, -1.5, 0.3, 2.3, 4.6, 7.1]) shell.push(P.bx(x, 0, 5.1, 0.16, 2.85, 0.26, trim));
    for (const z of [-5.0, -2.9, -1.0, 1.3, 3.2, 5.1]) shell.push(P.bx(7.1, 0, z, 0.26, 2.85, 0.16, trim));
    // back door frame on the right
    shell.push(P.bx(7.1, 0, -2.4, 0.3, 2.2, 1.0, '#6d4730'));
    add(own(P.meshOf(shell)));
    const glass = own(P.meshOf([
      P.bx(-4.35, 0.6, 5.1, 5.6, 2.25, 0.04, '#cfe6f5'),
      P.bx(3.75, 0.6, 5.1, 6.8, 2.25, 0.04, '#cfe6f5'),
      P.bx(7.1, 0.6, 1.7, 0.04, 2.25, 6.6, '#cfe6f5'),
    ], new Material({ color: '#dff0ff', opacity: 0.14 })));
    glass.castShadow = false;
    add(glass);
    // awning
    const awn = own(new Mesh(panelUV(14.6, 0.9, 10, 1), new Material({ map: T.awningTex() })));
    awn.position = [0, 2.72, 5.45];
    awn.rotation = [-0.62, 0, 0];
    add(awn);

    // ---- counter, registers, kiosk, drinks
    const ctr = own(P.meshOf(P.counter(6.4, decor >= 4 ? '#3e2715' : '#e9e4da', decor >= 3 ? '#8a3a2a' : decor >= 1 ? '#2f4f3a' : '#8f8a80'), P.WHITE, 'menu'));
    ctr.position = [-1.6, 0, -1.2];
    add(ctr);
    const regLv = st.upgrades.register;
    for (const x of REG_X) {
      const r = own(P.meshOf(P.register(regLv), P.WHITE, 'register'));
      r.position = [x, 1.06, -1.3];
      add(r);
    }
    if (up(st, 'register').kiosk) {
      const k = own(P.meshOf(P.kiosk(), P.WHITE, 'register'));
      k.position = [KIOSK_POS[0], 0, KIOSK_POS[1] - 0.6];
      add(k);
    }
    const df = P.drinksFridge();
    df.body.position = [1.15, 0, -2.05];
    df.glow.position = [1.15, 0, -2.05];
    add(own(df.body));
    add(own(df.glow));
    // pickup shelf with boxes
    const shelf = own(P.meshOf([P.bx(0, 1.06, 0, 0.9, 0.04, 0.6, '#6d4730'), ...[0, 1, 2].map((i) => P.bx(0, 1.1 + i * 0.075, 0, 0.55, 0.07, 0.55, '#c99a62'))], P.WHITE, 'menu'));
    shelf.position = [-4.3, 0, -1.25];
    add(shelf);

    // ---- menu board
    const mb = own(new Mesh(panelUV(2.7, 2.0, 1, 1), new Material({ map: T.menuBoardTex([], 'Menu'), emissive: '#151515' })));
    mb.position = [-6.97, 2.0, -0.45];
    mb.rotation = [0, Math.PI / 2, 0];
    mb.userData.pick = 'menu';
    mb.castShadow = false;
    this.menuBoard = mb;
    add(mb);

    // ---- kitchen
    const ovLv = st.upgrades.oven;
    const ov = P.oven(ovLv);
    const ovNode = new Node();
    ovNode.add(own(ov.body), own(ov.glow));
    if (ov.fire) {
      ovNode.add(own(ov.fire));
      this.fire = ov.fire;
    }
    if (ovLv <= 1) ovNode.position = [-5.4, 0, -4.35];
    else if (ovLv === 2) ovNode.position = [-4.7, 0, -4.4];
    else ovNode.position = [-5.25, 0, -3.95];
    this.ovenPos = [ovNode.position[0], 1.2, ovNode.position[2] + 1.2];
    this.ovenGlow = ov.glow;
    if (ov.fire) ov.fire.material.glow = 0.9;
    const op = ovNode.position;
    this.woodFired = ovLv >= 3;
    if (ovLv <= 1) {
      this.smokeAt = [op[0] + 0.75, 0.5 + (ovLv + 1) * 0.72 + 0.85, op[2] - 0.3];
      this.smokeKind = 'smoke';
    } else if (ovLv === 2) {
      this.smokeAt = [op[0], 1.75, op[2]];
      this.smokeKind = 'steam';
    } else {
      this.smokeAt = [op[0] + 0.4, 3.45, op[2] - 0.5];
      this.smokeKind = 'smoke';
    }
    add(ovNode);
    const stations = up(st, 'prep').stations ?? 1;
    for (let i = 0; i < stations; i++) {
      const pt = own(P.meshOf(P.prepTable(), P.WHITE, 'prep'));
      pt.position = [STATIONS_X[i], 0, STATION_Z];
      add(pt);
      const pz = new Mesh(P.pizzaGeo([]), P.WHITE);
      pz.position = [STATIONS_X[i] + 0.25, 0.94, STATION_Z + 0.12];
      pz.visible = false;
      pz.castShadow = false;
      this.stationPizzas.push(pz);
      add(pz);
    }
    const stLv = st.upgrades.storage;
    const sto = own(P.meshOf(P.storage(stLv), P.WHITE, 'storage'));
    sto.position = stLv === 0 ? [5.4, 0, -4.65] : stLv === 1 ? [6.2, 0, -4.55] : [stLv === 2 ? 5.55 : 5.4, 0, -4.0];
    add(sto);
    // dough crates near prep line
    add(own(P.meshOf([P.bx(-6.4, 0, -2.6, 0.6, 0.35, 0.45, '#e8c98f'), P.bx(-6.4, 0.35, -2.6, 0.6, 0.35, 0.45, '#e8c98f'), P.bx(-6.4, 0, -2.0, 0.6, 0.35, 0.45, '#c8352a')], P.WHITE, 'storage')));
    if (st.upgrades.cleaning >= 1) {
      const dw = own(P.meshOf(P.dishwasher(), P.WHITE, 'cleaning'));
      dw.position = [-1.6, 0, -4.55];
      add(dw);
    }
    if (st.upgrades.cleaning >= 2) {
      const sc = own(P.meshOf(P.scrubber(), P.WHITE, 'cleaning'));
      sc.position = [2.4, 0, -2.25];
      add(sc);
    }
    if (st.upgrades.breakroom >= 1) {
      const br = own(P.meshOf(P.breakroom(st.upgrades.breakroom), P.WHITE, 'breakroom'));
      br.position = [2.5, 0, -3.6];
      add(br);
    }
    if (st.staff.some((x) => x.role === 'manager') || s.level >= 4) {
      const dk = own(P.meshOf(P.desk(), P.WHITE, 'staff'));
      dk.position = [4.8, 0, -2.4];
      add(dk);
    }

    // ---- dining
    const seats = up(st, 'dining').seats ?? 4;
    const dParts: P.WHITE_PARTS = [];
    const chairColor = decor >= 4 ? '#5a3a22' : decor >= 3 ? '#c8352a' : decor >= 2 ? '#1f1d1c' : '#7b4a2a';
    for (let t = 0; t < seats / 2; t++) {
      const [tx, tz] = TABLES[t];
      const tp = P.table(decor >= 4 ? '#6d4730' : '#f4efe3', decor >= 2 && decor < 4).map((p) => ({ ...p, pos: [p.pos![0] + tx, p.pos![1], p.pos![2] + tz] as V3 }));
      dParts.push(...tp);
      if (decor >= 4 && t % 2 === 1) {
        dParts.push(...P.booth(tx + 0.75, tz, -Math.PI / 2, '#8a3a2a'), ...P.chair(tx - 0.62, tz, Math.PI / 2, chairColor));
      } else {
        dParts.push(...P.chair(tx - 0.62, tz, Math.PI / 2, chairColor), ...P.chair(tx + 0.62, tz, -Math.PI / 2, chairColor));
      }
      const plt = new Mesh(P.pizzaGeo(['#b53a2a']), P.WHITE);
      plt.visible = false;
      plt.castShadow = false;
      this.tablePizzas.push(plt);
      add(plt);
    }
    if (dParts.length) add(own(P.meshOf(dParts, P.WHITE, 'dining')));

    // ---- decor
    const dec: P.WHITE_PARTS = [];
    if (decor >= 1) dec.push(...P.plant(-6.5, 4.5), ...P.plant(6.6, 4.5), ...P.plant(6.6, -1.1), ...P.plant(-6.5, -1.35));
    if (decor >= 4) dec.push(...P.plant(1.0, 4.55, true));
    if (dec.length) add(own(P.meshOf(dec, P.WHITE, 'decor')));
    if (decor >= 2) {
      [[1.4, 0], [3.2, 2]].forEach(([z, k], i) => {
        const a = own(new Mesh(panelUV(0.85, 1.05, 1, 1), new Material({ map: T.artTex(k) })));
        if (i < 2) {
          a.position = [-6.98, 1.9, z];
          a.rotation = [0, Math.PI / 2, 0];
        } else {
          a.position = [z + 5.6, 2.2, -4.98];
        }
        a.userData.pick = 'decor';
        a.castShadow = false;
        add(a);
      });
    }
    if (decor >= 3) {
      const jb = P.jukebox();
      const jn = new Node().at(1.25, 0, 4.4);
      jn.rotation = [0, Math.PI, 0];
      jn.add(own(jb.body), own(jb.glow));
      add(jn);
      this.neon.push(jb.glow);
      const neonTex = T.textTex([{ text: 'PIZZA', size: 120, color: '#ff4f8b' }], 512, 160, null);
      const nm = own(new Mesh(panelUV(2.6, 0.82, 1, 1), new Material({ map: neonTex, unlit: true, emissive: '#000000', glow: 0.9 })));
      nm.position = [2.25, 2.6, -4.96];
      nm.castShadow = false;
      add(nm);
    }
    if (decor >= 4) {
      const pd: P.WHITE_PARTS = [];
      for (let t = 0; t < seats / 2; t++) pd.push(...P.pendant().map((p) => ({ ...p, pos: [p.pos![0] + TABLES[t][0], p.pos![1] + 2.2, p.pos![2] + TABLES[t][1]] as V3 })));
      const pdm = own(P.meshOf(pd));
      pdm.castShadow = false;
      add(pdm);
    }

    // ---- street sign
    const sg = st.upgrades.sign;
    const nameTex = T.textTex([{ text: s.company, size: 64, color: '#f6f1e6' }, { text: 'PIZZA · SLICES · DELIVERY', size: 26, color: '#f2b33d', font: T.FONT_UI }], 512, 192, '#c8352a', 20);
    if (sg === 0) {
      const board = own(P.meshOf([P.bx(0, 0, 0, 0.8, 1.1, 0.06, '#5a3a22', [-0.2, 0, 0]), P.bx(0, 0, -0.35, 0.8, 1.1, 0.06, '#5a3a22', [0.2, 0, 0])], P.WHITE, 'sign'));
      board.position = [1.4, 0, 6.2];
      add(board);
      const chalk = own(new Mesh(panelUV(0.62, 0.7, 1, 1), new Material({ map: T.textTex([{ text: 'PIZZA', size: 54, color: '#f6f1e6' }, { text: 'hot & fresh', size: 28, color: '#f2b33d', font: T.FONT_UI }], 256, 256, '#23302a'), emissive: '#111' })));
      chalk.position = [1.4, 0.62, 6.27];
      chalk.rotation = [-0.2, 0, 0];
      chalk.userData.pick = 'sign';
      add(chalk);
    } else {
      const h = sg === 1 ? 2.8 : 4.6;
      const post = own(P.meshOf([P.cy(0, 0, 0, 0.12, h, '#2b2b2e', 8), P.bx(0, 0, 0, 0.8, 0.2, 0.8, '#55595e')], P.WHITE, 'sign'));
      post.position = [9.6, 0, 6.9];
      add(post);
      const face = own(new Mesh(box(2.6, 1.0, 0.25), new Material({ color: '#c8352a' })));
      face.position = [9.6, h + 0.35, 6.9];
      face.userData.pick = 'sign';
      add(face);
      const front = own(new Mesh(panelUV(2.5, 0.94, 1, 1), new Material({ map: nameTex, emissive: '#000000' })));
      front.position = [9.6, h + 0.35, 7.03];
      front.userData.pick = 'sign';
      front.castShadow = false;
      add(front);
      front.userData.signFace = true;
      if (sg >= 2) this.signFaces.push(front);
      if (sg >= 3) {
        const slice = new Node();
        const sm = own(P.meshOf(P.sliceSign(), P.WHITE, 'sign'));
        sm.rotation = [0, 0, Math.PI];
        slice.add(sm);
        slice.position = [9.6, h + 2.2, 6.9];
        slice.scale = [0.75, 0.75, 0.75];
        this.slice = slice;
        add(slice);
      }
    }

    // ---- delivery parking
    for (const v of this.vehicles) this.fxRoot.remove(v.node);
    this.vehicles = [];
    this.driverWasOut.clear();
    if (st.upgrades.delivery > 0) {
      const lv = st.upgrades.delivery;
      for (let i = 0; i < 3; i++) {
        const node = new Node();
        const m = P.meshOf(P.vehicle(lv), P.WHITE, 'delivery');
        if (lv >= 3) m.setScale(0.8);
        node.add(m);
        node.position = [PARK[i][0], 0, PARK[i][1]];
        node.rotation = [0, -Math.PI / 2, 0];
        node.visible = false;
        this.vehicles.push({ node, home: PARK[i], away: false, mover: null });
        this.fxRoot.add(node);
      }
    }
  }

  // ============================================================== per-frame

  frame(s: GameState, st: Store, dtReal: number, gameSpeed: number, running: boolean) {
    this.time += dtReal;
    const sig = this.storeSignature(s, st);
    if (st.id !== this.storeId || sig !== this.signature) {
      if (st.id !== this.storeId) this.clearActors();
      this.storeId = st.id;
      this.signature = sig;
      this.rebuild(s, st);
    }
    this.updateMenuBoard(s, st);
    const speed = running ? Math.min(Math.max(gameSpeed, 1), 4) : 1;
    this.syncCustomers(s, st, dtReal, speed);
    this.syncStaff(s, st, dtReal, speed);
    this.updateKitchen(s, st);
    this.updateVehicles(st, dtReal, speed);
    this.updateMovers(dtReal);
    this.updateCars(dtReal, s);
    this.updateFloaters(dtReal);
    this.updateLive(s, st, dtReal, speed);
    const env = this.environment(s, st);
    this.updateRain(dtReal, s.weather === 'rainy');
    if (this.slice) this.slice.rotation = [0, this.time * 0.9, 0];
    if (this.fire) {
      const f = 0.85 + Math.sin(this.time * 17) * 0.08 + Math.sin(this.time * 7.3) * 0.07;
      this.fire.scale = [1, f, 1];
    }
    this.controls.update(Math.min(dtReal, 0.1));
    this.renderer.render(this.root, this.camera, env);
  }

  private updateLive(s: GameState, st: Store, dt: number, speed: number) {
    if (this.live) {
      const kinds: string[] = [];
      let waiting = 0;
      for (const o of st.orders) {
        if (o.state === 'kitchen' && kinds.length < 10) kinds.push(o.kind);
        if (o.state === 'ready') waiting++;
      }
      this.live.update(s.phase === 'open', s.phase === 'prep' ? 9 * 60 : s.minute, kinds, Math.min(8, waiting));
    }
    // oven smoke: busier oven, more smoke; a wood fire always smolders a little
    if (this.smokeAt) {
      const baking = itemsInStage(st, 'baking');
      const rate = baking > 0 ? 1.4 + baking * 0.5 : this.woodFired ? 0.6 : 0;
      this.smokeT += dt * rate * Math.min(2, speed);
      while (this.smokeT >= 1) {
        this.smokeT -= 1;
        this.fx.emit(this.smokeKind, this.smokeAt);
      }
    }
    // steam rising from pizzas on tables
    for (const tp of this.tablePizzas) {
      if (tp.visible && Math.random() < dt * 1.6) this.fx.emit('steam', [tp.position[0], tp.position[1] + 0.06, tp.position[2]]);
    }
    for (const sp of this.stationPizzas) {
      if (sp.visible && Math.random() < dt * 0.5) this.fx.emit('steam', [sp.position[0], sp.position[1] + 0.05, sp.position[2]]);
    }
    this.fx.update(dt);
  }

  /** Confetti over the counter (level-ups, goals, grand openings). */
  celebrate() {
    this.fx.emit('confetti', [-1.6, 2.6, -0.4], 70);
    this.fx.emit('sparkle', [-1.6, 2.2, -0.4], 20);
  }

  /** Puff of dust when something new is installed. */
  installPuff() {
    for (let i = 0; i < 6; i++) this.fx.emit('puff', [(Math.random() - 0.5) * 10, 0.2, -2 + (Math.random() - 0.5) * 5], 4);
  }

  /** Forget the current store so the next frame rebuilds everything (new game / load). */
  reset() {
    this.clearActors();
    this.storeId = -1;
    this.signature = '';
  }

  private clearActors() {
    for (const p of this.customers.values()) this.actorRoot.remove(p);
    for (const p of this.staff.values()) this.actorRoot.remove(p);
    for (const p of this.ghosts) this.actorRoot.remove(p);
    this.customers.clear();
    this.staff.clear();
    this.ghosts = [];
    this.cleanerTargets.clear();
    for (const f of this.floaters) this.fxRoot.remove(f.s);
    this.floaters = [];
  }

  private updateMenuBoard(s: GameState, st: Store) {
    if (!this.menuBoard) return;
    const items = MENU.filter((m) => s.unlocked.includes(m.id) && st.menu[m.id].on).map((m) => ({ name: m.name, price: '$' + salePrice(st, m.id).toFixed(2) }));
    const sig = items.map((i) => i.name + i.price).join('|');
    if (sig === this.menuSig) return;
    this.menuSig = sig;
    const old = this.menuBoard.material.map;
    if (old) this.renderer.disposeTexture(old);
    this.menuBoard.material.map = T.menuBoardTex(items, s.company);
  }

  // ---------------------------------------------------------------- customers

  private customerTarget(st: Store, c: Customer, lineIndex: Map<number, number>): { x: number; z: number; face: number; sit: boolean } {
    switch (c.state) {
      case 'enter':
      case 'queue': {
        const i = Math.min(lineIndex.get(c.id) ?? 0, QUEUE.length - 1);
        const q = QUEUE[i];
        const prev = i > 0 ? QUEUE[i - 1] : [REG_X[0], ORDER_Z];
        return { x: q[0], z: q[1], face: Math.atan2(prev[0] - q[0], prev[1] - q[1]), sit: false };
      }
      case 'ordering': {
        const taker = st.staff.find((x) => x.task?.kind === 'order' && x.task.customerId === c.id);
        if (!taker) return { x: KIOSK_POS[0], z: KIOSK_POS[1], face: Math.PI, sit: false };
        const reg = this.registerOf(st, taker);
        return { x: REG_X[reg], z: ORDER_Z, face: Math.PI, sit: false };
      }
      case 'toSeat':
      case 'waitFood':
      case 'eating':
        if (c.kind === 'dine' && c.seat !== undefined) {
          const sp = seatPos(c.seat);
          return { x: sp.x, z: sp.z, face: sp.face, sit: true };
        } else {
          const w = WAIT[(c.waitSpot ?? 0) % WAIT.length];
          return { x: w[0], z: w[1], face: Math.atan2(-4.3 - w[0], -1.25 - w[1]), sit: false };
        }
      default:
        return { x: DOOR_IN[0], z: DOOR_IN[1], face: 0, sit: false };
    }
  }

  private pathTo(p: Node, x: number, z: number): [number, number][] {
    const inside = p.position[2] < 5.0;
    const targetInside = z < 5.0;
    if (!inside && targetInside) return [DOOR_OUT, DOOR_IN, [x, z]];
    if (inside && !targetInside) return [DOOR_IN, DOOR_OUT, [x, z]];
    return [[x, z]];
  }

  private syncCustomers(s: GameState, st: Store, dt: number, speed: number) {
    const line = st.customers.filter((c) => c.state === 'enter' || c.state === 'queue').sort((a, b) => a.arrived - b.arrived);
    const lineIndex = new Map<number, number>();
    line.forEach((c, i) => lineIndex.set(c.id, i));
    const seen = new Set<number>();
    for (const c of st.customers) {
      seen.add(c.id);
      let p = this.customers.get(c.id);
      if (!p) {
        p = new Person(c.look, null);
        const side = Math.random() < 0.5 ? -1 : 1;
        p.position = [DOOR_OUT[0] + side * (3 + Math.random() * 6), 0, DOOR_OUT[1] + 0.4 + Math.random() * 0.6];
        p.userData.tkey = '';
        this.customers.set(c.id, p);
        this.actorRoot.add(p);
      }
      if (c.state === 'leave') {
        // hand off to ghost walker
        this.customers.delete(c.id);
        this.walkOut(p, c);
        continue;
      }
      const tg = this.customerTarget(st, c, lineIndex);
      const key = `${tg.x.toFixed(2)},${tg.z.toFixed(2)}`;
      if (p.userData.tkey !== key) {
        p.userData.tkey = key;
        p.goTo(this.pathTo(p, tg.x, tg.z));
        p.sitting = false;
      }
      if (p.atDest) {
        p.targetFacing = tg.face;
        p.sitting = tg.sit;
        if (tg.sit) p.position = [tg.x, 0.02, tg.z];
      }
      const showMood = c.state === 'queue' || (c.state === 'waitFood' && p.atDest);
      p.setMood(showMood && c.mood !== 'none' ? c.mood : 'none');
      p.update(dt, 2.3 * speed);
    }
    // customers removed from the sim without a 'leave' frame
    for (const [id, p] of [...this.customers]) {
      if (!seen.has(id)) {
        this.customers.delete(id);
        this.walkOut(p, null);
      }
    }
    for (const g of this.ghosts) g.update(dt, 2.3 * speed);
    for (const g of [...this.ghosts]) {
      if (g.atDest) {
        this.actorRoot.remove(g);
        this.ghosts.splice(this.ghosts.indexOf(g), 1);
      }
    }
  }

  private walkOut(p: Person, c: Customer | null) {
    p.sitting = false;
    const side = Math.random() < 0.5 ? -1 : 1;
    const exit: [number, number] = [side * 24, 6.9 + Math.random() * 0.6];
    const path: [number, number][] = p.position[2] < 5 ? [DOOR_IN, DOOR_OUT, exit] : [exit];
    p.goTo(path);
    p.carry.visible = !!c && c.kind === 'takeout' && c.orderId !== undefined && c.mood !== 'angry';
    p.setMood(c && c.mood === 'angry' ? 'angry' : 'none');
    this.ghosts.push(p);
  }

  // ---------------------------------------------------------------- staff

  private registerOf(st: Store, x: Staff) {
    const takers = st.staff.filter((y) => y.status === 'active' && (y.role === 'cashier' || y.task?.kind === 'order'));
    const i = takers.indexOf(x);
    return Math.max(0, Math.min(REG_X.length - 1, i));
  }

  private syncStaff(s: GameState, st: Store, dt: number, speed: number) {
    const seen = new Set<number>();
    const active = st.staff.filter((x) => x.status === 'active');
    const stations = up(st, 'prep').stations ?? 1;
    const busyStations = new Set<number>();
    for (const x of active) if (x.task?.kind === 'prep' && x.task.station !== undefined) busyStations.add(x.task.station);
    const freeStations = [...Array(stations).keys()].filter((i) => !busyStations.has(i));
    let extra = 0;
    let driverIdx = 0;
    const cashiers = active.filter((x) => x.role === 'cashier');
    for (const x of active) {
      const out = x.role === 'driver' && x.task?.kind === 'deliver';
      let p = this.staff.get(x.id);
      if (!p) {
        p = new Person(x.look, x.role);
        p.userData.pick = 'staff:' + x.id;
        p.position = x.role === 'driver' ? [6.5, 0, -2.4] : [6.2, 0, -2.4];
        p.userData.tkey = '';
        this.staff.set(x.id, p);
        this.actorRoot.add(p);
      }
      seen.add(x.id);
      p.visible = !out;
      let tx = 0, tz = 0, face = 0, working = false;
      if (x.task?.kind === 'order') {
        const reg = this.registerOf(st, x);
        tx = REG_X[reg];
        tz = REG_STAFF_Z;
        face = 0;
        working = true;
      } else if (x.role === 'cashier') {
        const i = cashiers.indexOf(x);
        if (i < REG_X.length) {
          tx = REG_X[i];
          tz = REG_STAFF_Z;
        } else {
          tx = 0.2;
          tz = -2.2;
        }
      } else if (x.role === 'cook') {
        if (x.task?.kind === 'prep' && x.task.station !== undefined) {
          tx = STATIONS_X[x.task.station];
          tz = COOK_Z;
          working = true;
        } else if (freeStations.length) {
          const i = freeStations.shift()!;
          tx = STATIONS_X[i] - 0.3;
          tz = COOK_Z - 0.1;
        } else {
          const e = EXTRA_COOK[extra++ % EXTRA_COOK.length];
          tx = e[0];
          tz = e[1];
        }
      } else if (x.role === 'driver') {
        const d = DRIVER_IDLE[driverIdx++ % DRIVER_IDLE.length];
        tx = d[0];
        tz = d[1];
        face = Math.PI / 2;
      } else if (x.role === 'cleaner') {
        let ct = this.cleanerTargets.get(x.id);
        if (!ct || this.time > ct.t) {
          const pt = CLEAN_POINTS[Math.floor(Math.random() * CLEAN_POINTS.length)];
          ct = { p: pt, t: this.time + 4 + Math.random() * 5 };
          this.cleanerTargets.set(x.id, ct);
        }
        tx = ct.p[0];
        tz = ct.p[1];
        working = st.cleanliness < 99;
        face = p.targetFacing + Math.sin(this.time) * 0.01;
      } else if (x.role === 'manager') {
        tx = MANAGER_POS[0];
        tz = MANAGER_POS[1];
        face = Math.PI;
      }
      const key = `${tx.toFixed(2)},${tz.toFixed(2)}`;
      if (p.userData.tkey !== key) {
        p.userData.tkey = key;
        p.goTo([[tx, tz]]);
      }
      p.working = working && p.atDest;
      if (p.atDest) p.targetFacing = face;
      p.update(dt, 2.6 * speed);
    }
    for (const [id, p] of [...this.staff]) {
      if (!seen.has(id)) {
        this.actorRoot.remove(p);
        this.staff.delete(id);
        this.cleanerTargets.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------- kitchen

  private updateKitchen(s: GameState, st: Store) {
    // pizzas being built
    for (const pz of this.stationPizzas) pz.visible = false;
    for (const x of st.staff) {
      if (x.status !== 'active' || x.task?.kind !== 'prep' || x.task.station === undefined) continue;
      const pz = this.stationPizzas[x.task.station];
      const o = st.orders.find((q) => q.id === x.task!.orderId);
      const it = o?.items[x.task.itemIdx ?? 0];
      if (!pz || !it) continue;
      pz.visible = true;
      pz.geometry = P.pizzaGeo(toppingColors(it.item), it.item === 'bbqchicken' ? '#6b2f1a' : it.item === 'bianca' ? '#f6efd2' : '#c8352a');
      const prog = 1 - x.task.remaining / x.task.total;
      pz.scale = [1, 0.6 + prog * 0.4, 1];
    }
    // oven glow
    if (this.ovenGlow) {
      const baking = itemsInStage(st, 'baking');
      const f = baking / Math.max(1, ovenSlots(st));
      this.ovenGlow.material.emissiveIntensity = 0.35 + f * 1.6 + Math.sin(this.time * 6) * 0.05;
    }
    // pizzas on tables
    for (const tp of this.tablePizzas) tp.visible = false;
    for (const c of st.customers) {
      if (c.state !== 'eating' || c.seat === undefined) continue;
      const sp = seatPos(c.seat);
      const tIdx = Math.floor(c.seat / 2);
      const pz = this.tablePizzas[tIdx];
      if (!pz) continue;
      pz.visible = true;
      pz.position = [sp.table[0] + (sp.x - sp.table[0]) * 0.35, 0.79, sp.table[1]];
      const eat = clamp(c.t / (c.eatFor ?? 15), 0, 1);
      pz.scale = [1 - eat * 0.5, 1, 1 - eat * 0.5];
    }
  }

  // ---------------------------------------------------------------- vehicles & cars

  private updateVehicles(st: Store, dt: number, speed: number) {
    if (!this.vehicles.length) return;
    const drivers = st.staff.filter((x) => x.role === 'driver');
    const count = Math.max(1, Math.min(3, drivers.length));
    this.vehicles.forEach((v, i) => {
      if (i >= count) {
        v.node.visible = false;
        return;
      }
      const d = drivers[i];
      const out = !!d && d.status === 'active' && d.task?.kind === 'deliver';
      const was = d ? this.driverWasOut.get(d.id) ?? false : false;
      if (!v.away && !v.mover) v.node.visible = true;
      if (d && out && !was) {
        // depart
        v.away = true;
        const mv: Mover = { node: v.node, path: [[v.home[0], 9.6], [46, 9.6]], speed: 6 * speed, onArrive: () => (v.node.visible = false) };
        v.node.visible = true;
        v.mover = mv;
        this.movers.push(mv);
      } else if (d && !out && was) {
        // return
        v.node.visible = true;
        v.node.position = [-46, 0, 12.4];
        const mv: Mover = { node: v.node, path: [[v.home[0] + 0.6, 12.4], [v.home[0], v.home[1]]], speed: 6 * speed, onArrive: () => { v.away = false; v.mover = null; v.node.rotation = [0, -Math.PI / 2, 0]; } };
        this.movers = this.movers.filter((m) => m.node !== v.node);
        v.mover = mv;
        this.movers.push(mv);
      }
      if (d) this.driverWasOut.set(d.id, out);
    });
  }

  private updateMovers(dt: number) {
    for (const m of [...this.movers]) {
      if (!m.path.length) {
        this.movers.splice(this.movers.indexOf(m), 1);
        m.onArrive?.();
        continue;
      }
      const [tx, tz] = m.path[0];
      const p = m.node.position;
      const dx = tx - p[0], dz = tz - p[2];
      const d = Math.hypot(dx, dz);
      const step = m.speed * dt;
      if (d <= step) {
        m.node.position = [tx, p[1], tz];
        m.path.shift();
      } else {
        m.node.position = [p[0] + (dx / d) * step, p[1], p[2] + (dz / d) * step];
        m.node.rotation = [0, Math.atan2(dx, dz) - Math.PI / 2, 0];
      }
    }
  }

  private updateCars(dt: number, s: GameState) {
    const busy = s.minute > 11 * 60 && s.minute < 21 * 60;
    for (const c of this.cars) {
      c.x += c.dir * c.speed * dt * (busy ? 1 : 0.6);
      if (c.x > 60) c.x = -60 - Math.random() * 30;
      if (c.x < -60) c.x = 60 + Math.random() * 30;
      c.node.position = [c.x, 0, c.dir > 0 ? 12.4 : 9.6];
      c.node.rotation = [0, c.dir > 0 ? 0 : Math.PI, 0];
    }
  }

  // ---------------------------------------------------------------- effects

  /** "+$12.50" rising from a customer or the register. */
  floatText(text: string, color: string, customerId?: number) {
    if (!this.opts.floatingText) return;
    let pos: V3 = [REG_X[0], 2.0, -0.6];
    const p = customerId !== undefined ? this.customers.get(customerId) : undefined;
    // avatars can lag behind the sim at high speed; only float over them once inside
    if (p && p.position[2] < 4.6) pos = [p.position[0], 2.3, p.position[2]];
    const sp = new Sprite(T.floatTextTex(text, color), 1.5, 0.42);
    sp.position = pos;
    if (color === '#f2b33d') this.fx.emit('sparkle', [pos[0], pos[1] - 0.2, pos[2]], 5);
    this.fxRoot.add(sp);
    this.floaters.push({ s: sp, t: 0 });
    if (this.floaters.length > 24) {
      const f = this.floaters.shift()!;
      this.fxRoot.remove(f.s);
      this.renderer.disposeTexture(f.s.texture);
    }
  }

  private updateFloaters(dt: number) {
    for (const f of [...this.floaters]) {
      f.t += dt;
      f.s.position = [f.s.position[0], f.s.position[1] + dt * 0.9, f.s.position[2]];
      f.s.opacity = clamp(1.6 - f.t, 0, 1);
      if (f.t > 1.6) {
        this.fxRoot.remove(f.s);
        this.renderer.disposeTexture(f.s.texture);
        this.floaters.splice(this.floaters.indexOf(f), 1);
      }
    }
  }

  private updateRain(dt: number, on: boolean) {
    this.rain.visible = on;
    if (!on) return;
    const d = this.rainDrops, out = this.rain.data;
    const n = d.length / 3;
    for (let i = 0; i < n; i++) {
      d[i * 3 + 1] -= dt * 16;
      d[i * 3] -= dt * 1.5;
      if (d[i * 3 + 1] < 0) {
        d[i * 3 + 1] = 12 + Math.random() * 3;
        d[i * 3] = (Math.random() - 0.5) * 34;
      }
      out[i * 6] = d[i * 3];
      out[i * 6 + 1] = d[i * 3 + 1];
      out[i * 6 + 2] = d[i * 3 + 2];
      out[i * 6 + 3] = d[i * 3] + 0.05;
      out[i * 6 + 4] = d[i * 3 + 1] + 0.45;
      out[i * 6 + 5] = d[i * 3 + 2];
    }
    this.rain.count = n * 2;
  }

  private environment(s: GameState, st: Store): Environment {
    const minute = this.envOverride ?? s.minute;
    const k = keyAt(minute);
    let sunI = k.sunI, clear = k.clear, sky = k.sky;
    if (s.weather === 'rainy') {
      sunI *= 0.45;
      clear = mixColor(clear, hex('#6f7a86'), 0.6);
      sky = mixColor(sky, hex('#8c96a0'), 0.5);
    } else if (s.weather === 'cloudy') {
      sunI *= 0.78;
      clear = mixColor(clear, hex('#a9b4bf'), 0.35);
    } else if (s.weather === 'hot') {
      clear = mixColor(clear, hex('#f2d3a0'), 0.2);
    }
    const el = k.elev, az = k.az;
    const sunDir = v3.norm([-Math.sin(az) * Math.cos(el), -Math.sin(el), -Math.cos(az) * Math.cos(el) * 0.6 - 0.4]);
    const night = clamp((k.inside - 0.45) / 0.55, 0, 1);
    // emissive night accents
    for (const n of this.neon) n.material.emissiveIntensity = 0.2 + night * 1.0;
    for (const n of this.neon) if (n.material.emissive[0] + n.material.emissive[1] + n.material.emissive[2] === 0) n.material.emissive = hex('#ffb38a');
    for (const n of this.nightGlow) n.material.emissiveIntensity = night * 1.4;
    for (const n of this.signFaces) {
      n.material.emissive = hex('#ff9a7a');
      n.material.emissiveIntensity = night * 0.35;
      n.material.glow = night * 0.3;
    }
    const lit = night > 0.5;
    for (const f of this.facades) {
      const want = T.facadeTex(String(f.userData.base ?? this.facadeBase), lit);
      if (f.material.map !== want) f.material.map = want;
    }
    const warm = hex('#ffd29a');
    const iv = 0.3 + k.inside * 1.15;
    const points: PointLight[] = [
      { pos: [3.9, 2.7, 1.6], color: v3.scale(warm, iv), range: 7.5 },
      { pos: [-2.2, 2.7, 1.0], color: v3.scale(warm, iv * 0.9), range: 7 },
      { pos: [-2.0, 2.7, -3.2], color: v3.scale(hex('#fff0d8'), iv * 0.85), range: 7 },
      { pos: [4.6, 2.7, -3.3], color: v3.scale(hex('#fff0d8'), iv * 0.7), range: 6 },
    ];
    const baking = itemsInStage(st, 'baking') / Math.max(1, ovenSlots(st));
    points.push({ pos: this.ovenPos, color: v3.scale(hex('#ff8a3a'), 0.4 + baking * 1.2), range: 4.5 });
    if (st.upgrades.sign >= 2) points.push({ pos: [9.6, 4.5, 7.6], color: v3.scale(hex('#ff6a4a'), night * 1.4), range: 7 });
    if (night > 0.3) for (const x of [-1.8, 5.2]) points.push({ pos: [x, 3.2, 7.4], color: v3.scale(hex('#ffd9a0'), night * 0.95), range: 7.5 });
    return {
      clear,
      sky: v3.scale(sky, 0.62),
      ground: v3.scale(k.ground, 0.55),
      sunDir,
      sunColor: v3.scale(k.sun, sunI),
      fog: clear,
      fogNear: 50,
      fogFar: 130,
      points,
      shadows: this.opts.shadows,
      shadowCenter: [0, 0, 1.5],
      shadowRadius: 16,
    };
  }
}

function toppingColors(id: keyof typeof ITEM): string[] {
  const r = ITEM[id].recipe;
  const skip: IngId[] = ['dough', 'sauce', 'cheese', 'bbq', 'garlic'];
  const cols = (Object.keys(r) as IngId[]).filter((k) => !skip.includes(k)).map((k) => ING[k].color);
  return cols.length ? cols : ['#f6efd2'];
}

export { merge, cached, cylinder, plane };
