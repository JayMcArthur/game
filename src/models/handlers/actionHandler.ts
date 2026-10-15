import { Game } from "../game";
import { GameError } from "@/models/GameError";
import { Player } from "../entities/player";
import type { Capability, IdentifierType } from "@/shared/api";
import type { Entity } from "../entities/entity";
import { Monster } from "../entities/monster";
import { Animated } from "../entities/animated";
import { getAttackRollEffect } from "../effects/activeEffect";
import { AttackRollData, DamageOnStack, DiceRoll, LootStepOnStack } from "../stackElement";
import { Card, ItemCard, LootCard, MonsterCard, MonsterType, RoomCard, TreasureCard } from "../cards";
import { LootCardEffect } from '../stackElement';
import { TargetBuilder } from "../targetBuilder";
import { toSerializedTranslation } from "@/utils/translation";
import { type SerializedTranslation } from "@/shared/api";
export class ActionHandler {
  private _game: Game;

  constructor(game: Game) {
    this._game = game;
  }

  get game(): Game {
    return this._game;
  }
    /**
     * Validates whether a player can declare an attack right now.
     */
    canDeclareAttack(player: Player, shouldThrow: boolean = false): Capability {
      try {
        this.game.assert.currentTurnIsPlayerTurn(player);
        this.game.assert.noOngoingAttack();
        this.game.assert.currentPlayerIsNotEngagedInPurchase();
        this.game.assert.currentPlayerIsNotEngagedInCombat();
        this.game.assert.isAlive(player);
        this.game.assert.emptyStack();
        this.game.assert.noPendingSelection();
  
        if (player.isEngagedInCombat) {
          throw new GameError("You are already engaged in combat.", toSerializedTranslation("capability.youAlreadyInCombat"));
        }
        if (player.attackThisTurn <= 0 && !player.hasMandatoryAttackRequirement && !player.hasFreeAttackRemaining)
          throw new GameError("You have no remaining attacks this turn.", toSerializedTranslation("capability.noAttacksRemainingForPlayer"));
        // if(player.hasAttackRequirement)
        //   console.log("Player has attack requirement.");
        // if(player.hasFreeAttackRemaining)
        //   console.log("Player has free attack remaining.");
        // if(player.attackThisTurn > 0)
        //   console.log("Player has attacks remaining this turn.", player.attackThisTurn);
        const canDeclareAttackData = {
          eventIssuer: player,
          canDeclare: [true],
          reason: Array<SerializedTranslation>(0),
        };
        this.game.emit("on:can:declare:attack", canDeclareAttackData, false);
        if (!canDeclareAttackData.canDeclare[0]) {
          throw new GameError("", canDeclareAttackData.reason[0]!);
        }
      } catch (e) {
        if (shouldThrow) throw e;
        if (e instanceof GameError && e.translation !== undefined) {
          return e.translation;
        }
        return toSerializedTranslation("capability.unknownReason");
      }
      return true;
    }
  
    /**
     * Declares combat intent for the current player.
     * Note that the player first declare an attack, and then select what to attack.
     * This let other players react to the attack declaration before the target is selected.
     */
    declareAttack(player: Player): void {
      this.canDeclareAttack(player, true);
      player.clearOutdatedAttackRequirements(this.game.attackableEntities);
      player.engageInCombat();
      this.game.entityHandler.addEntityInCombat(player);
      this.game.emit("on:attack:declared", { eventIssuer: player });
      player.stats.nbAttacksDeclared++;
      this.game.dispatch();
    }
  
