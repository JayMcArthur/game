import {
  BsoulCard,
  Card,
  CharacterCard,
  Deck,
  Hand,
  ItemCard,
  LoadDecks,
  LoadsCardSets,
  LootCard,
  MonsterCard,
  MonsterType,
  TreasureCard,
  createEmptyDecksCollection,
  isDeckType,
  isSameSlug,
} from "@/models/cards";
import {
  selectEternalAmongX
} from "@/models/effects/activeEffect";
import { effectParser, syncEffectParser } from "@/models/effects/parsing/effectParser";
import { Entity } from "@/models/entities/entity";
import { Monster } from "@/models/entities/monster";
import { Player } from "@/models/entities/player";
import type { DeckType, DeckTypeToCardType, DecksCollection, EffectType, TargetsSelector } from "@/models/types/cardTypes";
import { EffectData } from "@/models/types/cardTypes";
import { type RechargeReason } from '@/models/types/eventTypes';
import { loadCards } from "@/utils/loadCards";
import { Effect, PassiveEffect } from '../effects/effects';
import { Game } from '../game';
import { GameError } from "@/models/GameError";
import { LootCardEffect } from '../stackElement';
import { type CounterType } from "@/shared/api"
import { toSerializedTranslation } from "@/utils/translation";
import { bSoulEffectParser } from "../effects/bonusSoulEffects";
import { TargetBuilder } from "../targetBuilder";

const CARDS = await loadCards(process.cwd() + "/data/cards");
export const {nextGlobalId, cardSets: CARD_SETS} = LoadsCardSets(CARDS);
export class CardHandler {
  private _game: Game;

  private _decks: DecksCollection;
  private _outsideGameCards: Card[] = [];
  private _bonusSouls: BsoulCard[] | undefined = undefined;
  private _cardMapping: Map<number, Card> = new Map();
  private _nextCardGlobalId: number = 0;
  private _effectsAttached = new WeakSet<Card>();
  
  constructor(game: Game) {
      this._game = game;
      this._decks = createEmptyDecksCollection(this.game);
  }
////////////////////////////////////// Getters //////////////////////////////////////

  get game(): Game {
    return this._game;
  }
  get decks(): DecksCollection {
    return this._decks;
  }
  get outsideGameCards(): Card[] {
    return this._outsideGameCards;
  }
  putOutsideGame(card: Card): void {
    this._outsideGameCards.push(card);
  }
  get cardMapping(): ReadonlyMap<number, Card> {
    return this._cardMapping;
  }
  get targetableSoulsOwned(): Card[] {
    const souls: Card[] = [];
    for (const player of this.game.players) {
      souls.push(...player.targetableSouls);
    }
    return souls;
  }

  get inPlayItems(): { player: Player; card: ItemCard }[] {
    return this.game.players.flatMap(p => p.inPlay.map(c => ({player: p, card: c})));
  }

  get inPlayCurses(): { player: Player; card: MonsterCard }[] {this.game.players.flatMap(p => p.curses.map(c => ({player: p, card: c})));
    return this.game.players.flatMap(p => p.curses.map(c => ({player: p, card: c})));
  }

  /**
   * this.game function returns all visible treasure and trinkets: each players inPlay and the shop items.
   */
  get visibleItems(): ItemCard[] {
    const result: ItemCard[] = this.game.inPlayItems.map(({ card }) => card);
    result.push(
      ...this.game.shop.itemsInShop.filter((c): c is ItemCard => c instanceof ItemCard)
    );
    return result;
  }

  get deckNames(): DeckType[] {
    const names = ["loot", "treasure", "monster"] as DeckType[];
    if(this.game.rooms !== undefined)
      names.push("room");
    return names;
  }

  get bonusSouls(): BsoulCard[] | undefined {
    return this._bonusSouls;
  }

  /** Lists targetable in-play cards (excluding eternal/character). */
  inPlayTargetableCards(target: Player): ItemCard[] {
    return target.inPlay.filter(
      (card) =>
        card.type !== "eternal" &&
        card.type !== "character" && 
        card.eternal === false
    );
  }

  /**
   * @param player 
   * @returns the cards owned by a player (his hand and in-play, non-eternal cards), and game owned cards (shop and encounters).
   */
  playerCardsAndGameOwnedCards(player: Player): Card[] {
    // player's hand
    const cards: Card[] = [];
    cards.push(...player.hand._hand);
    // player's inPlay
    cards.push(...this.inPlayTargetableCards(player));
    // player's curses
    cards.push(...player.curses);
    // shop
    cards.push(...this.game.shop.itemsInShop.filter((c) => c !== undefined));
    // events and monsters not in combat
    cards.push(...this.game.encounters.nonEngagedInCombat);
    // rooms
    if(this.game.rooms !== undefined)
      cards.push(...this.game.rooms.activeRooms);
    return cards;
  }
  /**
   * Finds the owner of a soul or in-play item card.
   */
  getOwner(item: Card, type: "inplay" | "soul" | "any" = "any"): Player | null {
    if(type === "inplay" || type === "any") {
      if(item instanceof ItemCard)
        for (const player of this.game.players) {
          if (player.inPlay.includes(item) || player.character === item) {
            return player;
          }
        }
    }
    if(type === "soul" || type === "any") {
      for (const player of this.game.players) {
        if (player.targetableSouls.includes(item)) {
          return player;
        }
      }
    }
    return null;
  }

  getCardByGlobalId(globalId: number): Card | undefined {
    return this._cardMapping.get(globalId);
  }

  /**
   * An active effect goes on the stack immediately, a passive effect register a listener.
   * 
   * A loot card is always an active effect, as even trinket goes to the stack before becoming an item.
   * An event monster card is an active effect as it goes on the stack when drawn.
   * A monster card effect is passive.
   * @param outcome 
   * @param card 
   * @returns 
   */
  private getEffectTypeFromOutcome(outcome: string, card: Card): EffectType {
    const normalizedOutcome = outcome.trim();
    const lowerOutcome = normalizedOutcome.toLowerCase();
    let type: EffectType = "passive";
    if (
      normalizedOutcome.startsWith("[Tap Effect]") ||
      (card.type === "loot" && (card as LootCard).trinket === false) ||
      (card instanceof MonsterCard &&
        card.encounterType === MonsterType.EVENT &&
        outcome !==
        "The active player may attack an additional time this.game turn.")
    )
      type = "active";
    else if (normalizedOutcome.startsWith("[Paid Effect]") || lowerOutcome.startsWith("[paid effect]")) type = "paid";
    return type;
  }

////////////////////////////////////// Generic Card handler //////////////////////////////////////

