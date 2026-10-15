import type { StackReorderingInfo as ApiStackReorderingInfo, DamageOnStackJson, DeathOnStackJson, DiceRollJson, DiceWillRollJson, StackElementJson, LootStepJson, EffectOnStackJson, LootCardOnStackJson, VisualEffectBox, EndOfTurnJson } from "@/shared/api";
import type { Entity } from "./entities/entity";
import { type Game } from "./game";
import { GameError } from "@/models/GameError";
import { EffectData, LootCard, Card, type EffectFunction, MonsterCard } from "./cards";
import { Player } from "./entities/player";
import { TargetBuilder } from "./targetBuilder";
import { trueEffect } from "./effects/activeEffect";
import { toSerializedTranslation } from "@/utils/translation";
import type { DamageSource } from "./handlers/entityHandler";

interface StackElementJsonBase {
  id: number;
  reordering?: StackReorderingInfo;
}

export abstract class StackElement {
  private _stackId: number = -1;
  private _reordering: StackReorderingInfo | null = null;
  
  set stackId(id: number) {
    this._stackId = id;
  }

  get stackId(): number {
    return this._stackId;
  }

  set reordering(info: StackReorderingInfo | null) {
    this._reordering = info;
  }

  get reordering(): StackReorderingInfo | null {
    return this._reordering;
  }

  get isReorderable(): boolean {
    return this._reordering !== null;
  }

  protected get baseJson(): StackElementJsonBase {
    return {
      id: this.stackId,
      ...(this.reordering ? { reordering: this.reordering } : {}),
    };
  }

  abstract get json(): StackElementJson;
  abstract get debugLogs(): string;

  abstract onResolve(): Promise<void | boolean>;
  onCancel(game: Game): void{
    return;
  }
}

export type StackReorderingInfo = ApiStackReorderingInfo;

export class AttackRollData {
  damageDealtAdditional: number;
  damageDealtMultiplier: number;
  damageReceivedAdditional: number;
  damageReceivedMultiplier: number;
  evasion: number;
  target: Entity;
  
  constructor(
    damageDealtAdditional: number,
    damageDealtMultiplier: number,
    damageReceivedAdditional: number,
    damageReceivedMultiplier: number,
    evasion: number,
    target: Entity
  ) {
    this.damageDealtAdditional = damageDealtAdditional;
    this.damageDealtMultiplier = damageDealtMultiplier;
    this.damageReceivedAdditional = damageReceivedAdditional;
    this.damageReceivedMultiplier = damageReceivedMultiplier;
    this.evasion = evasion;
    this.target = target;
  }
}

export class DiceWillRoll extends StackElement {
  private _onResolve: () => void;
  private _roll: DiceRoll;

  constructor(roll: DiceRoll, onResolve: () => void){
    super();
    this._onResolve = onResolve;
    this._roll = roll;
  }

  get diceRoll(){
    return this._roll;
  }

  get issuer(){
    return this.diceRoll.issuer;
  }

  get attackRoll(){
    return this.diceRoll.attackRoll;
  }

  get card(){
    return this.diceRoll.attackRoll ? this.diceRoll.attackData?.target.card! : this.diceRoll.card!;
  }

  get visualEffectBox(){
    return this.diceRoll.completeVisualEffectBox;
  }

  override get json(): DiceWillRollJson {
    return { 
      ...super.baseJson,
      type: "diceWillRoll",
      issuer: this.issuer.json, 
      card: this.card.jsonAPI,
      attackRoll: this.attackRoll,
      visualEffectBox: this.visualEffectBox || undefined,
    }
  }

  override onCancel(game: Game): void {
    return this.diceRoll.onCancel(game);
  }

  override get debugLogs(): string {
    return `${this.attackRoll ? "Attack" : "Dice"} Roll (Issuer: ${this.issuer.id}, Card: ${this.card ? this.card.name : "N/A"}`;
  }