    /**
     * Validates whether a specific monster/top-deck can be attacked.
     */
    canDeclareAttackOnEntity(player: Player,
      entity: Entity | "topDeck", shouldThrow: boolean = false): Capability {
      try {
        this.game.entityHandler.endCombatIfInvalid(player);
        this.game.assert.emptyStack();
        if (entity !== "topDeck" && !entity.attackable) {
          throw new GameError("This entity cannot be attacked.", toSerializedTranslation("capability.entityNotAttackable"));
        }
        this.game.assert.currentTurnIsPlayerTurn(player);
        this.game.assert.noOngoingAttack();
        this.game.assert.isAlive(player);
        this.game.assert.emptyStack();
        if (!player.isEngagedInCombat) {
          throw new GameError("You have not declared an attack.", toSerializedTranslation("capability.attackNotDeclared"));
        }
        const isCombatOngoing = this.game.entitiesInCombat.length >= 2;
        if (isCombatOngoing) {
          throw new GameError("Another entity is already engaged in combat.", toSerializedTranslation("capability.anotherEntityInCombat"));
        }
        if(entity !== "topDeck" && this.game.attackableEntities.includes(entity) === false)
        {
          throw new GameError("This entity cannot be attacked.", toSerializedTranslation("capability.entityNotAttackable"));
        }
        const playerCanAttackData = player.canAttackThisEntity(entity);
        if (playerCanAttackData !== true) {
          throw new GameError("Entity cannot be attacked.", playerCanAttackData);
        }
      } catch (e) {
        if (shouldThrow) throw e;
        if (e instanceof GameError && e.translation !== undefined) {
          return e.translation;
        }else
        {
          console.error("Error in canDeclareAttackOnEntity:", e);
        }
        return toSerializedTranslation("capability.unknownReason");
      }
      return true;
    }

    /**
       * Binds the current attack to a monster target (or top-deck draw slot).
       */
      async declareAttackOnEntity(
        player: Player,
        target: Entity | "topDeck",
        drawInIndex: number = -1
      ): Promise<void> {
        this.canDeclareAttackOnEntity(player, target, true);
        const attackTopDeck = target === "topDeck";
        const attacked = [target];
        if(target instanceof Monster)
          this.game.emit("on:attack:declared:monster", { eventIssuer: player, monster:attacked });
        if(target instanceof Animated)
          this.game.emit("on:attack:declared:animated", { eventIssuer: player, animated:attacked });
        await this.game.executeWhenStackEmpty(() => {
          target = attacked[0]!; // in case the monster is modified by the event.
          if (drawInIndex !== -1 && target !== "topDeck")
            throw new GameError(
              "drawInIndex can only be specified when drawing from topDeck",
              toSerializedTranslation("error.drawInIndexOnlyForTopDeck")
            );
          if (drawInIndex === -1 && target === "topDeck")
            throw new GameError(
              "drawInIndex must be specified when drawing from topDeck",
              toSerializedTranslation("error.drawInIndexRequiredForTopDeck")
            );
          if(this.game.actions.canDeclareAttackOnEntity(player, target, false) !== true)
            return; // if the target is no longer valid, do nothing.
          player.registerAttackDeclaration(target);
          if (target === "topDeck") {
            this.game.drawMonster(player, drawInIndex);
            if (
              this.game.encounters.monsterIn(drawInIndex) === undefined ||
              !this.game.encounters.monsterIn(drawInIndex)!.attackable
            ) {
              player.clearAttackRequirement(target);
              player.clearAttackRequirement("any");
              this.game.entityHandler.endCombat();
              return; // drawn event.
            }
            target = this.game.encounters.monsterIn(drawInIndex)!;
          }
          player.clearAttackRequirement(target);
          player.clearAttackRequirement("any");
          if(target.isDead)
          {
            return; // if the target is already dead, do nothing.
          }
          target.engageInCombat();
          this.game.entityHandler.addEntityInCombat(target);
          if (target.isEngagedInCombat === false)
            throw new GameError("Monster should be engaged in combat now.",
              toSerializedTranslation("error.monsterShouldBeEngagedInCombat")
            );
          
          if(attackTopDeck)
          {
            this.game.emit("on:attack:declared:topdeck", { eventIssuer: player, drawInIndex });
            player.stats.nbAttackTopDeck++;
          }
          this.game.dispatch();
        });
      }
  

  /**
   * Validates whether the player can perform a combat attack roll.
   */
  canRollDice(player: Player, shouldThrow: boolean = false): Capability {
    try {
      this.game.assert.currentTurnIsPlayerTurn(player);
      this.game.assert.isAlive(player);
      this.game.assert.noPendingSelection();
      this.game.assert.currentPlayerIsEngagedInCombat();
      this.game.assert.emptyStack();
      
      const entity = [...this.game.entitiesInCombat].find(
        (e) => e !== player
      );
      if (!entity) {
        throw new GameError("No entity is currently engaged in combat.", toSerializedTranslation("capability.noEntityEngagedInCombat"));
      }
    } catch (e) {
      if (shouldThrow) throw e;
      if (e instanceof GameError && e.translation !== undefined) {
        return e.translation;
      }
      return toSerializedTranslation("capability.unknownReason");
    }
    return true;
  }

