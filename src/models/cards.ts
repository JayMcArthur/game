import { type ActiveEffectEntry, type CounterType, type BonusSoulCard, type DescriptiveVisualEffectBox, type IdentifierType, type VisualEffectBox, type DeckName, type SerializedChooseOne, type BasicSerializedTranslation, type SerializedTranslation, type SerializedCounter } from '@/shared/api';
import type { BonusSoulCardType, CardRewards, CharacterCardType, EternalCardType, FlipData, GenericCardType, InPlayCardType, LootCardType, MonsterCardType, RoomCardType, TreasureCardType } from '@/types/cardTypes';
import { print, shuffle } from '@/utils/auxiliary';
import { toSerializedTranslation, translationKeyFromCardSlug } from '@/utils/translation';
import { Effect, EffectInterface, PassiveEffect } from './effects/effects';
import type { Entity } from './entities/entity';
import { Player } from './entities/player';
import { GameError } from "@/models/GameError";
import type { GameParameters } from './gameParameters';
import { EffectOnStack } from './stackElement';
import { type CardSetsCollection, type DecksCollection, type DeckType, type DeckTypeToCardType, type TargetsSelector } from './types/cardTypes';
import type { Game } from './game';

export type EffectRange = DescriptiveVisualEffectBox[];
export type CardEffectsRanges = EffectRange[];
class Card {
    protected _json: GenericCardType;
    protected _id: number;
    protected _globalId: number;
    protected _slug: string;
    protected _name: string;
    protected _type: DeckType;
    protected _subtype: string;
    protected _origin: string;
    protected _quote: string | undefined;
    protected _front: string;
    protected _back: string;
    protected _keywords: string[];
    protected _tags: { [key: string]: any };
    protected _minimumPlayers: number;
    protected _effectOutcomes: string[];
    protected _effectInterface: EffectInterface;
    protected _flippedEffectInterface: EffectInterface;
    protected _outsideGame: boolean = false;
    protected _souls: number = 0;
    protected _charged: boolean = true;
    protected _owner: Entity | undefined;
    protected _associatedEntity!: Entity;
    protected _eternal: boolean = false;
    protected _flipped: boolean = false;
    protected _canBeDiscarded: boolean = true;
    protected _canBeActivated: boolean = true;
    protected _cleanup: (() => void)[] = [];
    protected _onFlip: (() => void)[] = [];
    protected _otherSideCard: Card | null = null;
    protected _entity: Entity | undefined = undefined;
    protected _identityHash: string | null = null;
    protected _flipData: FlipData | undefined = undefined;
    protected _counterHandler = new CounterHandler
    protected _separatorIds: CardEffectsRanges;

    constructor(id: number,
        globalId: number,
        json: GenericCardType) {
        this._json = JSON.parse(JSON.stringify(json)) as GenericCardType;
        this._id = id;
        this._globalId = globalId;
        this._slug = this._json.slug;
        this._name = this._json.name;
        this._type = this._json.type;
        this._subtype = this._json.type;
        this._origin = this._json.origin;
        this._quote = this._json.quote;
        this._front = this._json.front;
        this._back = this._json.back;
        this._keywords = [];
        this._tags = {};
        this._eternal = this._json.eternal || false;
        this._effectInterface = new EffectInterface(this);
        this._flippedEffectInterface = new EffectInterface(this);
        this._flipData = this._json.flip;
        this._minimumPlayers = this._json.minimumPlayers || 1;
        this._outsideGame = this._json.outsideGame || false;
        this._effectOutcomes = this._json.effectOutcome || [];
        this._separatorIds = this.getSeparatorIds();
    }
    toString() : string {
        let toAdd:string = "";
        if(this._keywords.length > 0) {
            toAdd = ", " + this._keywords.join("; ");
        }
        if(this._tags && Object.keys(this._tags).length > 0) {
            toAdd = " " + JSON.stringify(this._tags);
        }
        return this._name + ": " + this._effectOutcomes.join(", ") + toAdd;
    }
    get nameKey(): BasicSerializedTranslation {
        if(this._flipped)
            return translationKeyFromCardSlug(this.flipData!.slug)
        return translationKeyFromCardSlug(this._slug);
    }
    getEffectRange(idx: number): EffectRange {
        if(idx < 0 || idx >= this._separatorIds.length)
            throw new GameError(`Effect index ${idx} is out of bounds for card ${this.name}.`, toSerializedTranslation("error.effectIndexOutOfBounds", {card: this.name, index: idx}));
        return this._separatorIds[idx]!;
    }

