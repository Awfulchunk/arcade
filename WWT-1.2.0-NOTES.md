# World War Tiny 1.2.0 (versionCode 9) — SYSTEMS FORK

**Date:** 2026-10-24 (America/Los_Angeles)  
**APK:** `/workspace/game/ToughWorldWarTiny-1.2.0.apk`  
**MD5:** `1fd88d9b8457f7634ae6d449cb047dbb`  
**Size:** 6,859,173 bytes  
**Package:** `app.tj.wwt`  
**Download:** https://awfulchunk.github.io/arcade/ToughWorldWarTiny-1.2.0.apk  
**Arcade page:** https://awfulchunk.github.io/arcade/download.html  

## What "systems fork" means (not a reskin)

Style pick at begin menu activates **separate game systems**:

| Mode | Units / cards | Art | Map | Fog | HUD |
|------|---------------|-----|-----|-----|-----|
| **WARTIME TINY** | Full WWII roster replace (RIFLEMAN…MG NEST); AGE_ROLE locked WWII; medic never worker | Atlas sheets + limb walk | 2× front; forest→ruins→mud center; trenches/wire/craters | Own half + center lit; maxA≈78 dusk | ALLIES/AXIS · WOOD/FOOD/AMMO |
| **CLASSIC EC** | Restored snapshot (PEW PEW PETES etc.) | Procedural big-heads | Stock EC | Stock | YOU/ENEMY · MANPOWER |
| **STICK** | Classic roster + stick draw | Stick | Stock | Stock | Classic labels |

Classic is a real restore from a one-time SNAP of EU/ECARDS/ERNAME/EBLD/AGE_ROLE — not half-mutated EU.

## Non-negotiables covered

1. Style = systems (activateMode / applyWartimeSystems / applyClassicSystems)
2. Fog playable (centerVis, maxA 78, not black soup)
3. Walls atlas sandbag/wire; hospital mmSpr scrubbed every tick
4. Prop budget ~200; fog 30× ~4ms
5. Spawn bar WWII only — zero SPEAR/SWORD/ARCHER
6. Atlas soldiers when Wartime (useAtlas gate)
7. Limb + sheet walk when betterAnim
8. Medic never chops; fire semi/spray/cone
9. Bunker enter/exit + garrison badge
10. Smoke **47/47 PASS** (`/tmp/wwt-smoke120/results.json`)

## Test evidence

- Style picker: WARTIME TINY / CLASSIC EC / STICK FIGURES
- Wartime cards: RIFLEMAN ASSAULT SNIPER MG FLAME MEDIC ENGINEER OFFICER SCOUT MORTAR AT RIFLE MG NEST
- Classic restore: PEW PEW PETES, atlas OFF, mode-classic
- Re-enter Wartime: RIFLEMAN + mud seed again
- Combat: spray/cone projs, cover dmg 18/40, bunker in/out
- Fog: maxA=78, centerVis=true, visPct≈30
- Screenshots: `_preview/v120-mid.png`, `v120-hq3.png`, `/tmp/wwt-smoke120/wartime.png`

## Honest leftovers (not blockers)

- Resource HUD still uses icon strip (names are ERNAME WOOD/FOOD/AMMO; icon art not fully redrawn)
- HQ/hospital atlas art can still read as tents (that's the sheet art)
- Mid-map chunk redraw depends on tchunks.clear after seed — verified props include trench×12 crater×22 ruin×24 wire×14
- Stick size scroller still parked (Jay: keep current for now)
- Map Maker still OFF

## Build

```
bash /workspace/game/apk-wwt/build-apk.sh 9 1.2.0
```

Keep prior APKs (1.1.1, 1.1.0, 1.0.x).
