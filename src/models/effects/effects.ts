    import { type EffectFunction, type TargetsSelector, type EffectType, EffectData, Card, type EffectRange, LootCard } from "../cards";
import { EffectOnStack } from '../stackElement';
import type { Entity } from "../entities/entity";
import type { Player } from "../entities/player";
import { TargetBuilder } from "../targetBuilder";
import { isChooseOneOptions } from "../targetSelector";
import { combineEffectFunctions } from "./activeEffect";
import type { ActiveEffectEntry, SerializedChooseOne, VisualEffectBox } from "@/shared/api";
import type { SyncEffectFunction } from "../types/cardTypes";
import { toSerializedTranslation } from "@/utils/translation";
import { GameError } from "@/models/GameError";

export class Effect {
    protected _card: Card;
    protected _description: string;
    protected _effectFunction: EffectFunction;
    protected _paymentFunction?: EffectFunction;
    protected _targetsSelector: TargetsSelector[];
    protected _cleanup: () => void = () => { };
    protected _type: EffectType;
    protected _range: EffectRange;
    // protected _cleanup: () => void = () => {};
    constructor(description: string,
        type: EffectType,
        card: Card,
        effectFunction: EffectFunction = (data: EffectData): boolean => { return true; },
        targetsSelector: TargetsSelector[] = [{ description: toSerializedTranslation("common.empty"), selector: (issuer: Player, card: Card): Entity[] => [], min: 0, max: 0 }],
        range: EffectRange,
        paymentFunction?: EffectFunction,
    ) {
        this._description = description;
        this._type = type;
        this._effectFunction = effectFunction;
        this._targetsSelector = targetsSelector;
        this._paymentFunction = paymentFunction;
        this._card = card;
        this._range = range;
    }

    get card(): Card {
        return this._card;
    }
    get description(): string {
        return this._description;
    }
    get range(): EffectRange {
        return this._range;
    }
    getVisualEffectBoxFromTargets(targets: any[]): VisualEffectBox | undefined {
        // console.log("for effect", this.description, this.range.length);
        if(this.range.length === 1)
            return this.range[0];
        if(targets.length === 0)
            return undefined;
        
        if(typeof targets[0] !== "string") {
            return undefined;
        }
        // console.log("Getting visual effect box for effect", this.description,targets[0], "with range", this.range);
        const box = this.range.find(box => box.description.toLowerCase() === targets[0].toLowerCase());
        return box;
    }
    get targetsSelector(): TargetsSelector[] {
        return this._targetsSelector;
    }
    set effectFunction(effectFunction: EffectFunction) {
        this._effectFunction = effectFunction;
    }
    get effectFunction(): EffectFunction {
        return this._effectFunction;
    }

    get type(): EffectType {
        return this._type;
    }

    hasPayment(): boolean {
        return this._paymentFunction !== undefined;
    }

    async executePayment(data: EffectData): Promise<boolean> {
        if (!this._paymentFunction) {
            throw new GameError("Cannot execute payment: no payment function defined",
                toSerializedTranslation("error.cannotExecutePaymentNoFunction")
            );
        }
        return this._paymentFunction(data);
    }

    async execute(data: EffectData): Promise<boolean> {
        return this._effectFunction(data);
    }

    // Target validation methods
    private chooseOneTargetStillValid(issuer: Player, chooseOneArray: any[]): boolean {
        // Flat array format: ["description", ...targets]
        if (!Array.isArray(chooseOneArray) || chooseOneArray.length === 0) return false;

        const descr = chooseOneArray[0];
        if (typeof descr !== 'string') return false;

        const targetsList = chooseOneArray.slice(1);
        if (targetsList.length > 0) {
            for (const admissibleTarget of this._targetsSelector[0]!.selector(issuer, this.card)) {
                if (admissibleTarget.description.toLowerCase() === descr.toLowerCase()) {
                    let admisibleTargetsIndex = 0;
                    let nbTargetsForSelector = 0;
                    for (const t of targetsList) {
                        if (((admissibleTarget.admissibleTargets[admisibleTargetsIndex]) as TargetsSelector).selector(issuer, this.card).includes(t)) {
                            nbTargetsForSelector++;
                        } else if (nbTargetsForSelector >= ((admissibleTarget.admissibleTargets[admisibleTargetsIndex]) as TargetsSelector).min) {
                            admisibleTargetsIndex++;
                        } else {
                            return false;
                        }
                    }
                    return true;
                }
            }
        }
        return true;
    }

