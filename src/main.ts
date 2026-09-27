import './ui/hud.css';
import { Game } from './render/Game';
import { readAutosaves } from './runtime/storage';
import { parseSave, type SaveData } from './sim/save';

const container = document.getElementById('game');
if (!container) throw new Error('#game is missing from index.html');

/**
 * Picks up the autosave, if there is one, before the game starts. `?bench` never
 * loads (it is a fixed scene), and `?fresh` starts a new game without touching the
 * save, for testing.
 */
async function start(host: HTMLElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  let save: SaveData | null = null;
  let notice: string | null = null;

  if (!params.has('bench') && !params.has('fresh')) {
    for (const text of await readAutosaves()) {
      try {
        const candidate = parseSave(text);
        if (!save || candidate.savedAt > save.savedAt) save = candidate;
      } catch (error) {
        notice = `자동 저장을 불러오지 못했습니다: ${(error as Error).message}. 새 게임으로 시작합니다.`;
      }
    }
    if (save) notice = null;
  }

  new Game(host, { save, notice });
}

void start(container);