  async useCard(
          type: "hand" | "inPlay" | "character" | "room",
          player: Player,
          itemIndex: number,
          targets: any[],
          effectId: number | "tap" = "tap"
      )
      {
        switch(type) {
            case "hand":
              this.playCard(player, itemIndex, targets);
              return;
            case "character":
              await this.activateItemAtIndex(player, "character", targets, effectId);
              return;
            case "inPlay":
              await this.activateItemAtIndex(player, itemIndex, targets, effectId);
              return;
            case "room":
              if(this._game.rooms === undefined || this._game.rooms.activeRooms[itemIndex] === undefined)
                return
              await this.activateRoom(player, this._game.rooms.activeRooms[itemIndex], targets, effectId )

        }
      }

  /**
   * Creates and configures an attack dice roll for the current combat.
   */
  attackRoll(player: Player, target: Entity | undefined = undefined): void {
    if(target === undefined)
      this.canRollDice(player, true);
    
    if(target === undefined)
      target = [...this.game.entitiesInCombat].find(
        (m) => m !== player
      );
    if (!target) {
      throw new GameError("No monster is currently engaged in combat.",
        toSerializedTranslation("error.noMonsterEngagedInCombat")
      );
    }
    if(!target.isEngagedInCombat)
    {
      throw new GameError(`${player.id}The selected target (${target.id}) is not engaged in combat.`,
        toSerializedTranslation("error.chosenTargetNotEngagedInCombat", { targetId: target.id })
      );
    }
    // damageDealt and damageReceived will be increased by the attack
    // of the dealer and receiver respectively in getAttackRollEffect.
    const attackRollData = new AttackRollData(0, 1, 0, 1, this.game.entityHandler.getDC(target), target);
    const dice = this.game.rollDice(player, attackRollData);
  }

  /**
   * Resolves the top stack element, then triggers follow-up callbacks.
   */
  async resolveStack(): Promise<void> {
    // Keep resolveStack() idempotent: resolving an empty stack is a no-op.
    if (this.game.stack.isEmpty()) return;

    // Some unit tests resolve stack elements before the game is formally started.
    // In that case, enforce only the safety invariants that still make sense.
    if (this.game.isStarted) {
      this.canResolve(this.game.currentPlayer, true);
    } else {
      this.game.assert.stackNotEmpty();
      this.game.assert.noPendingSelection();
    }
    const elem = this.game.stack.peek();
    if (elem === undefined) return;
    if(elem instanceof DiceRoll)
      return this.game.resolveDiceRoll();
    if(elem instanceof DamageOnStack)
      return this.game.entityHandler.resolveDamageOnStack();
    if(elem instanceof LootStepOnStack === false) // loot step handle it's stack element on its own.
     this.game.stack.resolve();

    await elem.onResolve();
    // Add to history
    if(elem instanceof LootStepOnStack === false) // loot step handle it's history element on its own.
      this.game.addToHistory(elem.json);
    if (elem instanceof LootCardEffect && elem.card instanceof LootCard)
      this.game.cardHandler.handleLootCardEffectResolution(elem);
    this.game.dispatch();
    await this.game.resolveCallbacks();
  }

  async activateRoom(player: Player,
    room: RoomCard,
    targets: any[] = [],
    effectId: number | "tap" = "tap"
  ): Promise<boolean> {
    if(!this.game.rooms || !(room instanceof RoomCard) || (player !== this.game.currentPlayer))
      return false;
    if (!room.targetStillValid(player, effectId, targets))
      throw new GameError("Targets are not valid for this effect.", toSerializedTranslation("error.targetsNotValidForEffect"));

    const effectOnStack = await room.tryActivateEffect(targets, effectId);
    this.game.addToStack(effectOnStack);
    player.stats.nbRoomActivated++;
    return true;
  }