    targetStillValid(issuer: Player, targets: any[]): boolean {
        if (targets.length === 0) return true;

        // Check if the first selector is a choose-one selector
        if (this._targetsSelector.length > 0) {
            const firstSelector = this._targetsSelector[0]!;
            const admissibleTargets = firstSelector.selector(issuer, this.card);

            // If this is a choose-one selector and targets are provided
            if (admissibleTargets.length > 0 && isChooseOneOptions(admissibleTargets[0])) {
                // The entire targets array IS the flat choose-one format: ["description", ...targets]
                if (typeof targets[0] === 'string') {
                    return this.chooseOneTargetStillValid(issuer, targets);
                }
                return false;
            }
        }

        // Regular format validation: [target1, target2, target3]
        let targetIndex = 0;

        for (let i = 0; i < this._targetsSelector.length; i++) {
            if (targetIndex >= targets.length) break;

            const selector = this._targetsSelector[i]!;
            const admissibleTargets = selector.selector(issuer, this.card);

            if (admissibleTargets.length > 0 && isChooseOneOptions(admissibleTargets[0])) {
                // Should not reach here with new format
                return this.chooseOneTargetStillValid(issuer, targets.slice(targetIndex));
            } else {
                // Regular selector - check the next `selector.max` targets
                for (let j = 0; j < selector.max && targetIndex < targets.length; j++) {
                    const target = targets[targetIndex];
                    if (!admissibleTargets.includes(target)) {
                        if (j >= selector.min) {
                            // If we have already validated the minimum required targets, we can ignore extra invalid targets
                            break;
                        }
                        return false;
                    }
                    targetIndex++;
                }
            }
        }

        return true;
    }

}

export class PassiveEffect extends Effect {
    override _effectFunction: SyncEffectFunction;

    constructor(description: string,
        type: EffectType,
        card: Card,
        effectFunction: SyncEffectFunction = (data: EffectData): boolean => { return true; },
        targetsSelector: TargetsSelector[] = [{ description: toSerializedTranslation("common.empty"), selector: (issuer: Player, card: Card): Entity[] => [], min: 0, max: 0 }],
        range: EffectRange,
        paymentFunction?: EffectFunction,
    ) {
        super(description, type, card, effectFunction, targetsSelector, range, paymentFunction);
        this._effectFunction = effectFunction;
    }
    override get effectFunction(): SyncEffectFunction {
        return this._effectFunction;
    }
}

function combineEffects(effect1: Effect, effect2: Effect): Effect {
    if (effect1.type !== "active" || effect2.type !== "active") {
        throw new GameError("Only active effects can be combined.",
            toSerializedTranslation("error.onlyActiveEffectsCanBeCombined")
        );
    }
    const descr = `${effect1.description} ${effect2.description}`;
    const effect = combineEffectFunctions([effect1.effectFunction, effect2.effectFunction]);
    return new Effect(descr, "active", effect1.card, effect, effect1.targetsSelector.concat(effect2.targetsSelector), effect1.range.concat(effect2.range));

}
// Effect handler manages multiple effects of the same type of a card.
class EffectHandler {
    protected _effects: Effect[] = [];
    protected _effectNames: string[] = [];
    protected cleaners: (() => void)[] = [];

    cleanupAll(): void {
        for (const cleaner of this.cleaners) {
            cleaner();
        }
        this.cleaners = [];
        this._effects = [];
    }

