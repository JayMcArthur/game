import {
  BsoulCard,
  Card,
  CharacterCard,
  ItemCard,
  LootCard,
  MonsterCard,
  TreasureCard
} from "@/models/cards";
import { AttackRollData, DiceWillRoll, EffectOnStack, EndOfTurnOnStack } from './stackElement';
import { CurrentPlayerDecidesToChangeRoom, getAttackRollEffect } from "@/models/effects/activeEffect";
import { Entity } from "@/models/entities/entity";
import { Monster } from "@/models/entities/monster";
import { Player } from "@/models/entities/player";
import { Stack, type StackElement } from "@/models/stack";
import { DiceRoll, LootStepOnStack } from "@/models/stackElement";
import type { DeckType, DecksCollection } from "@/models/types/cardTypes";
import { EffectData } from "@/models/types/cardTypes";
import { type LoseCoinsReason, type TriggerEvent } from '@/models/types/eventTypes';
import type { Animation, DetailedState, GameOverBroadcast, PendingSelectionReason, SelectionItem, SerializedTranslation, StackElementJson, Team } from "@/shared/api";
import { shuffle } from "@/utils/auxiliary";
import { generateAnimationId } from "@/utils/random";
import { Signal, type ReadableSignal } from "micro-signals";
import { addPassiveEffectToStack } from "./effects/passiveEffect";
import { AnimatedList } from "./entities/animated";
import { GameEventEmitter } from "./eventEmmitter";
import { GameParameters } from "./gameParameters";
import { GameStateSerializer } from "./gameStateSerializer";
import { ActionHandler } from "./handlers/actionHandler";
import { AssertHandler } from "./handlers/assertHandler";
import { CardHandler } from "./handlers/cardHandler";
import { EntityHandler } from "./handlers/entityHandler";
import { HistoricHandler, type HistoricEntry } from "./handlers/historyHandler";
import type { ServerRoomBroadcast } from "./roomBroadcast";
import { SelectionHandler, type PendingSelection } from "./handlers/selectionHandler";
import { Encounters } from "./slots/encounters";
import { Rooms } from "./slots/rooms";
import { Shop } from "./slots/shop";
import { TurnHandler } from "./handlers/turnHandler";
import { miniDraft } from "./variants";
import { toSerializedTranslation } from "@/utils/translation";
import { GameError } from "@/models/GameError";
import { getTitles } from "./gameStats";

/*
 * The Game class is the central hub of the game logic, managing the state of the game, players, monsters, decks, shop, encounters, stack, and more. 
 * It also handles all player actions such as declaring attacks, dealing damage, resolving deaths, and managing the game history. 
 */
export class Game {
  private _turnHandler: TurnHandler = new TurnHandler(this);
  private _random: () => number = () => {throw new GameError("Random generator not initialized yet.", 
    toSerializedTranslation("error.behaviorError", {error: "Random generator not initialized yet."}))
  };
  private _seed: string = "";
  private _shop!: Shop;
  private _encounters!: Encounters;
  private _rooms!: Rooms;
  private _timerIsUsed = false; // true if the timer option is active.
  private _stack: Stack = new Stack(this);
  private _emitter: GameEventEmitter;
  private _stackSubsetCallbacks: {stackIds: number[], callback: () => void}[] = [];
  private _historicHandler: HistoricHandler = new HistoricHandler(this);
  private _gameOver: boolean = false;
  private _isWon: boolean = false;
  private _gameStateSerializer: GameStateSerializer;
  readonly gameParameters = new GameParameters(() => this.dispatch());
  readonly _assertHandler: AssertHandler = new AssertHandler(this);
  readonly _actionHandler = new ActionHandler(this);
  private _entityHandler = new EntityHandler(this);
  private _selectionHandler = new SelectionHandler(this);
  private _cardHandler = new CardHandler(this);
  private _promises: Promise<boolean>[] = [];
  _playersWithRandomCharacter: Player[] = [];

  private _onStateChange: Signal<void> = new Signal();
  onStateChange: ReadableSignal<void> = this._onStateChange.readOnly();

  private _onRoomBroadcast: Signal<ServerRoomBroadcast> = new Signal();
  onRoomBroadcast: ReadableSignal<ServerRoomBroadcast> = this._onRoomBroadcast.readOnly();

  private _onEndReached: Signal<GameOverBroadcast> = new Signal();
  onEndReached: ReadableSignal<GameOverBroadcast> = this._onEndReached.readOnly();