    /**
     * End the turn of the current player if issuer is the current player and all conditions are satisfied.
     */
    async nextTurn(player: Player): Promise<void> {
      this.canEndTurn(player, true);
      await this.game.endTurn();
    }
  
    /**
     * Validates if the active player can legally end the turn.
     */
    canEndTurn(player: Player, shouldThrow: boolean = false): Capability {
      try {
        this.game.assert.gameOngoing();
        this.game.assert.currentTurnIsPlayerTurn(player);
        this.game.assert.currentPlayerIsNotEngagedInPurchase();
        this.game.assert.currentPlayerIsNotEngagedInCombat();
        this.game.assert.emptyStack();
        this.game.assert.noOngoingAttack();
        this.game.assert.noEntityIsEngagedInCombat();
        this.game.assert.noPendingSelection();
        this.game.entityHandler.forcedAttackSatisfied(player);
      }
      catch (e) {
        if (shouldThrow) throw e;
        if (e instanceof GameError && e.translation !== undefined) {
          return e.translation;
        }
        return toSerializedTranslation("capability.unknownReason");
      }
      return true;
    }
  
    /**
     * Validates whether issuer can play a loot card.
     */
    canPlayCard(player: Player, shouldThrow: boolean = false): Capability {
      try {
        this.game.assert.gameOngoing();
        this.game.assert.noPendingSelection();
        if (!player.canIUseLootThisTurn) {
          throw new GameError(`You cannot play loot cards during ${this.game.currentPlayer.id}'s turn.`, toSerializedTranslation("error.cannotPlayLootCardsDuringOtherPlayerTurn", { player: this.game.currentPlayer.id }));
        }
        if (player.remainingLootPlay <= 0) {
          throw new GameError("You have no remaining loot play this turn.", toSerializedTranslation("error.noRemainingLootPlayThisTurn")  );
        }
      } catch (e) {
        if (shouldThrow) throw e;
        if (e instanceof GameError && e.translation !== undefined) {
          return e.translation;
        }
        return toSerializedTranslation("capability.unknownReason");
      }
      return true;
    }
  
    /**
     * Validates whether stack resolution is currently allowed.
     */
    canResolve(player: Player, shouldThrow: boolean = false): Capability {
      try {
        if(this.game.currentPlayer.user !== player.user)
          throw new GameError("", toSerializedTranslation("error.onlyCurrentPlayerCanResolveStack"));
        this.game.assert.gameOngoing();
        this.game.assert.stackNotEmpty();
        this.game.assert.noPendingSelection();
      } catch (e) {
        if (shouldThrow) throw e;
        if (e instanceof GameError && e.translation !== undefined) {
          return e.translation;
        }
        return toSerializedTranslation("capability.unknownReason");
      }
      return true;
    }
    /**
     * Plays one loot card from hand and pushes its effect on stack.
     */
    playCard(player: Player, index: number, targets: any[] = []): string {
      this.canPlayCard(player, true);
      this.game.assert.positiveNumber(index);
      if (index < 0 || index > player.hand.cards.length) {
        return "Invalid card position.";
      }
      const card = player.hand.cards[index]!;
      this.game.cardHandler.removeCardFromHand(player, card);
      const playedCard: LootCard = card;
  
      if (targets.length === 0 && card.trinket === false) {
        if (playedCard.getTargetSelectors().length === 1)
          if (playedCard.getTargetSelectors()[0]?.selector(player, playedCard).length === 1)
            targets = playedCard.getTargetSelectors()[0]!.selector(player, playedCard)[0];
      }
      const lootCardEffect = new LootCardEffect(player, playedCard, targets);
      this.game.addAnimation({
        id: this.game.nextAnimationId,
        type: "playLoot",
        card: playedCard.jsonAPI,
        player: player.id,
      });
      const idx = this.game.addToStack(lootCardEffect);
      player.remainingLootPlay -= 1;
      this.game.emit("on:loot:played", {
        eventIssuer: player,
        card: playedCard,
        targets: targets,
        stackId: idx
      });
      player.stats.nbLootPlayed++;
      return `You have played the card: ${playedCard.name} to your in-play area.\n`;
    }
  

