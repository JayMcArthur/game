import { toSerializedTranslation } from "@/utils/translation";
import type { Entity } from "../entities/entity";
import { Player } from "../entities/player";
import { Game } from "../game";
import { GameError } from "@/models/GameError";
import { assertCardMatchesDeck, Card, type DeckType } from "@/models/cards";
import type { Capability, SerializedTranslation } from "@/shared/api";

export class AssertHandler {
    private _game: Game;
    private _lastTimedAction: number = 0;

    constructor(game: Game) {
        this._game = game;
    }

    get game(): Game {
        return this._game;
    }
  /**
   * 
   * @param time as returned by new Date().getTime().
   */
  set lastTimedAction(time: number) {
    this._lastTimedAction = time;
  }
  
  get lastTimedAction(): number {
    return this._lastTimedAction;
  }
  updateLastTimedAction(): void {
    this.lastTimedAction = new Date().getTime();
  }


  currentTurnIsPlayerTurn(player: Player, shouldThrow: boolean = true): Capability {
    if (this.game.currentPlayer !== player) {
      if (shouldThrow) {
        throw new GameError("Not your turn", toSerializedTranslation("error.notYourTurn"));
      }
      return toSerializedTranslation("error.notYourTurn");
    }
    return true;
  }

  currentPlayerIsNotEngagedInCombat(shouldThrow: boolean = true): Capability {
    this.game.entityHandler.endCombatIfInvalid(this.game.currentPlayer);
    if (this.game.currentPlayer!.isEngagedInCombat) {
      if (shouldThrow) {
        throw new GameError("You are currently engaged in combat", toSerializedTranslation("error.alreadyEngagedInCombat"));
      }
      return toSerializedTranslation("error.alreadyEngagedInCombat");
    }
    return true;
  }

  currentPlayerIsEngagedInCombat(shouldThrow: boolean = true): Capability {
    if (!this.game.currentPlayer!.isEngagedInCombat) {
      if (shouldThrow) {
        throw new GameError("You are not currently engaged in combat", toSerializedTranslation("error.notEngagedInCombat"));
      }
      return toSerializedTranslation("error.notEngagedInCombat");
    }
    return true;
  }

  noEntityIsEngagedInCombat(shouldThrow: boolean = true): Capability {
    if (this.game.entitiesInCombat.length > 0) {
      if (shouldThrow) {
        throw new GameError("An entity is currently engaged in combat", toSerializedTranslation("error.entityEngagedInCombat"));
      }
      return toSerializedTranslation("error.entityEngagedInCombat");
    }
    return true;
  }

  currentPlayerIsEngagedInPurchase(shouldThrow: boolean = true): Capability {
    if (!this.game.currentPlayer!.isEngagedInPurchase) {
      if (shouldThrow) {
        throw new GameError("You are not currently engaged in purchase", toSerializedTranslation("error.notEngagedInPurchase"));
      }
      return toSerializedTranslation("error.notEngagedInPurchase");
    }
    return true;
  }

  currentPlayerIsNotEngagedInPurchase(shouldThrow: boolean = true): Capability {
    if (this.game.currentPlayer!.isEngagedInPurchase) {
      if (shouldThrow) {
        throw new GameError("You are currently engaged in purchase", toSerializedTranslation("error.alreadyEngagedInPurchase"));
      }
      return toSerializedTranslation("error.alreadyEngagedInPurchase");
    }
    return true;
  }
  playerIdAvailable(id: string, shouldThrow: boolean = true): Capability {
    if (this.game.players.some((p) => p.id === id)) {
      if (shouldThrow) {
        throw new GameError(`Player ${id} already exists`, toSerializedTranslation("error.playerAlreadyExists", { player: id }));
      }
      return toSerializedTranslation("error.playerAlreadyExists", { player: id });
    }
    return true;
  }

  emptyStack(shouldThrow: boolean = true): Capability {
    if (!this.game.stack.isEmpty()) {
      if (shouldThrow) {
        throw new GameError(`Stack is not empty.`, toSerializedTranslation("error.stackIsNotEmpty"));
      }
      return toSerializedTranslation("error.stackIsNotEmpty");
    }
    return true;
  }
  
