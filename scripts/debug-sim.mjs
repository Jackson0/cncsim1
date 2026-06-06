import { GameSim } from '../src/game/sim/GameSim.ts';

const sim = new GameSim();
sim.init();

function dump(tick) {
  console.log(`\n--- tick ${tick} ---`);
  for (const h of sim.getHouses()) {
    const blds = sim.getBuildings().filter((b) => b.houseId === h.id);
    console.log(
      `${h.name}: $${h.credits} pending=${h.pendingStructure} ` +
        `bld=${blds.length}(${blds.filter((b) => b.isComplete).length} done) ` +
        `units=${sim.countUnits(h.id)} inf=${sim.countInfantry(h.id)}`,
    );
    for (const b of blds) {
      console.log(`  ${b.type} @${b.cellX},${b.cellY} ${b.isComplete ? 'DONE' : b.buildProgress + '/' + b.buildTime}`);
    }
    console.log('  quantities:', JSON.stringify(h.quantities));
  }
}

const checkpoints = [100, 500, 1000, 2000, 3000];
let ci = 0;

for (let i = 1; i <= 3000; i++) {
  sim.update();
  if (i === checkpoints[ci]) {
    dump(i);
    ci++;
  }
}
