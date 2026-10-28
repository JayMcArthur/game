
import {
  Card,
  ItemCard,
  LootCard
} from "@/models/cards";
import {
  targetGetCoinRollEffect,
  targetGetLootRollEffect,
  targetGetTreasureRollEffect
} from "@/models/effects/activeEffect";
import { Animated } from "@/models/entities/animated";
import { Entity } from "@/models/entities/entity";
import { Monster } from "@/models/entities/monster";
import { Player } from "@/models/entities/player";
import { Game } from "@/models/game";
import { GameError } from "@/models/GameError";
import { DamageOnStack, DeathOnStack, DiceRoll, EndOfTurnOnStack } from "@/models/stackElement";
import { EffectData } from "@/models/types/cardTypes";
import { toSerializedTranslation } from "@/utils/translation";
import { AnimatedList } from "../entities/animated";
import { DeathPenaltyValues } from "../handlers/deathHandler";
import type { Capability, VisualEffectBox } from "@/shared/api";

/**
 *  Type representing sources of damage - either a card ability or a dice roll
 * */ 
export type CardAndBox = {card: Card, visualEffectBox: VisualEffectBox | undefined}
export type DamageSource = CardAndBox | DiceRoll;

/**
 * EntityHandler is responsible for the entities of a game.
 * It handles:
 *  - entities death
 *  - entities adders (e.g. addAtk, addHealth)
 *  - combats and health
 *  - players and animated registration (monsters registration is handled in encounters)
 */
export class EntityHandler {
  private _game: Game;
  private _players: Player[] = [];
  private _animatedList: AnimatedList = new AnimatedList();
  private _monsterDiedThisTurn: boolean = false;
  private _entitiesInCombat: Entity[] = [];

  constructor(game: Game) {
    this._game = game;
  }

////////////////////////////////////// Getters //////////////////////////////////////
  get game(): Game {
    return this._game;
  }
  /**
   * Returns the list of entities currently engaged in combat. 
   * CAREFULL IT ALSO INCLUDES ANIMATED ENTITIES.
   */
  get entitiesInCombat(): readonly Entity[] {
    return this._entitiesInCombat;
  }
  /**
   * Historically, entities only contains monsters and players.
   */
  get entities(): Entity[] {
    return this.playersAndMonsters.concat(this.animatedList.all);
  }

  get animatedList(): AnimatedList {
    return this._animatedList;
  }

  get attackableEntities(): Entity[] {
    return this.entities.filter(e => e.attackable === true);
  }
    
  get playersWithMostSouls(): Player[] {
    const maxSouls = Math.max(...this.players.map((player) => player.totalSouls));
    return this.players.filter((player) => player.totalSouls === maxSouls);
  }
  /**
   * Computes current monster attack after replacement/modifier effects.
   */
  getAttack(entity: Entity): number {
    const baseStat = [entity.attackPoints];
    if(entity instanceof Monster)
      this.game.emit(
        "on:get:monster:attackPoints",
        {
          eventIssuer: entity,
          stat: baseStat,
        },
        false
      );
    return baseStat[0]!;
  }

  /**
   * Computes current monster evasion/DC clamped to [1, 6].
   */
  getDC(entity: Entity): number {
    const baseStat = [entity.evasion];
    if(entity instanceof Monster)
      this.game.emit(
        "on:get:monster:evasion",
        {
          eventIssuer: entity,
          stat: baseStat,
        },
        false
      );
    return Math.max(1, Math.min(6, baseStat[0]!));
  }

  get players(): Player[] {
    return this._players;
  }
  get monsters(): Monster[] {
    return this.game.encounters.monsters;
  }
  get monsterDiedThisTurn(): boolean {
    return this._monsterDiedThisTurn;
  }
  set monsterDiedThisTurn(value: boolean) {
    this._monsterDiedThisTurn = value;
  }
  get playersAndMonsters(): Entity[] {
    return [
      ...this.players,
      ...this.monsters.filter((m): m is Monster => m !== undefined),
    ];
  }