    visualEffectBoxFromDescription(description: string): VisualEffectBox {
        const processedDescription = description.toLowerCase().replaceAll("!", "").replaceAll("-", "");
        for(const effectRange of this._separatorIds) {
            for(const effect of effectRange) {
                if(effect.description.toLowerCase().replaceAll("!", "").replaceAll("-", "").includes(processedDescription)) {
                    return { startIndex: effect.startIndex, endIndex: effect.endIndex };
                }
            }
        }
        // tmp
        return { startIndex:0, endIndex:0 };
    }
    get counters(): CounterHandler {
        return this._counterHandler;
    }
    get activeEffectList(): ActiveEffectEntry[] {
        if(this instanceof LootCard && this.trinket && !this.canBeActivated)
            return [];
        if(this instanceof MonsterCard && this.isCurse)
            return [];
        return this._effectInterface.activeEffectList;
    }
    get outsideGame(): boolean {
        return this._outsideGame;
    }
    get flipped(): boolean {
        return this._flipped;
    }
    swapEffectInterfaces(): void {
        [this._effectInterface, this._flippedEffectInterface] = [this._flippedEffectInterface, this._effectInterface];
    }
    get flipData(): FlipData | undefined {
        return this._flipData;
    }
    set flipData(value: FlipData | undefined) {
        this._flipData = value;
    }
    addFlipEffect(onFlipEffect: () => void): void {
        this._onFlip.push(onFlipEffect);
    }
    get entity(): Entity | undefined {
        return this._entity;
    }
    set entity(value: Entity | undefined) {
        this._entity = value;
    }
    get hasEntity(): boolean {
        return this._entity !== undefined;
    }
    get canBeActivated(): boolean {
        return this._canBeActivated;
    }
    set canBeActivated(value: boolean) {
        this._canBeActivated = value;
    }
    get charged(): boolean {
        return this._charged;
    }
    set charged(value: boolean) {
        this._charged = value;
    }
    get soul(): number {
        return this._souls;
    }
    set soul(value: number) {
        this._souls = value;
    }
    get slug() : string {
        return this._slug;
    }
    get type(): DeckType {
        return this._type;
    }
    set id(value: number) {
        this._id = value;
    }
    get id(): number {
        return this._id;
    }
    get globalId(): number {
        return this._globalId;
    }
    get name(): string {
        return this._name;
    }
    get minimumPlayers(): number {
        return this._minimumPlayers;
    }
    get effectOutcomes(): string[] {
        return this._effectOutcomes;
    }
    set effectOutcomes(outcomes: string[]) {
        this._effectOutcomes = outcomes;
    }
    get keywords(): string[] {
        return this._keywords;
    }
    get tags(): { [key: string]: any } {
        return this._tags;
    }
    get json(): GenericCardType {
        return this._json;
    }
    get jsonAPI(): IdentifierType {
        if(this._flipped)
            return {
            slug: this.flipData!.slug,
            nameKey: this.nameKey,
            globalId: this._globalId,
            orientation: this._type === "room" ? "landscape" : "portrait",
        };
        return {
            slug: this._slug,
            nameKey: this.nameKey,
            globalId: this._globalId,
            orientation: this._type === "room" ? "landscape" : "portrait",
        };
    }
    get subtype(): string {
        return this._subtype;
    }
    get eternal(): boolean {
        return this._eternal;
    }
    setEternal(eternal: boolean): void {
        this._eternal = eternal;
    }
    get cleaners(): (() => void)[] {
        return this._cleanup;
    }
    get owner(): Entity {
        if(!this._owner)
            throw new GameError(`Card ${this.name} does not have an owner.`, toSerializedTranslation("error.noOwnerForCard", {card: this.name}));
        return this._owner;
    }
    set owner(value: Entity | undefined) {
        this._owner = value;
    }
    get canBeDiscarded(): boolean{
        return this._canBeDiscarded
    }
    private getSeparatorIds(): CardEffectsRanges
    {
        let id = 0;
        const effectRange:CardEffectsRanges = [];
        for(const effect of this._effectOutcomes)
        {
            if(effect.includes("\n"))
            {
                const lines = effect.split("\n");
                const nbLines = lines.length;
                if(effect.toLowerCase().includes("roll-") || effect.toLowerCase().includes("rolls-") || effect.toLowerCase().includes("instead-") || effect.toLowerCase().includes("times!-"))
                    {
                        if(nbLines < 2)
                        {
                            const err = `Effect outcome "${effect}" has a newline but is not a roll or choose one effect.`;
                            throw new GameError(err, toSerializedTranslation("error.parsingError", {error: err}));
                        }
                        // new line separate roll- with first effect, but there is no separator. 
                        if(nbLines == 2)
                            effectRange.push([{startIndex: id, endIndex: id, description: lines[0]!}]);
                        else
                            effectRange.push([{startIndex: id, endIndex: id+lines.length-2, description: effect}]);
                        id += lines.length;
                    }
                else if(effect.toLowerCase().includes("choose one-"))
                {
                    const arr: EffectRange = []
                    for(let i = 1 + (effect.toLowerCase().includes("[paid effect]") ? 1 : 0); i < lines.length; i++)
                    {
                        arr.push({startIndex: id, endIndex: id, description: lines[i]!});
                        id++;
                    }
                    effectRange.push(arr);
                }else if( effect.includes("-\n") &&  effect.includes("whiff-\n") === false)
                    {
                        const err = `Effect outcome "${effect}" has a newline but is not a roll or choose one effect.`;
                        throw new GameError(err, toSerializedTranslation("error.parsingError", {error: err}));
                    }
                else
                    {
                        effectRange.push([{startIndex: id, endIndex: id, description: effect}]);
                        id++;
                    }
            }else
            {
                effectRange.push([{startIndex: id, endIndex: id, description: effect}]);
                id++;
            }
        }
        // console.log(`Computed separator IDs for card ${this.name}: ${JSON.stringify(effectRange)}`);
        return effectRange;
    }
    set canBeDiscarded(value: boolean){
        this._canBeDiscarded = value;
    }
    flip(): void {
        this._flipped = !this._flipped;
        [this._front, this._back] = [this._back, this._front];
        for (const onFlipEffect of this._onFlip) {
            onFlipEffect();
        }
    }

    private computeIdentityHash(): string {
        const keys = Object.keys(this._json)
            .filter(key => !["front", "back", "slug", "quote", "origin"].includes(key))
            .sort();
        const identityParts = keys.map(key =>
            `${key}:${JSON.stringify(this._json[key as keyof GenericCardType])}`
        );
        return identityParts.join('|');
    }

    private getIdentityHash(): string {
        if (this._identityHash === null) {
            this._identityHash = this.computeIdentityHash();
        }
        return this._identityHash;
    }

    isSameCard(other: Card): boolean {
        return this.getIdentityHash() === other.getIdentityHash();
    }
    resetEffects(): void {
        this._effectInterface.reset();
        this._flippedEffectInterface.reset();
    }
    cleanup(): void {
        for (const cleaner of this._cleanup.toReversed()) {
            cleaner();
        }
        this._cleanup = [];
    }

    recharge(): boolean {
        if (this._charged === false) {
            this._charged = true;
            return true;
        }
        return false;
    }

    deactivate(): void {
        if(this.hasTapEffect()) {
             this._charged = false;
        }
    }

    onAddInPlay(issuerProvider: () => Entity, differentSource: Card | undefined = undefined): void {
        this._owner = issuerProvider();
        this._effectInterface.subscribeAll(issuerProvider, differentSource);
    }
    addEffect(effect: Effect | PassiveEffect): void {
        this._effectInterface.addEffect(effect);
    }

    getActiveEffect(): Effect | undefined {
        try{
            return this._effectInterface.getActiveEffect();
        }
        catch(err){
            return undefined;
        }
    }

    hasTapEffect(): boolean {
        return this._effectInterface.hasTapEffect();
    }