  /** Draws the first N cards from a typed deck. */
  getFirstCardsOfDeck<T extends DeckType>(deckName: T, number: number): DeckTypeToCardType[T][] {
    return this.decks[deckName]!.drawSeveral(number) as DeckTypeToCardType[T][];
  }
  /** Inserts a card on top of a typed deck. */
  addTopPosition<T extends DeckType>(deckName: T, card: Card): void {
    this.game.assert.cardMatchesDeck(deckName, card);
    this.decks[deckName]!.addTopPosition(card as any);
  }
  /** Inserts a card at the bottom of a typed deck. */
  addBottomPosition<T extends DeckType>(deckName: T, card: Card): void {
    this.game.assert.cardMatchesDeck(deckName, card);
    this.decks[deckName]!.addBottomPosition(card as any);
  }

  /**
   * Applies post-death monster card destination (soul or discard).
   */
  obtainMonsterSoulOrDiscard(monster: Monster): void {
    const card = monster.card;
    if(card.afterEffect === "handled" || card.afterEffect === "nothing")
      return; // Card is already handled by its afterEffect, so do nothing here.
    if (card.rewards?.soul !== undefined) {
      if (typeof card.rewards?.soul !== "number")
        throw new GameError("Monster soul reward must be a number.", toSerializedTranslation("error.monsterSoulMustBeNumber"));
      card.soul = card.rewards?.soul;
      this.game.addAnimation({
        id: this.game.nextAnimationId,
        type: "obtainMonsterSoul",
        card: card.jsonAPI,
        player: this.game.currentPlayer.id,
      });
      this.addSoul(this.game.currentPlayer, card);
    } else this.discard(card);
    this.game.dispatch();
  }

  /**
   * Look for a card outside the game.
   * @param slug 
   * @param globalId 
   * @returns corresponding card or undefined if not found.
   */
  obtainCardFromOutsideGame(slug: string, globalId?: number): Card | undefined {
    const card = this._outsideGameCards.find((c) =>
      c.slug === slug && (globalId === undefined || c.globalId === globalId)
    );
    if (card) {
      this._outsideGameCards.splice(this._outsideGameCards.indexOf(card), 1);
      return card;
    }
    return undefined;
  }
  /**
   * Finds and removes a card by slug from all reachable game zones.
   * If a global ID is provided, it is used to disambiguate duplicate slugs.
   * Otherwise, the first matching card found in the search order is removed and returned.
   * Note that the search order is: shop, encounters, decks, players' hands, players' in-play areas. 
   * this.game means that if there are multiple cards with the same slug, the one in the shop will be removed first, then the one in encounters, then in decks and finally in players' possession.
   * Only tests should not provide a global ID.
   */
  obtainCard(slug: string, globalId?: number, type?: DeckType): Card | undefined {
    // Search in all players' hands and in-play areas
    for (const player of this.game.players) {
      if(type === "loot")
      {
        const handCard = player.hand.cards.find((c) =>
          c.slug === slug && (globalId === undefined || c.globalId === globalId)
        );
        if (handCard) {
          player.hand.removeCard(handCard);
          return handCard;
        }
      }

      const inPlayCard = player.inPlay.find((c) =>
        c.slug === slug && (globalId === undefined || c.globalId === globalId)
      );
      if (inPlayCard) {
        this.removeInPlay(player, inPlayCard);
        return inPlayCard;
      }
    }

    for (const slot of [this.game.shop, this.game.encounters, this.game.rooms]) {
        if(slot === undefined)
          continue;
        if(type !== undefined && type !== slot._deck._type)
          continue;
        const card = slot.obtainCard(slug, globalId);
        if (card) 
          {
            return card;
          }
    }
    // Search in all decks
    for (const deckKey in this.decks) {
        if(!isDeckType(deckKey))
          throw new GameError(`Invalid deck type: ${deckKey}`, toSerializedTranslation("error.invalidDeckType", {deckType: deckKey}));
        if(type !== undefined && type !== deckKey)
          continue;
        const deck = this.decks[deckKey]!;
        const card = deck.getCardFromSlug(slug, globalId);
        if (card) return card;
    }
    return undefined;
  }

  /** Sends a card to its owner deck discard pile. */
  discard(card: Card): void {
    if(!card.canBeDiscarded) return;
    const eventData = { eventIssuer: null, card };
    this.game.emit("on:card:discarded:before", eventData);
    if(eventData.card === null)
      return;
    this.game.obtainCard(card.slug, card.globalId, card.type); // make sure the card is removed from other places.
    const deck: Deck<Card> = this.decks[card.type];
    deck.addDiscardTop(card);
  }


  /**
   * Transfers a card between players when legal.
   */
  give(from: Player, to: Player, card: Card): boolean {
    if (from.targetableSouls.includes(card)) {
      this.removeSoul(from, card);
      this.addSoul(to, card);
      return true;
    }
    
    if (card instanceof ItemCard) 
      if (from.inPlay.includes(card) && !card.eternal) {
        this.removeInPlay(from, card, false);
        this.addInPlay(to, card);
        return true;
      }
      // loot card must be looked at the end, as it can be a trinket in play, or a soul.
    if (card instanceof LootCard) {
      return this.giveCard(from, to, card);
    }
    return false;
  }


  private registerCard(card: Card): void {
    if (this._cardMapping.has(card.globalId)) {
      throw new GameError(`Duplicate global card id detected: ${card.globalId}.`, toSerializedTranslation("error.behaviorError", {error: `Duplicate global card id detected: ${card.globalId}.`}));
    }
    this._cardMapping.set(card.globalId, card);
    this._nextCardGlobalId = Math.max(this._nextCardGlobalId, card.globalId + 1);
  }
////////////////////////////////////// Inplay and Curse handler //////////////////////////////////////