  constructor(seed: string = "", gameParameters?: GameParameters) {
    this.seed = seed; // if seed is empty, it will be set to a random value.
    this._emitter = new GameEventEmitter();
    this._gameStateSerializer = new GameStateSerializer(this);
    if(gameParameters !== undefined)
      this.gameParameters.loadFromJson(
        gameParameters.toJson(),
        gameParameters.deckMode,
      );
  }
////////////////////////////////////// Getters //////////////////////////////////////

/*
 * Check if that game is started.
 */
  get isStarted(): boolean {
    return this._turnHandler.isInitialized;
  }
  /**
   * Returns the list of entities currently engaged in combat. 
   */
  get entitiesInCombat(): readonly Entity[] {
    // Return a defensive copy so external code cannot mutate combat state.
    return this.entityHandler.entitiesInCombat;
  }
  get entityHandler(): EntityHandler {
    return this._entityHandler;
  }
  get cardHandler(): CardHandler {
    return this._cardHandler;
  }
  private get promises(): Promise<boolean>[] {
    return this._promises;
  }
  async awaitPromises(): Promise<void> {
    for (const p of this.promises)
    {
      await p;
    }
    this._promises = [];
    await this.resolveCallbacks();
  }
  addPromise(promise: Promise<boolean>): void {
    this._promises.push(promise);
  }
  get turnHandler(): TurnHandler {
    return this._turnHandler;
  }
  get reachedEnd(): boolean {
    return this._isWon;
  }
  get actions(): ActionHandler {
    return this._actionHandler;
  }
  get players(): Player[] {
    return this.entityHandler.players;
  }
  get emitter(): GameEventEmitter {
    return this._emitter;
  }
  get monsters(): Monster[] {
    return this._encounters.monsters;
  }
  get decks(): DecksCollection {
    return this.cardHandler.decks;
  }
  get shop(): Shop {
    return this._shop;
  }
  get timerIsUsed(): boolean {
    return this._timerIsUsed;
  }
  get encounters(): Encounters {
    return this._encounters;
  }
  get rooms(): Rooms | undefined {
    return this._rooms;
  }
  get outsideGameCards(): Card[] {
    return this.cardHandler.outsideGameCards;
  }
  get cardMapping(): ReadonlyMap<number, Card> {
    return this.cardHandler.cardMapping;
  }
  get stack(): Stack {
    return this._stack;
  }
  get playersAndMonsters(): Entity[] {
    return this.entityHandler.playersAndMonsters;
  }
  set isGameOver(value: boolean){
    this._gameOver = value;
  }
  get isGameOver(): boolean{
    return this._gameOver;
  }

  get assert(): AssertHandler {
    return this._assertHandler;
  }

  get entities(): Entity[] {
    return this.entityHandler.entities;
  }

  get isEndPhase(): boolean {
    return this.stack.elements.some((e) => e instanceof EndOfTurnOnStack);
  }

  get currentPlayer(): Player {
    return this.turnHandler.current;
  }
  /**
   * @param direction the direction to look for a player
   * @returns the player to the left or right of the current player
   */
  getPlayerToThe(direction: "left" | "right"): Player {
    return this.turnHandler.getPlayerTo(this.currentPlayer, direction);
  }
  /**
   * @returns the game history, excluding private data entries
   */
  get history(): StackElementJson[] {
    return this._historicHandler.history;
  }
  /**
   * @returns the game history, including private data entries
   */
  get log(): HistoricEntry[] {
    return this._historicHandler.log(this);
  }
  /**
   * @returns the active RNG seed used to initialize the current game generator.
   */
  get seed(): string {
    return this._seed;
  }

  get inPlayItems(): { player: Player; card: ItemCard }[] {
    return this.players.flatMap(p => p.inPlay.map(c => ({player: p, card: c})));
  }

  get inPlayCurses(): { player: Player; card: MonsterCard }[] {this.players.flatMap(p => p.curses.map(c => ({player: p, card: c})));
    return this.players.flatMap(p => p.curses.map(c => ({player: p, card: c})));
  }
  /**
   * @returns the list of animated entities in the game.
   * This includes alive entities that are not monsters nor players.
   */
  get animatedList(): AnimatedList {
    return this.entityHandler.animatedList;
  }

  get attackableEntities(): Entity[] {
    return [...this.playersAndMonsters.filter(e => e.attackable === true), ...this.animatedList.all.filter(e => e.attackable)];
  }
  /**
   * @returns all visible treasure and trinkets: each players inPlay and the shop items.
   */
  get visibleItems(): ItemCard[] {
    return this.cardHandler.visibleItems;
  }
  get nextAnimationId(): string {
    return generateAnimationId();
  }
  get deckNames(): DeckType[] {
    return this.cardHandler.deckNames;
  }
  get monsterSlots(): Encounters {
    return this.encounters;
  }
  get playersWithMostSouls(): Player[] {
    return this._entityHandler.playersWithMostSouls
  }
  get bonusSouls(): BsoulCard[] | undefined {
    return this.cardHandler.bonusSouls;
  }
  getRollbackLog(player: Player): HistoricEntry[] {
    if(!this.gameParameters.allowCheatOptions.value && this._historicHandler.lastUserRequestIssuer === player.id)
      throw new GameError("Cheat options are not allowed in this game. You can only rollback other players' actions.",
    toSerializedTranslation("error.cheatOptionsNotAllowed"));
    const logs = this._historicHandler.rollbackLog;
    return logs;
  }
  /**
   * Finds the owner of a soul or in-play item card.
  */
 getOwner(item: Card, type: "inplay" | "soul" | "any" = "any"): Player | null {
   return this.cardHandler.getOwner(item, type);
  }
  
  getCardByGlobalId(globalId: number): Card | undefined {
    return this.cardHandler.getCardByGlobalId(globalId);
  }
  ////////////////////////////////////// Selection Handler //////////////////////////////////////
  get hasPendingSelections(): boolean {
    return this._selectionHandler.hasPendingSelections;
  }
  
  get pendingMultipleSelections(): Map<number, PendingSelection> {
    return this._selectionHandler.pendingMultipleSelections;
  }

  setSelectionHandlerNextId(id: number){
    this._selectionHandler.setSelectionHandlerNextId(id);
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
    return this._selectionHandler.select(player, min, max, Options, description, reason, skippable, canUseOnBoardSelection);
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
    this._selectionHandler.submitSelection(player, requestId, selectedIdentifiers);
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
    return this._selectionHandler.selectMultiple(selections);
  }
////////////////////////////////////// Seeded random //////////////////////////////////////