  override async onResolve(): Promise<void | boolean> {
    return this._onResolve();
  }
}
export class DiceRoll extends StackElement {
  private _value: number;
  private _issuer: Player;
  private _effectIssuer: Entity | null = null;
  private _attackRoll: boolean;
  private _fizzled: boolean = false;
  private _effect: EffectFunction[] | EffectFunction | null = null;
  private _card: Card | null = null;
  private _visualEffectBox: VisualEffectBox | null = null;
  private _targets: any[] = [];
  private _random: () => number;
  private _readyToResolve: boolean = false;
  private _attackRollData: AttackRollData | null = null;

  constructor(random: () => number, issuer: Player, data: Card | AttackRollData) {
    super();
    this._random = random;
    this._issuer = issuer;
    if(data instanceof AttackRollData) {
      this._attackRoll = true;
      this._attackRollData = data;
    } else {
      this._attackRoll = false;
      this._card = data as Card;
      this._visualEffectBox = data.visualEffectBoxFromDescription("roll-");
    }
    this._value = this.roll();
  }
  get data(): Card | AttackRollData {
    return this._attackRoll ? this._attackRollData! : this._card!;
  }
  get attackData(): AttackRollData | null {
    return this._attackRollData;
  }
  /**
   * This function returns the box for the roll, including effects for each results.
   */
  get completeVisualEffectBox(){
    return this._visualEffectBox;
  }

  override onCancel(game: Game): void {
    const card = this.card;
    // If the dice is linked to a curse or an event, discard it.
    if(card instanceof MonsterCard && (card.isEvent || card.isCurse))
      game.cardHandler.discard(card);
  }

  get additionalDamageDealt(): number {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    return this._attackRollData?.damageDealtAdditional ?? 0;
  }
  set additionalDamageDealt(value: number) {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    this._attackRollData!.damageDealtAdditional = value;
  }
  get damageDealtMultiplier(): number {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    return this._attackRollData!.damageDealtMultiplier;
  }
  set damageDealtMultiplier(value: number) {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    this._attackRollData!.damageDealtMultiplier = value;
  }
  get additionalDamageReceived(): number {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    return this._attackRollData!.damageReceivedAdditional;
  }
  set additionalDamageReceived(value: number) {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    this._attackRollData!.damageReceivedAdditional = value;
  }
  get damageReceivedMultiplier(): number {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    return this._attackRollData!.damageReceivedMultiplier;
  }
  set damageReceivedMultiplier(value: number) {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    this._attackRollData!.damageReceivedMultiplier = value;
  }
  get evasion(): number {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    return this._attackRollData!.evasion;
  }
  set evasion(value: number) {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    this._attackRollData!.evasion = value;
  }
  get attackTarget(): Entity {
    if(!this._attackRollData) throw new GameError("No attack roll data available.", toSerializedTranslation("error.behaviorError", { error: "No attack roll data available." }));
    return this._attackRollData!.target;
  }

  set targets(targets: any[]) {
    this._targets = targets;
  }

  get attackRoll(): boolean {
    return this._attackRoll;
  }
  get fizzled(): boolean {
    return this._fizzled;
  }
  set fizzled(value: boolean){
    this._fizzled = value;
  }
  
  get issuer(): Player {
    return this._issuer;
  }
  get value(): number {
    return this._value;
  }
  set value(v: number) {
    const prev = this._value;
    this._value = Math.max(1, Math.min(6, v));
    // if (prev !== this._value)
    this.readyToResolve = false;
  }
  get card(): Card | null {
    return this._card;
  }

  get readyToResolve(): boolean {
    return this._readyToResolve;
  }

  set readyToResolve(value: boolean) {
    this._readyToResolve = value;
  }

  add(modifier: number): void {
    if(modifier < 0){
      throw new GameError("Modifier must be positive", toSerializedTranslation("error.modifierMustBePositive"));
    }
    this.value = this.value + modifier;
  }
  subtract(modifier: number): void {
    if (modifier < 0 || typeof modifier !== "number") {
      throw new GameError("Modifier must be positive", toSerializedTranslation("error.modifierMustBePositive"));
    }
    this.value = this.value - modifier;
  }
  override get json(): DiceRollJson {
    return { 
      type: "diceRoll",
      diceRoll: this.value, 
      issuer: this.issuer.json, 
      card: !this._attackRoll ? this._card!.jsonAPI : undefined,
      visualEffectBox: this.obtainVisualBox(),
      targets: !this._attackRoll ? TargetBuilder.convertToSelectionItems(this._targets.filter(s => typeof s !== "string")) : undefined,
      ...super.baseJson,
      modifier: (this._attackRoll ? this._issuer.attackDiceModifier : 0) + this._issuer.diceModifier,
    }
  }