  /**
   * Swaps two in-play items between their owners.
   */
  swapItems(item1: ItemCard, item2: ItemCard): boolean {
    const owner1 = this.game.getOwner(item1);
    const owner2 = this.game.getOwner(item2);
    if (owner1 && owner2 && item1.eternal === false && item2.eternal === false) {
      this.removeInPlay(owner1, item1, false);
      this.removeInPlay(owner2, item2, false);
      this.addInPlay(owner1, item2);
      this.addInPlay(owner2, item1);
      return true;
    }
    return false;
  }

  /**
   * Adds an item to play and emits enter-play trigger.
   */
  addInPlay(player: Player, card: ItemCard): void {
    this.ensureEffectsAttached(card);
    this.game.emit("on:enter:play", { eventIssuer: player, card: card });
    // Ensure the card knows its current owner and its effects are subscribed to that owner.
    // Previously only certain card types had onAddInPlay called; that left some items with a stale owner
    // after transfers (steal/give). Always call onAddInPlay so owner is accurate.
    card.onAddInPlay(() => player);
    player.addInPlay(card);
    this.game.emit("on:enter:play:after", {
      eventIssuer: player,
      card: card,
    });
    player.stats.nbItemGained++;
    this.game.dispatch();
  }

  /**
   * Adds a curse card to a player.
   */
  async addCurse(player: Player, card: MonsterCard): Promise<void> {
    this.ensureEffectsAttached(card);
    player.addCurse(card);
    await card.onPlay(player, []);
    this.game.dispatch();
  }

  /**
   * Removes a curse card from a player and runs cleanup.
   */
    removeCurse(player: Player, card: MonsterCard): void {
    card.cleanup();
    player.removeCurse(card);
    this.game.dispatch();
  }

  /**
   * Activates a specific item and pushes resulting effect to stack.
   */
  async activateItem(
    player: Player,
    item: ItemCard,
    targets: any[] = [],
    effectId: number | "tap" = "tap"
  ): Promise<boolean> {
    const effectOnStack = await player.activateItem(item, targets, effectId);
    this.game.addAnimation({
      id: this.game.nextAnimationId,
      type: "activateInPlay",
      card: item.jsonAPI,
    })
    this.game.addToStack(effectOnStack);
    if (effectId === "tap") {
      if (item !== player.character) {
        this.game.emit("on:item:activated", {
          eventIssuer: player,
          item: item,
        });
      }
      this.game.emit("on:card:activated", {
        eventIssuer: player,
        item: item,
      });
    }
    return true;
  }

  /** Draws treasure cards and puts them directly in play for the player. */
  gainTreasure(player: Player, nb: number = 1): void {
    this.game.assert.gameOngoing();
    this.game.assert.positiveNumber(nb);
    const eventData = { eventIssuer: player, amount: nb };
    this.game.emit("on:item:gained", eventData);

    for (let i = 0; i < eventData.amount; i++) {
      const treasureDeck = this.decks["treasure"]!;
      try {
        const drawnCard: TreasureCard = treasureDeck.draw()!;
        this.addInPlay(player, drawnCard);
      } catch (err: any) {
        // Treat empty-deck as a recoverable condition during randomized tests
        // Log for diagnostics and stop attempting further treasure draws.
        if (err && typeof err.message === 'string' && err.message.includes('has only 0 cards')) {
          // console.warn('gainTreasure: treasure deck empty, skipping remaining treasure draws.');
          return;
        }
        throw err;
      }
    }
  }

  shouldUseDiceWillRoll(): boolean{
    for(const player of this.game.players){
      for(const item of player.inPlay)
        if(item.requiresDiceWillRoll)
          return true;
    }
    return false;
  }

  /** Removes curse cards from players and marks them destroyed. */
  destroyCurse(cards: MonsterCard[]): boolean {
    this.game.players.forEach((player) => {
      player.curses.forEach((card) => {
        if (cards.includes(card)) {
          this.removeCurse(player, card);
          this.discard(card);
        }
      })
    });
    this.game.dispatch();
    return true;
  }

  /** Destroys cards by removing them from in-play/soul zones and shop and tracks destruction.
   * Note that loot cards can not be destroyed.
   */
  destroyCardsOrSouls(cards: Card[]): boolean {
    if (cards.length === 0 || cards.some((card) => card === undefined) || cards.some((card) => card.eternal === true) || cards.some((card) => card.type === "loot" && card.soul === 0 && (card as LootCard).trinket === false))
      return false;
    // You can not destroy a card that is already destroyed.
    for(const card of cards)
      if(this.decks[card.type].discard.includes(card as any))
        return false;
    // console.log("Destroying cards:", cards.map(c => c.name));
    const eventData = { eventIssuer: null, cards };
    this.game.emit("on:item:destroyed", eventData);
    cards = eventData.cards;
    if(cards.length === 0)
      return true;
    cards.forEach((card) => {
      if(card instanceof ItemCard)
        if(this.game.shop.removeCard(card)) {
        }
      });
      cards.forEach((card) => {
      const rest = this.game.obtainCard(card.slug, card.globalId, card.type);
    });
    cards.forEach((card) => {
      this.game.players.forEach((player) => {
        this.removeSoul(player, card);
      });
    });
    
    cards.forEach((card) => {
      this.discard(card);
      card.cleanup();
    });

    this.game.dispatch();
    return true;
  }

  /** Removes an in-play card from player and runs cleanup triggers. */
  removeInPlay(player: Player, card: ItemCard, removeCounter=true): boolean {
    card.cleanup();
    if(removeCounter)
      for(const counterType of card.counters.counterOwned)
        this.addToCounter(this.game.currentPlayer, card, counterType, -(card.counters.getIfDefined(counterType) || 0));
    return player.removeInPlay(card);
  }