  set seed(seed: string) {
    if (seed === "") {
      seed = crypto.randomUUID(); // generate a random seed if none is provided
    }
    this._seed = seed;
    if(this._historicHandler.lastEntry === undefined || 
        this._historicHandler.lastEntry?.type !== "randomSeed" || 
        this._historicHandler.lastEntry.seed !== seed)
    this._historicHandler.addToHistory({ private: true, type: "randomSeed", seed: seed });
    this._random = require("seedrandom")(this._seed);
  }
  /**
   * Seeded random number generator for reproducible randomness in effects, dice rolls and shuffling.
   */
  random = (): number => {
    return this._random();
  }

////////////////////////////////////// Dice Roll //////////////////////////////////////
/** Creates a dice roll stack element and emits pre-roll triggers. */
  rollDice(player: Player, data: Card | AttackRollData): DiceRoll {
    this.assert.gameOngoing();
    if (data instanceof AttackRollData) this.assert.isAlive(player);

    const diceRoll = player.rollDice(this.random, data);
    const rollOnStack = () => {
      diceRoll.roll(); // Roll again so that rollback roll after DiceWillRoll changes value
      this.addAnimation({
        id: this.nextAnimationId,
        type: "diceRoll",
        player: player.id,
        diceRoll: diceRoll.value,
      })
      this.addToStack(diceRoll);
      this.emit("on:dice:being-rolled", { eventIssuer: player, diceRoll });
    }
    if(this.cardHandler.shouldUseDiceWillRoll()){
      const willRoll = new DiceWillRoll(diceRoll, rollOnStack);
      this.addToStack(willRoll);
    }else
      rollOnStack();
    return diceRoll;
  }

  async resolveAttackRoll(dice: DiceRoll): Promise<void> {
    if(!dice.attackRoll)
      return;
    if (dice.issuer.attackRollThisTurn === 1)
      this.emit("on:attack:roll:first-time-each-turn", {
        eventIssuer: dice.issuer,
        target: dice.attackTarget,
        dice,
      });
    this.emit("on:attack:roll:modifier", {
      eventIssuer: dice.issuer,
      target: dice.attackTarget,
      dice,
    });
    dice.attachEffect(
      getAttackRollEffect(
        dice,
        this
      ),
      dice.attackTarget.card,
      [dice.attackTarget]
    );
    await dice.onResolve();
    this.emit("on:attack:roll", {
      eventIssuer: dice.issuer,
      target: dice.attackTarget,
      dice,
    });
  }
  async resolveDiceRoll(): Promise<void> {
    const turnId = this.turnHandler.turnId;
    const stackIds = this.stack.currentStackIds;
    const elem = this.stack.peek() as DiceRoll;
    if (!elem || !(elem instanceof DiceRoll)) return;

    elem.readyToResolve = true;
    this.emit("on:dice:would-roll", { eventIssuer: elem.issuer, diceRoll: elem });
    await this.executeWhenStackSubset(stackIds, async () => {
      // If the value has changed, the roll stays in the stack.
      
      if (elem.readyToResolve === false)
        {
          this.dispatch();
          return;
        }
        this.stack.resolve();
        this.emit("on:roll:modifier", { eventIssuer: elem.issuer, diceRoll: elem });
        
        if(elem.attackRoll)
          await this.resolveAttackRoll(elem);
        else
          await elem.onResolve();
        // Add to history
        this.addToHistory(elem.json);
        this.dispatch();
        await this.resolveCallbacks();
        if(elem.fizzled)
          return;
        if(this.turnHandler.turnId !== turnId) // some dice roll may end the turn.
          return;
        this.emit("on:dice:resolved", { eventIssuer: elem.issuer, dice: elem });
        if(elem.attackRoll)
          elem.issuer.stats.nbAttackRolledValues[elem.value - 1]! += 1;
        else
          elem.issuer.stats.nbNonAttackRolledValues[elem.value - 1]! += 1;
        await this.resolveCallbacks();
    });
  }

////////////////////////////////////// Game Initialization, Win and Reset //////////////////////////////////////

  /**
   * Starts the game lifecycle and executes initial setup.
   */
  async start(players: { issuer: string; character: string; user?: string, team: Team }[], shufflePlayerOrder: boolean = true): Promise<void>{

    if(!this.turnHandler.isInitialized)
      this.startOfGameSetup(players, shufflePlayerOrder);
    await this.atGameStartDecisions();
  }