  /**
   * Activates a player item by in-play index.
   */
  async activateItemAtIndex(
    player: Player,
    index: number | "character",
    choices: any[] = [],
    effectId: number | "tap" = "tap"
  ): Promise<boolean> {
    this.game.assert.noPendingSelection();
    const item = index === "character" ? player.character : player.inPlay[index];
    if (!item || !(item instanceof ItemCard)) {
      throw new GameError("Player does not own the specified item.", toSerializedTranslation("error.playerDoesNotOwnItem"));
    }
    if (!item.activeEffectList.map((e) => e.index).includes(effectId))
      throw new GameError("Item does not have the specified effect ID.", toSerializedTranslation("error.itemDoesNotHaveEffectId"));
    if(effectId === "tap")
      player.stats.nbItemActivated++;
    return this.game.activateItem(player, item, choices, effectId);
  }


  /** Validates whether a card can currently be activated by its owner. */
  canActivate(card: Card, owner: Player): Capability {
    // Ensure the owner actually has the item in-play (prevents bots/actions from trying to activate
    // items they no longer own because the game state changed between action selection and execution).
    if (card instanceof ItemCard && !owner.inPlay.includes(card) && owner.character !== card && card instanceof RoomCard === false) {
      return toSerializedTranslation("capability.YouDoNotOwnThisItem");
    }
    if (card instanceof RoomCard === true && this.game.currentPlayer !== owner)
      return toSerializedTranslation("error.notYourTurn");


    if(card.type === "loot" && !card.canBeActivated)
      return toSerializedTranslation("capability.cannotActivate");
    if (card instanceof ItemCard && card.activeEffectList.length === 0) {
      return toSerializedTranslation("capability.noActiveEffect");
    }
    if(card instanceof MonsterCard && card.encounterType === MonsterType.EVENT) {
      return toSerializedTranslation("capability.cannotActivateMonsterCard");
    }
    if (!owner.canIActivateThisTurn) {
      return toSerializedTranslation("capability.cannotActivateThisTurn");
    }
    // Either card is not charged and has a tap effect, or card does not have a tap effect,
    if (((card.charged === false && card.hasTapEffect()) || !card.hasTapEffect()) && (
      // And all paid effect are not valid
      !(card instanceof ItemCard) || !card.activeEffectList.some(e => 
          (e.index !== "tap" && 
            TargetBuilder.verifyPaiementCanBeMade(this.game, owner, card, e.description) === true) && 
              TargetBuilder.validTargetExists(this.game, owner, card, e.index, e.visualEffectBox.startIndex) === true)
    )) {
      if(card.activeEffectList.length === 1 && card.activeEffectList[0]!.index === "tap" && !card.charged)
        return toSerializedTranslation("capability.notCharged");
      return toSerializedTranslation("capability.noEffectsUsable");
    }
    if(card instanceof ItemCard)
      {
        if(card.activeEffectList.length === 1){
          return TargetBuilder.validTargetExists(this.game, owner, card, card.activeEffectList[0]!.index);
        }
        else if(!card.activeEffectList.some(e => TargetBuilder.validTargetExists(this.game, owner, card, e.index, e.visualEffectBox.startIndex) === true && (card.charged || e.index !== "tap")))
          return toSerializedTranslation("capability.noValidTargets");
      }
    return true;
  }

  canSwitchTo(player: Player, target: Player): Capability {
    if (player.user !== target.user)
      return toSerializedTranslation("capability.cannotSwitchToOtherPlayer");
    if (player.id === target.id)
      return toSerializedTranslation("capability.cannotSwitchToSelf");
    return true;
  }


  /** Validates whether current player can declare purchase mode. */
  canDeclarePurchase(player: Player, shouldThrow: boolean = false): Capability {
    try {
      this.game.assert.gameOngoing();
      this.game.assert.currentTurnIsPlayerTurn(player);
      this.game.assert.isAlive(player);
      this.game.assert.currentPlayerIsNotEngagedInCombat();
      this.game.assert.currentPlayerIsNotEngagedInPurchase();
      this.game.assert.emptyStack();
      this.game.assert.noPendingSelection();
      if (player.remainingPurchaseThisTurn <= 0) {
        throw new GameError(
          "You have no remaining purchase this turn.", toSerializedTranslation("capability.noRemainingPurchase")
        );
      } 
    } catch (error) {
      if (shouldThrow) throw error;
      if (error instanceof GameError && error.translation !== undefined) {
        return error.translation;
      }
      return toSerializedTranslation("capability.unknownReason");
    }
    return true;
  }