  /** Destroys an owned item and replaces it by gaining treasure. */
  reroll(card: Card): void {
    const owner = this.game.getOwner(card, "inplay");
    if (!(card instanceof ItemCard)) {
      throw new GameError("Can only reroll item cards.", toSerializedTranslation("error.canOnlyRerollItemCards"));
    }
    if (owner && !owner.inPlay.includes(card)) {
      throw new GameError("Owner does not have the specified card in play.", toSerializedTranslation("error.ownerDoesNotHaveCardInPlay"));
    }
    const success = this.game.getOwner(card, "soul") ? false : this.destroyCardsOrSouls([card]);
    if(owner && success)
      {
        // owner.removeInPlay(card);
        this.game.gainTreasure(owner);
    }
  }

/** Attempts to steal an item from shop or another player's in-play area. */
  stealItemAnywhere(player: Player, target: ItemCard): boolean {
    this.game.assert.gameOngoing();

    if (this.game.shop.removeCard(target)) {
      this.addInPlay(player, target);
      return true;
    }
    for (const p of this.game.players) {
      if (p !== player) {
        if (p.inPlay.includes(target)) {
          if(target.eternal)
            throw new GameError("Cannot steal eternal items.", toSerializedTranslation("error.cannotStealEternalItems"));
          if(this.removeInPlay(p, target, false)) {
            this.addInPlay(player, target);
            return true;
          }
        }
      }
    }
    return false;
  }

  addToCounter(issuer: Entity, item: Card, type: CounterType, value: number): void {
    const oldValue = item.counters.value(type);
    item.counters.addToCounter(value, type);
    this.game.emit("on:counter:modified", { eventIssuer: issuer, card: item, counterName: type, previousValue: oldValue, newValue: item.counters.value(type) });
  }

  /**
   * Recharges every in-play item for a player.
   */
  rechargeMultiple(player: Player, reason: RechargeReason = "other", items: ItemCard[] | undefined = undefined): void {
    if(items === undefined)
      items = player.unchargedItems;
    for (const card of items) {
      this.recharge(card, reason);
    }
  }

  /**
   * Recharges a single item.
   */
  recharge(item: ItemCard, reason: RechargeReason = "other"): void {
    const data = { eventIssuer: null, card: item, reason, shouldRecharge: true};
    this.game.emit("on:recharge", data);
    if(data.shouldRecharge)
      item.recharge();
  }

  /**
   * Deactivates a single item.
   */
  deactivateItem(item: ItemCard): void {
    item.deactivate();
    this.game.dispatch();
  }
  flip(entity: Entity, card: Card): void {
    this.game.assert.gameOngoing();
    if (entity instanceof Player && !(this.game.getOwner(card) === entity)) {
      return;
    }
    if (card.flipData === undefined) {
      return;
    }
    card.flip();
    this.game.emit("on:card:flipped", { eventIssuer: entity, card, recto: card.flipped });
  }

////////////////////////////////////// Game initialisation Handler //////////////////////////////////////

  /**
   * Creates decks and attaches parsed effects to all cards.
   */
  setupDecks(): void {
    if(this._decks["character"]._order!.length !== 0)
      return;
    this._decks = LoadDecks(
      CARDS
      // .filter((c) => c.slug.includes("fsp2") || (c.type !== "treasure" && c.type !== "monster"))
      ,
      this.game.players.length,
      this.game.gameParameters,
      this.game
    );
    this.rebuildCardMapping();
    this.moveOutsideCards();
  }
  /**
   * Outside cards start in their respective deck, they are move to the outside of the game here.
   * e.g. The Harbingers starts in the monster deck.
   */
  moveOutsideCards(): void {
    for (const key in this.decks) {
      const deck = this.decks[key as DeckType]!;
      for (const card of deck.cards) {
        if (card.outsideGame) {
          const obtainedCard = deck.getCardFromSlug(card.slug);
          if(!obtainedCard)
            throw new GameError(`Card with slug ${card.slug} not found in deck.`, toSerializedTranslation("error.cardWithSlugNotFoundInDeck", {slug: card.slug}));
          this.putOutsideGame(obtainedCard);
        }
      }
    }
  }

  /**
   * Note that any character card taken is duplicated with its eternal item if it has one. 
   * That allows several players to have the same character.
   * @param slugs set of character card slugs or "random" in the players order.
   * @returns set of character cards in the same order
   */
  getCharactersFromSlugs(slugs: string[]): CharacterCard[] {
    this.setupDecks();
    const characters: CharacterCard[] = [];
    for (const slug of slugs) {
      const isRandomPlaceholder = slug === "random";
      let cardFromSet: CharacterCard | undefined;
      if(isRandomPlaceholder)
      {
        // Use a valid in-set template while the mulligan is pending. The
        // template must also have an eternal card available in this setup.
        cardFromSet = this._decks.character._set.cards.find((candidate) =>
          candidate.slug === "b2-eden" &&
          (!candidate.eternalCard || this._decks.eternal._set.cards.some((eternal) => eternal.slug === candidate.eternalCard))
        ) ?? this._decks.character._set.cards.find((candidate) =>
          !candidate.eternalCard || this._decks.eternal._set.cards.some((eternal) => eternal.slug === candidate.eternalCard)
        );
        if (!cardFromSet)
          throw new GameError("No valid character is available for a random-character placeholder.", toSerializedTranslation("error.behaviorError", {error: "No valid character is available for a random-character placeholder."}));
      }
      else
        cardFromSet = this._decks["character"]._set.cards.find(c => c.slug === slug);
      if(!cardFromSet)
        throw new GameError(`Card with slug ${slug} not found in deck.`, toSerializedTranslation("error.cardWithSlugNotFoundInDeck", {slug: slug}));
      const card = this.copyCard(cardFromSet) as CharacterCard;
      if (card) {
        if (!isRandomPlaceholder)
          this.addBottomPosition("character", card);
        if(card.eternalCard !== null)
        {
          const eternalCardFromSet = this._decks["eternal"]._set.cards.find(c => c.slug === card.eternalCard) as ItemCard;
          if (!eternalCardFromSet)
            throw new GameError("No eternal card with slug " + card.eternalCard + " found", toSerializedTranslation("error.noEternalCardWithSlug", {card: card.eternalCard}));
          const eternalCard = this.copyCard(eternalCardFromSet) as ItemCard;
          this.addBottomPosition("eternal", eternalCard);
        }
        characters.push(card);
      }
    }
    return characters;
  }