    /**
     * Transforms this card to become a copy of another card.
     * Returns the original state so it can be restored later.
     * @param otherCard - The card to copy
     * @param attachEffects - Optional callback to attach effects to this card
     */
    becomesCopyOf(otherCard: Card, attachEffects?: (card: Card) => void): { originalState: any, restore: () => void } {
        // verify that the card is still in play.
        // Store original state including cleanup array
        // console.log(`becomesCopyOf called on ${this.name} to copy ${otherCard.name}. Current tags: ${JSON.stringify(this.effectOutcomes)}. Current cleanup length: ${this._cleanup.length}.`);
        const originalState = {
            json: this._json,
            tags: this._tags,
            slug: this._slug,
            name: this._name,
            separatorIds: this._separatorIds,
            canBeActivated: this._canBeActivated,
            type: this._type,
            subtype: this._subtype,
            effectOutcomes: this._effectOutcomes,
            effectInterface: this._effectInterface,
            cleanup: [...this._cleanup], // Store a COPY of the cleanup array
            owner: this._owner,
            flipData: this._flipData,
        };

        // Don't cleanup here - we need to preserve the original effectInterface state
        // Cleanup will happen in restore() for the copied effects only
        
        // Copy properties from the other card
        const originalFlipData = this._flipData; // Preserve the flip data of the original card
        this._json = otherCard._json;
        this._separatorIds = otherCard._separatorIds;
        this._json.flip = originalFlipData; // Restore original flip data
        // this._tags = otherCard._tags;
        this._slug = otherCard._slug;
        this._name = otherCard._name;
        this._type = otherCard._type;
        this._canBeActivated = otherCard._canBeActivated;
        this._subtype = otherCard._subtype;
        this._effectOutcomes = otherCard._effectOutcomes;
        this._flipData = originalFlipData;
        if(this instanceof ItemCard)
            this.parentCard = originalState.slug;
        // Create a new effect interface
        this._effectInterface = new EffectInterface(this);
        
        // Attach effects if callback provided
        if (attachEffects) {
            attachEffects(this);
        }
        const prevIdx = this._tags.lastCopiedRestoreOriginalStateIndex;
        // Restore function
        const restoreOriginalState = (): void => {
            // console.log(`Restoring original state for ${originalState.name} ${this.globalId} after copying ${otherCard.name} ${otherCard.globalId}. Current cleanup length: ${this._cleanup.length}.`);
            // Restore original properties
            this._json = originalState.json;
            this._slug = originalState.slug;
            this._name = originalState.name;
            this._type = originalState.type;
            this._separatorIds = originalState.separatorIds;
            this._canBeActivated = originalState.canBeActivated;
            this._subtype = originalState.subtype;
            this._effectOutcomes = originalState.effectOutcomes;
            this._effectInterface = originalState.effectInterface;
            this._flipData = originalState.flipData;
            this._tags.lastCopiedRestoreOriginalStateIndex = prevIdx; // Restore the previous index for potential nested copies
            this._tags.restore = undefined;
            if(this instanceof ItemCard)
                this.parentCard = null;
        };
         this._cleanup.push(restoreOriginalState);
        this._tags.lastCopiedRestoreOriginalStateIndex = this._cleanup.length - 1; // Store the index of the restore function in tags for potential external access
        // Cleanup anything that happened after the copy.
        const restore = (): void => {
            // Call all cleanup functions to restore original state
            for (let i = this._cleanup.length - 1; i >= originalState.cleanup.length; i--) {
                this._cleanup[i]!();
            }
            this._cleanup = this._cleanup.slice(0, originalState.cleanup.length); // Restore original cleanup array
        };

        this._tags.restore = restore;
        
        return { originalState, restore };
    }
}

enum InplayType { CHARGED, UNCHARGED, PASSIVE, PAID, PLAYABLE }
export class ItemCard extends Card {
  protected _inplayType: InplayType;
  protected _guppy: boolean = false;
//   Card that copies other card create child cards. 
// Parent can be set to unkown when it should not be destroyed by destruction of this card.
  protected _parentCard: string | undefined | null = undefined; 

  protected _cost: string;
    constructor(id: number, globalId: number, json: InPlayCardType) {
        super(id, globalId, json);
    this._guppy = json.guppy === true;
    this._cost = "";
    this._inplayType = InplayType.PASSIVE;
    if (json.effectOutcome !== undefined) {
      if (json.effectOutcome.join(", ").includes("[Tap Effect]")) {
        this._inplayType = InplayType.UNCHARGED;
      } else if (json.effectOutcome.join(", ").includes("[Paid Effect]")) {
        this._inplayType = InplayType.PAID;
      }
    }
  }

/**
 * @returns a the card that generated this card when it is copy of a card. Unknown when the parent is protected from destruction of the child.
 */
  get parentCard(): string | undefined | null{
    return this._parentCard
  }

  set parentCard(parent: string | undefined | null){
    this._parentCard = parent;
  }

  get inPlayType(): InplayType {
    return this._inplayType;
  }
  get requiresDiceWillRoll(): boolean{
    return this._effectInterface.requiresDiceWillRoll;
  }
  isActiveItem(): boolean {
    return (
      this._inplayType === InplayType.CHARGED ||
      this._inplayType === InplayType.UNCHARGED
    );
  }
  getEffectTarget(effectId: number | "tap"): TargetsSelector[] {
    return this._effectInterface.getTargetSelectors(effectId);
  }
  getEffectIdAndChooseOneChoiceFromSeparatorId(id: number): { effectId: number | "tap"; choice?: SerializedChooseOne[] }
  {
    return this._effectInterface.getEffectIdAndChooseOneChoiceFromSeparatorId(id);
  }

  get cost(): string {
    return this._cost;
  }
  isEternal(): boolean {
    return this._eternal;
  }
  isGuppy(): boolean {
    return this._guppy;
  }
  async tryActivateEffect(
    targets: any[] = [],
    effectId: number | "tap" = "tap",
    differentSource: Card | undefined = undefined,
  ): Promise<EffectOnStack> {
    switch (effectId) {
      case "tap":
        if (this._charged === true) {
          this._charged = false;
          return this._effectInterface.tapEffect(this.owner, targets, differentSource);
        }
        throw new GameError("Cannot activate uncharged item", toSerializedTranslation("error.cannotActivateUnchargedItem"));
      default:
        return this._effectInterface.paidEffect(this.owner, targets, effectId, differentSource);
    }
  }
  targetStillValid(
    player: Player,
    effectId: number | "tap",
    targets: any[]
  ): boolean {
    return this._effectInterface.targetStillValid(player, effectId, targets);
  }