    get effectNames(): string[] {
        if(this._effectNames.length !== this._effects.length)
            this._effectNames = this._effects.map(e => e.description);
        return this._effectNames;
    }
}
class PassiveEffectHandler extends EffectHandler {
    protected _type: "passive" = "passive";
    override _effects: PassiveEffect[] = [];
    addEffect(effect: PassiveEffect): void {
        if (effect.type === "passive")
            this._effects.push(effect);
        else throw new GameError("Cannot put a non-passive effect in a PassiveEffectHandler.",
            toSerializedTranslation("error.behaviorError", { error: "Cannot put a non-passive effect in a PassiveEffectHandler." })
        );
    }
    subscribeAll(issuerProvider: () => Entity, it: Card): void {
        for (const effect of this._effects) {
            // Passive effects don't have targets, pass empty array
            const targets: any[] = [];
            // if(effect.targetsSelector.length > 0) {
            //     targets = effect.targetsSelector.map(selector => { selector.selector(owner as Player)[0]; });
            // }
            effect.effectFunction(new EffectData(it, issuerProvider, targets, effect.getVisualEffectBoxFromTargets(targets)));
        }
    }
}
class ActiveEffectHandler extends EffectHandler {
    protected _type: "active" = "active";
    protected _activeEffect: Effect | null = null;
    private _requiresDiceWillRoll: boolean = false;

    addEffect(effect: Effect): void {
        if(this._requiresDiceWillRoll === false)
            this._requiresDiceWillRoll = (effect.targetsSelector.findIndex(t => t.description.key === "selector.diceWillRoll") !== -1);
        switch (effect.type) {
            case "active":
                if (this._activeEffect !== null) {
                    this._activeEffect = combineEffects(this._activeEffect, effect);
                }

                else
                    this._activeEffect = effect;
                break;
            case "paid":
                this._effects.push(effect);
                break;
            default:
                throw new GameError("Cannot put a passive effect in an ActiveEffectHandler.",
                    toSerializedTranslation("error.behaviorError", { error: "Cannot put a passive effect in an ActiveEffectHandler." })
                );
        }   
    }

    getActiveEffect(): Effect {
        if (this._activeEffect === null) {
            throw new GameError("No active effect found in ActiveEffectHandler.",
                    toSerializedTranslation("error.behaviorError", { error: "No active effect found in ActiveEffectHandler." })

            );
        }
        return this._activeEffect;
    }
    get requiresDiceWillRoll(){
        return this._requiresDiceWillRoll;
    }
    get nbPaidEffects(): number {
        return this._effects.length;
    }

    async activate(issuer: Entity, it: Card, targets: any[]): Promise<boolean> {
        if (this._activeEffect === null) {
            throw new GameError("No active effect found in ActiveEffectHandler.",
                toSerializedTranslation("error.behaviorError", { error: "No active effect found in ActiveEffectHandler." })
            );
        }
        return this._activeEffect.effectFunction(new EffectData(it, () => issuer as Player, targets, this._activeEffect!.getVisualEffectBoxFromTargets(targets)));
    }

    async pay(issuer: Entity, it: Card, targets: any[], effectId: number): Promise<boolean> {
        const effect = this.getPaidEffect(effectId);
        return effect.effectFunction(new EffectData(it, () => issuer as Player, targets, effect.getVisualEffectBoxFromTargets(targets)));
    }

    hasTapEffect(): boolean {
        return this._activeEffect !== null;
    }

    getPaidEffect(index: number): Effect {
        const paidEffects = this._effects[index];
        if (!paidEffects) {
            throw new GameError(`Paid effect at index ${index} not found.`,
                toSerializedTranslation("error.behaviorError", { error: `Paid effect at index ${index} not found.` })
            );
        }
        return paidEffects;
    }

    getTargetSelectors(index: number | "tap"): TargetsSelector[] {
        if (index === "tap")
            return this.getActiveEffect().targetsSelector || [];
        else
            return this._effects[index]?.targetsSelector || [];
    }

    getPaidEffectId(description: string): number {
        const idx = this._effects.findIndex((effect) => effect.description === description);
        if (idx === -1) {
            throw new GameError(`Effect with description "${description}" not found in effect list ${this._effects.map(e => e.description).join(", ")}.`,
                toSerializedTranslation("error.behaviorError", { error: `Effect with description "${description}" not found in effect list ${this._effects.map(e => e.description).join(", ")}.` })
            );
        }
        return idx;
    }
}
export class EffectInterface {
    private activeEffects: ActiveEffectHandler;
    private passiveEffects: PassiveEffectHandler;
    protected _issuer: Player | undefined;
    protected it: Card;
    protected _mapSepIdToActiveEffectId: Map<number, number | "tap"> = new Map(); // Maps separator IDs to paid effect indices
    constructor(it: Card) {
        this.activeEffects = new ActiveEffectHandler();
        this.passiveEffects = new PassiveEffectHandler();
        this.it = it;
    }