  /**
   * Draws random character cards and assigns them to players.
   */
  assignRandomCharacterToPlayers(): void {
    this.setupDecks();
    const characterDeck = this.decks["character"];
    if (!characterDeck) {
      throw new GameError("No character deck found", toSerializedTranslation("error.behaviorError", {error: "No character deck found"}));
    }
    
    const characters: CharacterCard[] = characterDeck.drawSeveral(
      this.game.players.length
    );
    this.assignCharactersToPlayers(characters);
  }

  /**
   * Assigns provided character cards (and matching eternals) to players.
   */
  assignCharactersToPlayers(characters: CharacterCard[]): void {
    const characterDeck = this.decks["character"];
    if (!characterDeck) {
      throw new GameError("No character deck found", toSerializedTranslation("error.behaviorError", {error: "No character deck found"}));
    }
    if (characters.length !== this.game.players.length) {
      throw new GameError("Number of characters does not match number of players", toSerializedTranslation("error.numberOfCharaNEQnbPlayers"));
    }
    this.game.players.forEach((player, index) => {
      const character = characters[index]!;
      this.addInPlay(player, character);
      const eternalDeck = this.decks["eternal"];
      if (!eternalDeck) {
        throw new GameError("No eternal deck found", toSerializedTranslation("error.behaviorError", {error: "No eternal deck found"}));
      }
      if (character.eternalCard) {
        const cardName = character.eternalCard;
        const card = eternalDeck.getCard((card: Card) =>
          isSameSlug(cardName, card)
        );
        if (!card) {
          eternalDeck?.cards.forEach((card) => {
            console.log("Available eternal card:", card.slug);
          });
          throw new GameError("No eternal card with slug " + cardName + " found", toSerializedTranslation("error.noEternalCardWithSlug", {card: cardName}));
        }
        if (card.slug !== cardName) {
          throw new GameError(
            "Eternal card slug mismatch: expected " +
            cardName +
            ", got " +
            card.slug,
            toSerializedTranslation("error.eternalCardSlugMismatch", {expected: cardName, actual: card.slug})
          );
        }
        this.addInPlay(player, card);
      }
    });
  }

  private rebuildCardMapping(): void {
    this._cardMapping.clear();
    this._nextCardGlobalId = 0;
      Object.values(this.decks).forEach((deck) => deck.cards.forEach((card: Card): void => this.registerCard(card)));
  }

  /**
   * Draws and initializes the three bonus soul cards.
   */
  initializeBonusSouls(): void {
    if(this.decks["bsoul"]._order!.length !== 0 && this.game.gameParameters.playWithBonusSouls.value) {
      this._bonusSouls = this.decks["bsoul"]!.drawSeveral(3);
      for (const soul of this._bonusSouls) {
        soul.cleanup = bSoulEffectParser(soul, this.game);
      }
    }
  }
////////////////////////////////////// Loot card Handler //////////////////////////////////////

  /** Draws loot cards for a player and emits pre/post loot triggers. */
  loot(player: Player, number: number = 1, reason: "lootStep" | "other" = "other"): void {
    this.game.assert.gameOngoing();
    this.game.assert.positiveNumber(number);

    const n = [number];
    const lootDeck = this.decks["loot"]!;
    this.game.emit("on:loot:would", {
      eventIssuer: player,
      numberOfCards: n,
      reason
    });
    const toLoot = n[0]!;
    this.game.addAnimation({
      id: this.game.nextAnimationId,
      type: "drawLoot",
      nb: toLoot,
      player: player.id,
    })
    if (toLoot > 0)
      for (let i = 0; i < toLoot; i++) {
        const drawnCard: LootCard = lootDeck.draw()!;
        this.addCardToHand(player, drawnCard);
      }
    this.game.emit("on:loot:after", {
      eventIssuer: player,
      numberOfCards: toLoot,
    });
    this.game.dispatch();
  }

  /**
   * Add a card to a player's hand and emit the appropriate event.
   * this.game is the centralized method for all hand additions.
   */
  addCardToHand(player: Player, card: LootCard): void {
    this.ensureEffectsAttached(card);
    card.owner = player;
    player.hand.addToHand(card);
    player.stats.nbLootGained++;

    this.game.dispatch();
    this.game.emit("on:loot:added:after", { eventIssuer: player, card });
    this.game.dispatch();
  }

  /**
   * Remove a card from a player's hand and emit the appropriate event.
   * this.game is the centralized method for all hand removals.
   */
  removeCardFromHand(player: Player, card: LootCard): void {
    player.hand.removeCard(card);
    this.game.dispatch();
    this.game.emit("on:loot:removed:after", { eventIssuer: player, card });
    this.game.dispatch();
  }

  /** Removes and returns a specific loot card from issuer hand. */
  getCardFromHand(player: Player, card: LootCard): LootCard {
    this.game.assert.gameOngoing();
    const lootCard = card;
    const position = player.hand.cards.indexOf(lootCard);
    this.game.assert.positiveNumber(position);

    if (position < 0 || position > player.hand.cards.length) {
      throw new GameError("Invalid card position.", toSerializedTranslation("error.invalidCardPosition"));
    }

    this.removeCardFromHand(player, card);
    return card;
  }

  /** Discards one hand card by index to the loot discard pile. 
   * @return true if the discard was successful.
  */
  discardFromHandAtIndex(player: Player, position: number, reason: "death" | "effect" | "overload" | "other"= "other"): boolean {
    this.game.assert.gameOngoing();
    this.game.assert.positiveNumber(position);
    const hand = player.hand;
    const eventData = { eventIssuer: player, indice: [position], reason };
    position = eventData.indice[0]!;
    this.game.emit("on:loot:discard:before", eventData);
    if (position < 0 || position > hand.cards.length - 1) {
      return false;
    }
    
    const discardedCard: LootCard = hand.cards[position]!;
    this.removeCardFromHand(player, discardedCard);
    const lootDeck = this.decks["loot"]!;
    this.game.addAnimation({
      id: this.game.nextAnimationId,
      type: "discardLoot",
      player: player.id,
      card: discardedCard.jsonAPI,
    })
    lootDeck.addDiscardTop(discardedCard);

    return true;
  }
  /** Steals one specific loot card from target player's hand. */
  stealLootCard(player: Player, target: Player, card: LootCard): string {
    this.game.assert.gameOngoing();

    const position = target.hand.cards.indexOf(card);
    this.game.assert.positiveNumber(position);

    if (position < 0 || position > target.hand.cards.length) {
      throw new GameError("Invalid card position.",  toSerializedTranslation("error.invalidCardPosition"));
    }

    this.removeCardFromHand(target, card);
    this.addCardToHand(player, card);

    return `You have stolen the card: ${card.name} from ${target.id}.\n`;
  }

