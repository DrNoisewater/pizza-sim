// Per-store equipment upgrades. Level 0 is what a new store starts with.

export type UpgradeId =
  | 'oven' | 'prep' | 'register' | 'storage' | 'dining' | 'decor' | 'sign'
  | 'delivery' | 'online' | 'cleaning' | 'breakroom' | 'software';

export interface UpgradeLevel {
  name: string;
  cost: number;
  req: number;
  desc: string;
  // stats (only the relevant ones are set per category)
  slots?: number;
  bakeTime?: number;
  quality?: number;
  stations?: number;
  speed?: number;
  orderTime?: number;
  kiosk?: boolean;
  capacity?: number;
  shelfBonus?: number;
  seats?: number;
  ambience?: number;
  traffic?: number;
  vehicleCap?: number;
  vehicleSpeed?: number;
  onlineMult?: number;
  decay?: number;
  morale?: number;
  energy?: number;
  autoReorder?: boolean;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  group: 'Kitchen' | 'Front of house' | 'Growth' | 'Back office';
  levels: UpgradeLevel[];
  /** Upgrade that must be at least level 1 first. */
  needs?: UpgradeId;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'oven', name: 'Oven', group: 'Kitchen', levels: [
      { name: 'Deck Oven', cost: 0, req: 1, slots: 2, bakeTime: 7, quality: 0, desc: '2 pizzas at a time, 7 min bake.' },
      { name: 'Double Deck Oven', cost: 1200, req: 1, slots: 4, bakeTime: 6.5, quality: 2, desc: '4 pizzas at once, slightly faster.' },
      { name: 'Conveyor Oven', cost: 3800, req: 5, slots: 6, bakeTime: 4.5, quality: 4, desc: '6 pizzas on the belt, 4.5 min bake.' },
      { name: 'Wood-Fired Dome', cost: 9500, req: 8, slots: 8, bakeTime: 3, quality: 12, desc: '8 pizzas, 3 min bake, leopard-spotted crust (+quality).' },
    ],
  },
  {
    id: 'prep', name: 'Make Line', group: 'Kitchen', levels: [
      { name: 'Prep Table', cost: 0, req: 1, stations: 1, speed: 1, desc: 'Room for 1 cook.' },
      { name: 'Twin Prep Line', cost: 650, req: 1, stations: 2, speed: 1, desc: 'Room for 2 cooks.' },
      { name: 'Pro Make Line', cost: 1900, req: 3, stations: 3, speed: 1.1, desc: '3 cooks, chilled topping rail (+10% speed).' },
      { name: "Chef's Line", cost: 4500, req: 6, stations: 4, speed: 1.2, desc: '4 cooks, everything in reach (+20% speed).' },
    ],
  },
  {
    id: 'register', name: 'Register', group: 'Front of house', levels: [
      { name: 'Cash Box', cost: 0, req: 1, orderTime: 1.6, desc: 'Orders take a while to ring up.' },
      { name: 'POS Terminal', cost: 500, req: 1, orderTime: 1.1, desc: 'Faster ordering at the counter.' },
      { name: 'Touchscreen POS + Kiosk', cost: 2600, req: 4, orderTime: 0.8, kiosk: true, desc: 'Fastest tills plus a self-order kiosk.' },
    ],
  },
  {
    id: 'storage', name: 'Storage', group: 'Back office', levels: [
      { name: 'Pantry Shelves', cost: 0, req: 1, capacity: 440, shelfBonus: 0, desc: '440 storage units.' },
      { name: 'Upright Fridge', cost: 750, req: 1, capacity: 850, shelfBonus: 0, desc: '850 storage units.' },
      { name: 'Walk-in Cooler', cost: 2300, req: 3, capacity: 1400, shelfBonus: 1, desc: '1,400 units, stock lasts +1 day.' },
      { name: 'Cold Room', cost: 5200, req: 7, capacity: 2400, shelfBonus: 2, desc: '2,400 units, stock lasts +2 days.' },
    ],
  },
  {
    id: 'dining', name: 'Dining Room', group: 'Front of house', levels: [
      { name: 'Two Tables', cost: 0, req: 1, seats: 4, desc: '4 seats.' },
      { name: 'Cozy Corner', cost: 900, req: 1, seats: 8, desc: '8 seats.' },
      { name: 'Full Dining Room', cost: 2500, req: 3, seats: 12, desc: '12 seats.' },
      { name: 'Grand Hall', cost: 5200, req: 6, seats: 16, desc: '16 seats.' },
    ],
  },
  {
    id: 'decor', name: 'Decor', group: 'Front of house', levels: [
      { name: 'Bare Walls', cost: 0, req: 1, ambience: 0, desc: 'Concrete floor, plain walls.' },
      { name: 'Fresh Paint & Plants', cost: 450, req: 1, ambience: 1, desc: 'A little life. +ambience, +patience.' },
      { name: 'Checkered Classic', cost: 1300, req: 2, ambience: 2, desc: 'Black and white tiles, framed prints.' },
      { name: 'Retro Neon', cost: 3200, req: 5, ambience: 3, desc: 'Brick, neon and a jukebox.' },
      { name: 'Trattoria Deluxe', cost: 7500, req: 9, ambience: 4, desc: 'Oak floors, pendant lights, the works.' },
    ],
  },
  {
    id: 'sign', name: 'Street Sign', group: 'Growth', levels: [
      { name: 'Sidewalk Board', cost: 0, req: 1, traffic: 0, desc: 'Chalk on a sandwich board.' },
      { name: 'Lightbox Sign', cost: 550, req: 1, traffic: 0.08, desc: '+8% foot traffic.' },
      { name: 'Neon Pylon', cost: 1600, req: 3, traffic: 0.18, desc: '+18% foot traffic. Glows at night.' },
      { name: 'Giant Spinning Slice', cost: 4200, req: 6, traffic: 0.3, desc: '+30% foot traffic. A landmark.' },
    ],
  },
  {
    id: 'delivery', name: 'Delivery', group: 'Growth', levels: [
      { name: 'No Delivery', cost: 0, req: 1, vehicleCap: 0, vehicleSpeed: 1, desc: 'Walk-ins only.' },
      { name: 'Bicycle', cost: 800, req: 2, vehicleCap: 1, vehicleSpeed: 1, desc: 'Unlocks delivery orders. Needs a driver.' },
      { name: 'Scooter', cost: 2100, req: 4, vehicleCap: 2, vehicleSpeed: 0.75, desc: '2 orders per trip, 25% faster.' },
      { name: 'Electric Van', cost: 5400, req: 7, vehicleCap: 4, vehicleSpeed: 0.65, desc: '4 orders per trip, 35% faster.' },
    ],
  },
  {
    id: 'online', name: 'Online Ordering', group: 'Growth', needs: 'delivery', levels: [
      { name: 'Phone Orders', cost: 0, req: 1, onlineMult: 1, desc: 'Customers call in.' },
      { name: 'Website Ordering', cost: 1300, req: 3, onlineMult: 1.45, desc: '+45% delivery orders.' },
      { name: 'Mobile App', cost: 3800, req: 6, onlineMult: 1.95, desc: '+95% delivery orders.' },
    ],
  },
  {
    id: 'cleaning', name: 'Cleaning Gear', group: 'Back office', levels: [
      { name: 'Mop & Bucket', cost: 0, req: 1, decay: 1, desc: 'The basics.' },
      { name: 'Dishwasher', cost: 700, req: 2, decay: 0.7, desc: 'Store gets dirty 30% slower.' },
      { name: 'Floor Scrubber', cost: 1900, req: 4, decay: 0.45, desc: 'Store gets dirty 55% slower.' },
    ],
  },
  {
    id: 'breakroom', name: 'Breakroom', group: 'Back office', levels: [
      { name: 'No Breakroom', cost: 0, req: 1, morale: 0, energy: 0, desc: 'Staff eat standing up.' },
      { name: 'Breakroom', cost: 900, req: 3, morale: 2, energy: 10, desc: '+morale daily, staff recover energy.' },
      { name: 'Staff Lounge', cost: 2600, req: 6, morale: 4, energy: 20, desc: 'Big morale and energy boost.' },
    ],
  },
  {
    id: 'software', name: 'Inventory System', group: 'Back office', levels: [
      { name: 'Clipboard', cost: 0, req: 1, autoReorder: false, desc: 'Count stock by hand.' },
      { name: 'Inventory Software', cost: 1200, req: 5, autoReorder: true, desc: 'Auto-reorders to your par levels every night.' },
    ],
  },
];
export const UPG: Record<UpgradeId, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDef>;
