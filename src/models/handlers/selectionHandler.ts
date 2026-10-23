import type { PendingSelectionReason, SelectionItem, SerializedTranslation } from "@/shared/api";
import { Player } from "../entities/player";
import { TargetBuilder } from "../targetBuilder";
import { GameError } from "@/models/GameError";
import { toSerializedTranslation } from "@/utils/translation";
import type { Game } from "../game";

export interface PendingSelection {
          playerId: string;
          options: any[];
          min: number;
          max: number;
          requestId: number;
          reason: PendingSelectionReason;
          description: SerializedTranslation;
          canUseOnBoardSelection: boolean;
          resolve: (selection: any[]) => void;
        }

export class SelectionHandler {
  private _game: Game;
  private _nextId = 0;

  constructor(game: Game) {
      this._game = game;
    }
  
  get game(): Game {
    return this._game;
  }
  
  private get nextId(){
    return this._nextId++;
  }
  
  // Pending selection tracking for multiplayer (handles both single and multiple selections)
  protected _pendingMultipleSelections: Map<
    number,
    PendingSelection
  > = new Map();

  get pendingMultipleSelections(): Map<number, PendingSelection> {
    return this._pendingMultipleSelections;
  }
  
  get hasPendingSelections(): boolean {
    return this._pendingMultipleSelections.size > 0;
  }

  clearPendingSelections(): void {
    this._pendingMultipleSelections.clear();
  }

  resetPendingSelections(): void {
    this._pendingMultipleSelections = new Map();
  }
  setSelectionHandlerNextId(id: number){
    this._nextId = id;
  }

  /** Select is used to obtain a selection from a single player
   * If n=1 and only one option is available, it is automatically selected
   * The player must select between min and max options.
   * Returns a Promise that resolves to an object containing the selected and remaining options
  */
  async select<T>(
      player: Player,
      min: number,
      max: number,
      Options: T[],
      description: SerializedTranslation,
      reason: PendingSelectionReason,
      skippable: boolean = true,
      canUseOnBoardSelection: boolean = true,
  ): Promise<{ selected: T[]; remaining: T[] }> {
    if (min < 0 || min > max) {
      throw new GameError(`Invalid selection bounds: min (${min}) must be between 0 and max (${max}).`,
        toSerializedTranslation("error.invalidSelectionBounds", { min: min, max: max })); 
    }

    if ((min === max && Options.length === max && skippable) || Options.length < min) {
      return {
        selected: Options,
        remaining: [],
      };
    }
    if (Options.length === 0) return { selected: [], remaining: [] };
    
    const results = await this.game.selectMultiple([
      {
        player,
        min: min,
        max: max,
        options: Options,
        description: description,
        reason: reason,
        skippable,
        canUseOnBoardSelection,
      },
    ]);
    return results.find(r => r.playerId === player.id)!;
  }

  // Select from multiple players in parallel (useful for voting)
  // Method to submit a selection from the client
  /**
   * Submits a player's answer for a pending selection request.
   */
  submitSelection(
    player: Player,
    requestId: number,
    selectedIdentifiers: SelectionItem[]
  ): void {
    // Check if this is from a selectMultiple() call
    const pending = this._pendingMultipleSelections.get(requestId);
    if (pending && pending.playerId === player.id) {
      // Validate selection count
      if (selectedIdentifiers.length !== pending.max && pending.min === pending.max) {
        throw new GameError(`Must select exactly ${pending.max} option(s)`,
          toSerializedTranslation("error.mustSelectExactlyN", { count: pending.max }));
      }
      else if (selectedIdentifiers.length > pending.max) {
        throw new GameError(`Must select at most ${pending.max} option(s)`,
          toSerializedTranslation("error.mustSelectAtMostN", { count: pending.max }));
      }
      else if (selectedIdentifiers.length < pending.min) {
        throw new GameError(`Must select at least ${pending.min} option(s)`,
          toSerializedTranslation("error.mustSelectAtLeastN", { count: pending.min }));
      }

      // Resolve identifiers back to actual options
      const selected = selectedIdentifiers.map((id) => {
        const option = TargetBuilder["resolveIdentifier"](id, pending.options);
        if (option === undefined) {
          throw new GameError(`Invalid selection identifier: ${id.payload}`,
            toSerializedTranslation("error.invalidSelectionIdentifier"));
        }
        return option;
      });

      // Resolve the pending promise
      pending.resolve(selected);
      this.game.dispatch();
      return;
    }
    // No matching pending selection found
    throw new GameError("No pending selection found for this request ID",
      toSerializedTranslation("error.behaviorError", { error: "No pending selection found for this request ID" })
    );
  }

  /**
   * Opens multiple simultaneous selection prompts and waits for all.
   * @param skippable is not implemented yet.
   */
  async selectMultiple<T>(
    selections: 
    {
      player: Player;
      min: number;
      max: number;
      options: T[];
      description: SerializedTranslation;
      reason: PendingSelectionReason;
      skippable?: boolean;
      canUseOnBoardSelection: boolean;
    }[]
  ): Promise<{ playerId: string; selected: T[]; remaining: T[] }[]> {
    // The request that opens this selection must appear in history before its answers.
    this.game.commitDeferredHistoryEntries();
    // In multiplayer mode: create promises for all players
    const promises = selections.map(async (sel) => {
      return new Promise<{
        playerId: string;
        selected: T[];
        remaining: T[];
      }>((resolve) => {
        // Non-seeded random used here for requestId generation since it doesn't affect game logic and just needs to be unique enough to avoid collisions.
        const requestId = this.nextId;
        this._pendingMultipleSelections.set(requestId, {
          playerId: sel.player.id,
          options: sel.options,
          min: sel.min,
          max: sel.max,
          description: sel.description,
          reason: sel.reason,
          requestId,
          canUseOnBoardSelection: sel.canUseOnBoardSelection,
          resolve: (selection: any[]) => {
            const remaining = sel.options.filter(
              (opt) => !selection.includes(opt)
            );
            resolve({
              playerId: sel.player.id,
              selected: selection,
              remaining,
            });
            this._pendingMultipleSelections.delete(requestId);
          },
        });
      });
    });

    this.game.dispatch();

    // Wait for all selections to complete
    return Promise.all(promises);
  }
}