  override get jsonAPI(): IdentifierType {
      {
        return {
            ...super.jsonAPI,
            ...(typeof this.parentCard === "string" ? {parent: this.parentCard} : {}),
        };
      }
  }
}
// "discardNextTime" turns into "discard" after the first time the card is played.
type AfterEffectType = "discard" | "addInPlay" | "nothing" | "discardNextTime";
class LootCard extends ItemCard {
    protected _reward: CardRewards | undefined;
    protected _trinket: boolean = false;
    protected _afterEffect: AfterEffectType = "discard";

    constructor(id: number, globalId: number, json: LootCardType) {
        super(id, globalId, json);
        this._inplayType = InplayType.PLAYABLE;
        this._reward = json.rewards;
        this._effectInterface = new EffectInterface(this);
        this.canBeActivated = false;
        if (json.trinket) {
            this._trinket = json.trinket;
            this._inplayType = InplayType.PASSIVE;
            this._afterEffect = "addInPlay";
        }
    }

    get afterEffect(): AfterEffectType {
        return this._afterEffect;
    }

    set afterEffect(value: AfterEffectType) {
        this._afterEffect = value;
    }

    get trinket(): boolean {
        return this._trinket;
    }

    onPlay(issuer: Player, targets: any[] = []): (() => void | Promise<void>) {
        this._owner = issuer;
        // Return a resolve function that captures trinket state
        const resolveFunction = this._effectInterface.onPlay(issuer, targets);
        return async () => {
            return resolveFunction();
        };
    }

    getTargetSelectors(): TargetsSelector[] {
        return this._effectInterface.getTargetSelectors("tap");
    }
}

export class RoomCard extends ItemCard {
    constructor(id: number, globalId: number, json: RoomCardType) {
        super(id, globalId, json);
    }
}
class TreasureCard extends ItemCard {

    constructor(id: number, globalId: number, json: TreasureCardType) {
        super(id, globalId, json);
        this._subtype = json.subtype;
    }
}

class EternalCard extends ItemCard {
    constructor(id: number, globalId: number, json: EternalCardType) {
        super(id, globalId, json);
        this._eternal = true;
    }
}

class CharacterCard extends ItemCard {
    protected _eternalCard: string | null = null;
    protected _healthPoints: number = 0;
    protected _attackPoints: number = 0;

    constructor(id: number, globalId: number, json: CharacterCardType) {
        super(id, globalId, json);
        if(json.eternalCard) {
            this._eternalCard = json.eternalCard.slug;
        }
        if(json.stats) {
            this._healthPoints = json.stats.healthPoints || 0;
            this._attackPoints = json.stats.attackPoints || 0;
        }
        if (json.rewards && json.rewards.soul) {
            if(typeof json.rewards.soul === "number")
            {
                this._souls = json.rewards.soul;
            }
        }
        this._charged = false;  
        this._eternal = true;
    }
    override onAddInPlay(issuerProvider: () => Entity): void {
        super.onAddInPlay(issuerProvider);
        const owner = issuerProvider();
        owner.addHealthPoints(this._healthPoints);
        owner.addAttackPoints(this._attackPoints);
        if(this.soul > 0)
            (owner as Player).addSoul(this);
        this.cleaners.push(() => {
            owner.addHealthPoints(-this._healthPoints);
            owner.addAttackPoints(-this._attackPoints);
            if(this.soul > 0)
                (owner as Player).removeSoul(this);
        });
    }
    onRemoveFromPlay(): void {

    }
    get eternalCard(): string | null {
        return this._eternalCard;
    }
    get healthPoints(): number {
        return this._healthPoints;
    }
    get attackPoints(): number {
        return this._attackPoints;
    }
}
/*
* MONSTER: attackable
* BOSS: attackable that gives soul on defeat.
* EVENT: not attackable, resolve effect on encounter.
*/
enum MonsterType {MONSTER, BOSS, EVENT}
class MonsterCard extends Card {
    protected _monsterType:MonsterType;
    protected _healthPoints:number = 0;
    protected _attackPoints:number = 0;
    protected _evasion: number = 0;
    protected _reward: CardRewards;
    protected _afterEffect: "discard" | "handled" | "nothing" = "discard";
    protected _indomitable: boolean = false;

    constructor(id: number, globalId: number, json: MonsterCardType) {
        super(id, globalId, json);
        this._monsterType = MonsterType.MONSTER;
        if(["gevent", "bevent", "curse"].includes(json.subtype)) {
            this._monsterType = MonsterType.EVENT;
        }
        this._subtype = json.subtype;
        this._reward = json.rewards || {soul: 0, coin: 0, loot: 0, treasure: 0};
        // Curses handle their own placement in player.curses
        if(this.isCurse) {
            this._afterEffect = "nothing";
        }
        if(json.stats) {
            this._healthPoints = json.stats.healthPoints || 0;
            this._attackPoints = json.stats.attackPoints || 0;
            this._evasion = json.stats.evasionPoints || 0;
            this._indomitable = json.indomitable || false;
            if (json.rewards){
                if (json.rewards.soul) {
                    this._monsterType = MonsterType.BOSS;
                    if (typeof json.rewards.soul === "number") {
                        this._souls = json.rewards.soul;
                    }
                }
            }
        }
    }
    get encounterType(): MonsterType {
        return this._monsterType;
    }
    get isCurse(): boolean {
        return this.subtype === "curse";
    }
    get isEvent(): boolean {
        return this._monsterType === MonsterType.EVENT;
    }
    get indomitable(): boolean {
        return this._indomitable;
    }
    set indomitable(value: boolean) {
        this._indomitable = value;
    }
    get healthPoints(): number {
        return this._healthPoints;
    }
    get attackPoints(): number {
        return this._attackPoints;
    }
    get evasion(): number {
        return this._evasion;
    }
    get rewards(): CardRewards | undefined {
        return this._json.rewards;
    }
    /**
     * Determines what happens to the card after its effect is resolved.
     * Some cards handle their own placement after resolution.
     * For instance, curses are placed in the player's curse area and are not discarded.
     * Another example is "Delirium", that goes back into the deck 6 cards from the top.
     */
    get afterEffect(): "discard" | "nothing" | "handled"{
        return this._afterEffect;
    }
    set afterEffect(value: "discard" | "nothing" | "handled") {
        this._afterEffect = value;
    }
    async onPlay(issuer: Player, targets: any[] = []): Promise<void>{
        return this._effectInterface.onPlay(issuer, targets)();
    }
}

