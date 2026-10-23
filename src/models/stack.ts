import { toSerializedTranslation } from "@/utils/translation";
import { GameError } from "@/models/GameError";
import { MonsterCard } from './cards';
import type { Entity } from "./entities/entity";
import type { Player } from "./entities/player";
import type { Game } from './game';
import { DamageOnStack, DiceRoll, EffectOnStack, StackElement } from './stackElement';
import type { TriggerEvent } from "./types/eventTypes";

export function isStackElement(obj: any): obj is StackElement {
    return obj instanceof StackElement;
}
export class Stack {
    _stack: StackElement[] = [];
    _nextId: number = 0;
    _nextBatchId: number = 0;
    _game: Game;
    
    constructor(game: Game) {
        this._game = game;
    }
    get game(): Game {
        return this._game;
    }
    push(item: StackElement) : void {
        item.stackId = this._nextId++;
        this._stack.push(item);
    }

    cancel() : void {
        this.removeAt(this._stack.length - 1);
    }

    clear() : void {
        for(let i = this._stack.length - 1; i >= 0; i--) {
            this.removeAt(i);
        }
        this._nextId = 0;
    }

    removeAt(index: number) : void {
        const element = this._stack[index];
        if(element !== undefined)
            element?.onCancel(this._game);
        this._stack.splice(index, 1);
    }
    cancelElement(element: StackElement) : void {
        for (let i = this._stack.length - 1; i >= 0; i--) {
            const el = this._stack[i];
            if (el === element) {
                this.removeAt(i);
                return;
            }
        }
    }

    get currentStackIds(): number[] {
        return this.elements.map(e => e.stackId);
    }

    /** Moves one stack element before another within the same reordering group. 
    */
    insertStackElementBefore(elementToMove: StackElement, targetElement: StackElement): void {
        if (elementToMove === targetElement) {
            return;
        }

        const fromIndex = this._stack.indexOf(elementToMove);
        const toIndex = this._stack.indexOf(targetElement);

        if (fromIndex === -1 || toIndex === -1) {
            throw new GameError("Both elements must be in the stack.",
                toSerializedTranslation("error.bothElementsMustBeInStack")
            );
        }

        const sourceGroup = elementToMove.reordering?.groupId;
        const targetGroup = targetElement.reordering?.groupId;
        if (!sourceGroup || !targetGroup) {
            throw new GameError("Both elements must belong to a reordering group.",
                toSerializedTranslation("error.bothElementsMustBelongToReorderingGroup")
            );
        }
        if (sourceGroup !== targetGroup) {
            throw new GameError("Cannot reorder elements from different groups.",
                toSerializedTranslation("error.bothElementsMustBelongToReorderingGroup")
            );
        }

        // Swap-based insertion to keep operation explicit and predictable.
        if (fromIndex < toIndex) {
            // If already directly before target, no move is needed.
            for (let i = fromIndex; i < toIndex - 1; i++) {
                const tmp = this._stack[i]!;
                this._stack[i] = this._stack[i + 1]!;
                this._stack[i + 1] = tmp;
            }
            return;
        }

        for (let i = fromIndex; i > toIndex; i--) {
            const tmp = this._stack[i]!;
            this._stack[i] = this._stack[i - 1]!;
            this._stack[i - 1] = tmp;
        }
    }

