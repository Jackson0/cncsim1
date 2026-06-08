import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { SetupScene } from './scenes/SetupScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 1280,
  height: 896,
  backgroundColor: '#0a0a12',
  scale: {
    mode: Phaser.Scale.RESIZE,
  },
  scene: [SetupScene, GameScene],
  render: {
    antialias: true,
  },
};

new Phaser.Game(config);