class BsoulCard extends Card {
    granted: boolean = false;

    override get jsonAPI(): BonusSoulCard {
        return {
            ...super.jsonAPI,
            globalId: this._globalId,
            granted: this.granted,
            counters: this.counters.json ,
        };
    }
    
    constructor(id: number, globalId: number, json: BonusSoulCardType) {
        super(id, globalId, json);
        if (json.rewards && json.rewards.soul) {
            if(typeof json.rewards.soul === "number")
            {
                this._souls = json.rewards.soul;
            }
        }
    }
}
/**
 * Type mapping from Card classes to their corresponding JSON types
 */
type CardToJsonType<T extends Card> = 
    T extends LootCard ? LootCardType :
    T extends EternalCard ? EternalCardType :
    T extends CharacterCard ? CharacterCardType :
    T extends TreasureCard ? TreasureCardType :
    T extends MonsterCard ? MonsterCardType :
    T extends BsoulCard ? BonusSoulCardType :
    T extends RoomCard ? RoomCardType :
    GenericCardType;

/**
 * Creates a card instance from JSON data based on its type.
 * Overloaded signatures provide type inference based on JSON type.
 */
function createCardFromJson(id: number, globalId: number, json: LootCardType): LootCard;
function createCardFromJson(id: number, globalId: number, json: TreasureCardType): TreasureCard;
function createCardFromJson(id: number, globalId: number, json: EternalCardType): EternalCard;
function createCardFromJson(id: number, globalId: number, json: CharacterCardType): CharacterCard;
function createCardFromJson(id: number, globalId: number, json: MonsterCardType): MonsterCard;
function createCardFromJson(id: number, globalId: number, json: BonusSoulCardType): BsoulCard;
function createCardFromJson(id: number, globalId: number, json: RoomCardType): RoomCard;
function createCardFromJson(id: number, globalId: number, json: GenericCardType): Card;
function createCardFromJson(id: number, globalId: number, json: GenericCardType): Card {
    switch (json.type) {
        case "loot":
            return new LootCard(id, globalId, json);
        case "treasure":
            return new TreasureCard(id, globalId, json);
        case "eternal":
            return new EternalCard(id, globalId, json);
        case "character":
            return new CharacterCard(id, globalId, json);
        case "monster":
            return new MonsterCard(id, globalId, json);
        case "bsoul":
            return new BsoulCard(id, globalId, json);
        case "room":
            return new RoomCard(id, globalId, json);
        default:
            console.log(`Unknown card: ${json}, adding as generic Card.`);
            return new Card(id, globalId, json);
    }
}

class CardSet<T extends Card> {
    protected _set: T[];
    protected _type: string;
    constructor(type: string) {
        this._type = type
        this._set = []
    }
    addCard(json: GenericCardType, globalId: number) : void{
        this._set.push(createCardFromJson(this._set.length, globalId, json) as T);
        return;
    }
    get(id: number) : T {
        if(this._set === undefined) {
            throw new GameError(`Card set of type ${this._type} is undefined.`, toSerializedTranslation("error.cardSetTypeUndefined", {type: this._type}));
        }
        if (id < 0 || id >= this._set.length) {
            throw new GameError(`Card id ${id} is out of bounds for card set of length ${this._set.length}`, toSerializedTranslation("error.cardIdOutOfBoundsForCardSet", {id: id, value: this._set.length}));
        }
        if(typeof this._set[id] === "undefined" || this._set[id] === null) {
            throw new GameError(`Card id ${id} is undefined or null in card set of type ${this._type}.`, toSerializedTranslation("error.cardIdUndefinedInCardSet", {id: id, type: this._type}));
        }
        return this._set[id];
    }

    id(card: T) : number {
        const index = this._set.indexOf(card);
        if (index === -1) {
            throw new GameError(`Card not found in card set.`, toSerializedTranslation("error.cardNotFoundInCardSet"));
        }
        return index;
    }
    get type() : string{ 
        return this._type; }
    get length() : number{ 
        return this._set.length; }
    get cards() : T[] { 
        return this._set; 
    }
    showAllCards() : void {
        this._set.forEach((card) => {
            console.log(card);
        });
    }
}
/*
* Loads card sets from an array of json cards.
* Returns a dictionary of card sets indexed by their type.
*/
function LoadsCardSets(json_array: GenericCardType[]) : {nextGlobalId: number, cardSets: CardSetsCollection} {
    const sets: CardSetsCollection = {
        loot: new CardSet<LootCard>('loot'),
        treasure: new CardSet<TreasureCard>('treasure'),
        eternal: new CardSet<EternalCard>('eternal'),
        character: new CardSet<CharacterCard>('character'),
        monster: new CardSet<MonsterCard>('monster'),
        bsoul: new CardSet<BsoulCard>('bsoul'),
        room: new CardSet<RoomCard>('room'),
    };
    json_array.sort((a, b) => 
        (a.name + a.slug).localeCompare(b.name + b.slug)
    );
    let globalId = 0;
    for(let index:number = 0; index < json_array.length; index++) {
        const card_json = json_array[index];
        if (typeof card_json === "undefined" || card_json === null) {
            throw new GameError(`Card id ${card_json} is undefined or null in card set.`,
                toSerializedTranslation("error.cardIdUndefinedInCardSet", {id: card_json, type: "unknown"})
            );
        }
        const type: string = String(card_json.type);
        
        switch(type) {
            case "loot":
                sets.loot.addCard(card_json, globalId++);
                break;
            case "treasure":
                sets.treasure.addCard(card_json, globalId++);
                break;
            case "eternal":
                sets.eternal.addCard(card_json, globalId++);
                break;
            case "character":
                sets.character.addCard(card_json, globalId++);
                break;
            case "monster":
                sets.monster.addCard(card_json, globalId++);
                break;
            case "bsoul":
                sets.bsoul.addCard(card_json, globalId++);
                break;
            case "room":
                sets.room.addCard(card_json, globalId++);
                break;
            default:
                throw new GameError(`Unknown card type: ${type}. Only loot, treasure, eternal, room, character, monster, bsoul, and room are allowed.`,
                    toSerializedTranslation("error.behaviorError", {error: `Unknown card type: ${type}. Only loot, treasure, eternal, room, character, monster, bsoul, and room are allowed.`})
                );
        }
    }
    return {nextGlobalId: globalId, cardSets: sets};
}

