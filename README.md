# C&C Red Alert — AI Sim

A stripped-down Phaser 3 simulation of the original Red Alert CPU player logic. Two AI factions (Allies vs Soviets) start on opposite sides of the map with MCVs and nearby ore fields, then build bases, harvest, produce armies, and attack.

## Run

```bash
cd cncsim
npm install
npm run dev
```

Open http://localhost:5173 — the browser should open automatically.

## Controls

- **Right-mouse drag** — pan camera
- **Mouse wheel** — zoom

## Architecture

| Layer | Source inspiration | Role |
|-------|-------------------|------|
| `src/game/definitions.ts` | `CODE/RULES.CPP`, type data | Costs, ratios, unit/building stats |
| `src/game/ai/houseAI.ts` | `CODE/HOUSE.CPP` | `AI_Building`, `AI_Unit`, `AI_Infantry`, `AI_Aircraft`, `Expert_AI`, `AI_Attack` |
| `src/game/sim/GameSim.ts` | `CODE/HOUSE.CPP`, `BUILDING.CPP`, `UNIT.CPP` | Tick sim: economy, production, combat, harvest |
| `src/scenes/GameScene.ts` | — | Phaser rendering with abstract sim-driven visual layers |

## Abstract Visuals

The sim renders as a data-art battlefield: ore fields pulse as luminous resource blooms, bases and units appear as faction-tinted glyphs, moving entities leave trails, construction/health are shown as orbiting arcs, and combat events produce beams and shockwave rings. The underlying economy, production, movement, and combat mechanics are unchanged.

## Simplifications vs original

- No team/trigger INI system — attack uses hunt missions directly
- No naval units
- Grid placement instead of full base node editor
- Expert-system strategy stubs (`AI_Build_Power`, etc.) folded into `AI_Building`
- 15 ticks/second sim (matches original `TICKS_PER_SECOND`)
