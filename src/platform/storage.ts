// Save-game storage with three backends:
//  - Desktop (Electron): JSON files in the user's app-data folder via the preload bridge.
//  - Web: localStorage on this device.
//  - Cloud (claude.ai artifact runtime): a private per-player document, so saves follow the player.
// The web build writes to both local and cloud and reads whichever is newer.

export interface SaveMeta {
  slot: string;
  savedAt: number;
  company: string;
  day: number;
  cash: number;
  level: number;
  stores: number;
}
export interface SaveFile {
  meta: SaveMeta;
  data: string;
}

interface Backend {
  name: string;
  list(): Promise<SaveMeta[]>;
  load(slot: string): Promise<SaveFile | null>;
  save(file: SaveFile): Promise<void>;
  remove(slot: string): Promise<void>;
}

// ------------------------------------------------------------ desktop
interface NativeBridge {
  listSaves(): Promise<SaveMeta[]>;
  loadSave(slot: string): Promise<SaveFile | null>;
  writeSave(file: SaveFile): Promise<void>;
  deleteSave(slot: string): Promise<void>;
  quit(): void;
  toggleFullscreen(): void;
  isDesktop: true;
}
export function native(): NativeBridge | null {
  return (window as unknown as { pizzaNative?: NativeBridge }).pizzaNative ?? null;
}

const desktopBackend = (n: NativeBridge): Backend => ({
  name: 'desktop',
  list: () => n.listSaves(),
  load: (slot) => n.loadSave(slot),
  save: (f) => n.writeSave(f),
  remove: (slot) => n.deleteSave(slot),
});

// ------------------------------------------------------------ local
const PREFIX = 'pizzasim.save.';
const localBackend: Backend = {
  name: 'local',
  async list() {
    const out: SaveMeta[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(PREFIX)) continue;
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const f = JSON.parse(raw) as SaveFile;
        if (f?.meta) out.push(f.meta);
      }
    } catch {
      /* storage unavailable */
    }
    return out;
  },
  async load(slot) {
    try {
      const raw = localStorage.getItem(PREFIX + slot);
      return raw ? (JSON.parse(raw) as SaveFile) : null;
    } catch {
      return null;
    }
  },
  async save(f) {
    try {
      localStorage.setItem(PREFIX + f.meta.slot, JSON.stringify(f));
    } catch {
      /* quota or blocked */
    }
  },
  async remove(slot) {
    try {
      localStorage.removeItem(PREFIX + slot);
    } catch {
      /* ignore */
    }
  },
};

// ------------------------------------------------------------ cloud (artifact runtime)
type DocSnap = { exists: boolean; data(): Record<string, unknown> | undefined };
type DocRef = { get(): Promise<DocSnap>; set(d: Record<string, unknown>): Promise<unknown>; delete(): Promise<unknown> };
type Db = { collection(p: string): { doc(id: string): DocRef } };
type UserCap = { id(): Promise<string | null> };
type ClaudeRuntime = { use(name: string): Promise<unknown> };

async function cloudBackend(): Promise<Backend | null> {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (!claude?.use) return null;
  try {
    const [db, user] = (await Promise.all([claude.use('db'), claude.use('user')])) as [Db | null, UserCap | null];
    if (!db || !user) return null;
    const uid = await user.id();
    if (!uid) return null;
    const col = db.collection('data/users/' + uid);
    const ref = (slot: string) => col.doc('save_' + slot);
    const slots = ['auto', '1', '2', '3'];
    let writeChain: Promise<unknown> = Promise.resolve();
    return {
      name: 'cloud',
      async list() {
        const out: SaveMeta[] = [];
        await Promise.all(
          slots.map(async (s) => {
            try {
              const snap = await ref(s).get();
              const d = snap.exists ? snap.data() : undefined;
              if (d?.meta) out.push(d.meta as SaveMeta);
            } catch {
              /* ignore */
            }
          }),
        );
        return out;
      },
      async load(slot) {
        try {
          const snap = await ref(slot).get();
          const d = snap.exists ? snap.data() : undefined;
          return d ? ({ meta: d.meta as SaveMeta, data: String(d.data) } as SaveFile) : null;
        } catch {
          return null;
        }
      },
      async save(f) {
        // one write at a time per document
        writeChain = writeChain.then(() => ref(f.meta.slot).set({ meta: f.meta, data: f.data })).catch(() => undefined);
        await writeChain;
      },
      async remove(slot) {
        try {
          await ref(slot).delete();
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ facade
class SaveStore {
  private primary: Backend;
  private cloud: Backend | null = null;
  ready: Promise<void>;
  constructor() {
    const n = native();
    this.primary = n ? desktopBackend(n) : localBackend;
    this.ready = n
      ? Promise.resolve()
      : cloudBackend().then((c) => {
          this.cloud = c;
        });
  }
  get where() {
    if (this.primary.name === 'desktop') return 'Saved to your PC';
    return this.cloud ? 'Saved to your account and this device' : 'Saved in this browser';
  }
  async list(): Promise<SaveMeta[]> {
    const local = await this.primary.list();
    const remote = this.cloud ? await this.cloud.list() : [];
    const map = new Map<string, SaveMeta>();
    for (const m of [...local, ...remote]) {
      const cur = map.get(m.slot);
      if (!cur || m.savedAt > cur.savedAt) map.set(m.slot, m);
    }
    return [...map.values()].sort((a, b) => b.savedAt - a.savedAt);
  }
  async load(slot: string): Promise<SaveFile | null> {
    const a = await this.primary.load(slot);
    const b = this.cloud ? await this.cloud.load(slot) : null;
    if (a && b) return a.meta.savedAt >= b.meta.savedAt ? a : b;
    return a ?? b;
  }
  async save(f: SaveFile) {
    await this.primary.save(f);
    if (this.cloud) this.cloud.save(f).catch(() => undefined);
  }
  async remove(slot: string) {
    await this.primary.remove(slot);
    if (this.cloud) await this.cloud.remove(slot);
  }
}

export const saves = new SaveStore();

// ------------------------------------------------------------ settings (per device)
export interface Settings {
  sound: boolean;
  music: boolean;
  volume: number;
  shadows: boolean;
  floatingText: boolean;
  autoNextDay: boolean;
  quality: 'high' | 'low';
}
const DEFAULT_SETTINGS: Settings = { sound: true, music: false, volume: 0.6, shadows: true, floatingText: true, autoNextDay: false, quality: 'high' };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('pizzasim.settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  const mobile = Math.min(window.innerWidth, window.innerHeight) < 600;
  return { ...DEFAULT_SETTINGS, quality: mobile ? 'low' : 'high', shadows: !mobile || true };
}
export function storeSettings(s: Settings) {
  try {
    localStorage.setItem('pizzasim.settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
