import { Game } from "@/models/game";
import { GameError } from "@/models/GameError";
import { type Deck, RoomCard } from "../cards";
import { Slots } from "./slots";
import { toSerializedTranslation } from "@/utils/translation";

/**
 * Manages the rooms slots in the Four Souls game.
 */
export class Rooms extends Slots<RoomCard> {
    /** @private Reference to the game instance */
    _game: Game; // Game type
    /** Tracks, per slot, the current top card's identity and which players have completed a turn since it last changed. */
    private _stability: { cardId: number | undefined; playersSinceChange: Set<string> }[];

    constructor(nbRooms: number, deck: Deck<RoomCard>, game: Game) {
        super(nbRooms, deck);
        this._game = game;
        this._stability = new Array(nbRooms).fill(null).map(() => ({ cardId: undefined, playersSinceChange: new Set<string>() }));
        this.fillEmptySpots();
    }

    /**
     * Draws a card from the monster deck and places it on top of a specific slot.
     * Creates a new Monster entity for the drawn card.
     *
     * @param position - The slot index to draw to
     */
    override draw(position: number): void {
        const card = this._deck.draw();
        if (card === undefined)
            throw new GameError(`Cannot draw card from deck for slot ${position}.`,
                toSerializedTranslation("error.behaviorError", {error: `Cannot draw card from deck for slot ${position}.`}));
        this._slots[position]!.push(card);
        card.onAddInPlay(() => this._game.currentPlayer);
        this._stability[position] = { cardId: card.globalId, playersSinceChange: new Set() };
    }

    /**
     * Called once at the end of each player's turn. For each room whose top card is unchanged
     * since the last call, records that this player has had a turn with it in place.
     * @returns Rooms whose top card has now remained unchanged through a whole round (every player had a turn).
     */
    registerTurnEndForStability(playerId: string | undefined, totalPlayers: number): RoomCard[] {
        const staleRooms: RoomCard[] = [];
        for (let i = 0; i < this._slots.length; i++) {
            const top = this.roomIn(i);
            if (top === undefined) continue;
            const tracking = this._stability[i]!;
            if (tracking.cardId !== top.globalId) {
                tracking.cardId = top.globalId;
                tracking.playersSinceChange = new Set();
            }
            if (playerId !== undefined) {
                tracking.playersSinceChange.add(playerId);
            }
            if (tracking.playersSinceChange.size >= totalPlayers) {
                staleRooms.push(top);
            }
        }
        return staleRooms;
    }

    get activeRooms(): RoomCard[] {
        return this._slots.map(slot => slot[slot.length - 1]!).filter(card => card !== undefined);
    }

    /**
     * Removes the top card from a slot without sending it to discard.
     * Refills or reveals the next card in the slot as needed.
     *
     * @param index - The slot index to remove the top card from
     * @returns The removed card, if any
     */
    override removeTop(index: number): RoomCard | undefined {
        if (index < 0) {
            return undefined;
        }
        const card = this._slots[index]!.pop();
        card?.cleanup();
        if (this._slots[index]!.length === 0) {
            this.fillEmptySpots();
        }
        this._stability[index] = { cardId: this.roomIn(index)?.globalId, playersSinceChange: new Set() };
        return card;
    }

    roomIn(index: number): RoomCard | undefined {
        if (index < 0 || index >= this._slots.length)
            return undefined;
        const card = this._slots[index]![this._slots[index]!.length - 1];
        return card;
    }
    override removeAtIndices(i: number, j: number): RoomCard | undefined {
        if (i < 0 || i >= this._slots.length || j < 0 || j >= this._slots[i]!.length) {
            return undefined;
        }
        const card = this._slots[i]![j]!;
        this._slots[i]!.splice(j, 1);
        card.cleanup();
        this.fillEmptySpots();
        if( this._slots[i]!.length - 1 === j) {
            this._stability[i] = { cardId: this.roomIn(i)?.globalId, playersSinceChange: new Set() };
        }
        return card;
    }

    forceRoomAtSlot(index: number, roomCard: RoomCard): void {
        this._deck.addTopPosition(roomCard);
        const previousCard = this.removeTop(index);
        if (previousCard) {
            this._deck.addDiscardTop(previousCard);
        }
    }
}