  /**
   * provide the visual effect box associated with this dice roll.
   */
  private obtainVisualBox(): VisualEffectBox | undefined {
    if(!this.card)
      return undefined;
    if(!this._visualEffectBox)
      return undefined;
    if(this._effect instanceof Array === false && this._effect !== null)
      return this._visualEffectBox;
    if(!this._effect || this._effect.length !== 6)
      return undefined;
    if(this._effect[this.value - 1]!.name === "trueEffect")
      return undefined;
    const range = this._visualEffectBox.endIndex - this._visualEffectBox.startIndex + 1;
    if(range === 1)
      return this._visualEffectBox;
    const step = this._effect.reduce((acc, cur, idx, arr) => acc + (arr[idx]!.name !== "trueEffect" ? 1 : 0), 0) / range;
    const boxIndex = Math.floor((this.value - 1) / step);
    return {startIndex: this._visualEffectBox.startIndex + boxIndex, endIndex: this._visualEffectBox.startIndex + boxIndex};
  }

  override get debugLogs(): string {
    return `${this.attackRoll ? "Attack" : "Dice"} Roll: ${this.value} (Issuer: ${this.issuer.id}, Card: ${this._card ? this._card.name : "N/A"}, Targets: ${!this._attackRoll ? TargetBuilder.convertToSelectionItems(this._targets) : "N/A"}, Modifier: ${(this._attackRoll ? this._issuer.attackDiceModifier : 0) + this._issuer.diceModifier})`;
  }
  
  roll(): number {
    const old = this._value;
    this.value = Math.floor(this._random() * 6) + 1;
    return this._value;
  }
  override toString(): string {
    return JSON.stringify(this.json);
  }
  /**
   * Modify the random function used for this dice roll (for testing purposes only)
   */
  _TEST_setRandom(random: () => number): void {
    this._random = random;
  }
  attachEffect(effect: EffectFunction[] | EffectFunction, card: Card, targets: any[]=[], effectIssuer: Entity | null = null): void {
    if(effect instanceof Array && effect.length != 6)
      throw new GameError("Effect must have 6 outcomes, one for each dice face.", toSerializedTranslation("error.behaviorError", { error: "Effect must have 6 outcomes, one for each dice face." }));
    this._effect = effect;
    this._card = card;
    this._targets = targets;
    this._effectIssuer = effectIssuer;
  }
  async onResolve(): Promise<void> {
    if(this.attackRoll)
      if(this._issuer.isDead || this._targets.length === 0 || this._targets[0].isDead)
      {
        this.fizzled = true;
        return; // No effect if attacker or target is dead
      }
    this.value += (this._attackRoll ? this._issuer.attackDiceModifier : 0) + this._issuer.diceModifier;
    if ((this._effect instanceof Array && this._effect.length === 6) || this._effect instanceof Function) {
      const effectIssuer = this._effectIssuer ?? this._issuer;
      // For attack rolls, prepend the dice roll itself to targets so effects can use it as the damage source
      const targetsWithDiceRoll = this._attackRoll ? [this, ...this._targets] : this._targets;
      const effect = this._effect instanceof Array ? this._effect[this._value - 1]! : this._effect;
      await effect(new EffectData(this._card!, () => effectIssuer, targetsWithDiceRoll));
    }
  }
}

export class DamageOnStack extends StackElement {

  from: Entity;
  receiver: Entity;
  damage: number[];
  _source: DamageSource;
  _targets: any[] = [];
  _effect: EffectFunction | null = null;
  game: Game;

  constructor(
    from: Entity,
    receiver: Entity,
    damage: number[],
    source: DamageSource,
    game: Game
  ) {
    super();
    this.receiver = receiver;
    this.from = from;
    this.damage = damage;
    this._source = source;
    this.game = game;
  }
  attachEffect(effect: EffectFunction, source: DamageSource, targets: any[] = []): void {
    this._effect = effect;
    this._source = source;
    this._targets = targets;
  }