    /** Moves one stack element before another within the same reordering group, or at the start of the group. 
     * @returns The event and the new order of listener IDs for the affected group, if applicable. It is used by the client to update the order of event listeners when a trigger group is reordered.
    */
      insertStackElement(player: Player, elementToMoveStackId: number, targetStackId: number | "start"): {event: TriggerEvent | null, orderedListenerIds: number[]} {
    
        const elementToMove = this.elements.find((el) => el.stackId === elementToMoveStackId);
        const targetElement = 
          targetStackId === "start"
            ? this.elements.filter((el) => el.reordering?.groupId === elementToMove?.reordering?.groupId).at(-1)
            : this.elements.find((el) => el.stackId === targetStackId);
    
        if (!elementToMove || !targetElement) {
          throw new GameError("Stack elements to reorder were not found.",
            toSerializedTranslation("error.stackElementsToReorderWereNotFound")
          );
        }
        const moveInfo = elementToMove.reordering;
        const targetInfo = targetElement.reordering;
        if (!moveInfo || !targetInfo) {
          throw new GameError("Both stack elements must be reorderable.",
            toSerializedTranslation("error.bothStackElementsMustBeReorderable")
          );
        }
        if (moveInfo.groupId !== targetInfo.groupId) {
          throw new GameError("Cannot reorder stack elements from different groups.",
            toSerializedTranslation("error.cannotReorderStackElementsFromDifferentGroups")
          );
        }
        if (!moveInfo.ownerId || moveInfo.ownerId !== player.id) {
          throw new GameError("You are not allowed to reorder this trigger group.",
            toSerializedTranslation("error.youAreNotAllowedToReorderThisTriggerGroup")
          );
        }
    
        // If the target is the start of the group, we first put the element to move second, and then swap with the first.
        this.insertStackElementBefore(elementToMove, targetElement);
        if(targetStackId === "start")
          this.insertStackElementBefore(targetElement, elementToMove);
        const event = moveInfo.event;
        if (!event) {
          return {event: null, orderedListenerIds: []};
        }
    
        const orderedListenerIds = this.elements
          .filter((el) => el.reordering?.groupId === moveInfo.groupId)
          .map((el) => el.reordering?.listenerId)
          .filter((id): id is number => typeof id === "number");

        return {event: event as TriggerEvent, orderedListenerIds};
      }

    cancelPreviousDeath(entity: Entity): boolean {
        for (let i = this._stack.length - 1; i >= 0; i--) {
            const element = this._stack[i];
            if (element?.json.type === "death") {
                this._stack.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    resolve(): StackElement | undefined {
        return this._stack.pop();
    }

    get elements(): StackElement[] {
        return this._stack;
    }

    isEmpty(): boolean {
        return this._stack.length === 0;
    }

   get size(): number {
        return this._stack.length;
    }

    displayStack(): void {
        console.log("Current Stack:");
        for (let i = this._stack.length - 1; i >= 0; i--) {
            const element = this._stack[i]!;
            console.log(`  [${i}]: ${element.constructor.name}`);
        }
    }

    peek(): StackElement | undefined {
        return this._stack[this._stack.length - 1];
    }

    clearEffectsFromEntity(entity: Entity): void {
        this._stack = this._stack.filter(element => {
            if (element instanceof EffectOnStack && element.data.it === entity.card) {
                return false; // Remove this element
            }
            return true; // Keep this element
        });
    }

    clearCombatEffects(): void {
        this._stack = this._stack.filter(element => {
            if ((element instanceof DamageOnStack && element._source instanceof DiceRoll) ||
                 (element instanceof DiceRoll && element.attackRoll)) {
                return false; // Remove this element
            }
            return true; // Keep this element
        });
    }

    reorderStack(currentPlayer: Player, count: number): void {
        const topElements = this.elements.slice(-count);
        if(topElements.some(el => el.json.type !== "effect")) // Only effects can be reordered.
          return;
        // Group by issuer
        const groups: {[issuer: string]: StackElement[]} = {};
        topElements.forEach((el) => {
          const effect = el as EffectOnStack;
          const issuerId = effect.json.issuer.type === "player" ? effect.json.issuer.nameKey.interpolates!["content"] as string: "game";
          if (!groups[issuerId]) {
            groups[issuerId] = [];
          }
          groups[issuerId].push(el); 
        });
    
        // Must not depend on wall-clock time: replays run faster than live play and must rebuild the same groups.
        const batchMarker = `batch-${this._nextBatchId++}`;
        Object.entries(groups).forEach(([issuerId, elements]) => {
          if (elements.length <= 1) {
            elements.forEach((el) => {
              el.reordering = null;
            });
            return;
          }
          // Game effects can be reordered by the current player.
          const ownerId = issuerId === "game" ? currentPlayer.id : issuerId;
          const groupId = `${batchMarker}:${issuerId}`;
          elements.forEach((el) => {
            el.reordering = {
              ...(el.reordering ?? { groupId }),
              groupId,
              ownerId,
            };
          });
        });
      }
}

export { StackElement } from "./stackElement";