  /**
   * Transfers a loot card from one hand to another.
   */
  giveCard(from: Player, to: Player, card: LootCard): boolean {
    if (!from.hand.cards.includes(card)) {
      return false;
    }
    this.game.addAnimation({
      id: this.game.nextAnimationId,
      type: "transferLoot",
      sender: from.id,
      recipient: to.id,
      card: card.jsonAPI,
    });

    this.removeCardFromHand(from, card);
    this.addCardToHand(to, card);
    return true;
  }

  handleLootCardEffectResolution(elem: LootCardEffect): void {
    if(this.decks["loot"].discard.includes(elem.card))
      return;
    if(elem.card.afterEffect === "discard")
    {
      this.discard(elem.card);
    }
    if(elem.card.afterEffect === "addInPlay")
      {
        if(!(elem.card.owner instanceof Player))
          throw new GameError("Trinket can only be owned by a player", toSerializedTranslation("error.trinketOwnerByPlayer"));
        this.addInPlay(elem.card.owner, elem.card);
      }
    if(elem.card.afterEffect === "discardNextTime")
      elem.card.afterEffect = "discard";
    }

  /**
   * Returns all player hands paired with their owner.
   */
  allHands(): { player: Player; hand: Hand }[] {
    return this.game.players.map((player) => ({ player, hand: player.hand }));
  }

  /** Replaces a player's hand and returns the previous one. */
  setHand(player: Player, hand: Hand): Hand {
    return player.setHand(hand);
  }
  
////////////////////////////////////// Soul Handler //////////////////////////////////////

  /**
   * Gives a soul card to a player.
   */
  addSoul(player: Player, soulCard: Card): void {
    if (soulCard instanceof BsoulCard && soulCard.granted === false)
    {
      soulCard.granted = true;
    }
    soulCard.setEternal(false);
    const eventData = { eventIssuer: player, soul: soulCard };
    this.game.emit("on:soul:gained:before", eventData);
    if(eventData.soul === null)
      return;
    if (soulCard instanceof BsoulCard && soulCard.granted === false)
    {
      this.game.addAnimation({
        id: this.game.nextAnimationId,
        type: "obtainBonusSoul",
        card: soulCard.jsonAPI,
        player: player.id,
      });
    }
    player.addSoul(soulCard);
    this.game.emit("on:soul:gained", eventData);
    this.game.dispatch();
  }

  /**
   * Transfers a soul card from a target player to another player.
   */
  stealSoul(player: Player, target: Player, soul: Card): void {
    if (!target.targetableSouls.includes(soul)) {
      throw new GameError("Target player does not have the specified soul.", toSerializedTranslation("error.targetPlayerDoesNotHaveSoul"));
    }
    this.removeSoul(target, soul);
    this.addSoul(player, soul);
  }
  /** Removes a soul card from player and runs cleanup triggers. */
  removeSoul(player: Player, card: Card): boolean {
    const result = player.removeSoul(card);
    if(result)
      {
        card.cleanup();
        this.game.emit("on:soul:removed", { eventIssuer: player, card });
      }
    return result;
  }

////////////////////////////////////// Card Effect Manipulation //////////////////////////////////////

  attachFlipEffectsToCard(card: Card): void {
    if(card.flipData === undefined)
      throw new GameError("attachFlipEffectsToCard should only be called on cards with flip data.", toSerializedTranslation("error.behaviorError", {error: "attachFlipEffectsToCard should only be called on cards with flip data."}));
    
    if(card.flipData.rewards !== undefined)
    {
      const originalRewards = card.json.rewards;
      const flippedRewards = card.flipData.rewards;
      card.addFlipEffect(() => {
          card.json.rewards = card.flipped ? flippedRewards : originalRewards;
      });
    }
    if(card.flipData.stats !== undefined && card.json.stats !== undefined) // Entity changes stats.
      {
        const originalStats = card.json.stats;
        const flippedStats = card.flipData.stats;
        const differenceHP = (flippedStats.healthPoints ?? 0) - (originalStats.healthPoints ?? 0); 
        const differenceAttack = (flippedStats.attackPoints ?? 0) - (originalStats.attackPoints ?? 0);
        const differenceEvasion = (flippedStats.evasionPoints ?? 0) - (originalStats.evasionPoints ?? 0);
        if((flippedStats.evasionPoints === undefined) !== (originalStats.evasionPoints === undefined))
          throw new GameError("Cards adding or removing evasion as a stat not supported.", toSerializedTranslation("error.behaviorError", {error: "Cards adding or removing evasion as a stat not supported."}));

        card.addFlipEffect(() => {
          if(!card.flipped)
          {
            this.game.entityHandler.addHealth(card.owner, -differenceHP, "flip");
            this.game.entityHandler.addAttack(card.owner, -differenceAttack, "flip");
            if(flippedStats.evasionPoints !== undefined && card.owner instanceof Monster)
              this.game.entityHandler.addDC(card.owner, -differenceEvasion, "flip"); 
          }
            else
            {
              this.game.entityHandler.addHealth(card.owner, differenceHP, "flip");
              this.game.entityHandler.addAttack(card.owner, differenceAttack, "flip");
              if(flippedStats.evasionPoints !== undefined && card.owner instanceof Monster)
                this.game.entityHandler.addDC(card.owner, differenceEvasion, "flip");
            }
        });
      }
      else if(card.flipData.stats !== undefined || card.json.stats !== undefined)// create animated entity.
      {
        card.addFlipEffect(() => {
          if(!card.flipped)
          {
            card.json.stats = card.json.stats;
          }
          else
          {
            card.json.stats = card.flipData!.stats!;
          }
        });
      }
    const originalEffects = card.json.effectOutcome || [];
    const newEffects = card.flipData!.effectOutcome;
    const flipData = card.flipData;
    card.flipData = undefined; // to avoid confusion, as the json is not updated on flip after initialization.
    card.swapEffectInterfaces();
    card.effectOutcomes = newEffects;
    this.attachEffectsToCard(card);
    card.effectOutcomes = originalEffects;
    card.flipData = flipData;
    card.swapEffectInterfaces();
    card.addFlipEffect(() => {
      card.effectOutcomes = card.flipped ? newEffects : originalEffects;
      card.cleanup();
      card.swapEffectInterfaces();
      card.onAddInPlay(() => card.owner);
    });
  }