  ////////////////////////////////////// Death Handler //////////////////////////////////////
  /** Shortcut to queue death for an entity from a given source. */
  kill(killer: Entity, entity: Entity, source: DamageSource): void {
    this.game.assert.gameOngoing();
    if(this.game.assert.isAlive(entity, false) !== true
      || this.game.assert.entityIsInPlay(entity, false) !== true
    )
      return; // if the receiver is not alive or not in play anymore, do nothing.
    this.death(entity, killer, source);
  }
  /**
   * Applies all death penalties configured for a player.
   * It can be override by a specific passive effect.
   */
  async deathPenalty(player: Player, values: DeathPenaltyValues): Promise<void> {
    // remove coins.
    // obtain set of items that can be lost.
    
    const lostCoins = this.game.loseCoins(player, values.nbCoinsToLose, true, "death");
    let lootCardsToLose: LootCard[] = [];
    let itemsToLose: ItemCard[] = await this.game.deathPenaltyItems(player, values.nbItemsToLose);
    // If at least one item can be lost, ask the player to select one.
    
    // lose loot cards
    if (values.nbLootCardsToLose > 0 && player.hand.cards.length > 0) {
      lootCardsToLose = (
        await this.game.select(player, values.nbLootCardsToLose, values.nbLootCardsToLose, player.hand.cards, values.nbLootCardsToLose > 1
            ? toSerializedTranslation("pending.chooseLootCardsToLose")
            : toSerializedTranslation("pending.chooseLootCardToLose"), "death", true)
      ).selected;
    }
    // discharge every items. 
    for (const item of player.inPlay)
      if (item.hasTapEffect()) item.charged = false;
    player.character.charged = false;

    const deathPenaltyData = {
      eventIssuer: player,
      coinsLost: lostCoins,
      itemsLost: itemsToLose,
      lootCardsLost: lootCardsToLose,
    };
    this.game.emit("on:death:penalty", deathPenaltyData);

    // Replacement effects may alter the effective penalties during on:death:penalty emission.
    itemsToLose = deathPenaltyData.itemsLost;
    lootCardsToLose = deathPenaltyData.lootCardsLost;
    
    if (itemsToLose && itemsToLose.length > 0) {
      for (const item of itemsToLose) {
        if(!(item instanceof ItemCard))
          throw new GameError("Selected card is not an ItemCard.",
            toSerializedTranslation("error.chosenCardNotItemCard"));
        this.game.cardHandler.destroyCardsOrSouls([item]);
      }
    }
    if (lootCardsToLose && lootCardsToLose.length > 0) {
      for (const loot of lootCardsToLose) {
        this.game.cardHandler.discardFromHandAtIndex(player, player.hand._hand.indexOf(loot), "death");
      }
    }
    this.game.dispatch();
  }