  async onResolve(): Promise<void> {
    if(this._effect) {
      const card = this._source.card!;
      if(this.from instanceof Player === false)
        throw new GameError("Damage effect issuer is not a player", toSerializedTranslation("error.behaviorError", { error: "Damage effect issuer is not a player" }));
      await this._effect(new EffectData(card, () => this.from, [this, this._targets]));
    }
  }
  override get json(): DamageOnStackJson {
    const sourceName = this._source instanceof DiceRoll ? this._source.json : this._source.card.jsonAPI;
    const box = this._source instanceof DiceRoll ? undefined : this._source.visualEffectBox;
    return {
      type: "damage",
      from: this.from.json, 
      receiver: this.receiver.json, 
      damage: this.damage[0]!, 
      source: sourceName,
      visualEffectBox: box,
      ...super.baseJson,
    };
  }
  override get debugLogs(): string {
    return `${this.from.id} deals ${this.damage[0]} damage to ${this.receiver.id} (${this.receiver.currentHealthPoints})HP with source ${this._source instanceof DiceRoll ? "Dice Roll" : this._source.card.name} (Targets: ${TargetBuilder.convertToSelectionItems(this._targets)})`;
  }
};

export class DeathOnStack extends StackElement {

  receiver: Entity;
  from: Entity;
  source: DamageSource; 
  game: Game;

  constructor(
    receiver: Entity,
    from: Entity,
    source: DamageSource,
    game: Game
  ) {
    super();
    this.receiver = receiver;
    this.from = from;
    this.source = source;
    this.game = game;
  }
  async onResolve(): Promise<void> {
    await this.game.entityHandler.resolveDeath(this.receiver, this.from, this.source);
  }

  override get json(): DeathOnStackJson {
    const sourceName = this.source instanceof DiceRoll ? this.source.json : this.source.card.jsonAPI;
    const box = this.source instanceof DiceRoll ? undefined : this.source.visualEffectBox;
    this.receiver.json;
    return {
      type: "death",
      receiver: this.receiver.json,
      from: this.from.json,
      source: sourceName,
      visualEffectBox: box,
      ...super.baseJson,
    };
  }
  override get debugLogs(): string {
    const sourceName = this.source instanceof DiceRoll ? "Dice Roll" : this.source.card.name;
    return `${this.from.id} kills ${this.receiver.id} with source ${sourceName}`;
  }
};

export class LootStepOnStack extends StackElement {
  
  _player: Player
  _nbLoots: number;
  game: Game;
  
  constructor(player: Player, nbLoots: number, game: Game) {
    super();
    this._player = player;
    this._nbLoots = nbLoots;
    this.game = game;
  }
  override get json(): LootStepJson {
    return {
      type: "lootStep",
      player: this.player.json,
      nbLoots: this.nbLoots,
      ...super.baseJson,
    };
  }
  override get debugLogs(): string {
    return `LootStep: ${this.player.id} loots ${this.nbLoots} card(s)`;
  }
  override async onResolve(): Promise<void> {
    const ids = this.game.stack.currentStackIds;
    this.game.emit("on:loot:step", { eventIssuer: this.player, lootStep: this });
    await this.game.executeWhenStackSubset(ids, async () => {
      this.game.stack.resolve();
      this.game.addToHistory(this.json);
      this.game.lootStep(this.player, this.nbLoots);
      await this.game.resolveCallbacks();
    });
  }
  get nbLoots(){
    return this._nbLoots;
  }
  set nbLoots(value: number){
    this._nbLoots = value;
  }
  get player(){
    return this._player;
  }
  set player(newPlayer: Player){
    this._player = newPlayer;
  }
}

export class EndOfTurnOnStack extends StackElement {
  
  player: Player
  game: Game;
  
  constructor(player: Player, game: Game) {
    super();
    this.player = player;
    this.game = game;
  }
  override get json(): EndOfTurnJson {
    return {
      type: "endOfTurn",
      player: this.player.json,
      ...super.baseJson,
    };
  }
  override get debugLogs(): string {
    return `EndOfTurn: ${this.player.id} ends their turn`;
  }
  override async onResolve(): Promise<void> {
    await this.game.handleRoomChange();
    await this.game.resolveCallbacks();
  }
}