  /**
   * Distributes starting resources to each player.
   */
  startOfGameSetup(players: { issuer: string; character: string; user?: string, team: Team }[], shufflePlayerOrder: boolean = true): void {
    this.assert.gameNotStarted();
    for (const p of players) 
      this.entityHandler.addPlayer(new Player(p.issuer, p.team, p.user));
    this._playersWithRandomCharacter = players.filter((p) => p.character === "random").map((p) => this.players.find((player) => player.id === p.issuer)!);
    const chara = this.cardHandler.getCharactersFromSlugs(players.map((p) => p.character));
    this.cardHandler.assignCharactersToPlayers(chara);

    this.assert.minimumPlayerCount();
    this._selectionHandler.clearPendingSelections();
    if (shufflePlayerOrder) {
      shuffle(this.random, this.players);
    }
    this.turnHandler.initialize(this.players);
    this._historicHandler.recordInitialGameState(this);
    
    this.initializeWinningCondition();
    if(this.gameParameters.timer.value > 0)
      this._timerIsUsed = true;
    this.cardHandler.initializeBonusSouls();
    this._shop = new Shop(
      this.gameParameters.nbItemsInShop.value,
      this.gameParameters.shopPrice.value,
      this.decks["treasure"]
    );
    this._encounters = new Encounters(
      this.gameParameters.nbEncounters.value,
      this.decks["monster"],
      this
    );
    this.gameParameters.playWithRooms.value = this.gameParameters.playWithRooms.value && this.decks["room"] !== undefined && this.decks["room"]._order!.length > 0;
    // fill empty spot may call game.encounters, so it must be called after this._encounters initialization.
    this._encounters.fillEmptySpots(true);
    // initialize resources here so room laser eye does not deal damage before the first turn starts.
    for (const player of this.players) {
      this.gainTreasure(player, this.gameParameters.treasuresOnStart.value);
      this.loot(player, this.gameParameters.lootOnStart.value);
      this.gainCoins(player, this.gameParameters.coinsOnStart.value, "gift");
    }
    if(this.gameParameters.playWithRooms.value === true)
    {
      this._rooms = new Rooms(
        this.gameParameters.nbRooms.value,
        this.decks["room"]!,
        this
      );
    }
  } 
  /**
   * Select character cards when eternal should also be displayed. This is used for the mulliganCharacters method, as well as for the clicket effect.
   * @param game 
   */
  async selectRawCharacterAmong(characters: CharacterCard[], player: Player, min: number, max: number): Promise<{ selected: CharacterCard[]; remaining: CharacterCard[] }> {
    const selectionItem: SelectionItem[] = characters.map((card) => ({type: "character", payload: { character: card.slug, eternal: card.eternalCard || "random" }}));
    return this.select(player, min, max, selectionItem, toSerializedTranslation("startStep.playerList.selectCharacterButton.popup.title"), "mulliganCharacters", true, false).then((result) => {
      return { selected: result.selected.map((item) => characters.find((card) => item.type === "character" && card.slug === item.payload.character)!),
         remaining: result.remaining.map((item) => characters.find((card) => item.type === "character" && card.slug === item.payload.character)!)};
    });
  }

  async mulliganCharacters(): Promise<void> {
    this._playersWithRandomCharacter;
    for(let nbOptions = this.gameParameters.mulliganCharacterNbOptions.value; nbOptions > 0 && this._playersWithRandomCharacter.length > 0; nbOptions--)
        {
            const minVal = nbOptions === 1 || !this.gameParameters.mulliganCharacterReroll.value ? 1 : 0;
            let currentUnresolvedPlayers = [...this._playersWithRandomCharacter];
            let toPutBack: CharacterCard[] = [];
            
            const promises = [];
            for( const player of currentUnresolvedPlayers) {
                const availableCharacters = this.decks.character.length + this.decks.character.discard.length;
                const numberToDraw = Math.min(nbOptions, availableCharacters);
                if (numberToDraw === 0)
                  continue;
                const drawn: CharacterCard[] = this.decks.character.drawSeveral(numberToDraw);
                promises.push({player: player, selection: this.selectRawCharacterAmong(drawn, player, minVal, 1)});
            }
            const pairs = await Promise.all(promises.map(async (p) => ({player: p.player, selection: await p.selection})));
            for(const pair of pairs) {
                const player = pair.player;
                const card = pair.selection.selected[0];
                if(card !== undefined) {
                    await this.cardHandler.replaceCharacter(player, card, false);
                    this._playersWithRandomCharacter.splice(this._playersWithRandomCharacter.indexOf(player), 1);
                }
                toPutBack.push(...pair.selection.remaining);
            }
            for(const card of toPutBack) {
                this.decks.character.addBottomPosition(card);
            }
            this.decks.character.shuffle();
            this.dispatch();
        }
    this.dispatch();
    return;
  }

  async atGameStartDecisions(): Promise<void> {
    await this.mulliganCharacters();
    // No user interaction on this trigger, use on:game:stat. This is for Cain.
    this.emit("on:game:start:before", {});
    this.assignColorsToPlayers();
    this.entityHandler.healEveryone();
    this.emit("on:game:start", {}); // Eden starting item choice
    if(this.gameParameters.miniDraft.value)
      miniDraft(this); // Add resolutions to game.promises.
    await this.awaitPromises();
    await this.executeWhenStackEmpty(async () => {
      await this.startTurn();
    });
    // this.DEBUG_startOfGameSetup();
  }

  DEBUG_startOfGameSetup() {
    if(false)
      return;
    
    const card0 = this.obtainCard("r-golden_trinket") as LootCard;
    this.cardHandler.addCardToHand(this.currentPlayer, card0);
    for( const slug of ["fsp2-abaddon", "b2-bum_friend", "b2-pandoras_box"])
    {   
        const card1 = this.obtainCard(slug) as ItemCard;
        this.cardHandler.addInPlay(this.currentPlayer, card1);
    }
    // // this.cardHandler.addInPlay(this.currentPlayer, card);
    const card = this.obtainCard("r-peeping_fatty") as MonsterCard;
    this.encounters.forceSetMonsterAtSlot(0, card);
    this.entityHandler.kill(this.currentPlayer, this.monsters[0]!, {card: card, visualEffectBox: {startIndex: 0, endIndex:0}}) 
  }

