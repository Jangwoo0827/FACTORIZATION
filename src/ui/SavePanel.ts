/**
 * The save panel (GDD 12.3): save now, export to a file, import from one, new game.
 *
 * Starting a new game throws away the current factory, so it takes two clicks: the
 * first turns the button into a warning, the second does it. No browser dialog —
 * those block the page, and the factory would stop while it is open.
 */

export interface SavePanelCallbacks {
  onSaveNow(): void;
  onExport(): void;
  onImport(file: File): void;
  onNewGame(): void;
}

export class SavePanel {
  private readonly status: HTMLElement;
  private readonly newGame: HTMLButtonElement;
  private armed = false;
  private disarmTimer = 0;

  constructor(
    private readonly root: HTMLElement,
    callbacks: SavePanelCallbacks,
  ) {
    root.replaceChildren();

    const head = document.createElement('div');
    head.className = 'panel__head';
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = '저장';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel__close';
    close.textContent = '×';
    close.setAttribute('aria-label', '닫기');
    close.addEventListener('click', () => this.hide());
    head.append(title, close);

    this.status = document.createElement('div');
    this.status.className = 'section-label';

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      file.value = '';
      if (chosen) callbacks.onImport(chosen);
    });

    const button = (label: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'save__button';
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    };

    this.newGame = button('새 게임', () => {
      if (!this.armed) {
        this.arm(true);
        return;
      }
      this.arm(false);
      callbacks.onNewGame();
    });

    const buttons = document.createElement('div');
    buttons.className = 'save__buttons';
    buttons.append(
      button('지금 저장 (Ctrl+S)', () => callbacks.onSaveNow()),
      button('파일로 내보내기', () => callbacks.onExport()),
      button('파일에서 불러오기', () => file.click()),
      this.newGame,
    );

    const note = document.createElement('div');
    note.className = 'save__note';
    note.textContent = '60초마다, 그리고 창을 닫거나 다른 탭으로 갈 때 자동 저장됩니다. 파일로 내보내면 다른 기기로 옮길 수 있어요.';

    root.append(head, this.status, buttons, note, file);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
    if (this.root.hidden) this.arm(false);
  }

  hide(): void {
    this.root.hidden = true;
    this.arm(false);
  }

  setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('save__status--error', error);
  }

  private arm(on: boolean): void {
    this.armed = on;
    this.newGame.textContent = on ? '정말 새로 시작? 지금 공장이 사라집니다 — 다시 클릭' : '새 게임';
    this.newGame.classList.toggle('save__button--danger', on);
    window.clearTimeout(this.disarmTimer);
    if (on) this.disarmTimer = window.setTimeout(() => this.arm(false), 5000);
  }
}
