// Full-screen and modal views: title, new game, load, day report receipt, events,
// pause menu, settings, help, game over.
import type { GameState, DayReport } from '../core/types';
import { LOC, WEATHER, DAY_NAMES } from '../data/world';
import { ITEM, type ItemId } from '../data/catalog';
import { DIFFICULTY } from '../core/state';
import { money, plural } from '../core/util';
import type { SaveMeta, Settings } from '../platform/storage';
import { esc, icon, stars } from './dom';

export function titleScreen(opts: { latest: SaveMeta | null; hasSaves: boolean; where: string; desktop: boolean }): string {
  const l = opts.latest;
  return `<div class="title-card">
    <h1 class="logo">Pizza<small>SIM</small></h1>
    <p class="tagline">One deck oven, one cook, one dream. Build it into a pizza empire.</p>
    <div class="menu-stack">
      ${l ? `<button class="btn red big-cta" data-act="continue">${icon('play', 18)} Continue <span class="num" style="font-family:var(--font-num);font-size:15px;opacity:.9">Day ${l.day} · ${money(l.cash)}</span></button>` : ''}
      <button class="btn ${l ? '' : 'red big-cta'}" data-act="new-game">New pizzeria</button>
      ${opts.hasSaves ? '<button class="btn" data-act="load-screen">Load game</button>' : ''}
      <div class="row" style="gap:8px">
        <button class="btn grow" data-act="help">How to play</button>
        <button class="btn grow" data-act="settings">Settings</button>
      </div>
      ${opts.desktop ? '<button class="btn" data-act="quit-app">Exit to desktop</button>' : ''}
    </div>
    <p class="foot-note">${esc(opts.where)} · Drag to look around, scroll or pinch to zoom</p>
  </div>`;
}

export function newGameScreen(name: string, diff: string): string {
  return `<div class="title-card">
    <h1 class="logo" style="font-size:clamp(48px,12vw,72px)">New<small>Pizzeria</small></h1>
    <form class="menu-stack" data-form="new-game" autocomplete="off">
      <div class="field"><label for="ng-name">Pizzeria name</label><input id="ng-name" type="text" maxlength="22" value="${esc(name)}" /></div>
      <div class="field"><label>Difficulty</label>
        <div class="seg" role="group" style="margin:0">${(Object.keys(DIFFICULTY) as (keyof typeof DIFFICULTY)[]).map((k) => `<button type="button" data-act="ng-diff" data-v="${k}" aria-pressed="${diff === k}">${DIFFICULTY[k].label}</button>`).join('')}</div>
        <div class="t-meta">${esc(DIFFICULTY[diff as keyof typeof DIFFICULTY].desc)} Starting cash ${money(DIFFICULTY[diff as keyof typeof DIFFICULTY].cash)}.</div>
      </div>
      <button class="btn red big-cta" type="submit">Open the doors</button>
      <button class="btn" type="button" data-act="title">Back</button>
    </form>
  </div>`;
}