  initializeWinningCondition(): void {
    let offSoulGained: (() => void) | null = null;
        offSoulGained = this.emitter.on("on:soul:gained", ({ eventIssuer }) => {
          let teamSouls = 0;
          this.players.filter(p=>p.team === eventIssuer.team).forEach(p => teamSouls += p.totalSouls);
          if(teamSouls >= this.gameParameters.nbSoulsToWin.value)
          {
              this.win(eventIssuer);
              offSoulGained!();
              offSoulGained = null;
          }
      });
    }

  assignColorsToPlayers(): void {
    const colors = [
      "#E6E420", "#AE6DFA", "#17E6C9", "#FF6B2D"];
    if(this.players.length > colors.length)
      throw new GameError("Too many players.",
        toSerializedTranslation("error.tooManyPlayer"));
    for (let i = 0; i < this.players.length; i++) {
      this.players[i]!.color = colors[i % colors.length]!;
    }
  }

  win(player: Player | null): void {
    if(this._isWon)
      return;
    this._isWon = true;
    this._onEndReached.dispatch(
      this._gameStateSerializer.serializeEndGame(player?.team ?? null)
    );
    for(const p of this.players)
      console.log(`player: ${p.id}, stats: ${JSON.stringify(p.stats)}`);
    getTitles(this.players);
  }

  /**
   * Resets the full game state to a fresh pre-start state.
   */
  reset(newSeed: boolean = true): void {
    this._historicHandler = new HistoricHandler(this);
    this._turnHandler = new TurnHandler(this);
    this._entityHandler = new EntityHandler(this);
    this._cardHandler = new CardHandler(this);
    this.seed = (newSeed ? "" : this.seed); // If newSeed is true, set to a random value in the setter.
    this._shop = undefined!;
    this._encounters = undefined!;
    this._rooms = undefined!;
    this.resetStack();
    this._promises = [];
    this._emitter = new GameEventEmitter();
    this._selectionHandler.resetPendingSelections();
    this._stackSubsetCallbacks = [];
    this._isWon = false;
  }

////////////////////////////////////// Turn Structure //////////////////////////////////////

  /**
   * Initializes turn counters and emits turn-start triggers.
   */
  async startTurn(): Promise<void> {
    this.players.forEach((p) => {
      p.initializeTurnCounters(p === this.currentPlayer);
    });
    for(const room of this.rooms?.activeRooms ?? [])
    {
      room.owner = this.currentPlayer;
    }
    this.entityHandler.monsterDiedThisTurn = false;
    const player = this.currentPlayer;
    const itemsToRecharge = [...player.unchargedItems];
    const charactersToRecharge = [player.character];
    const eventData = { eventIssuer: player, itemsToRecharge: itemsToRecharge, charactersToRecharge: charactersToRecharge};
    
    this.emit("on:turn:start:before:recharge:step", eventData);
    await this.executeWhenStackEmpty(async () => {
      this.cardHandler.rechargeMultiple(player, "rechargeStep", eventData.charactersToRecharge);
      this.cardHandler.rechargeMultiple(player, "rechargeStep", eventData.itemsToRecharge);
      this.emit("on:turn:start", { eventIssuer: player });
      await this.executeWhenStackEmpty(async () => {
        const lootStep = new LootStepOnStack(this.currentPlayer, 1, this);
        this.addToStack(lootStep);
      });
    });
  }
  
  /**
   * Executes the standard loot step at turn start.
   */
  lootStep(player: Player, numberToLoot: number): void {
    this.loot(player, numberToLoot, "lootStep");
    player.addLootPlay(this.gameParameters.lootPlayPerTurn.value);
    this.emit("on:your:turn", { eventIssuer: player });
  }

    /**
   * Runs turn-end sequence, then advances to next turn.
   */
  async endTurn(): Promise<void> {
    const player = this.currentPlayer;
    this.actions.canEndTurn(player, true);
    this.stack.push(new EndOfTurnOnStack(player, this));
    this.emit("on:turn:end", { eventIssuer: player });
    await this.executeWhenStackEmpty(async () => {
      this.emit("till:turn:end", { eventIssuer: player });
      await this.verifyHandSize(player);
      this.entityHandler.healEveryone();
      for (const player of this.players) {
        player.resetTurnFlags();
      }
      for (const monster of this.monsters) {
        monster.resetEntityFlags();
      }
      this.turnHandler.endTurn();
      this.verifyTimerLosingCondition();
      this.dispatch();
      await this.startTurn();
    });
    this.dispatch();
  }

  verifyTimerLosingCondition(): void {
    if(this.timerIsUsed && this.turnHandler.round > this.gameParameters.timer.value)
        this.win(null);
  }
  /**
   * Enforces max-hand-size discard rules for a player.
   */
  async verifyHandSize(player: Player): Promise<void> {
    const toDiscard = player.hand.cards.length - player.maxHandSize;
    if (toDiscard > 0){
      const selection = await this.select(player, toDiscard, toDiscard, player.hand.cards, toSerializedTranslation("pending.maxHand", { value: toDiscard, count: player.maxHandSize }), "maxHandSize", true);
      for (const card of selection.selected) {
        this.cardHandler.discardFromHandAtIndex(player, player.hand._hand.indexOf(card), "overload");
      }
    }
  }

  removeStaleRooms(registerPlayer: Player | undefined): void {
    if(this.rooms === undefined) return;
    const staleRooms = this.rooms.registerTurnEndForStability(registerPlayer?.id, this.players.length);
    if(this.players.every((player) => player.team === this.currentPlayer.team)) {
      // Discard any room whose top card hasn't changed since every player has had a turn.
      for (const room of staleRooms) {
        if (room.canBeDiscarded)
          this.cardHandler.discard(room);
      }
    }
  }