export class LootCardEffect extends StackElement {
    private _card: LootCard;
    private _targets: any[];
    private _issuer: Player;

    constructor(issuer: Player, card: LootCard, targets: any[]) {
        super();
        this._card = card;
        this._targets = targets;
        this._issuer = issuer;
    }

    get card(): LootCard {
        return this._card;
    }

    get issuer(): Player {
        return this._issuer;
    }

    async onResolve(): Promise<void> {
        await this._card.onPlay(this.issuer, this.targets)();
    }
    override onCancel(game: Game): void {
      game.decks.loot.addDiscardTop(this._card);
    }
    get visualEffectBox(): VisualEffectBox | undefined{
      if(typeof this.targets[0] === "string")
        return this.card.visualEffectBoxFromDescription(this.targets[0]);
      return this.card.getEffectRange(0)[0];
    }
    override get json(): LootCardOnStackJson {
        return {
            type: "LootCardEffect",
            card: this.card.jsonAPI,
            targets: TargetBuilder.convertToSelectionItems(this.targets.filter(s => typeof s !== "string")),
            issuer: this.issuer.json,
            visualEffectBox: this.visualEffectBox,
            ...super.baseJson,
        };
    }
    override get debugLogs(): string {
        return `LootCardEffect from ${this.issuer.id} for card ${this.card.name} with targets: ${JSON.stringify(TargetBuilder.convertToSelectionItems(this.targets))}`;
    }

    get targets(): any[] {
        return this._targets;
    }
}
function prepareEffectString(s: string): string {
    s = s.replace("[Tap Effect]", ""); // remove tap effect marker
    s = s.replace("[Paid Effect]", ""); // remove paid effect marker
    s = s.replace("[Curse Effect] ", ""); // remove curse effect marker
    s = s.trim();
    return s;
}
export type EffectTypeOnStack = "active" | "paid" | "passive" | "event";
export class EffectOnStack extends StackElement {
    protected _effectFunction: EffectFunction;
    protected _data: EffectData;
    protected _description: string;
    protected _type: EffectTypeOnStack;
    protected _visualEffectBox: VisualEffectBox | undefined;

    constructor(effectFunction: EffectFunction, data: EffectData, description: string, type: EffectTypeOnStack, visualEffectBox?: VisualEffectBox) {
        super();
        // if(!data)
        //     throw new GameError("EffectOnStack constructor: data is undefined or null.");
        this._effectFunction = effectFunction;
        this._data = data;
        this._description = prepareEffectString(description);
        this._type = type;
        this._visualEffectBox = visualEffectBox;
    }
    async onResolve(): Promise<boolean> {
        return this._effectFunction(this._data);
    }

    get data(): EffectData {
        return this._data;
    }
    get type(): EffectTypeOnStack {
        return this._type;
    }
    set targets(targets: any[]) {
        this._data.targets = targets;
        // Reset the consumption index when targets are set externally
        (this._data as any)._nextIndex = 0;
    }
    override get json(): EffectOnStackJson {
        return {
            type: "effect",
            issuer: this._data.issuer.json,
            targets: TargetBuilder.convertToSelectionItems([...this._data.targets.filter(s => typeof s !== "string"), ...this._data.selectedOnResolve.filter(s => typeof s !== "string")]),
            card: this.data.it.jsonAPI,
            effect: this._description,
            visualEffectBox: this._visualEffectBox,
            ...super.baseJson,
        };
    }

    override onCancel(game: Game): void {
      const card = this._data.it;
      if(card instanceof MonsterCard && (card.isEvent || card.isCurse))
        game.cardHandler.discard(card);
    }

    override get debugLogs(): string {
        return `card effect ${this.data.it.name} ${this.data.it.globalId} ISSUER ${this._data.issuer.id} EFFECT "${this._description}" `;
        // TARGETS: ${JSON.stringify(TargetBuilder.convertToSelectionItems(this._data.targets))}
    }
}
