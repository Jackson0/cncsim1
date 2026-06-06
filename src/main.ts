import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { SetupScene } from './scenes/SetupScene';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from './game/definitions';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: MAP_COLS * CELL_SIZE,
  height: MAP_ROWS * CELL_SIZE,
  backgroundColor: '#0a0a12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [SetupScene, GameScene],
  render: {
    antialias: true,
  },
};

new Phaser.Game(config);