    reset(): void {
        this.activeEffects = new ActiveEffectHandler();
        this.passiveEffects = new PassiveEffectHandler();
    }

    addEffect(effect: Effect | PassiveEffect): void {
        if (effect.type === "passive") {
            if(effect instanceof PassiveEffect === false)
                throw new GameError(`Effect "${effect.description}" is not a passive effect.`,
                    toSerializedTranslation("error.behaviorError", { error: `Effect "${effect.description}" is not a passive effect.` })
                );
            this.passiveEffects.addEffect(effect);
        } else {
            // console.log(`Adding effect "${effect.description}" of type "${effect.type}" to card ${this.it.slug}.`);
            for(const boxId of effect.range) {
                // console.log(boxId);
                for(let i = boxId.startIndex; i < boxId.endIndex + 1; i++) {
                    if(this._mapSepIdToActiveEffectId.has(i))
                        throw new GameError(`Duplicate separator ID ${boxId} in card ${this.it.slug}. Each effect range separator must be unique.`,
                            toSerializedTranslation("error.behaviorError", { error: `Duplicate separator ID ${boxId} in card ${this.it.slug}. Each effect range separator must be unique.` })
                        );
                    this._mapSepIdToActiveEffectId.set(i, effect.type === "active" ? "tap" : this.activeEffects.nbPaidEffects);
                }
            }
            this.activeEffects.addEffect(effect);
        }
    }
    get requiresDiceWillRoll(): boolean{
        return this.activeEffects.requiresDiceWillRoll;
    }
    getEffectIdAndChooseOneChoiceFromSeparatorId(id: number): { effectId: number | "tap"; choice?: SerializedChooseOne[] } {
        const effectId = this._mapSepIdToActiveEffectId.get(id);
        if (effectId === undefined) {
            throw new GameError(`Separator ID ${id} not found in effect map for card ${this.it.slug}.`,
                toSerializedTranslation("error.behaviorError", { error: `Separator ID ${id} not found in effect map for card ${this.it.slug}.` })
            );
        }
        const effect = effectId === "tap" ? this.activeEffects.getActiveEffect() : this.activeEffects.getPaidEffect(effectId);
        if(effect.range.length === 1)
            return { effectId };
        for(let i = 0; i < effect.range.length; i++) {
            if(effect.range[i]!.startIndex <= id && id <= effect.range[i]!.endIndex!){
                return { effectId, choice: [{description: effect.range[i]!.description.toLowerCase().replaceAll("!",""), visualEffectBox: effect.range[i]!, card: this.it.jsonAPI}] };}
        }
        throw new GameError(`Separator ID ${effectId} does not fall within any effect range for card ${this.it.slug}.`,
            toSerializedTranslation("error.behaviorError", { error: `Separator ID ${effectId} does not fall within any effect range for card ${this.it.slug}.` })
        );
    }

    hasTapEffect(): boolean {
        return this.activeEffects.hasTapEffect();
    }

    subscribeAll(issuerProvider: () => Entity, differentSource: Card | undefined = undefined): void {
        this.passiveEffects.subscribeAll(issuerProvider, differentSource === undefined ? this.it : differentSource);
    }

    async paidEffect(issuer: Entity, targets: any[], effectId: number, differentSource: Card | undefined): Promise<EffectOnStack> {
        const effect = this.activeEffects.getPaidEffect(effectId);
        const data = new EffectData(differentSource === undefined ? this.it : differentSource, () => issuer as Player, targets);
        // Execute payment if it exists
        if (effect.hasPayment()) {
            if (!await effect.executePayment(data)) {
                throw new GameError(`Payment denied for ${this.it.slug}, with targets: "${JSON.stringify(TargetBuilder.convertToSelectionItems(data.targets))}".`,
                    toSerializedTranslation("error.paymentDenied", { card: this.it.nameKey })
                );
            }
        }
        return new EffectOnStack(effect.effectFunction, data, effect.description, effect.type, effect.getVisualEffectBoxFromTargets(targets));
    }

