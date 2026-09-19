import Phaser from 'phaser';
import './ui/hud.css';
import { GameScene } from './render/GameScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0e1216',
  scale: {
    // RESIZE keeps the canvas matched to the viewport, which is what makes one
    // build work on both desktop and a rotating phone (GDD 12.2).
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  // All pointer and keyboard handling goes through InputAdapter, so Phaser's own
  // input plugins are switched off to avoid two systems fighting over gestures.
  input: {
    keyboard: false,
    mouse: false,
    touch: false,
    gamepad: false,
  },
  render: {
    antialias: true,
    powerPreference: 'high-performance',
  },
  scene: [GameScene],
});
