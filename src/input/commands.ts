/**
 * Command pattern for every world mutation (GDD 14.3).
 *
 * Gives undo/redo now, and later gives replays and a clean boundary for moving the
 * simulation into a Web Worker.
 */

import type { PlacedBuilding, Rotation } from '../sim/types';
import type { World } from '../sim/world';

export interface Command {
  readonly label: string;
  redo(world: World): void;
  undo(world: World): void;
}

export class PlaceCommand implements Command {
  readonly label = 'place';
  /** Captured on first execution so redo restores the same building id. */
  private placed: PlacedBuilding | null = null;

  constructor(
    private readonly defId: string,
    private readonly x: number,
    private readonly y: number,
    private readonly rot: Rotation,
  ) {}

  redo(world: World): void {
    if (this.placed) world.insert(this.placed);
    else this.placed = world.place(this.defId, this.x, this.y, this.rot);
  }

  undo(world: World): void {
    if (this.placed) world.removeById(this.placed.id);
  }

  get building(): PlacedBuilding | null {
    return this.placed;
  }
}

export class RemoveCommand implements Command {
  readonly label = 'remove';

  constructor(private readonly building: PlacedBuilding) {}

  redo(world: World): void {
    world.removeById(this.building.id);
  }

  undo(world: World): void {
    world.insert(this.building);
  }
}

/** Groups one drag stroke into a single undo step. */
export class CompositeCommand implements Command {
  readonly label = 'stroke';

  constructor(private readonly commands: readonly Command[]) {}

  redo(world: World): void {
    for (const c of this.commands) c.redo(world);
  }

  undo(world: World): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i]!.undo(world);
  }

  get size(): number {
    return this.commands.length;
  }
}

const MAX_HISTORY = 200;

export class History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Runs the command and records it. */
  execute(command: Command, world: World): void {
    command.redo(world);
    this.record(command);
  }

  /**
   * Records a command that was already applied. Used for drag strokes, which apply
   * as the pointer moves so the player sees them immediately, then land in history
   * as one step when the stroke ends.
   */
  record(command: Command): void {
    this.undoStack.push(command);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(world: World): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo(world);
    this.redoStack.push(command);
    return true;
  }

  redo(world: World): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.redo(world);
    this.undoStack.push(command);
    return true;
  }
}