  /**
   * Queues a death resolution sequence for an entity.
   */
  death(receiver: Entity, from: Entity, source: DamageSource): void {
    this.game.assert.gameOngoing();
    if(this.game.assert.entityIsInPlay(receiver, false) !== true) return;
    if (receiver.isDead) return;

    const deathOnStack = new DeathOnStack(receiver, from, source, this.game);
    this.game.addToStack(deathOnStack);
    this.game.emit("on:death:would-death", {
      eventIssuer: receiver,
      target: from,
      source: source,
      deathOnStack: deathOnStack,
    });
  }
  /** Cancels previous death entry for a player and stabilizes at 1 HP if needed. */
  preventDeath(entity: Entity): boolean {
    const cancelled = this.game.stack.cancelPreviousDeath(entity);
    if (entity.currentHealthPoints === 0) this.heal(entity, 1);
    return cancelled;
  }
  /**
   * Grants coin/loot/treasure rewards when a monster dies to the current player.
   */
  entityRewards(entity: Monster | Animated, player: Player | null = null): void {
    if(player === null)
      player = this.game.currentPlayer;
    const rewards = entity.rewards;
    if(rewards === undefined)
      return;

    const adders =  {
      "coin": (player: Player, amount: number): string => this.game.gainCoins(player, amount, entity.card),
      "loot": (player: Player, amount: number): void => this.game.loot(player, amount),
      "treasure": (player: Player, amount: number): void => this.game.gainTreasure(player, amount),
    }
    const onDice = {
      "coin": targetGetCoinRollEffect(this.game),
      "loot": targetGetLootRollEffect(this.game),
      "treasure": targetGetTreasureRollEffect(this.game),
    }
    for(const rewardType of ["coin", "loot", "treasure"] as const)
      if(rewards[rewardType] !== undefined)
      {
        const allPlayers = rewards[rewardType] instanceof Object && "all" in rewards[rewardType] && rewards[rewardType].all
        const amount = (rewards[rewardType] instanceof Object && "all" in rewards[rewardType]) ? rewards[rewardType].count : rewards[rewardType] as number | "roll";
        const receivers = allPlayers ? this.players : [player];
        for(const receiver of receivers)
        {
          if (amount === "roll") {
            const roll = this.game.rollDice(receiver, entity.card);
            roll.attachEffect(onDice[rewardType], entity.card, [
              receiver,
            ]);
          } else if (typeof amount === "number") {
            adders[rewardType](receiver, amount);
          }
        }
      }
  }

  /**
   * Resolves a pending death and its before/after trigger windows.
   * Should only be called by DeathOnStack objects.
   */
  async resolveDeath(receiver: Entity, from: Entity, source: DamageSource): Promise<void> {
    if(this.game.assert.isAlive(receiver, false) !== true
      || this.game.assert.entityIsInPlay(receiver, false) !== true)
      return;// if the receiver is not alive or not in play anymore, do nothing.
    if(this.game.timerIsUsed && receiver === this.game.currentPlayer)
    {
      this.game.gameParameters.timer.value -= 1; // reset timer if the current player dies.
      this.game.verifyTimerLosingCondition();
    }
    const stackIds = this.game.stack.currentStackIds;
    const values: DeathPenaltyValues = new DeathPenaltyValues(this.game.gameParameters);

    this.game.emit("on:death:before-penalty", {
      eventIssuer: receiver,
      target: from,
      source: source,
      values: values,
    });
    
    receiver.die();
    if(from instanceof Player)
    {
      if(from === receiver)
        from.stats.nbSuicides++;
      else if(receiver instanceof Player)
        from.stats.nbPlayerKilled++;
      else if(receiver instanceof Monster)
        from.stats.nbMobKilled++;
    }
    if(receiver instanceof Player)
      receiver.stats.nbDeaths++;
    await this.game.executeWhenStackSubset(stackIds, async () => {
      const stackIds = this.game.stack.currentStackIds;
      if (receiver.isEngagedInCombat) {
        this.endCombat();
      }
      for (const player of this.players) {
        player.clearAttackRequirement(receiver);
      }
      if (receiver instanceof Player) {
        receiver.clearAttackRequirement(); // clear any forced attack constraints on this.game player.
        this.game.actions.cancelPurchase(receiver, true);
        await this.deathPenalty(receiver, values);
      } else if (receiver instanceof Monster) {
        // Clear any forced attack constraints on this.game monster
        const eventData = {
          eventIssuer: receiver,
          target: from,
          source: source,
          rewardGainer: this.game.currentPlayer
        };
        this.game.emit("on:death:monster", eventData);
        this.monsterDiedThisTurn = true;
        this.entityRewards(receiver, eventData.rewardGainer);
        await this.game.executeWhenStackSubset(stackIds, async () => {
          this.game.encounters.kill(receiver); // should only kill once its effects are resolved: should be moved in the resolvewhenstackempty
          this.game.cardHandler.obtainMonsterSoulOrDiscard(receiver);
          await this.game.resolveCallbacks();
        }).catch((error) => {
          console.error("Failed to finish monster death resolution", error);
        });
      }else if (receiver instanceof Animated) {
        this.game.emit("on:death:animated", {
          eventIssuer: receiver,
          target: from,
          source: source,
        });
        this.entityRewards(receiver);
        if(!receiver.card.eternal)
          this.game.cardHandler.destroyCardsOrSouls([receiver.card]);
      }
      this.game.emit("on:death:after-penalty", {
        eventIssuer: receiver,
        target: from,
        source: source,
      });
      this.game.dispatch();
      const turnId = this.game.turnHandler.numberOfRoundSinceBeginning;
      if(receiver instanceof Player && this.game.currentPlayer === receiver && this.game.stack.elements.find(e => e instanceof EndOfTurnOnStack) == undefined)
        await this.game.executeWhenStackEmpty(async () => {
          if(this.game.turnHandler.numberOfRoundSinceBeginning === turnId )
            await this.game.endTurn();});
    }).catch((error) => {
      console.error("Failed to resolve death follow-up", error);
    });
    await this.game.resolveCallbacks();
  }

////////////////////////////////////// Combat and Health Handler //////////////////////////////////////