  /** Enters purchase mode and consumes one purchase allowance. */
  declarePurchase(player: Player): void {
    this.canDeclarePurchase(player, true);

    player.remainingPurchaseThisTurn -= 1;
    player.engageInPurchase();
    this.game.dispatch();
  }

  /** Cancels purchase mode when purchasing is no longer valid.
   * Checks if the first item in the shop can not be purchased.
   * It assumes that: all shop items have the same price, and that the top deck item is not cheaper.
   */
  cancelPurchase(player: Player, force: boolean = false): void {
    if(force || this.canPurchase(player) !== true)
      {
        player.purchaseEnded();
        player.stats.nbPurchaseCancelled++;
        this.game.dispatch();
      }
    else 
      throw new GameError("You have to purchase an item.", toSerializedTranslation("error.mustPurchaseAnItem"));
  }

  // We should implement declaring a purchase
  /** Validates whether the active player can buy from the shop now.
   *  By default checks if the first item in the shop can not be purchased.
   * It assumes that: all shop items have the same price, and that the top deck item is not cheaper.
   */
  canPurchase(player: Player, index: number | "top" = 0, shouldThrow: boolean = false): Capability {
    try {
      this.game.assert.gameOngoing();
      this.game.assert.currentTurnIsPlayerTurn(player);
      this.game.assert.isAlive(player);
      this.game.assert.currentPlayerIsEngagedInPurchase();
      this.game.assert.noPendingSelection();
      this.game.assert.emptyStack();
      const price = this.game.shop.priceAt(index, player);
      if (player.coins < price!) {
        throw new GameError(
          `Purchase failed. You need ${price! - player.coins} more coins.\n`,
          toSerializedTranslation("error.purchaseFailedNeedMoreCoins", { value: price! - player.coins })
        );
      }
    } catch (error) {
      if (shouldThrow) throw error;
      if (error instanceof GameError && error.translation !== undefined) {
        return error.translation;
      }
      return toSerializedTranslation("capability.unknownReason");
    }
    return true;
  }

  /** Purchases a shop slot (or top deck) item if affordable. */
  purchase(player: Player, index: number | "top"): string {
    this.canPurchase(player, index, true);
    if (index !== "top" && (index < 0 || index >= this.game.shop.itemsInShop.length))
      throw new GameError("Invalid shop index.",
        toSerializedTranslation("error.invalidShopIndex"));
    const price = Math.max(0, this.game.shop.priceAt(index, player));
      if (player.coins < price!) {
        throw new GameError(
          `Purchase failed. You need ${price! - player.coins} more coins.\n`,
          toSerializedTranslation("error.purchaseFailedNeedMoreCoins", { value: price! - player.coins })
        );
      }
    if (this.game.shop.purchase(player, index, price, this.game)) {
      const purchasedCard = player.inPlay[player.inPlay.length - 1]!;
      this.game.addAnimation({
        id: this.game.nextAnimationId,
        type: index === "top" ? "buyTopDeckTreasure" : "buyShopTreasure",
        player: player.id,
        card: purchasedCard.jsonAPI,
      })
      this.game.emit("on:purchase:success", {
        eventIssuer: player,
        price: price,
        index: index,
      });
      player.purchaseEnded();
      this.game.dispatch();
      player.stats.nbPurchases++;
      if(index === "top")
        player.stats.nbPurchaseTopDeck++;
      return `Purchase successful. You have now ${player.coins} coins.\n`;
    } else {
      throw new GameError(
        `Purchase failed. You need ${price - player.coins} more coins.\n`,
        toSerializedTranslation("error.purchaseFailedNeedMoreCoins", { value: price - player.coins })
      );
    }
  }