  /**
   * Parses and attaches all effects from a card's effect outcomes.
   * @param card - The card to attach effects to
   * @param attachFlip - Whether to attach flip effects. Set to false only by parsing flipped cards.
   */
  attachEffectsToCard(card: Card, force: boolean = false): void {
    if (!force && this._effectsAttached.has(card))
      return;

    const flipped = card.flipped;
    for (let idx = 0; idx < card.effectOutcomes.length; idx++) {
      let outcome = card.effectOutcomes[idx]!;
      if(card.subtype === "curse" && !outcome.startsWith("[Curse]") && idx === 0)
        outcome = "[Curse] " + outcome;
      const effectType = this.getEffectTypeFromOutcome(outcome, card);
      // Handle paid effects separately to extract payment and effect functions
      if (effectType === "paid") {
        const s2 = outcome
          .replace("[paid effect] ", "")
          .replace("[Paid Effect] ", "")
          .trim();
        const idxSplit = s2.indexOf(":");

        if (idxSplit === -1) {
          throw new GameError(
            `Invalid paid effect format (missing ':'): ${outcome}`,
            toSerializedTranslation("error.parsingError", {error: `Invalid paid effect format (missing ':'): ${outcome}`})
          );
        }

        const paymentString = s2.substring(0, idxSplit).trim();
        const effectString = s2.substring(idxSplit + 1).trim();

        const paymentParsed = effectParser(paymentString, this.game);
        const effectParsed = effectParser(effectString, this.game);

        const effect: Effect = new Effect(
          outcome,
          effectType,
          card,
          effectParsed.effectFunction,
          [...paymentParsed.targetSelectors, ...effectParsed.targetSelectors],
          card.getEffectRange(idx),
          paymentParsed.effectFunction,
        );
        card.addEffect(effect);
      } else if(effectType === "active") {
        // Regular effects (passive/active)
        const parsed = effectParser(outcome, this.game, card instanceof MonsterCard);
        const effect: Effect = new Effect(
          outcome,
          effectType,
          card,
          parsed.effectFunction,
          parsed.targetSelectors,
          card.getEffectRange(idx),
        );
        card.addEffect(effect);
      }
      else
      {
        const parsed = syncEffectParser(outcome, this.game);
        if(parsed === null)
        {
          console.log(`Effect parsing failed for card ${card.name} (slug: ${card.slug}) with outcome: ${outcome}`);
          return;
        }
        const effect: Effect = new PassiveEffect(
          outcome,
          effectType,
          card,
          parsed.effectFunction,
          parsed.targetSelectors,
          card.getEffectRange(idx),
        );
        card.addEffect(effect);
      }
    }
    
    if(card.flipData !== undefined)
      this.attachFlipEffectsToCard(card);

    this._effectsAttached.add(card);
  }

  /** Attach a card's effects once, at the point where it becomes usable. */
  ensureEffectsAttached(card: Card): void {
    // Bonus souls use their own event-listener parser and must never be sent
    // through the ordinary card effect parser.
    if (card instanceof BsoulCard)
      return;
    if (!this._effectsAttached.has(card))
      this.attachEffectsToCard(card);
  }

  async replaceCharacter(player: Player, newCharacter: CharacterCard, triggerFindNewEternalIfUndefined: boolean = true): Promise<void> {
     // Remove the current character + starting item (both are eternal, so we cannot use removeInPlay()).
    const oldCharacter = player.character;
    const oldStartingItem = player.inPlay[0]!;
    
    const copyNewChara = this.copyCard(newCharacter) as CharacterCard;
    copyNewChara.onAddInPlay(() => player);
    
    oldCharacter.cleanup();
    if(oldStartingItem !== undefined && oldStartingItem.eternal === true)
    {
      oldStartingItem.cleanup();
    }
    player.character = copyNewChara;
    
    const newStartingItemSlug = newCharacter.eternalCard;
    const eternalTemplate = newStartingItemSlug === null
      ? undefined
      : this._decks.eternal._set.cards.find((card) => card.slug === newStartingItemSlug);
    const newStartingItem = eternalTemplate === undefined
      ? undefined
      : this.copyCard(eternalTemplate) as ItemCard;

    if(newStartingItem === undefined)
    {
      if(triggerFindNewEternalIfUndefined)
      {
        await selectEternalAmongX(this.game, 3)(new EffectData(newCharacter, () => player, []));
        player.inPlay[0] = player.inPlay[player.inPlay.length - 1]!;
        player.inPlay.pop();
      } 
    }
    else{
      newStartingItem.onAddInPlay(() => player);
      player.inPlay[0] = newStartingItem!;
    }
  }