  /**
   * Check is the game is started and not finished.
   * @throws if the game is not started, or if the game is over.
   * @returns the current number of rounds.
   */
  gameOngoing(shouldThrow: boolean = true): number | SerializedTranslation {
    if (!this.game.turnHandler.isInitialized) {
      if (shouldThrow) {
        throw new GameError("Game not started", toSerializedTranslation("error.gameNotStarted"));
      }
      return toSerializedTranslation("error.gameNotStarted");
    }
    if(this.game.isGameOver)
    {
      if (shouldThrow) {
        throw new GameError("Game is over. You must leave.", toSerializedTranslation("error.gameOver"))
      }
      return toSerializedTranslation("error.gameOver");
    }
    return this.game.turnHandler.round;
  }

  gameNotStarted(shouldThrow: boolean = true): Capability {
    if (this.game.turnHandler.isInitialized) {
      if (shouldThrow) {
        throw new GameError("Game already started", toSerializedTranslation("error.gameAlreadyStarted"));
      }
      return toSerializedTranslation("error.gameAlreadyStarted");
    }
    return true;
  }

  stackNotEmpty(shouldThrow: boolean = true): Capability {
    if (this.game.stack.size === 0) {
      if (shouldThrow) {
        throw new GameError("The stack is empty", toSerializedTranslation("error.stackIsEmpty"));
      }
      return toSerializedTranslation("error.stackIsEmpty");
    }
    return true;
  }
  entityIsInPlay(entity: Entity, shouldThrow: boolean = true): Capability {
    if (!this.game.entities.includes(entity)) {
      if (shouldThrow) {
        throw new GameError("Entity is not currently in play.", toSerializedTranslation("error.entityNotInPlay"));
      }
      return toSerializedTranslation("error.entityNotInPlay");
    }
    return true;
  }

  minimumPlayerCount(shouldThrow: boolean = true): Capability {
    if (this.game.players.length < 2) {
      if (shouldThrow) {
        throw new GameError("At least 2 players are required to start the game", toSerializedTranslation("error.atLeast2PlayersRequired"));
      }
      return toSerializedTranslation("error.atLeast2PlayersRequired");
    }
    return true;
  }

  isAlive(ent: Entity, shouldThrow: boolean = true): Capability {
    if (ent.isDead) {
      if (shouldThrow) {
        throw new GameError(`${ent.id} is already dead`, toSerializedTranslation("error.entityAlreadyDead", { entityId: ent.id }));
      }
      return toSerializedTranslation("error.entityAlreadyDead", { entityId: ent.id });
    }
    return true;
  }

  positiveNumber(nb: number, shouldThrow: boolean = true): Capability {
    if (nb < 0) {
      if (shouldThrow) {
        throw new GameError("Number is negative.", toSerializedTranslation("error.numberIsNegative"));
      }
      return toSerializedTranslation("error.numberIsNegative");
    }
    return true;
  }

  noOngoingAttack(shouldThrow: boolean = true): Capability {
    if(this.game.entitiesInCombat.length > 1) {
      if (shouldThrow) {
        throw new GameError("An attack is ongoing", toSerializedTranslation("error.attackIsOngoing"));
      }
      return toSerializedTranslation("error.attackIsOngoing");
    }
    return true;
  }

  noPendingSelection(shouldThrow: boolean = true): Capability {
    if (this.game.hasPendingSelections) {
      if (shouldThrow) {
        throw new GameError("Pending selection need to be resolved", toSerializedTranslation("error.pendingSelectionNeedsResolution"));
      }
      return toSerializedTranslation("error.pendingSelectionNeedsResolution");
    }
    return true;
  }

  cardMatchesDeck<T extends DeckType>(
      deckName: T,
      card: Card
  ): void {
      assertCardMatchesDeck(deckName, card);
  }

  canResolveNow(shouldThrow: boolean = true): Capability {
    if(new Date().getTime() - this.lastTimedAction < 1000 * this.game.gameParameters.resolveCooldown.value) {
      if (shouldThrow) {
        throw new GameError(`You must wait ${this.game.gameParameters.resolveCooldown.value} seconds between actions.`,
          toSerializedTranslation("error.waitBetweenActions", { seconds: this.game.gameParameters.resolveCooldown.value })
        );
      }
      return toSerializedTranslation("error.waitBetweenActions", { seconds: this.game.gameParameters.resolveCooldown.value });
    }
    return true;
  }
}