export function loadScreen(list: SaveMeta[], fromGame: boolean): string {
  return `<div class="title-card">
    <h1 class="logo" style="font-size:clamp(48px,12vw,72px)">Load<small>Game</small></h1>
    <div class="menu-stack">
      ${list.length ? list.map((m) => `<div class="save-slot"><div class="grow"><div class="t-name">${esc(m.company)} <span class="chip">${m.slot === 'auto' ? 'Autosave' : 'Slot ' + esc(m.slot)}</span></div>
        <div class="t-meta">Day ${m.day} · level ${m.level} · ${money(m.cash)} · ${plural(m.stores, 'store')} · ${new Date(m.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div></div>
        <button class="btn buy small" data-act="load" data-slot="${esc(m.slot)}">Load</button>
        <button class="icon-btn" data-act="delete-save" data-slot="${esc(m.slot)}" aria-label="Delete save">${icon('trash', 16)}</button></div>`).join('') : '<p class="t-meta">No saved games yet.</p>'}
      <button class="btn" data-act="${fromGame ? 'pause' : 'title'}">Back</button>
    </div>
  </div>`;
}

export function reportModal(s: GameState, r: DayReport): string {
  const sum = (k: 'revenue' | 'supplies' | 'wages' | 'rent' | 'marketing' | 'other' | 'loan' | 'equipment' | 'served' | 'lost' | 'deliveries' | 'refunds' | 'waste' | 'soldOut') => r.stores.reduce((a, x) => a + x.stats[k], 0);
  const sat = r.stores.reduce((a, x) => a + x.stats.satSum, 0) / Math.max(1, r.stores.reduce((a, x) => a + x.stats.satCount, 0));
  const costs = sum('supplies') + sum('wages') + sum('rent') + sum('marketing') + sum('other') + sum('loan');
  const profit = sum('revenue') - costs;
  const sold: Partial<Record<ItemId, number>> = {};
  for (const x of r.stores) for (const [k, v] of Object.entries(x.stats.sold)) sold[k as ItemId] = (sold[k as ItemId] ?? 0) + (v ?? 0);
  const top = (Object.entries(sold) as [ItemId, number][]).filter(([k]) => ITEM[k].type === 'pizza').sort((a, b) => b[1] - a[1])[0];
  const line = (label: string, v: string, cls = '') => `<div class="line ${cls}"><span>${label}</span><span class="lead"></span><span>${v}</span></div>`;
  const dow = DAY_NAMES[(r.day - 1) % 7];
  return `<div class="receipt-wrap" role="dialog" aria-label="End of day report">
    <div class="receipt">
      <h2>${esc(s.company)}</h2>
      <div class="center">Day ${r.day} · ${dow} · closing receipt</div>
      <hr/>
      ${line('Sales', money(sum('revenue'), true))}
      ${line('Supplies', '−' + money(sum('supplies'), true), 'sub')}
      ${line('Wages', '−' + money(sum('wages'), true), 'sub')}
      ${line('Rent', '−' + money(sum('rent'), true), 'sub')}
      ${sum('marketing') ? line('Marketing', '−' + money(sum('marketing'), true), 'sub') : ''}
      ${sum('other') ? line('Training, fines, bonuses', '−' + money(sum('other'), true), 'sub') : ''}
      ${sum('loan') ? line('Loan payment', '−' + money(sum('loan'), true), 'sub') : ''}
      <hr/>
      ${line('Profit', (profit < 0 ? '−' : '') + money(Math.abs(profit), true), 'total ' + (profit < 0 ? 'neg' : 'pos'))}
      ${sum('equipment') ? line('Invested in equipment', money(sum('equipment')), 'sub') : ''}
      ${line('Cash on hand', money(r.cashEnd), 'sub')}
      <hr/>
      ${line('Customers served', String(sum('served')))}
      ${line('Customers lost', String(sum('lost')), sum('lost') > sum('served') * 0.25 ? 'neg' : '')}
      ${sum('soldOut') ? line('&nbsp;&nbsp;of those, sold out', String(sum('soldOut')), 'sub') : ''}
      ${sum('refunds') ? line('Refunds', String(sum('refunds')), 'sub neg') : ''}
      ${sum('deliveries') ? line('Deliveries', String(sum('deliveries')), 'sub') : ''}
      ${line('Avg. satisfaction', sat ? Math.round(sat) + '%' : '—', 'sub')}
      ${top ? line('Best seller', `${esc(ITEM[top[0]].name)} ×${top[1]}`, 'sub') : ''}
      ${sum('waste') > 1 ? line('Spoiled stock', money(sum('waste')), 'sub neg') : ''}
      ${r.stores.map((x) => {
        const st = s.stores.find((q) => q.id === x.storeId);
        if (!st) return '';
        const d = st.rating - x.ratingStart;
        return line(`${esc(LOC[st.locationId].name)} rating`, `${stars(st.rating, 12)} ${st.rating.toFixed(2)} <span class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '▲' : '▼'}${Math.abs(d).toFixed(2)}</span>`, 'sub');
      }).join('')}
      ${s.level > r.levelStart ? `<hr/><div class="note">${icon('star', 16)}<span><b>Level up!</b> You reached level ${s.level}.</span></div>` : ''}
      ${r.notes.length ? '<hr/>' + r.notes.map((n) => `<div class="note">${icon('info', 16)}<span>${esc(n)}</span></div>`).join('') : ''}
      <hr/>
      <div class="center">Tomorrow</div>
      ${r.tomorrow.map((n) => `<div class="note">${icon(n.startsWith('Forecast') ? s.weather : 'clock', 16)}<span>${esc(n)}</span></div>`).join('')}
    </div>
    <div class="receipt-foot">
      ${s.gameOver ? '<button class="btn red block big-cta" data-act="game-over">See what happened</button>' : `<button class="btn red block big-cta" data-act="next-day">Start day ${r.day + 1}</button>`}
    </div>
  </div>`;
}

export function choiceModal(s: GameState): string {
  const c = s.choice!;
  return `<div class="modal" role="dialog" aria-label="${esc(c.title)}">
    <h2>${esc(c.title)}</h2>
    <p>${esc(c.body)}</p>
    ${c.options.map((o) => `<button class="choice" data-act="choose" data-id="${esc(o.id)}"><b>${esc(o.label)}</b><span>${esc(o.detail)}</span></button>`).join('')}
  </div>`;
}

export function pauseModal(where: string, desktop: boolean): string {
  return `<div class="modal" role="dialog" aria-label="Paused">
    <h2>Paused</h2>
    <p class="t-meta">${esc(where)}.</p>
    <div class="menu-stack" style="box-shadow:none;padding:0;border:0;background:none">
      <button class="btn red" data-act="resume">${icon('play', 16)} Resume</button>
      <div class="section-label" style="margin:10px 2px 0">Save to slot</div>
      <div class="row" style="gap:6px">${['1', '2', '3'].map((n) => `<button class="btn grow" data-act="save" data-slot="${n}">${icon('save', 16)} Slot ${n}</button>`).join('')}</div>
      <button class="btn" data-act="load-screen-game">Load game</button>
      <button class="btn" data-act="settings">Settings</button>
      <button class="btn" data-act="help">How to play</button>
      <button class="btn only-desktop" data-act="fullscreen">Toggle full screen${desktop ? ' (F11)' : ''}</button>
      <button class="btn" data-act="quit-title">Save and quit to title</button>
      ${desktop ? '<button class="btn" data-act="quit-app">Save and exit to desktop</button>' : ''}
    </div>
  </div>`;
}

export function settingsModal(st: Settings, back: string): string {
  const tog = (key: keyof Settings, label: string, desc: string) => `<div class="ticket" style="margin-bottom:6px"><div class="row"><div class="grow"><div class="t-name" style="font-size:15px">${label}</div><div class="t-meta">${desc}</div></div>
    <button class="toggle" data-act="set" data-key="${key}" aria-pressed="${!!st[key]}" aria-label="${label}"></button></div></div>`;
  return `<div class="modal" role="dialog" aria-label="Settings">
    <h2>Settings</h2>
    ${tog('sound', 'Sound effects', 'Cash register dings, oven bells, level-ups.')}
    ${tog('music', 'Music', 'A little tarantella loop.')}
    <div class="ticket" style="margin-bottom:6px"><div class="row"><div class="grow"><div class="t-name" style="font-size:15px">Volume</div></div>
      <div class="stepper"><button data-act="volume" data-d="-0.1" aria-label="Quieter">${icon('minus', 14)}</button><span class="val">${Math.round(st.volume * 100)}%</span><button data-act="volume" data-d="0.1" aria-label="Louder">${icon('plus', 14)}</button></div></div></div>
    ${tog('shadows', 'Shadows', 'Turn off for smoother play on older devices.')}
    <div class="ticket" style="margin-bottom:6px"><div class="row"><div class="grow"><div class="t-name" style="font-size:15px">Graphics quality</div><div class="t-meta">High adds glow, bloom and sharper shadows. Low is smoother on older devices.</div></div>
      <div class="seg" style="margin:0"><button data-act="quality" data-v="high" aria-pressed="${st.quality === 'high'}">High</button><button data-act="quality" data-v="low" aria-pressed="${st.quality === 'low'}">Low</button></div></div></div>
    ${tog('floatingText', 'Floating money', 'Show +$ amounts above customers when they pay.')}
    ${tog('autoNextDay', 'Open automatically', 'Skip the morning prep and open the doors as soon as a day starts.')}
    <div class="btns"><button class="btn red block" data-act="${back}">Done</button></div>
  </div>`;
}

export function helpModal(back: string): string {
  return `<div class="modal help" role="dialog" aria-label="How to play">
    <h2>How to play</h2>
    <p>You run a pizzeria from one small shop to a chain. Each day has a <b>morning prep</b> (time is stopped, so plan), then the store is <b>open 10 AM to 10 PM</b>, then you get the day's receipt.</p>
    <h3>The loop</h3>
    <ul>
      <li><b>Customers</b> line up, order at the register, then wait at a table or the pickup area. If the line is slow they leave, and if food takes too long they ask for a refund.</li>
      <li><b>Cashiers</b> take orders. <b>Cooks</b> build pizzas, one per make-line station. The <b>oven</b> bakes a few at a time. <b>Drivers</b> handle delivery once you buy a vehicle. <b>Cleaners</b> keep the floor spotless.</li>
      <li><b>Stock</b> runs out. Every pizza uses dough, sauce, cheese and toppings. Stock spoils, so order what you need for about a day. During the day, orders arrive tomorrow unless you pay for express.</li>
      <li><b>Rating</b> drives traffic. It moves with quality, speed, prices, cleanliness and decor.</li>
    </ul>
    <h3>Growing</h3>
    <ul>
      <li>Happy customers earn XP. Levels unlock recipes, equipment, campaigns and new locations.</li>
      <li>Upgrade the oven and make line before hiring more cooks than you have stations.</li>
      <li>Train staff to raise their skill: they miss a day and come back faster and better.</li>
      <li>Keep an eye on morale. Overworked or underpaid staff quit.</li>
      <li>Three days with negative cash and the bank closes you down.</li>
    </ul>
    <h3>Controls</h3>
    <ul>
      <li>Drag to rotate the view, scroll or pinch to zoom, right-drag or two fingers to pan. Click the oven, register, fridge or staff to jump to their panel.</li>
      <li><kbd>Space</kbd> pause · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> game speed · <kbd>Enter</kbd> open for business · <kbd>Esc</kbd> close / menu</li>
      <li><kbd>S</kbd> staff · <kbd>I</kbd> stock · <kbd>M</kbd> menu · <kbd>U</kbd> upgrades · <kbd>K</kbd> marketing · <kbd>F</kbd> finance · <kbd>E</kbd> empire · <kbd>G</kbd> goals</li>
    </ul>
    <div class="btns"><button class="btn red block" data-act="${back}">Got it</button></div>
  </div>`;
}

export function gameOverModal(s: GameState): string {
  return `<div class="modal" role="dialog" aria-label="Game over">
    <h2>The bank closed you down</h2>
    <p>${esc(s.company)} ran out of money after ${plural(s.stats.daysCompleted, 'day')} in business.</p>
    <div class="ticket"><dl class="kv"><dt>Customers served</dt><dd>${s.stats.served.toLocaleString()}</dd><dt>Lifetime sales</dt><dd>${money(s.stats.revenue)}</dd><dt>Stores</dt><dd>${s.stores.length}</dd><dt>Level reached</dt><dd>${s.level}</dd></dl></div>
    <p class="t-meta">Tip: keep a cash cushion for wages and rent, and don't buy equipment you can't staff yet.</p>
    <div class="btns"><button class="btn red" data-act="new-game">Start a new pizzeria</button><button class="btn" data-act="load-screen-game">Load a save</button></div>
  </div>`;
}

export function weatherLabel(s: GameState) {
  return WEATHER[s.weather].name;
}