   /**
   * This function allows a player to discard a card. 
   * It is not part of the game, but can be used to debug situations.
   * A player can discard: any card owned by the game (shop and encounters) and any card that he owns (hand and inPlay).
   */
  debugRemoveCards(player: Player, cards: Card[]): void {
    if(!this.game.gameParameters.allowCheatOptions.value)
      throw new GameError("Cheat options are not allowed in this game.", toSerializedTranslation("error.cheatOptionsNotAllowed"));
    // verify that the cards are actually owned by the player or in the shop/encounters.
    for (const card of cards) {
      if (!this.game.playerCardsAndGameOwnedCards(player).some(c => c === card)) {
        throw new GameError(`Card ${card.name} is not owned by player ${player.id}`,
          toSerializedTranslation("error.cardNotOwnedByPlayer", { card: card.nameKey, player: player.id })
        );
      }
    }
    for (const card of cards) {
      switch(card.type)
      {
        case "loot":
          const loot = card as LootCard;
          if(!loot)
            throw new GameError(`Card ${card.name} is not a LootCard.`,
              toSerializedTranslation("error.cardNotLootCard", { card: card.nameKey })
            );
          this.game.cardHandler.removeCardFromHand(player, loot);
          if(loot.trinket)
            this.game.cardHandler.removeInPlay(player, loot);
          this.game.cardHandler.discard(loot);
          break;
        case "treasure":
          const treasure = card as TreasureCard;
          if(!treasure)
            throw new GameError(`Card ${card.name} is not a TreasureCard.`,
              toSerializedTranslation("error.cardNotTreasureCard", { card: card.nameKey })
            );
          if(this.game.shop.itemsInShop.includes(treasure))
            this.game.shop.removeCard(treasure);
          else
            this.game.cardHandler.removeInPlay(player, treasure);
          this.game.cardHandler.discard(treasure);
          break;
        case "monster":
          const monster = card as MonsterCard;
          if(!monster)            
            throw new GameError(`Card ${card.name} is not a MonsterCard.`,
              toSerializedTranslation("error.cardNotMonsterCard", { card: card.nameKey })
            );
          if(monster.isCurse)
            this.game.cardHandler.removeCurse(player, monster);
          else
          {
            const toDiscard = this.game.encounters.obtainCard(monster.slug, monster.globalId);
            if(toDiscard)
              this.game.cardHandler.discard(toDiscard);
          }
          break;
        case "room":
          const room = card as RoomCard;
          if(this.game.rooms === undefined)
            throw new GameError(`Room deck not found.`,
              toSerializedTranslation("error.deckNotFound")
            );
          if(!room || room instanceof RoomCard === false)
            throw new GameError(`Card ${card.name} is not a RoomCard.`,
              toSerializedTranslation("error.invalidCardPosition")
            );
          if(this.game.rooms.activeRooms.includes(room) === false)
            throw new GameError(`Card ${card.name} is not an active RoomCard.`,
              toSerializedTranslation("error.invalidCardPosition")
            );
          const toDiscard = this.game.rooms.obtainCard(room.slug, room.globalId);
          if(toDiscard)
            this.game.cardHandler.discard(toDiscard);
          break;
        default:
          throw new GameError(`Card ${card.name} is of type ${card.type} which cannot be removed with debugRemoveCards.`,
            toSerializedTranslation("error.cardTypeCannotBeRemovedWithDebug", { card: card.nameKey, cardType: card.type })
          );
      }
    }
    this.game.dispatch();
    if(cards.length === 1)
      this.game.toast({
        type: "warning",
        title:  toSerializedTranslation("gameStep.cheats.discardCard.popup.successToast.title", { player: player.id, count: cards.length }),
        message: toSerializedTranslation("gameStep.cheats.discardCard.popup.successToast.message", { cardNames: cards.map((c) => c.nameKey) }),
        players: this.game.players.map((p) => p.id),
      });
  }

