// Locations, marketing, staff roles & traits, weather, loans.
import type { ItemId } from './catalog';

export type LocationId = 'maple' | 'campus' | 'downtown' | 'harbor' | 'airport';
export type CurveId = 'default' | 'late' | 'lunch' | 'tourist' | 'flat';
export type EnvId = 'suburb' | 'campus' | 'city' | 'harbor' | 'airport';

/** Demand multipliers for each opening hour, 10:00 through 21:00. */
export const HOUR_CURVES: Record<CurveId, number[]> = {
  default: [0.35, 0.7, 1.5, 1.4, 0.7, 0.5, 0.6, 1.0, 1.6, 1.7, 1.3, 0.8],
  late: [0.3, 0.6, 1.2, 1.1, 0.7, 0.6, 0.7, 1.0, 1.4, 1.6, 1.6, 1.5],
  lunch: [0.5, 1.1, 2.2, 2.0, 0.8, 0.5, 0.6, 0.9, 1.1, 1.0, 0.7, 0.4],
  tourist: [0.4, 0.8, 1.4, 1.5, 1.2, 1.0, 1.0, 1.2, 1.6, 1.6, 1.3, 0.9],
  flat: [1.0, 1.1, 1.3, 1.3, 1.1, 1.0, 1.0, 1.1, 1.3, 1.2, 1.0, 0.8],
};

export interface LocationDef {
  id: LocationId;
  name: string;
  district: string;
  cost: number;
  reqLevel: number;
  rent: number;
  /** Base customers per hour at curve 1.0 and a 3-star rating. */
  traffic: number;
  priceSens: number;
  patience: number;
  deliveryShare: number;
  deliveryDist: number;
  weekendBoost: number;
  weatherSens: number;
  prefs: Partial<Record<ItemId, number>>;
  curve: CurveId;
  env: EnvId;
  blurb: string;
}

export const LOCATIONS: LocationDef[] = [
  { id: 'maple', name: 'Maple Street', district: 'Suburbs', cost: 0, reqLevel: 1, rent: 90, traffic: 9, priceSens: 1, patience: 1, deliveryShare: 0.3, deliveryDist: 1, weekendBoost: 1.1, weatherSens: 1, prefs: { pepperoni: 1.1, margherita: 1.1, hawaiian: 1.1 }, curve: 'default', env: 'suburb', blurb: 'Quiet street, family crowd, steady dinners.' },
  { id: 'campus', name: 'Campus Corner', district: 'University', cost: 15000, reqLevel: 4, rent: 160, traffic: 12, priceSens: 1.5, patience: 1.1, deliveryShare: 0.45, deliveryDist: 0.8, weekendBoost: 1.0, weatherSens: 1, prefs: { pepperoni: 1.3, hawaiian: 1.3, knots: 1.4, soda: 1.3, supreme: 0.8 }, curve: 'late', env: 'campus', blurb: 'Hungry students, tight budgets, late nights.' },
  { id: 'downtown', name: 'Downtown Plaza', district: 'Business District', cost: 40000, reqLevel: 7, rent: 320, traffic: 17, priceSens: 0.75, patience: 0.75, deliveryShare: 0.32, deliveryDist: 0.9, weekendBoost: 0.75, weatherSens: 0.8, prefs: { margherita: 1.2, veggie: 1.3, bianca: 1.4 }, curve: 'lunch', env: 'city', blurb: 'Huge lunch rush. Office workers hate waiting.' },
  { id: 'harbor', name: 'Harbor Boardwalk', district: 'Waterfront', cost: 85000, reqLevel: 10, rent: 520, traffic: 19, priceSens: 0.6, patience: 1, deliveryShare: 0.15, deliveryDist: 1.2, weekendBoost: 1.5, weatherSens: 1.6, prefs: { supreme: 1.3, bbqchicken: 1.3, meatlovers: 1.2, calzone: 1.2 }, curve: 'tourist', env: 'harbor', blurb: 'Tourists pay more. Weather makes or breaks the day.' },
  { id: 'airport', name: 'Airport Terminal B', district: 'Airport', cost: 180000, reqLevel: 14, rent: 950, traffic: 26, priceSens: 0.3, patience: 0.65, deliveryShare: 0, deliveryDist: 1, weekendBoost: 1.05, weatherSens: 0.2, prefs: { calzone: 1.4, margherita: 1.1 }, curve: 'flat', env: 'airport', blurb: 'Endless foot traffic, premium prices, zero patience.' },
];
export const LOC: Record<LocationId, LocationDef> = Object.fromEntries(LOCATIONS.map((l) => [l.id, l])) as Record<LocationId, LocationDef>;

