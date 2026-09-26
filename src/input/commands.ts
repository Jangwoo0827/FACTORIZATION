/**
 * Command pattern for every change the player makes (GDD 14.3).
 *
 * Gives undo/redo now, and later gives replays and a clean boundary for moving the
 * simulation into a Web Worker.
 *
 * Commands go through the `Builder`, so they cost and refund like any other build,
 * and that makes them able to fail: putting a demolished building back costs its
 * price again, which may no longer be in stock. A command that cannot be applied
 * changes nothing and says so, and history treats that as "not done" rather than
 * pretending.
 */

import type { Builder } from '../sim/builder';
import type { PlacedBuilding, Rotation } from '../sim/types';

export interface Command {
  readonly label: string;
  /** Applies it. Returns false, having changed nothing, if it cannot be applied. */
  redo(builder: Builder): boolean;
  /** Reverses it. Returns false, having changed nothing, if it cannot be reversed. */
  undo(builder: Builder): boolean;
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

  redo(builder: Builder): boolean {
    if (this.placed) return builder.insert(this.placed);
    this.placed = builder.place(this.defId, this.x, this.y, this.rot);
    return this.placed !== null;
  }

  undo(builder: Builder): boolean {
    // Never placed, so there is nothing to reverse.
    if (!this.placed) return true;
    return builder.remove(this.placed.id) !== null;
  }

  get building(): PlacedBuilding | null {
    return this.placed;
  }
}

export class RemoveCommand implements Command {
  readonly label = 'remove';

  constructor(private readonly building: PlacedBuilding) {}

  redo(builder: Builder): boolean {
    return builder.remove(this.building.id) !== null;
  }

  undo(builder: Builder): boolean {
    return builder.insert(this.building);
  }
}

/** Changes what a machine makes. Free; refused only for a recipe that is not unlocked yet. */
export class SetRecipeCommand implements Command {
  readonly label = 'recipe';

  constructor(
    private readonly buildingId: number,
    private readonly next: number,
    private readonly previous: number,
  ) {}

  redo(builder: Builder): boolean {
    return builder.setRecipe(this.buildingId, this.next);
  }

  undo(builder: Builder): boolean {
    return builder.setRecipe(this.buildingId, this.previous);
  }
}

/**
 * Groups one drag stroke into a single undo step.
 *
 * All or nothing: if part of it cannot be applied, what had been applied is put back
 * and the whole thing reports failure. A half-applied stroke would leave a run of
 * belts with a gap in it.
 */
export class CompositeCommand implements Command {
  readonly label = 'stroke';

  constructor(private readonly commands: readonly Command[]) {}

  redo(builder: Builder): boolean {
    for (let i = 0; i < this.commands.length; i++) {
      if (this.commands[i]!.redo(builder)) continue;
      // Put back what was applied. Reversing something that just succeeded gives back
      // exactly what it took, so this cannot itself run short.
      for (let j = i - 1; j >= 0; j--) this.commands[j]!.undo(builder);
      return false;
    }
    return true;
  }

  undo(builder: Builder): boolean {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      if (this.commands[i]!.undo(builder)) continue;
      for (let j = i + 1; j < this.commands.length; j++) this.commands[j]!.redo(builder);
      return false;
    }
    return true;
  }

  get size(): number {
    return this.commands.length;
  }
}

/** What an undo or redo did. `blocked` means there was something to do but it could not be done. */
export type StepResult = 'done' | 'nothing' | 'blocked';

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

  /** Runs the command and, if it worked, records it. */
  execute(command: Command, builder: Builder): boolean {
    if (!command.redo(builder)) return false;
    this.record(command);
    return true;
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

  /**
   * A command that cannot be reversed stays where it is on the stack, so a later
   * attempt (once stock has been freed up) can still succeed.
   */
  undo(builder: Builder): StepResult {
    const command = this.undoStack[this.undoStack.length - 1];
    if (!command) return 'nothing';
    if (!command.undo(builder)) return 'blocked';
    this.undoStack.pop();
    this.redoStack.push(command);
    return 'done';
  }

  redo(builder: Builder): StepResult {
    const command = this.redoStack[this.redoStack.length - 1];
    if (!command) return 'nothing';
    if (!command.redo(builder)) return 'blocked';
    this.redoStack.pop();
    this.undoStack.push(command);
    return 'done';
  }
}