  debugGainTreasures(player: Player, treasures: IdentifierType[], fromTop: boolean = false): void {
    if(!this.game.gameParameters.allowCheatOptions.value)
      throw new GameError("Cheat options are not allowed in this game.", toSerializedTranslation("error.cheatOptionsNotAllowed"));
    for (const card of treasures) {
      const targetCard = this.game.obtainCard(card.slug, card.globalId, "treasure")!;
      if (targetCard instanceof ItemCard === false)
        throw new GameError(`Card ${targetCard.name} is not an ItemCard`, toSerializedTranslation("error.targetCardNotItemCard", { card: targetCard.nameKey }));
      this.game.cardHandler.addInPlay(player, targetCard);
    }
    this.game.toast({
      type: "warning",
      title: fromTop 
        ? toSerializedTranslation("gameStep.cheats.getTreasureTopDeck.successToast.title", { player: player.id, count: treasures.length })
        : toSerializedTranslation("gameStep.cheats.selectTreasureToLoot.popup.successToast.title", { player: player.id, count: treasures.length }),
      message: fromTop 
        ? toSerializedTranslation("gameStep.cheats.getTreasureTopDeck.successToast.message", { cardName: treasures.map((t) => t.nameKey) })
        : toSerializedTranslation("gameStep.cheats.selectTreasureToLoot.popup.successToast.message", { cardNames: treasures.map((t) => t.nameKey) }),
      players: this.game.players.map((p) => p.id),
    });
  }

  debugGainCoins(player: Player, coins: number): void {
    if(!this.game.gameParameters.allowCheatOptions.value)
      throw new GameError("Cheat options are not allowed in this game.", toSerializedTranslation("error.cheatOptionsNotAllowed"));
    this.game.gainCoins(player, coins, "gift");
    this.game.toast({
      type: "warning",
      title: toSerializedTranslation("gameStep.cheats.gainGoin.popup.successToast.title", { player: player.id, count: coins }),
      message: toSerializedTranslation("gameStep.cheats.gainGoin.popup.successToast.message", { count: coins }),
      players: this.game.players.map((p) => p.id),
    });
  }

  debugLoot(player: Player, lootCards: IdentifierType[], broadcastName: boolean = true): void {
    if(!this.game.gameParameters.allowCheatOptions.value)
      throw new GameError("Cheat options are not allowed in this game.", toSerializedTranslation("error.cheatOptionsNotAllowed"));
    for (const card of lootCards) {
      const targetCard = this.game.obtainCard(card.slug, card.globalId, "loot")! as LootCard;
      this.game.cardHandler.addCardToHand(player, targetCard);
    }
    this.game.toast({
      type: "warning",
      title: broadcastName 
        ? toSerializedTranslation("gameStep.cheats.selectCardToLoot.popup.successToast.title", { player: player.id, count: lootCards.length })
        : toSerializedTranslation("gameStep.cheats.getLootTopDeck.successToast.title", { player: player.id }),
      message: broadcastName 
        ? toSerializedTranslation("gameStep.cheats.selectCardToLoot.popup.successToast.message", { cardNames: lootCards.map((c) => c.nameKey)  })
        : toSerializedTranslation("gameStep.cheats.getLootTopDeck.successToast.message"),
      players: this.game.players.map((p) => p.id),
    });
  }
  debugPutMonsterCardInSlot(player: Player, card: MonsterCard, index: number | "top"): void {
    if (!card) {
      throw new GameError("Card not found in the game.", toSerializedTranslation("error.cardNotFoundInGame"));
    }
    this.game.cardHandler.addTopPosition("monster", card);
    let message = toSerializedTranslation("gameStep.cheats.putMonsterCardInSlot.popup.successToast.messageTopDeck", { card: card.nameKey})
    if(index !== "top")
    {
      this.game.encounters.draw(index);
      message = toSerializedTranslation("gameStep.cheats.putMonsterCardInSlot.popup.successToast.message", { card: card.nameKey, value: index + 1 })
    }
    this.game.dispatch();
    this.game.toast({
      type: "warning",
      title: toSerializedTranslation("gameStep.cheats.putMonsterCardInSlot.popup.successToast.title", { player: player.id }),
      message: message,
      players: this.game.players.map((p) => p.id),
    });
  }

  debugChangeDiceResult(player: Player, dice: DiceRoll, value: number): void {
    const prev = dice.value;
    dice.value = value;

    this.game.dispatch();
    this.game.toast({
      type: "warning",
      title: toSerializedTranslation("gameStep.cheats.changeDice.successToast.title", { player: player.id }),
      message: toSerializedTranslation("gameStep.cheats.changeDice.successToast.message", { prev, new: value }),
      players: this.game.players.map((p) => p.id),
    });
  }
}