  async handleRoomChange(): Promise<void> {
    if(this.rooms === undefined) return;
    const staleRooms = this.rooms.registerTurnEndForStability(this.currentPlayer.id, this.players.length);
    if(this.entityHandler.monsterDiedThisTurn){
      if(this.rooms.activeRooms.every((room) => room.canBeDiscarded === false)) return;
      const data:EffectData = new EffectData(this.rooms.activeRooms[0]!, () => this.currentPlayer, []);
      await CurrentPlayerDecidesToChangeRoom(this)(data);
    }
    
    this.removeStaleRooms(undefined);
  }

////////////////////////////////////// Handlers shortcuts //////////////////////////////////////
  /**
   * Activates a specific item and pushes resulting effect to stack.
   */
  async activateItem(
    player: Player,
    item: ItemCard,
    targets: any[] = [],
    effectId: number | "tap" = "tap"
  ): Promise<boolean> {
    return this.cardHandler.activateItem(player, item, targets, effectId);
  }

  /** Discards the top monster card from an encounter slot. */
  discardMonster(player: Player, position: number): string {
    this.assert.gameOngoing();
    this.assert.positiveNumber(position);

    if (position < 0 || position > this.encounters._slots.length - 1) {
      throw new GameError("Invalid monster position.",
        toSerializedTranslation("error.invalidMonsterPosition")
      );
    }

    player.clearAttackRequirement(this.monsters[position]!);
    this.encounters.discardTop(position);
    return `You have discarded the monster at position ${position}.\n`;
  }

  /** Draws a new monster into the chosen encounter slot during combat. */
  drawMonster(player: Player, position: number): string {
    this.assert.gameOngoing();
    this.assert.isAlive(player);
    this.assert.positiveNumber(position);
    this.assert.currentTurnIsPlayerTurn(player);
    this.assert.noPendingSelection();

    if (!player.isEngagedInCombat) {
      throw new GameError("You must be engaged in combat to draw a monster.",
        toSerializedTranslation("error.mustBeInCombatToDrawMonster")
      );
    }

    if (position < 0 || position > this.encounters._slots.length) {
      throw new GameError("Invalid monster position.",
        toSerializedTranslation("error.invalidMonsterPosition")
      );
    }

    if( this.encounters.cardsOnTop[position] !== undefined && this.encounters.cardsOnTop[position].indomitable) {
      throw new GameError("Invalid monster position.",
        toSerializedTranslation("error.cannotCoverIndomitable")
      );
    }

    this.encounters.draw(position);

    return `You have drawn a new monster at position ${position}.\n`;
  }
  
  /** Builds a full player-scoped game state payload for API/UI clients. */
  detailedStateJSON(player: Player): DetailedState {
    this.assert.gameOngoing();
    return this._gameStateSerializer.detailedStateJSON(player);
  }

  
  /** Draws loot cards for a player and emits pre/post loot triggers. */
  loot(player: Player, number: number = 1, reason: "lootStep" | "other" = "other"): void {
    return this.cardHandler.loot(player, number, reason);
  }

  gainTreasure(player: Player, nb: number = 1): void {
    return this.cardHandler.gainTreasure(player, nb);
  }
  /** Marks a player to skip their next turn. */
  playerSkipNextTurn(player: Player): void {
    this.turnHandler.skipNextTurn(player);
  }

  /** Schedules an extra turn for a player. */
  addExtraTurn(player: Player): void {
    this.turnHandler.InsertPlayerAtNextTurn(player);
  }

  /**
   * Appends an entry to the game history/log handler.
   */
  addToHistory(entry: HistoricEntry): void {
    this._historicHandler.addToHistory(entry);
  }

  /** Drops a trailing "randomSeed" history entry, e.g. one left over from a replay reseed. */
  removeTrailingRandomSeed(): void {
    this._historicHandler.removeTrailingRandomSeed();
  }

  dispatch(): void {
    this._onStateChange.dispatch();
  }

