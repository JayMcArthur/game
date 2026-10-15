import { Game } from "@/models/game";
import { GameError } from "@/models/GameError";
import { Player } from "../entities/player";
import { toSerializedTranslation } from "@/utils/translation";

export class TurnHandler {
    private _isInitialized: boolean = false;
    private _roundIndex: number = 0;
    private _turnId: number = 0;
    private _remainingTurnsInRound: Player[] = [];
    private _baseOrder: Player[] = [];
    private _skipTurnNextRoundList: Player[] = [];
    private _game: Game;

    constructor(game: Game) { this._game = game; }
    initialize(baseOrder: Player[]) : void {
        this._isInitialized = true;
        this._roundIndex = 1;
        this._baseOrder = baseOrder;
        this._remainingTurnsInRound = [...baseOrder];
    }

    get numberOfRoundSinceBeginning(): number {
        return this._turnId;
    }
    get turnId(): number {
        return this._turnId;
    }
    
    endTurn() : void {
        this._turnId++;
        const finishedPlayer = this._remainingTurnsInRound.shift();
        if (this._remainingTurnsInRound.length === 0) {
            this._roundIndex += 1;
            this._remainingTurnsInRound = [...this._baseOrder];
        }
        const nextPlayer = this._remainingTurnsInRound[0]!;
        if(this._skipTurnNextRoundList.includes(nextPlayer))
        {
            const idx = this._skipTurnNextRoundList.findIndex(p => p.id === nextPlayer.id);
            this._skipTurnNextRoundList.splice(idx, 1);
            this._game.removeStaleRooms(nextPlayer);
            this.endTurn();
        }
    }

    get skipNextTurnList(): Player[] {
        return this._skipTurnNextRoundList;
    }

    numberOfTurnSkiped(player: Player): number {
        return this._skipTurnNextRoundList.filter(p => p.id === player.id).length;
    }

    get isInitialized(): boolean {
        return this._isInitialized;
    }

    get priorityOrder(): Player[] {
        const idx = this._baseOrder.findIndex(p => p.id === this.current.id);
        return this._baseOrder.slice(idx).concat(this._baseOrder.slice(0, idx));
    }

    get current(): Player {
        return this._remainingTurnsInRound[0]!;
    }

    getPlayerTo(player: Player, direction: "left" | "right"): Player {
        const idx = this._baseOrder.findIndex(p => p.id === player.id);
        if (idx === -1) {
            throw new GameError("Player not found in base order", toSerializedTranslation("error.behaviorError", {error: "Player not found in base order"}));
        }
        let targetIdx: number;
        if (direction === "left") {
            targetIdx = (idx + 1) % this._baseOrder.length;
        } else {
            targetIdx = (idx - 1 + this._baseOrder.length) % this._baseOrder.length;
        }
        return this._baseOrder[targetIdx]!;
    }

    get round(): number {
        return this._roundIndex;
    }

    InsertPlayerAtNextTurn(player: Player) : void {
        this._remainingTurnsInRound.splice(1, 0, player);
    }

    setFirstPlayer(player: Player) : void {
        const idx = this._baseOrder.findIndex(p => p.id === player.id);
        if (idx === -1) {
            throw new GameError("Player not found in base order", toSerializedTranslation("error.behaviorError", {error: "Player not found in base order"}));
        }
        this._baseOrder = this._baseOrder.slice(idx).concat(this._baseOrder.slice(0, idx));
        this._remainingTurnsInRound = [...this._baseOrder];
    }
    skipNextTurn(player: Player, canSkip0: boolean=false) : void {
        this._skipTurnNextRoundList.push(player);
    }
    reset() : void {
        this._isInitialized = false;
        this._roundIndex = 0;
        this._turnId = 0;
        this._remainingTurnsInRound = [];
        this._baseOrder = [];
        this._skipTurnNextRoundList = [];
    }

}