  /**
   * Returns a reference to the copied card.
   * @param issuer 
   * @param gainer 
   * @param toCopy 
   * @returns 
   */
  gainAbilities(issuer: Player, gainer: ItemCard, toCopy: ItemCard): ItemCard {
    // Implementation for gaining abilities
    if(gainer.tags.copiedCards === undefined)
        gainer.tags.copiedCards = [];
    if(toCopy.json.stats !== undefined)
      gainer.json.stats = toCopy.json.stats;
    // console.log("Gaining abilities from ", toCopy.name, " to ", gainer.name);
    const copiedSelector: TargetsSelector = {
        description: toSerializedTranslation("selector.cardGranted"),
        selector: (player: Player) => ((gainer.tags.copiedCards as ItemCard[]).filter((c) => c.activeEffectList.length > 0)),
        min: 1,
        max: 1,
    };
    // Create an active effect selecting one of the copied cards and one of its effects.
    if(!(gainer.hasTapEffect()))
    {
      gainer.canBeActivated = true;
        gainer.addEffect(new Effect("Choose a card to use its effect.",
            "active",
            gainer,
            async (effectData: EffectData) => {
              const effectIssuer = effectData.issuer;
                if(effectIssuer instanceof Player === false)
                    throw new GameError("Effect issuer must be a player.", toSerializedTranslation("error.effectIssuerMustBePlayer"));
                if(effectIssuer.inPlay.includes(gainer) === false)
                  return false; // the card must be still in play to use its effect.
                const card = effectData.next;
                if(!(card instanceof ItemCard)) {
                    throw new GameError("gainAbilitiesUntilEffect target must be an ItemCard.", toSerializedTranslation("error.behaviorError", {error: "gainAbilitiesUntilEffect target must be an ItemCard."}));
                }
                if(!(gainer.tags.copiedCards as ItemCard[]).includes(card)) {
                  return false;
                    throw new GameError("You can only choose cards granted by this effect.", toSerializedTranslation("error.canOnlyChooseCardsGrantedByGameEffect"));
                }
                card.owner = effectIssuer;
                const effectsWithValidTargets = card.activeEffectList.filter(e => {
                    if(TargetBuilder.validTargetExists(this.game, effectIssuer, card, e.index, e.visualEffectBox.startIndex) !== true) return false;
                    return (e.index === "tap" || TargetBuilder.verifyPaiementCanBeMade(this.game, effectIssuer, card, e.description) === true);
                });
                if(effectsWithValidTargets.length === 0)
                    return false;
                const effect = (await effectData.selectAndRecord(this.game, effectIssuer, 1, 1, effectsWithValidTargets.map(e => {return {...(e), card: card}}), toSerializedTranslation("pending.effect"), effectData.serializedCardAndBox, true)).selected[0]!;
                const effectType = effect?.index;
                if(effectType === undefined) {
                    throw new GameError(`Selected effect "${effect.description}" not found on the card ${card.name}.`, toSerializedTranslation("error.behaviorError", {error: `Selected effect "${effect.description}" not found on the card ${card.name}.`}));
                }
                const { effectId, choice } = card.getEffectIdAndChooseOneChoiceFromSeparatorId(effect.visualEffectBox.startIndex);

                let partialChoices: any[] = [];
                if(choice !== undefined) {
                  partialChoices = [...choice.map(c=>{return {type: "chooseOne" as const, payload: c}})];
                }
                const targets =  await TargetBuilder.buildTargetsOnResolve(this.game, effectIssuer, card, effectId, partialChoices);
                card.recharge();
                const effectOnStack = await card.tryActivateEffect(targets, effectId);
                this.game.addToStack(effectOnStack);

                // triger all tap effects.
                if(effect.index === "tap")
                  for(const activeItem of copiedSelector.selector(issuer, gainer) as ItemCard[])
                    if(card !== activeItem && activeItem.hasTapEffect() && TargetBuilder.validTargetExists(this.game, effectIssuer, activeItem, "tap") === true)
                    {
                      const targets =  await TargetBuilder.buildTargetsOnResolve(this.game, effectIssuer, activeItem, effectId);
                      activeItem.recharge();
                      const effectOnStack = await activeItem.tryActivateEffect(targets, effectId);
                      this.game.addToStack(effectOnStack);
                    }
                return true;
            }
        ,[copiedSelector], [{startIndex: 0, endIndex: 0, description: "Choose a card to use its effect."}]
    ));
    }
    const copied = this.copyCard(toCopy, issuer) as ItemCard;
    copied.parentCard = gainer.slug;
    copied.tags.copiedFrom = toCopy;
    gainer.tags.copiedCards.push(copied);
    copied.onAddInPlay(() => issuer);
    gainer.entity = copied.entity;
    for (const counterType of copied.counters.counterOwned) {
      gainer.counters.addToCounter(copied.counters.value(counterType), counterType);
    }
    const offCopiedCounterChange = this.game.emitter.on("on:counter:modified", ({ card, counterName, newValue, previousValue }) => {
      if (card !== copied) return;
      this.addToCounter(issuer, gainer, counterName, newValue - previousValue);
    });
    gainer.cleaners.push(() => {  
      offCopiedCounterChange();
      for (const counterType of copied.counters.counterOwned) {
        this.addToCounter(issuer, gainer, counterType, -copied.counters.value(counterType));
      }
      if (gainer.entity === copied.entity) gainer.entity = undefined;
      copied.parentCard = null;
      copied.cleanup();
      copied.parentCard = gainer.slug;
      gainer.tags.copiedCards = (gainer.tags.copiedCards as ItemCard[]).filter(c => c !== copied);
    });
    
    copied.cleaners.push(() => {
        if(copied.parentCard === gainer.slug)
          this.game.cardHandler.destroyCardsOrSouls([gainer]);
    });
    return copied;
  }

  /**
   * Creates a copy of a card by reconstructing it from its JSON definition.
   * The copy is built from scratch with all effects parsed and attached.
   * @param card - The card to copy
   * @returns A new card instance with the same properties and effects
   */
  copyCard(card: Card, owner: Player | null = null): Card {
    const json = card.json;

    // Create the appropriate card type using the helper function
    this.decks[card.type]._set.addCard(json, this.allocateCardGlobalId());
    const copiedCard = this.decks[card.type]._set.get(this.decks[card.type]._set.length - 1);
    // Parse and attach effects to the copied card
    this.attachEffectsToCard(copiedCard);
    this.registerCard(copiedCard);
    if(owner) {
      copiedCard.owner = owner;
    }
    copiedCard.canBeDiscarded = false;
    return copiedCard;
  }

  private allocateCardGlobalId(): number {
    return this._nextCardGlobalId++;
  }
}