  /** Yields one event-loop tick so connected clients can observe the latest game state. */
  async waitForNextTick(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  /**
   * Dispatch a message to specific players in the game.
   */
  toast(payload: ServerRoomBroadcast): void {
    this._onRoomBroadcast.dispatch(payload);
  }
  /**
   * Load history after loading a game.
   */
  loadHistory(logs: HistoricEntry[]): void {
    this._historicHandler.loadHistory(logs);
  }

  /**
   * This function returns the cards owned by a player (his hand and in-play, non-eternal cards), and game owned cards (shop and encounters).
   * @param player 
   */
  playerCardsAndGameOwnedCards(player: Player): Card[] {
   return this.cardHandler.playerCardsAndGameOwnedCards(player);
  }
  
  /**
   * Removes a specific element from the stack, wherever it is.
   */
  cancelStackElement(element: StackElement): void {
    this.stack.cancelElement(element);
  }
  /**
   * @param slug 
   * @param globalId 
   * @returns 
   */
  obtainCardFromOutsideGame(slug: string, globalId?: number): Card | undefined {
    return this.cardHandler.obtainCardFromOutsideGame(slug, globalId);
  }
  /**
   * Finds and removes a card by slug from all reachable game zones.
   * If a global ID is provided, it is used to disambiguate duplicate slugs.
   * Otherwise, the first matching card found in the search order is removed and returned.
   * Note that the search order is: shop, encounters, decks, players' hands, players' in-play areas. 
   * This means that if there are multiple cards with the same slug, the one in the shop will be removed first, then the one in encounters, then in decks and finally in players' possession.
   * Only tests should not provide a global ID.
   */
  obtainCard(slug: string, globalId?: number, type?: DeckType): Card | undefined {
    return this.cardHandler.obtainCard(slug, globalId, type);
  }


  /**
   * Adds an element to the stack and enriches reordering metadata when needed.
   * @return the stack ID of the added element.
   */
  addToStack(item: StackElement): number {
    if (item instanceof EffectOnStack && !item.data.issuer) {
      throw new GameError("EffectOnStack must have an issuer.",
        toSerializedTranslation("error.behaviorError", {error: "EffectOnStack must have an issuer."}));
    }
//  EffectOnStack can be reordered on the stack by their owner.
    if (item instanceof EffectOnStack) {
      const emissionContext = this.emitter.getCurrentEmissionContext();
      if (emissionContext) {
        item.reordering = {
          ...(item.reordering ?? { groupId: "" }),
          ownerId: item.data.issuer.id,
          event: emissionContext.event,
          listenerId: emissionContext.listenerId,
        };
      }
    }

    this.stack.push(item);
    this.assert.updateLastTimedAction();
    this.dispatch();
    return item.stackId;
  }

  /**
   * Resolves stack elements until the stack is empty.
   */
  async resolveEntireStack(): Promise<void> {
    while (!this.stack.isEmpty()) {
      await this.actions.resolveStack();
    }
  }
  
  /**
   * Cancels the current top stack element.
   */
  cancelStack(): void {
    this.stack.cancel();
  }

  /**
   * Removes one stack element at a specific stack index.
   */
  cancelAt(index: number): void {
    this.stack.removeAt(index);
  }

  /**
   * Clears the full stack state.
   */
  resetStack(): void {
    for(let i = 0; i <= 1000; i++)
    {
      this.stack.clear();
      this.resetCallbacks();
      if(this.stack.isEmpty())
        return;
    }
    throw new GameError("", toSerializedTranslation("error.behaviorError", {error: "Expected stack to be empty."}))
  }

////////////////////////////////////// Coin handler //////////////////////////////////////
  /** Grants coins to a player and emits coin gained triggers. 
   * debug source must only be used for testing purposes.
  */
  gainCoins(player: Player, coins: number, source: Card | "gift" | "debug"): string {
    this.assert.gameOngoing();
    this.assert.positiveNumber(coins);
    if (coins > 0) {
      const amount = [coins];
      if(source !== "gift")
        this.emit("on:coin:gained", {
          eventIssuer: player,
          coinGained: amount,
          source: source,
        });
      player.gainCoins(amount[0]!);
      this.emit("on:coin:gained:after", {
        eventIssuer: player,
        coinGained: amount,
        source: source,
      });
      player.stats.nbCoinsGained += amount[0]!;
    }
    this.dispatch();
    return `New amount of coins: ${player.coins} coins.\n`;
  }

  /** Removes coins from a player and emits coin lost trigger. */
  canLoseCoins(player: Player, coins: number, asMany: boolean, reason: LoseCoinsReason = "other"): boolean {
    this.assert.gameOngoing();
    this.assert.positiveNumber(coins);

    const eventData = { eventIssuer: player, coinToLose: coins, reason };
    this.emit("on:coin:lost:before", eventData);
    coins = eventData.coinToLose;
    return coins <= player.coins || asMany;
  }
  /** Removes coins from a player and emits coin lost trigger. */
  loseCoins(player: Player, coins: number, asMany: boolean, reason: LoseCoinsReason = "other"): number {
    this.assert.gameOngoing();
    this.assert.positiveNumber(coins);

    const eventData = { eventIssuer: player, coinToLose: coins, reason };
    this.emit("on:coin:lost:before", eventData);
    coins = eventData.coinToLose;
    // console.log(`Player ${player.id} is about to lose ${coins} coins for reason ${reason} with ${player.coins} coins.`);
    if(coins <= 0) return 0;
    const coinLost = player.loseCoins(coins, asMany);
    this.emit("on:coin:lost:after", { eventIssuer: player, coinLost });
    if(coinLost === 0 && reason === "paiement" && asMany === false && coins > 0)
      return -1; // signal that the player cannot pay the cost.
    if(reason === "gift")
      player.stats.coinsGiven += coinLost;
    if(reason === "paiement")
      player.stats.coinsPaid += coinLost;
    return coinLost;
  }


  /** Steals up to the requested number of coins from target player. */
  stealCoins(player: Player, target: Player, amount: number, source: Card): string {
    this.assert.gameOngoing();
    this.assert.positiveNumber(amount);

    const stolenCoins = this.loseCoins(target, amount, true, "effect");
    this.gainCoins(player, stolenCoins, source);

    return `You have stolen ${stolenCoins} coins from ${target.id}.\n`;
  }

  /**
   * Proposes a coin transfer that target player may accept/decline.
   */
  async giveCoins(from: Player, to: Player, amount: number, forcedBy: Card | null = null): Promise<boolean> {
    if(this.gameParameters.allowCoinDonation.value === false)
      throw new GameError("Giving coins is not allowed in this game.",
        toSerializedTranslation("error.givingCoinsNotAllowed")
      );
    if (from.coins < amount || amount <= 0) {
      return false;
    }
    if(forcedBy === null) {
      const response = await this.select(to, 1, 1, [
        toSerializedTranslation("common.acceptButton"), toSerializedTranslation("common.declineButton")], 
        toSerializedTranslation("pending.fromIdWantsToGiveYouCoins", { player: from.id, value: amount }), "coinGift", true);
      if (response.selected[0]?.key !== "common.acceptButton") {
        console.log("declined");
        return false;
      }
    }
   return this.forceGiveCoins(from, to, amount, forcedBy);
  }

  forceGiveCoins(from: Player, to: Player, amount: number, forcedBy: Card | null = null): boolean {
    if (from.coins < amount || amount <= 0) {
      return false;
    }
    this.addAnimation({
      id: this.nextAnimationId,
      type: "giveCoins",
      sender: from.id,
      recipient: to.id,
      count: amount
    });
    this.loseCoins(from, amount, true, "gift");
    this.gainCoins(to, amount, forcedBy ? forcedBy : "gift");
    this.emit("on:coin:given", { eventIssuer: from, target: to, amount, forcedBy });
    this.dispatch();
    return true;
  }
  ////////////////////////////////////// Misc //////////////////////////////////////

  /** Emits a game trigger event and schedules stack reordering if needed. */
  emit(event: TriggerEvent, data: any = {}, dispatch: boolean = true): void {
    const count = this.emitter.emit(event, data);
    if (count > 0 && dispatch)
      this.dispatch();
    // If count > 1 calls stack reordering. 
    // Players can reorder their own effects if they have multiple. 
    // Current player can also reorder game effects if multiple are triggered at the same time.
    // Game effects are always resolved before player effects, and player effects are resolved in turn order starting from the current player.
    if(count > 1)
      this.stack.reorderStack(this.currentPlayer, count);
  }

  /** Moves one stack element before another within the same reordering group. */
  insertStackElementBefore(player: Player, elementToMoveStackId: number, targetStackId: number | "start"): void {
    this.assert.gameOngoing();
    const {event, orderedListenerIds} = this.stack.insertStackElement(player, elementToMoveStackId, targetStackId);
    if (orderedListenerIds.length > 1) {
      this.emitter.reorderListenersBySubset(event as TriggerEvent, orderedListenerIds);
    }
    this.dispatch();
  }
  /** Add a new animation to the game. */
  addAnimation(animation: Animation): void {
    for(const player of this.players)
      player.addAnimation(animation);
  }
  /**
   * Asynchronously selects items to lose as a death penalty.
   * This is separated from the main deathPenalty function to allow it to be overridden by specific passive effects that modify the item loss penalty without affecting the rest of the death penalty sequence.
   */
  async deathPenaltyItems(player: Player, nbItemsToLose: number): Promise<ItemCard[]> {
    const setOfLosableItems = player.inPlay.filter(
      (c) =>
        (c instanceof TreasureCard || (c instanceof LootCard && c.trinket)) &&
      c.eternal === false
    );
    if (nbItemsToLose > 0 && setOfLosableItems.length > 0) {
      const numberOfItemsToLose = Math.min(nbItemsToLose, setOfLosableItems.length);

      return (
        await this.select(player, numberOfItemsToLose, numberOfItemsToLose, setOfLosableItems, nbItemsToLose > 1
            ? toSerializedTranslation("pending.loseItems")
            : toSerializedTranslation("pending.loseItem"), "death", true)
      ).selected;
    }
    return [];
  }
  ////////////////////////////////////// Callbacks and Pending selection //////////////////////////////////////

  /**
   * Schedules a callback to run once the stack becomes empty.
   */
  async executeWhenStackEmpty(
    callback: () => void | Promise<void>
  ): Promise<void> {
    return this.executeWhenStackSubset([], callback);
  }

  /**
   * Schedules a callback once only the provided stack ids remain.
   * It is used to "wait" for additional effects to resolve before executing the callback, without needing to know exactly what those effects are.
   * Example: A monster dies, it has an on death effect. To trigger, the monster must be dead, and when a monster dies, its card is dicarded (usually).
   * But we want to keep the card in the slot while its death effect is not resolved. It is possible to do so with this function.
   */
  async executeWhenStackSubset(
    ids: number[],
    callback: () => void | Promise<void>
  ): Promise<void> {
    this._stackSubsetCallbacks.push({stackIds: ids, callback});
    await this.resolveCallbacks();
  }

  hasCallbacks(): boolean {
    return this._stackSubsetCallbacks.length > 0;
  }

  /**
   * Executes stack-subset callbacks whose condition is currently met.
   */
  async resolveCallbacks(): Promise<void> {
    if (this.hasPendingSelections)
      return;
    const callbacksToExecute: {stackIds: number[], callback: () => void | Promise<void>}[] = [];
    for(let i = this._stackSubsetCallbacks.length - 1; i >= 0; i--){
      const e = this._stackSubsetCallbacks[i]!;
      if (this.stack.elements.every((el) => e.stackIds.includes(el.stackId))) {
        callbacksToExecute.push(e);
        this._stackSubsetCallbacks.splice(i, 1);
      }
    }
    // Execute collected callbacks
    for (const cb of callbacksToExecute) {
      if (this.hasPendingSelections || !this.stack.elements.every((el) => cb.stackIds.includes(el.stackId))) {
        this._stackSubsetCallbacks.push(cb);
        continue;
      }
      await cb.callback();
      this.dispatch();
    }
  }
  resetCallbacks(): void {
    this._stackSubsetCallbacks = [];
  }
}