    tapEffect(issuer: Entity, targets: any[], differentSource: Card | undefined): EffectOnStack {
        const effect = this.activeEffects.getActiveEffect();
        if (!issuer)
            throw new GameError("EffectInterface.tapEffect: issuer is undefined or null.",
                toSerializedTranslation("error.behaviorError", { error: "EffectInterface.tapEffect: issuer is undefined or null." })
            );
        const data = new EffectData(differentSource === undefined ? this.it : differentSource, () => issuer as Player, targets, effect.getVisualEffectBoxFromTargets(targets));
        return new EffectOnStack(effect.effectFunction, data, effect.description, effect.type, effect.getVisualEffectBoxFromTargets(targets));
    }
    
    get activeEffectList(): ActiveEffectEntry[] {
        // const effects: ActiveEffectEntry[] = [];
        // if (this.activeEffects.hasTapEffect())
        //     effects.push({visualEffectBox: {startIndex: 0, endIndex: 0}, index: "tap" as const, description: this.activeEffects.getActiveEffect().description });
        // for (const [index, effect] of this.activeEffects.effectNames.entries())
        //     effects.push({ visualEffectBox: { startIndex: 0, endIndex: 0 }, index: index, description: effect });
        // return effects;
        const effects: ActiveEffectEntry[] = [];
        if (this.activeEffects.hasTapEffect())
            for( const boxId of this.activeEffects.getActiveEffect().range)
        {
            // const boxId = this.activeEffects.getActiveEffect().range[0]!;
            effects.push({ visualEffectBox: { startIndex: boxId.startIndex, endIndex: boxId.endIndex }, index: "tap" as const, description: this.activeEffects.getActiveEffect().description });
        }
        for (const [index, effect] of this.activeEffects.effectNames.entries())
        {
            for( const boxId of this.activeEffects.getPaidEffect(index).range)
            // const boxId = this.activeEffects.getActiveEffect().range[0]!;
                effects.push({ visualEffectBox: { startIndex: boxId.startIndex, endIndex: boxId.endIndex }, index: index, description: effect });
        }
        return effects;
    }


    // Get the first active effect (for cards that have a single effect)
    getActiveEffect(index: number = 0): Effect {
        return this.activeEffects.getActiveEffect();
    }

    getTargetSelectors(index: number | "tap"): TargetsSelector[] {
        return this.activeEffects.getTargetSelectors(index);
    }
    // Lifecycle methods for loot cards, events and curses - onPlay takes targets as parameter and returns a resolve function
    onPlay(issuer: Player, targets: any[]): (() => void | Promise<void>) {
        this._issuer = issuer;
        let effect:Effect;
        if(this.it instanceof LootCard === false || this.it.trinket === false)
        {
            effect = this.activeEffects.getActiveEffect();
            if (!effect) {
                return () => { };
            }
        }


        // Return a resolve function to be called later
        return async () => {
            if (this._issuer) {
                // Validate targets before calling effect function
                if(this.it instanceof LootCard === false || this.it.trinket === false)
                {
                    if (effect.targetStillValid(this._issuer!, targets)) {
                        await effect.effectFunction(new EffectData(this.it, () => this._issuer!, targets, effect.getVisualEffectBoxFromTargets(targets)));
                    }
                    await this.subscribeAll(() => this._issuer!);
                }
            }
        };
    }

    targetStillValid(
        player: Player,
        effectId: number | "tap",
        targets: any[]
    ): boolean {
        const effect = effectId === "tap" ? this.activeEffects.getActiveEffect() : this.activeEffects.getPaidEffect(effectId);
        return effect.targetStillValid(player, targets);
    }
    debugSetTargets(targets: any[]): void {
        // This method is deprecated - targets should be passed to onPlay instead
        console.warn("debugSetTargets is deprecated. Pass targets to onPlay instead.");
    }
}