  makePlayerAttackable(player: Player, evasion: number): void {
    player.attackable = true;
    player.evasion = evasion;
  }

  makePlayerUnattackable(player: Player): void {
    player.attackable = false;
    player.evasion = 0;
  }

  /** Adds or refreshes a forced-attack requirement for a player. */
  playerMustAttack(player: Player, target: (Entity[] | "topDeck" | "any"), source: Card, checkRemainingAttack: boolean): void {
    // Check if player is dead - constraint doesn't apply
    if (player.isDead) {
      player.clearAttackRequirement();
      return;
    }

    const mustAttackEntity = player.mustAttackEntity;

    for (const req of mustAttackEntity) {
      if (req.targets === "topDeck") continue;
      if (req.targets === "any") continue;
      if(req.targets.every(m => !(this.game.attackableEntities.includes(m)) || m.attackable === false)) {
        player.clearAttackRequirement(req.targets[0]);
      }
    }
    player.mustAttack(target, source, checkRemainingAttack);
    this.game.dispatch();
  }

  forcedAttackSatisfied(player: Player, shouldThrow: boolean = true): Capability {
    this.game.actions.canDeclareAttack(player, false);
    // Check if there's a forced attack constraint
    if (!player.hasAttackRequirement) {
      return true; // No constraint, all good
    }

    // Check if player is dead - constraint doesn't apply
    if (player.isDead) {
      player.clearAttackRequirement();
      return true;
    }

    const requirement = player.mustAttackEntity!;

    // Filter monsters that are still in play
    const validMonsters = requirement.filter(
      (req) => 
        // (req.checkAttackRemaining === false || player.attackThisTurn > 0) &&
        (req.targets === "topDeck" || req.targets === "any" || req.targets.some(target => this.game.attackableEntities.includes(target)))
    );

    if (validMonsters.length === 0) {
      player.clearAttackRequirement(); // All monsters gone, constraint lifted
      return true;
    }

    if (validMonsters.every(req => (req.checkAttackRemaining === true && player.attackThisTurn <= 0)))
      return true;

    // At least one monster constraint remains - must be satisfied
    if (shouldThrow) {
      throw new GameError(
        "You must attack the required monster(s).",
        toSerializedTranslation("error.mustAttackRequiredMonsters")
      );
    }
    return toSerializedTranslation("error.mustAttackRequiredMonsters");
  }

