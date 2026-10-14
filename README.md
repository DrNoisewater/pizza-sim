# Pizza SIM

A 3D pizzeria tycoon game. Start with one deck oven and one cook on Maple Street, then hire and train staff, keep the walk-in stocked, set prices, buy upgrades, run marketing, and grow into a five-store chain.

The same code runs three ways:

| Where | How |
|---|---|
| Any browser (PC or phone) | Open `dist/index.html`, or use the published link |
| Windows desktop app | Electron build: installer (`PizzaSIM-Setup-x.y.z.exe`) and a portable `.exe` |
| Mac / Linux desktop | Same Electron project (`electron-builder --mac` / `--linux`) |

---

## Build the Windows game

You need [Node.js 20 or newer](https://nodejs.org) installed on your PC.

```bash
npm install          # first time only, downloads Electron and the build tools
npm start            # play the desktop version in a window
npm run dist:win     # build the Windows installer + portable .exe
```

The finished files appear in the `release/` folder:

- `PizzaSIM-Setup-0.1.0.exe` installs the game with a Start-menu and desktop shortcut.
- `PizzaSIM-0.1.0-portable.exe` runs without installing (good for a USB stick).

Windows SmartScreen may warn the first time because the app isn't code-signed. Click **More info → Run anyway**. To remove the warning for other players, sign the build with a code-signing certificate (electron-builder picks it up from the `CSC_LINK` / `CSC_KEY_PASSWORD` environment variables).

### Or let GitHub build it for you

1. Create a GitHub repository and upload this folder.
2. Open the **Actions** tab. The *Build Windows game* workflow runs on every push (or press **Run workflow**).
3. When it finishes, download **PizzaSIM-Windows** from the run's *Artifacts* section.

## Play in a browser

```bash
npm install
npm run build
```

Then open `dist/index.html` in Chrome, Edge, Firefox or Safari. It is a single self-contained file, so you can also upload it to itch.io (HTML game), GitHub Pages or any static host. On phones it switches to a touch layout with a bottom tab bar.

## Controls

- Drag to rotate, scroll or pinch to zoom, right-drag or two fingers to pan.
- Click the oven, register, fridge, tables or staff to jump to their panel.
- `Space` pause · `1` `2` `3` speed · `Enter` open for business · `Esc` menu · `F11` full screen (desktop)
- `S` staff · `I` stock · `M` menu · `U` upgrades · `K` marketing · `F` finance · `E` empire · `G` goals

## Saves

- Desktop: `%APPDATA%\Pizza SIM\saves\` (one JSON file per slot, plus an autosave each morning).
- Browser: saved in that browser. The published link also syncs saves to your Claude account when allowed.

---

## How the project is organized

```
src/
  data/        All balance numbers: ingredients, recipes, upgrades, locations, staff roles, campaigns
  core/        The simulation (no graphics): customers, orders, staff tasks, ovens, stock, days, events, goals
  engine/      "Crust", a small WebGL2 renderer: lighting, shadows, glow/bloom, sprites, camera controls
  render/      The 3D pizzeria: building, props, people, particles, day/night, weather
  ui/          HUD, management panels, title screen, end-of-day receipt
  platform/    Saving (desktop files / browser / cloud) and sound
electron/      Windows desktop wrapper (window, save files, full screen)
scripts/       Build helpers and a headless balance test
build/         App icon (png + ico)
```

### Tuning the game

Most changes don't need any code:

- Prices, recipes and unlock levels: `src/data/catalog.ts`
- Upgrade costs and effects: `src/data/upgrades.ts`
- Locations, foot traffic, rent, staff wages, marketing, loans: `src/data/world.ts`
- Starting cash per difficulty: `src/core/state.ts`

After a change, `npm run simtest` plays 40 days with a simple bot and prints daily sales, losses, rating and cash, so you can see whether the economy still feels right.

### Making a phone app later

The game already plays in phone browsers. To ship it on the App Store or Google Play, wrap `dist/index.html` with [Capacitor](https://capacitorjs.com): `npm i @capacitor/core @capacitor/cli`, `npx cap init`, point `webDir` at `dist`, then `npx cap add android` / `ios`.