export type CampaignId = 'flyers' | 'social' | 'coupon' | 'radio' | 'billboard' | 'tv';
export interface CampaignDef {
  id: CampaignId;
  name: string;
  cost: number;
  days: number;
  boost: number;
  deliveryBoost?: number;
  priceMult?: number;
  req: number;
  desc: string;
}
export const CAMPAIGNS: CampaignDef[] = [
  { id: 'flyers', name: 'Flyer Drop', cost: 120, days: 3, boost: 0.12, req: 1, desc: '+12% customers for 3 days.' },
  { id: 'social', name: 'Social Media Ads', cost: 380, days: 5, boost: 0.22, deliveryBoost: 0.2, req: 2, desc: '+22% customers, +20% delivery orders for 5 days.' },
  { id: 'coupon', name: 'Coupon Day', cost: 0, days: 1, boost: 0.6, priceMult: 0.8, req: 3, desc: '+60% customers today, but everything is 20% off.' },
  { id: 'radio', name: 'Local Radio Spot', cost: 950, days: 7, boost: 0.35, req: 4, desc: '+35% customers for 7 days.' },
  { id: 'billboard', name: 'Billboard', cost: 2300, days: 14, boost: 0.45, req: 7, desc: '+45% customers for 14 days.' },
  { id: 'tv', name: 'TV Commercial', cost: 6500, days: 7, boost: 0.85, deliveryBoost: 0.3, req: 8, desc: '+85% customers for 7 days.' },
];
export const CAMPAIGN: Record<CampaignId, CampaignDef> = Object.fromEntries(CAMPAIGNS.map((c) => [c.id, c])) as Record<CampaignId, CampaignDef>;

export const LOYALTY = { cost: 1500, req: 5, boost: 0.12, dailyFee: 15 };

export type Role = 'cook' | 'cashier' | 'driver' | 'cleaner' | 'manager';
export const ROLES: Record<Role, { name: string; baseWage: number; perSkill: number; req: number; desc: string; color: string }> = {
  cook: { name: 'Cook', baseWage: 11, perSkill: 2.5, req: 1, desc: 'Builds pizzas on the make line. Skill raises speed and quality.', color: '#f4f1ea' },
  cashier: { name: 'Cashier', baseWage: 9.5, perSkill: 2, req: 1, desc: 'Takes orders at the register.', color: '#d8402b' },
  driver: { name: 'Driver', baseWage: 10, perSkill: 2, req: 2, desc: 'Delivers orders. Needs a delivery vehicle.', color: '#2f6fd1' },
  cleaner: { name: 'Cleaner', baseWage: 8.5, perSkill: 1.5, req: 1, desc: 'Keeps the store spotless.', color: '#3f9b4a' },
  manager: { name: 'Manager', baseWage: 18, perSkill: 4, req: 4, desc: 'Boosts everyone, auto-orders stock, cuts waste. One per store.', color: '#2b2724' },
};

export type TraitId = 'speedy' | 'charming' | 'upseller' | 'perfectionist' | 'clumsy' | 'reliable' | 'slacker' | 'veteran' | 'nightowl';
export const TRAITS: Record<TraitId, { name: string; good: boolean; desc: string }> = {
  speedy: { name: 'Quick Hands', good: true, desc: '+15% speed.' },
  charming: { name: 'Charming', good: true, desc: 'Customers they serve are happier.' },
  upseller: { name: 'Upseller', good: true, desc: 'Sells more sides and drinks at the register.' },
  perfectionist: { name: 'Perfectionist', good: true, desc: '+quality, a little slower.' },
  clumsy: { name: 'Clumsy', good: false, desc: 'Sometimes drops a pizza and has to remake it.' },
  reliable: { name: 'Reliable', good: true, desc: 'Never calls in sick. Steadier morale.' },
  slacker: { name: 'Slacker', good: false, desc: '-15% speed.' },
  veteran: { name: 'Veteran', good: true, desc: 'Learns 50% faster.' },
  nightowl: { name: 'Night Owl', good: true, desc: '+10% speed after 6 PM.' },
};

export type WeatherId = 'sunny' | 'cloudy' | 'rainy' | 'hot';
export const WEATHER: Record<WeatherId, { name: string; walk: number; delivery: number; drinks: number }> = {
  sunny: { name: 'Sunny', walk: 1.06, delivery: 0.9, drinks: 1.1 },
  cloudy: { name: 'Cloudy', walk: 1, delivery: 1, drinks: 1 },
  rainy: { name: 'Rain', walk: 0.7, delivery: 1.6, drinks: 0.9 },
  hot: { name: 'Heatwave', walk: 0.92, delivery: 1.1, drinks: 1.8 },
};

export const LOANS = [
  { amount: 2000, req: 1 },
  { amount: 8000, req: 3 },
  { amount: 25000, req: 6 },
  { amount: 75000, req: 10 },
];
export const LOAN_INTEREST = 0.1;
export const LOAN_DAYS = 20;

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_TRAFFIC = [0.85, 0.85, 0.95, 1.0, 1.25, 1.35, 1.1];

export const OPEN_MIN = 10 * 60;
export const CLOSE_MIN = 22 * 60;
export const HARD_CLOSE_MIN = 23 * 60 + 30;
export const PREP_MIN = 9 * 60;
export const MAX_STAFF = 14;