class Deck<T extends Card> {
    _type: DeckType;
    _nextId: number;
    _set: CardSet<T>
    _order: number[];
    _discard: number[];
    _game: Game;

    constructor(set: CardSet<T>, type: DeckType, order: number[], game: Game) {
        // Type of cards in the deck.
        this._type = type;
        // Set of all the cards that can belong to the deck.
        this._set = set;
        // reverse order of the cards ids remaining in the deck.
        this._order = order.reverse();
        this._nextId = order.length - 1;
        // Set of discarded cards of the deck.
        this._discard = [];
        this._game = game;

        order.forEach((id) => {
            const card = this._set.get(id);
        });
    }

    get nextId(): number {
        return ++this._nextId;
    }

    get length(): number {
        return this._order.length;
    }

    shuffle(): void {
        shuffle<number>(this._game.random, this._order)
    }

    get translatedType(): SerializedTranslation {
        return toSerializedTranslation(`startStep.gameParams.decks.${this._type}`);
    }

    remove(card:T): void
    {
        assertCardMatchesDeck(this._type, card);
        const cardId = card.id;
        const setCardId = this._set.id(card);
        if(cardId !== setCardId)
        {
            throw new GameError("Card to remove does not belong to this deck's card set.",
                toSerializedTranslation("error.cardToRemoveNotInDeckCardSet")
            );
        }
        const index = this._order.indexOf(cardId);
        if(index >= 0)
        {
            this._order.splice(index, 1);
        }
        else{
            const discardIndex = this._discard.indexOf(cardId);
            if(discardIndex >= 0)
            {
                this._discard.splice(discardIndex, 1);
            }
            else{
                throw new GameError("Card to remove not found in deck or discard pile.",
                    toSerializedTranslation("error.cardToRemoveNotFoundInDeckOrDiscard")
                );
            }
        }
        this._game.cardHandler.ensureEffectsAttached(card);
    }

    draw(): T {
        return this.drawCardAt(0);
    }
    get cards(): T[] {
        return this._order.map((id) => this._set.get(id)).reverse();
    }
    drawSeveral(n: number): T[] {
        const cards = Array(n)
        for (let i = 0; i < n; i++) {
            if (this._order.length == 0) {
                this.resetDiscard();
            }
            cards[i] = this.draw();
        }
        return cards;
    }

    drawCardAt(positionFromTop: number): T {
        if (this._order.length - 1 < positionFromTop + 1) {
            this.resetDiscard();
        }
        const posFromEnd: number = this._order.length - 1 - positionFromTop;
        if (posFromEnd >= this._order.length) {
            this._game.isGameOver = true;
            throw new GameError(`Cannot draw card at position ${positionFromTop} from top, deck of type ${this._type} has only ${this._order.length} cards.`,
                toSerializedTranslation("error.cannotDrawCardAtPositionFromTop", {value: positionFromTop, type: this._type, count: this._order.length})
            );
        }
        if(posFromEnd < 0 || this._order.length === 0)
        {
            this._game.isGameOver = true;
            throw new GameError(`Cannot draw card at position ${positionFromTop} from top even after resetting discard, deck of type ${this._type} has only ${this._order.length} cards.`,
                toSerializedTranslation("error.cannotDrawCardAtPositionFromTopAfterReset", {value: positionFromTop, type: this._type, count: this._order.length})
            );
        }
        const id: number = this._order[posFromEnd]!;
        if(id === undefined || id === null) {
            throw new GameError(`Card id at position ${positionFromTop} from top is undefined or null in deck of type ${this._type}.`,
                toSerializedTranslation("error.cardIdAtPositionUndefined", {value: positionFromTop, type: this._type})
            );
        }
        if(this._set === undefined) {
            throw new GameError(`Card set of type ${this._type} is undefined.`,
                toSerializedTranslation("error.cardSetTypeUndefined", {type: this._type})
            );
        }
        // console.log(`Drawing card id ${id} from deck of type ${this._type} at position from top ${positionFromTop}.`);
        const result = this._set.get(id);
        this._order.splice(posFromEnd, 1);
        this._game.cardHandler.ensureEffectsAttached(result);
        return result;
    }

    addTopPosition(card: T): void {
        assertCardMatchesDeck(this._type, card);
        this.addCardAtPosFromTop(card, 0);
    }

    addBottomPosition(card: T): void {
        assertCardMatchesDeck(this._type, card);
        this.addCardAtPosFromTop(card, this._order.length);
    }
    addCardAtPosFromTop(card: T, positionFromTop: number): void {
        assertCardMatchesDeck(this._type, card);
        if(positionFromTop > this._order.length)
            this.resetDiscard();
        const posFromEnd = Math.max(this._order.length - positionFromTop, 0);
        this._order.splice(posFromEnd, 0, card.id);
    }
    addRandomPosition(card: T): void {
        assertCardMatchesDeck(this._type, card);
        const randomIdx = Math.floor(this._game.random() * this._order.length);
        this.addCardAtPosFromTop(card, randomIdx);
    }

    addDiscardTop(card: T): void {
        assertCardMatchesDeck(this._type, card);
        this._discard.push(card.id);
    }