  /** Adds an entity to the combat list (idempotent). */
  addEntityInCombat(entity: Entity): void {
    if (!this._entitiesInCombat.includes(entity)) {
      this._entitiesInCombat.push(entity);
    }
  }
  /**
   * Routes combat damage through triggers then queues stack damage.
   */
  dealCombatDamage(
    dealer: Entity,
    receiver: Entity,
    source: DamageSource,
    damage: number
  ): void {
    if (damage <= 0 || receiver.isDead) return;
    if(this.entities.includes(receiver) === false || this.entities.includes(dealer) === false)
    {
      this.endCombat();
      return;
    }
    const content = {
        eventIssuer: dealer, // The dealer is the one dealing combat damage
        target: receiver,
        source: source,
        damage,
      }
    this.dealDamage(dealer, receiver, source, damage);
    this.game.emit("on:combatdamage:dealt", content);
    if (receiver instanceof Player) {
      this.game.emit("on:combatdamage:dealt:to-player", content);
    } else if (receiver instanceof Monster) {
      this.game.emit("on:combatdamage:dealt:to-monster", content);
    }
  }
  /**
   * Pushes damage on stack and opens the "would take damage" window.
   */
  dealDamage(
    dealer: Entity,
    receiver: Entity,
    source: DamageSource,
    damage: number,
    callback?: (data: EffectData) => boolean,
    callbackTargets: any[] = []
  ): void {
    if (damage <= 0) return;

    const damageArray = [damage];

    const damageOnStack = new DamageOnStack(
      dealer,
      receiver,
      damageArray,
      source,
      this.game
    );
    if (callback) {
      damageOnStack.attachEffect(callback, source, callbackTargets);
    }
    this.game.addToStack(damageOnStack);
  }

  // on health loss trigger can be added here. Be careful, in case of pay HP to verify that all the HP are actually lost.
  /**
   * Applies raw damage to an entity's health pool.
   */
  healthLoss(
    dealer: Entity,
    receiver: Entity,
    source: DamageSource,
    damage: number,
    checkDeath: boolean = true
  ): boolean {
    const damageReceived = receiver.receiveDamage(damage, dealer, source);
    if (checkDeath && receiver.currentHealthPoints <= 0) {
      this.death(receiver, dealer, source);
    }
    return damageReceived;
  }

  /**
   * Resolves queued damage and emits taken-damage/death triggers.
   */
  async resolveDamageOnStack(): Promise<void> {
    const elem = this.game.stack.peek() as DamageOnStack;
    if (!elem || !(elem instanceof DamageOnStack)) return;

    const dealer: Entity = elem.from;
    const receiver: Entity = elem.receiver;
    const source: DamageSource = elem._source;
    const stackIds = this.game.stack.currentStackIds;
    if ((elem._source instanceof DiceRoll && (elem.receiver.isEngagedInCombat === false && elem.from.isEngagedInCombat === false))
      || !this.entities.includes(receiver)
    ) 
      {
        this.game.stack.resolve();
        this.game.dispatch();
        await this.game.resolveCallbacks();
        return;
      }
    this.game.emit("on:damage:would-take", {
      eventIssuer: elem.receiver,
      target: elem.from,
      source: elem._source,
      damageArray: elem.damage,
    });
    // console.log(`Resolving damage on stack: ${elem.damage[0]} damage from ${dealer instanceof Player ? `Player ${dealer.id}` : dealer instanceof Monster ? `Monster ${dealer.card.name}` : "Animated"} to ${receiver instanceof Player ? `Player ${receiver.id}` : receiver instanceof Monster ? `Monster ${receiver.card.name}` : "Animated"}.`);
    await this.game.executeWhenStackSubset(stackIds, async () => {
      // console.log(`Executing damage resolution for ${elem.damage[0]} damage from ${dealer instanceof Player ? `Player ${dealer.id}` : dealer instanceof Monster ? `Monster ${dealer.card.name}` : "Animated"} to ${receiver instanceof Player ? `Player ${receiver.id}` : receiver instanceof Monster ? `Monster ${receiver.card.name}` : "Animated"}.`);
      const damage = elem.damage[0]!;
      this.game.stack.resolve();
      this.healthLoss(dealer, receiver, source, damage, false);
      if(damage > 0){
        await elem.onResolve();
        // Add to history
        this.game.addToHistory(elem.json);
        this.game.dispatch();
        await this.game.resolveCallbacks();
        if (receiver.damageTakenThisTurn.length === 1)
          this.game.emit("on:damage:taken:first-time-each-turn", {
        eventIssuer: receiver,
          target: dealer,
          source: source,
          damage: damage,
        });
        
        this.game.emit("on:damage:taken", {
          eventIssuer: receiver,
          target: dealer,
          source: source,
          damage: damage,
        });
        if(receiver instanceof Player)
          receiver.stats.nbDamageTaken += damage;
        if(dealer instanceof Player)
          dealer.stats.nbDamageDealt += damage;
      }

      if (receiver.currentHealthPoints <= 0) {
        this.death(receiver, dealer, source);
      }
      await this.game.resolveCallbacks();
    });
    await this.game.resolveCallbacks();
  }

