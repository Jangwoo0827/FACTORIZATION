import './ui/hud.css';
import { Game } from './render/Game';

const container = document.getElementById('game');
if (!container) throw new Error('#game is missing from index.html');

new Game(container);
