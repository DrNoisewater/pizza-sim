// Game state types. Everything in GameState is plain JSON so saves are trivial.
import type { IngId, ItemId, SupplierId } from '../data/catalog';
import type { UpgradeId } from '../data/upgrades';
import type { CampaignId, LocationId, Role, TraitId, WeatherId } from '../data/world';
import type { ReviewTopic } from '../data/text';

export type Difficulty = 'relaxed' | 'standard' | 'hard';
export type Phase = 'prep' | 'open' | 'closing' | 'report';

export interface Look {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  height: number;
}

export interface Staff {
  id: number;
  name: string;
  role: Role;
  skill: number;
  xp: number;
  morale: number;
  energy: number;
  wage: number;
  traits: TraitId[];
  hiredDay: number;
  status: 'active' | 'training' | 'sick';
  /** Days left in current status (training/sick). */
  statusDays: number;
  task: Task | null;
  busyMin: number;
  tasksToday: number;
  bonusDay: number;
  look: Look;
}

export interface Candidate {
  id: number;
  name: string;
  role: Role;
  skill: number;
  wage: number;
  traits: TraitId[];
  look: Look;
}

export type TaskKind = 'order' | 'prep' | 'deliver' | 'clean';
export interface Task {
  kind: TaskKind;
  remaining: number;
  total: number;
  /** order: customer id. prep: order id. deliver: order ids. */
  customerId?: number;
  orderId?: number;
  itemIdx?: number;
  orderIds?: number[];
  /** Kitchen station index used by a prep task. */
  station?: number;
  /** deliver: minutes from start when the drop happens. */
  dropAt?: number;
  dropped?: boolean;
}

export type CustomerState = 'enter' | 'queue' | 'ordering' | 'toSeat' | 'waitFood' | 'eating' | 'leave';
export interface Customer {
  id: number;
  kind: 'dine' | 'takeout';
  state: CustomerState;
  t: number;
  patience: number;
  arrived: number;
  orderId?: number;
  seat?: number;
  waitSpot?: number;
  eatFor?: number;
  critic?: boolean;
  mood: 'happy' | 'ok' | 'angry' | 'none';
  look: Look;
}

export type ItemStage = 'queued' | 'prep' | 'ovenWait' | 'baking' | 'done';
export interface OrderItem {
  item: ItemId;
  stage: ItemStage;
  progress: number;
  quality: number;
}

export interface Order {
  id: number;
  kind: 'dine' | 'takeout' | 'delivery';
  customerId?: number;
  name: string;
  items: OrderItem[];
  total: number;
  placed: number;
  expected: number;
  state: 'kitchen' | 'ready' | 'out' | 'done' | 'refunded';
  charm: number;
  critic?: boolean;
}

export interface Batch {
  qty: number;
  /** Last day (inclusive) the batch is usable. */
  exp: number;
}

export interface Incoming {
  ing: IngId;
  qty: number;
  /** Absolute minute it arrives; -1 = next morning. */
  at: number;
}

export interface DayStats {
  day: number;
  revenue: number;
  supplies: number;
  wages: number;
  rent: number;
  marketing: number;
  equipment: number;
  other: number;
  loan: number;
  foodCost: number;
  served: number;
  lost: number;
  soldOut: number;
  refunds: number;
  deliveries: number;
  satSum: number;
  satCount: number;
  waste: number;
  sold: Partial<Record<ItemId, number>>;
  ratingEnd: number;
}

export interface Review {
  day: number;
  name: string;
  stars: number;
  topic: ReviewTopic;
  text: string;
  critic?: boolean;
}

export interface Store {
  id: number;
  locationId: LocationId;
  upgrades: Record<UpgradeId, number>;
  staff: Staff[];
  candidates: Candidate[];
  inventory: Record<IngId, Batch[]>;
  incoming: Incoming[];
  supplier: SupplierId;
  autoReorder: boolean;
  par: Partial<Record<IngId, number>>;
  menu: Record<ItemId, { on: boolean; price: number }>;
  customers: Customer[];
  orders: Order[];
  deliveryQueue: number[];
  cleanliness: number;
  rating: number;
  campaigns: { id: CampaignId; daysLeft: number }[];
  today: DayStats;
  history: DayStats[];
  reviews: Review[];
  ovenPenalty: number;
  usage: Partial<Record<IngId, number>>[];
  kiosk: { customerId: number; remaining: number } | null;
  openedDay: number;
}

export type EventKind =
  | 'inspection' | 'critic' | 'biggame' | 'festival' | 'cheese' | 'oven' | 'sick' | 'rival'
  | 'wholesale' | 'raise' | 'viral' | 'sale';

export interface ScheduledEvent {
  kind: EventKind;
  storeId: number;
  at: number;
  done: boolean;
}

export interface Effect {
  kind: 'traffic' | 'dinner' | 'price' | 'upgradeSale';
  storeId: number | null;
  mult: number;
  ing?: IngId;
  daysLeft: number;
  label: string;
}

export interface ChoiceOption {
  id: string;
  label: string;
  detail: string;
}
export interface PendingChoice {
  kind: EventKind;
  storeId: number;
  title: string;
  body: string;
  options: ChoiceOption[];
  data?: Record<string, number | string>;
}

export interface Loan {
  principal: number;
  remaining: number;
  daily: number;
  daysLeft: number;
}

export interface DayReport {
  day: number;
  stores: { storeId: number; stats: DayStats; ratingStart: number }[];
  cashStart: number;
  cashEnd: number;
  levelStart: number;
  notes: string[];
  tomorrow: string[];
}

export interface Stats {
  served: number;
  revenue: number;
  lost: number;
  bestDayRevenue: number;
  bestDayProfit: number;
  ordersPlaced: number;
  upgradesBought: number;
  campaignsRun: number;
  trained: number;
  recipesUnlocked: number;
  hires: number;
  daysCompleted: number;
  deliveries: number;
}

export interface NewsItem {
  day: number;
  minute: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

export interface GameState {
  version: number;
  company: string;
  difficulty: Difficulty;
  rng: number;
  nextId: number;
  day: number;
  minute: number;
  phase: Phase;
  cash: number;
  dayStartCash: number;
  xp: number;
  level: number;
  stores: Store[];
  unlocked: ItemId[];
  loyalty: boolean;
  loan: Loan | null;
  goalIndex: number;
  goalsDone: string[];
  stats: Stats;
  weather: WeatherId;
  forecast: WeatherId;
  effects: Effect[];
  scheduled: ScheduledEvent[];
  choice: PendingChoice | null;
  tomorrowEvent: EventKind | null;
  tomorrowStore: number;
  market: Record<IngId, number>;
  report: DayReport | null;
  news: NewsItem[];
  negativeDays: number;
  gameOver: boolean;
  tutorial: boolean;
}

export interface SimEvent {
  type: 'sale' | 'served' | 'walkout' | 'levelup' | 'goal' | 'toast' | 'dayEnd' | 'review' | 'delivery' | 'ding' | 'error';
  storeId?: number;
  amount?: number;
  text?: string;
  tone?: 'good' | 'bad' | 'info';
  customerId?: number;
  stars?: number;
}