  /**
  * Heals an entity by a fixed amount.
  */
  heal(receiver: Entity, amount: number | "full" = "full"): void {
    receiver.heal(amount);
  }
  healEveryone(): void {
    this.players.forEach((p) => this.heal(p));
    this.game.monsters.forEach((m) => this.heal(m));
  }
/** Removes an entity from the combat list if present. */
  removeEntityInCombat(entity: Entity): void {
    const idx = this._entitiesInCombat.indexOf(entity);
    if (idx !== -1) {
      this._entitiesInCombat.splice(idx, 1);
    }
  }
  /**
   * Ends combat for all currently engaged entities.
   */
  endCombat(): void {
    // console.log("Ending combat for entities:", this.entitiesInCombat.map(e => e instanceof Player ? `Player ${e.id}` : e instanceof Monster ? `Monster ${e.card.name}` : "Animated"));
    const engagedEntities = this.entitiesInCombat;
    for (const entity of engagedEntities) {
      if (entity.isEngagedInCombat) {
        entity.combatEnded();
      }
    }
    this._entitiesInCombat = [];
    this.game.stack.clearCombatEffects();
    this.game.emit("on:combat:end", { eventIssuer: engagedEntities.filter(e => e instanceof Player)[0] });
    this.game.dispatch();
  }


  endCombatIfInvalid(player: Player): void
  {
    if(player.isEngagedInCombat && player.clearOutdatedAttackRequirements(this.game.attackableEntities) && this.entitiesInCombat.length === 1)
      {
        this.endCombat();
      }
  }

  ////////////////////////////////////// Entity Adders //////////////////////////////////////

  /** Adds a temporary/permanent attack modifier to an entity. */
  addAttack(e: Entity, value: number, source: Card | "flip" | "other" = "other"): void {
    // console.log(`Adding ${value} attack points to entity ${e.id}. Current attack points: ${e.attackPoints}. source is ${source instanceof Card ? source.jsonAPI.name : source}, id ${source instanceof Card ? source.jsonAPI.globalId : "N/A"}.`);
    if(e.attackPoints + value < 0)
      throw new GameError(`Cannot reduce attack points of entity ${e.id} below 0.`,
        toSerializedTranslation("error.cannotReduceAttackPointsBelow0", {card: e.card.nameKey}));
    e.addAttackPoints(value);
  }

  /** Increases the number of attacks available this.game turn for a player. 
   * If the player is engaged in combat, but has not yet chosen a target, and this.game would set its remaining attacks to 0, it will be set to 1 instead.
  */
  addAttackThisTurn(e: Entity, value: number = 1, source: Card | "flip" | "other" = "other"): void {
    if (e instanceof Player) {
      if(e.attackThisTurn + value === 0 && e.isEngagedInCombat && this.entities.every((entity) => entity === e || entity.isEngagedInCombat === false))
      {
        e.addAttackThisTurn(value + 1);
      }
      else
        e.addAttackThisTurn(value);
      this.game.dispatch();
    }
  }