    getFromDiscard(card: T): boolean {
        assertCardMatchesDeck(this._type, card);
        const cardId = card.id;
        const setCardId = this._set.id(card);
        if(cardId !== setCardId)
        {
            throw new GameError("Card to get from discard does not belong to this deck's card set.",
                toSerializedTranslation("error.behaviorError", {error: "Card to get from discard does not belong to this deck's card set."})
            );
        }
        const index = this._discard.indexOf(cardId);
        if(index >= 0)
        {
            this._discard.splice(index, 1);
            return true;
        }
        return false;
    }

    drawTopDiscard(): T | null {
        if (this._discard.length === 0) {
            return null;
        }
        const id = this._discard.pop()!;
        if (typeof id === "undefined" || id === null) {
            throw new GameError(`Card id drawn from discard pile is undefined or null in deck of type ${this._type}.`,
                toSerializedTranslation("error.drawnDiscardCardIdUndefined", {type: this._type})
            );
        }
        const result = this._set.get(id);
        this._game.cardHandler.ensureEffectsAttached(result);
        return result;
    }

    get discard(): T[] {
        const result = []
        for (let i = this._discard.length - 1; i >= 0; i--) {
            const id = this._discard[i];
                if (typeof id !== "undefined" && id !== null) {
                    result.push(this._set.get(id));
                }
                
        }
        return result;
    }

    shuffleDiscard(): void {
        shuffle<number>(this._game.random, this._discard);
    }

    resetDiscard(): void {
        this.shuffleDiscard();
        this._order = this._discard.concat(this._order);
        this._discard = [];
    }
    getCardFromSlug(slug: string, globalId?: number) : T|undefined {
        const res = this.getCard((card) =>
            card.slug === slug && (globalId === undefined || card.globalId === globalId)
        );
        // if( res === undefined ) {
        //     throw new GameError(
        //         globalId === undefined
        //             ? `No card with slug ${slug} found in deck of type ${this._type}.`
        //             : `No card with slug ${slug} and global id ${globalId} found in deck of type ${this._type}.`
        //     );
        // }
        return  res;
    }
    getCard(filter: (card: T) => boolean) : T|undefined {
        for (let i = 0; i < this._order.length; i++) {
            const id = this._order[i];
            if (typeof id !== "undefined" && id !== null) {
                const card = this._set.get(id);
                if (filter(card)) {
                    const positionFromTop = this._order.length - 1 - i;
                    // console.log(`Found card ${card.slug} at position from top ${positionFromTop}.`);
                    const card: T = this.drawCardAt(positionFromTop);
                    return card;
                }
            }
        }
        return undefined;
    }

    getCards(filter: (card: T) => boolean) : T[] {
        const result: T[] = [];
        for (let i = 0; i < this._order.length; i++) {
            const id = this._order[i];
            if (typeof id !== "undefined" && id !== null) {
                const card = this._set.get(id);
                if (filter(card)) {
                    const positionFromTop = this._order.length - 1 - i;
                    // console.log(`Found card ${card.slug} at position from top ${positionFromTop}.`);
                    result.push(this.drawCardAt(positionFromTop)!);
                }
            }
        }
        return result;
    }
    ////// debug //////
    displayAllCards(): void {
        this._order.forEach((id) => {
            const card = this._set.get(id);
            console.log(card?.slug);
        });
    }
    displayOrder(): void {
        console.log(this._order.reverse());
        this._order.reverse();
    }
}

class Hand {
    _hand: LootCard[];
    constructor() {
        this._hand = []
    }
    get length(): number {
        return this._hand.length;
    }
    get cards(): LootCard[] {
        return this._hand;
    }
    addToHand(card: LootCard): void {
        if (card.type !== "loot") {
            print("Error, hand should only contain loot cards.")
            throw new GameError("Hand can only contain loot cards.",
                toSerializedTranslation("error.behaviorError", {error: "Hand can only contain loot cards."})
            );
        }
        this._hand.push(card);
    }
    moveCardToPos(from: number, to: number): void {
        const card: LootCard = this._hand[from]!;
        this._hand.splice(from, 1);
        this._hand.splice(to, 0, card);
    }
    removeFromHandByPos(pos: number) : LootCard {
        const card: LootCard = this._hand[pos]!;
        this._hand.splice(pos, 1);
        return card;
    }
    removeCard(target: LootCard): boolean{
        const index = this._hand.indexOf(target);
        if(index >= 0)
        {
            this.removeFromHandByPos(index);
            return true;
        }
        return false;
    }
    playCard(index: number) : LootCard {
        return this.removeFromHandByPos(index);
    }
}

export function isDeckType(value: string): value is DeckType {
    return ['loot', 'treasure', 'eternal', 'character', 'monster', 'bsoul', 'room'].includes(value);
}

export function assertCardMatchesDeck<T extends DeckType>(
    deckName: T,
    card: Card
): asserts card is DeckTypeToCardType[T] {
    if (card === undefined || card.type !== deckName) {
        throw new GameError(`Card type ${card?.type} doesn't match deck ${deckName}`,
            toSerializedTranslation("error.cardTypeDoesNotMatchDeck", {cardType: card?.type || "undefined", deckType: toSerializedTranslation(`startStep.gameParams.decks.${deckName as DeckName}`)})
        );
    }
}

function createEmptyDecksCollection(game: Game): DecksCollection {
    const emptyCardSets = {
        loot: new CardSet<LootCard>('loot'),
        treasure: new CardSet<TreasureCard>('treasure'),
        eternal: new CardSet<EternalCard>('eternal'),
        character: new CardSet<CharacterCard>('character'),
        monster: new CardSet<MonsterCard>('monster'),
        bsoul: new CardSet<BsoulCard>('bsoul'),
        room: new CardSet<RoomCard>('room')
    };
    return {
        loot: new Deck(emptyCardSets.loot, 'loot', [], game),
        treasure: new Deck(emptyCardSets.treasure, 'treasure', [], game),
        eternal: new Deck(emptyCardSets.eternal, 'eternal', [], game),
        character: new Deck(emptyCardSets.character, 'character', [], game),
        monster: new Deck(emptyCardSets.monster, 'monster', [], game),
        bsoul: new Deck(emptyCardSets.bsoul, 'bsoul', [], game),
        room: new Deck(emptyCardSets.room, 'room', [], game)
    };
}

// Module-level cache for getCardsByCopy results - avoids recomputing across game instances
const cardSetCopyCache = new WeakMap<CardSet<any>, any[][]>();