  /** Adds max/current health points to an entity according to entity logic. */
  addHealth(e: Entity, value: number, source: Card | "flip" | "other" = "other"): void {
    e.addHealthPoints(value);
  }

  /** Applies a global attack modifier to encounter monsters. */
  addAttackToEachMonster(e: Entity, value: number, source: Card | "flip" | "other" = "other"): void {
    this.game.encounters.addAttackModifier(value);
  }

  /** Applies a global evasion/DC modifier to encounter monsters. */
  addDCToEachMonster(e: Entity, value: number, source: Card | "flip" | "other" = "other"): void {
    this.game.encounters.addDCModifier(value);
  }

  /** Adds an evasion/DC modifier to a monster entity. */
  addDC(e: Entity, value: number, source: Card | "flip" | "other" = "other"): void {
    if (!(e instanceof Monster))
      throw new GameError("Evasion modifier can only be added to monsters.",
        toSerializedTranslation("error.dcModifierOnlyForMonsters"));
    e.addEvasion(value);
  }

  /** Grants extra loot plays this.game turn. */
  addLootPlay(e: Entity, value: number, source: Card | "flip" | "other" = "other"): void {
    if(!(e instanceof Player))
      throw new GameError("Loot play modifier can only be added to players.",
        toSerializedTranslation("error.lootPlayModifierOnlyForPlayers"));
    e.addLootPlay(value);
  }

  /** Toggles/updates permission to see the treasure deck top card. */
  addCanSeeTopOfTreasureDeck(e: Player, value: number, source: Card | "flip" | "other" = "other"): void {
    e.addCanSeeTopOfTreasureDeck(value);
  }

  /** Applies attack-roll specific dice modifier to an entity. */
  addAttackDiceModifier(e: Entity, value: number, source: Card | "flip" | "other" = "other"): void {
    e.addAttackDiceModifier(value);
  }

  /** Applies generic dice modifier to a player. */
  addDiceModifier(e: Entity, value: number, source: Card | "flip" | "other" = "other"): void {
    if (!(e instanceof Player))
      throw new GameError("Dice modifier can only be added to players.",
        toSerializedTranslation("error.diceModifierOnlyForPlayers"));
    e.addDiceModifier(value);
  }

  /** Grants additional purchases for the current turn. */
  addPurchaseThisTurn(p: Player, value: number, source: Card | "flip" | "other" = "other"): void {
    p.remainingPurchaseThisTurn += value;
  }


  /** Applies the current turn player's loot/activation restriction to all other players. */
  applyLootOrActivateRestrictionForCurrentTurn(player: Player, value: number = 1): void {
    for (const p of this.players) {
      if(p !== player)
      {
        p.addToCanIActivateThisTurn(value);
        p.addToCanIUseLootThisTurn(value);
      }
    }
    this.game.dispatch();
  }

////////////////////////////////////// Entity registration //////////////////////////////////////

  addAnimated(animated: Animated): void {
    this._animatedList.add(animated);
  }
  removeAnimated(animated: Animated): void {
    this._animatedList.remove(animated);
    if(animated !== undefined && animated.isEngagedInCombat)
      this.endCombat();
  }  

  /**
   * Adds a new player before game start.
   */
  addPlayer(newPlayer: Player): void {
    this.game.assert.playerIdAvailable(newPlayer.id);
    this.game.assert.gameNotStarted();
    newPlayer.maxHandSize = this.game.gameParameters.maxHandSize.value;
    this.players.push(newPlayer);
    this.game.dispatch();
  }

  /** Finds a player by id or throws. */
  getPlayerById(id: string): Player {
    for (const p of this.players) {
      if (p.id === id) {
        return p;
      }
    }
    throw new GameError(`Player with id ${id} not found.`,
      toSerializedTranslation("error.playerNotFound", {player: id}));
  }

}