function getCardsByCopy<T extends Card>(set: CardSet<T>): T[][] {
    // Return cached result if available
    if (cardSetCopyCache.has(set)) {
        return cardSetCopyCache.get(set)!;
    }
    const copies: T[][] = [];
     for (let i = 0; i < set.length; i++) {
        const card = set.get(i);
        const copyIndex = copies.findIndex((copyGroup) => copyGroup[0]!.isSameCard(card));
        if (copyIndex === -1) {
            copies.push([card]);
        } else {
            copies[copyIndex]!.push(card);
        }
    }
    // Cache the result for future calls with the same CardSet
    cardSetCopyCache.set(set, copies);
    return copies;
}
function LoadDecks(json_array: GenericCardType[], numPlayers: number, parameters: GameParameters, game: Game) : DecksCollection {
    // Create fresh CardSets from JSON to ensure independent card instances
    let {nextGlobalId, cardSets: decks_cardSets} = LoadsCardSets(json_array);
    
    const decks = {} as DecksCollection;
    const cardTypes: (keyof CardSetsCollection)[] = ['loot', 'treasure', 'eternal', 'character', 'monster', 'bsoul', 'room'];
    for (const type of cardTypes) {
        const set = decks_cardSets[type] as CardSet<any>;
        if (set.length === 0) {
            continue;
        }
        
        const range = [];
        if(type === 'eternal')
            for (let i = 0; i < set.length; i++) {
                range.push(i);
            }
        else
        {
            const copies = getCardsByCopy<Card>(decks_cardSets[type] as CardSet<Card>);
            const paramType = type as 'character' | 'loot' | 'treasure' | 'monster' | 'bsoul' | 'room';
            const paramCards = parameters[paramType].json(); // Cache to avoid repeated calls
            
            // Build slug→copies Map for O(1) lookup instead of O(n) search
            const slugToCopies = new Map<string, Card[]>();
            for (const copyGroup of copies) {
                if (copyGroup.length > 0) {
                    slugToCopies.set(copyGroup[0]!.slug, copyGroup);
                }
            }
            
            for (const cardParam of paramCards) {
                const copyGroup = slugToCopies.get(cardParam.slug);
                if (copyGroup === undefined) {
                    throw new GameError(`Card with slug ${cardParam.slug} not found in card set of type ${type}.`,
                        toSerializedTranslation("error.cardSlugNotFoundInCardSet", {slug: cardParam.slug, type: type})
                    );
                }
                let next_set_id = 0;
                let createCopy = false;
                for(let counter = 0; counter < cardParam.count; counter++) {
                    let nextId = copyGroup[next_set_id]!.id;
                    if (createCopy) {
                        nextId = decks_cardSets[type]!.length;
                        decks_cardSets[type]!.cards.push(createCardFromJson(nextId, nextGlobalId++, copyGroup[next_set_id]!.json) as any);
                    }
                    range.push(nextId);
                    next_set_id = (next_set_id + 1) % copyGroup.length;
                    if(next_set_id === 0)
                        createCopy = true;
                }
            }
        }
        shuffle<number>(game.random, range);
        (decks as any)[type] = new Deck(set, type, range, game);
    }
    
    return decks;
}

function isSameSlug(slug: string, card: Card) : boolean   
{
    return card.slug === slug;
}

function randomCardFromSet<T extends Card>(set: CardSet<T>, random: () => number) : T {
    const randomIndex = Math.floor(random() * set.length);
    const card = set.get(randomIndex);
    if (card === undefined) {
    throw new GameError(`Card id ${randomIndex} is out of bounds for card set of length ${set.length}`,
        toSerializedTranslation("error.cardIdOutOfBoundsForCardSet", {id: randomIndex, value: set.length})
    );
    }
    return card;
}
export class Counter
{
    private _type: CounterType;
    private _value: number;

    constructor(type: CounterType, initialValue: number)
    {
        this._type = type;
        this._value = initialValue;
    }

    get value(): number{
        return this._value;
    }
    get hasCounter(): boolean{
        return this.value > 0;
    }
    
    get type(): CounterType{
        return this._type;
    }

    addToValue(toAdd: number): void
    {
        this._value = Math.max(0, this._value + toAdd);
    }

    resetValue(): void
    {
        this._value = 0;
    }   
}

export class CounterHandler{
    private counters: Map<CounterType, Counter> = new Map();
    constructor(){}
    get counterOwned(): CounterType[]{
        const res: CounterType[] = [];
        this.counters.forEach((value, key) => {if(value.value > 0) res.push(key)});
        return res;
    }
    getCounter(type: CounterType): Counter{
        if(this.counters.get(type) === undefined)
            this.counters.set(type, new Counter(type, 0));
        return this.counters.get(type)!;
    }
    value(type: CounterType): number{
        return this.getCounter(type).value;
    }
    isDefined(type: CounterType): boolean{
        return this.counters.get(type) !== undefined;
    }
    getIfDefined(type: CounterType): number | undefined{
        return this.isDefined(type) ? this.value(type) : undefined;
    }
    addToCounter(toAdd: number, type: CounterType): void
    {
        const counter = this.getCounter(type);
        counter.addToValue(toAdd);
    }
    reset(type: CounterType): void{
        this.getCounter(type).resetValue();
    }
    hasCounter(type: CounterType): boolean{
        return this.getCounter(type).hasCounter;
    }

    get json(): SerializedCounter[] | undefined{
        const arr: SerializedCounter[] = this.counterOwned.map(t => {
            return {
                type: t,
                value: this.getIfDefined(t)!,
            }});
        if(arr.length > 0)
            return arr;
        return undefined;
    }

}

export { EffectData } from './types/cardTypes';
export type { CardSetsCollection, DecksCollection, DeckType, DeckTypeToCardType, EffectFunction, EffectType, TargetsSelector } from './types/cardTypes';
export { BsoulCard, Card, CardSet, CharacterCard, createCardFromJson, createEmptyDecksCollection, Deck, EternalCard, Hand, InplayType, isSameSlug, LoadDecks, LoadsCardSets, LootCard, MonsterCard, MonsterType, randomCardFromSet, TreasureCard as TreasureCard };

