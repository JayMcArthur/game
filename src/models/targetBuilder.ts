import { shuffle } from "@/utils/auxiliary";
import { type DeckName, type SelectionItem, type TargetSelectorResponse, type SerializedTranslation, type Capability, serializedTranslationSchema, type SerializedChooseOne } from "../shared/api";
import { Card, ItemCard, LootCard, type TargetsSelector } from "./cards";
import { Entity } from "./entities/entity";
import { type Game } from "./game";
import { GameError } from "@/models/GameError";
import { Player } from "./entities/player";
import { isStackElement } from "./stack";
import { isChooseOneOptions, type ChooseOneOptions } from "./targetSelector";
import { toSerializedTranslation } from "@/utils/translation";
import { EffectTextNumber } from "./effectTextNumber";

/**
 * Target Builder - Standalone utility for progressive target selection
 * 
 * 
 * For choose-one selectors:
 * 1. First choice is the option description (e.g., "destroy an item you control.")
 * 2. Subsequent choices are the actual targets for that option
 * 
 * Usage:
 * ```typescript
 * // Step 1: Get first selector
 * const item = player.inPlay[0];
 * const step1 = TargetBuilder.getNextSelector(game, player, item, []);
 * // If it's choose-one with options: ["option A", "option B"]
 * // Step 2: User picks "option A", get targets for that option
 * const step2 = TargetBuilder.getNextSelector(game, player, item, ["option A"]);
 * // Now returns the admissible targets for option A
 * // Step 3: User picks a target "b2-blank_card"
 * const step3 = TargetBuilder.getNextSelector(game, player, item, ["option A", "b2-blank_card"]);
 * // Continue until complete
 * ```
 */
export class TargetBuilder {
    private static shouldAutofillSelector(selector: TargetsSelector, possibleTargets: any[]): boolean {
        return selector.min === possibleTargets.length && selector.max === possibleTargets.length;
    }

    private static completeResponse(): TargetSelectorResponse {
        return {
            description: toSerializedTranslation("common.empty"),
            min: 0,
            max: 0,
            options: [],
            complete: true,
            isChooseOne: false
        };
    }

    private static normalizeSelectorForPrompt(
        rootSelectors: TargetsSelector[],
        selectorIndex: number,
        selector: TargetsSelector | undefined,
        player: Player,
        item: ItemCard
    ): { selector: TargetsSelector | undefined; selectorIndex: number } {
        while (selector) {
            const possibleTargets = selector.selector(player, item);
            if (!TargetBuilder.shouldAutofillSelector(selector, possibleTargets)) {
                break;
            }
            const isChooseOne = possibleTargets.length > 0 && isChooseOneOptions(possibleTargets[0]);
            if (isChooseOne) {
                const chosenOption = (possibleTargets as ChooseOneOptions[])[0]!;

                // Fully deterministic choose-one (option and target both implied): advance.
                if (chosenOption.admissibleTargets.length <= 1) {
                    selectorIndex++;
                    selector = rootSelectors[selectorIndex];
                    continue;
                }

                // Deterministic choose-one option, but target still needs user input.
                selector = {
                    description: toSerializedTranslation("common.content", { content: chosenOption.description }),
                    selector: (): any[] => chosenOption.admissibleTargets,
                    min: selector.min,
                    max: selector.max,
                };
                break;
            }

            // Regular deterministic selector.
            selectorIndex++;
            selector = rootSelectors[selectorIndex];
        }

        return { selector, selectorIndex };
    }

    private static advanceFullyDeterministicSelectorsForBuild(
        rootSelectors: TargetsSelector[],
        selectorIndex: number,
        selector: TargetsSelector | undefined,
        player: Player,
        item: ItemCard,
        result: any[]
    ): { selector: TargetsSelector | undefined; selectorIndex: number } {
        while (selector) {
            const possibleTargets = selector.selector(player, item);
            if (!TargetBuilder.shouldAutofillSelector(selector, possibleTargets)) {
                break;
            }

            const isChooseOne = possibleTargets.length > 0 && isChooseOneOptions(possibleTargets[0]);
            if (isChooseOne)
                throw new GameError("SHOULD NEVER BE THERE: Cannot auto-advance through deterministic choose-one selectors during build - user choice is required to determine the path.", toSerializedTranslation("error.behaviorError", { error: "SHOULD NEVER BE THERE: Cannot auto-advance through deterministic choose-one selectors during build - user choice is required to determine the path."}));
 
            result.push(...possibleTargets);
            selectorIndex++;
            selector = rootSelectors[selectorIndex];
        }

        return { selector, selectorIndex };
    }

    /**
     * Walk through selectors following the user's choices, handling choose-one nesting.
     * Returns the current selector to display based on the partial choices made so far non serialized.
     * 
     * 
     * @param game The game instance
     * @param player The player building the targets
     * @param item The item card whose effect is being activated
     * @param partialChoices Flat array of all string identifiers chosen so far
     * @param effectId Which effect to activate ("tap" or paid effect index)
     * @param throwIfNotCharged Whether to throw an error if the item is not charged (default: true)
     * @returns Information about the next selector to fill, or completion status non serialized
     */
    static getNextSelectorRaw(
        game: Game,
        player: Player,
        item: ItemCard,
        partialChoices: SelectionItem[] = [],
        effectId: number | "tap" = "tap",
        throwIfNotCharged: boolean = true,
        bypassAsserPendingSelection: boolean = false
    ): {
                description: SerializedTranslation,
                min: number,
                max: number,
                options: any[],
                complete: boolean,
                isChooseOne: boolean,
            } {
        if(!bypassAsserPendingSelection)
            game.assert.noPendingSelection();
        if(!item)
            throw new GameError(`Item not found.`, toSerializedTranslation("error.itemNotFound"));
        if(item instanceof LootCard && item.trinket)
            return this.completeResponse();
        if(throwIfNotCharged && effectId === "tap" && !item.charged)
            throw new GameError(`Item ${item.name} is not charged.`, toSerializedTranslation("capability.notCharged"));
        // console.log("TargetBuilder.getNextSelector for item:", item.name, "effectId:", effectId, "partialChoices:", partialChoices, item.activeEffectList);

        const rootSelectors = [... item.getEffectTarget(effectId)];

        let selectorIndex = 0;
        let selector: TargetsSelector | undefined = rootSelectors[selectorIndex];
        if (!selector) {
            return TargetBuilder.completeResponse();
        }

        // Walk through choices using for loop
        let choicesProcessed = 0;
        for (let i = 0; i < partialChoices.length; i++) {
            const normalized = TargetBuilder.normalizeSelectorForPrompt(rootSelectors, selectorIndex, selector, player, item);
            if (normalized.selectorIndex !== selectorIndex) {
                choicesProcessed = 0;
            }
            selectorIndex = normalized.selectorIndex;
            selector = normalized.selector;

            if (!selector) {
                return TargetBuilder.completeResponse();
            }

            const possibleTargets: any[] = selector.selector(player, item);
            const choice = partialChoices[i]!;

            // Check if this is a choose-one selector
            if (possibleTargets.length > 0 && isChooseOneOptions(possibleTargets[0])) {
                // Choose-one: find the chosen option
                const chosenOption = (possibleTargets as ChooseOneOptions[]).find(
                    opt => opt.description === (choice.payload as SerializedChooseOne).description
                );

                if (!chosenOption) {
                    throw new GameError(`Invalid choose-one option: ${choice}`, toSerializedTranslation("error.invalidChooseOneOption"));
                }
                rootSelectors.splice(selectorIndex + 1, 0, ...chosenOption.admissibleTargets);
                selectorIndex++;
                selector = rootSelectors[selectorIndex];
                if (!selector) {
                    return TargetBuilder.completeResponse();
                }
            } else {
                // Regular selector - validate choice by matching against possibleTargets
                const resolved = TargetBuilder.resolveIdentifier(choice, possibleTargets);
                if (resolved === undefined) {
                    throw new GameError(`Invalid target choice: ${choice} for item ${item.name}, selector: ${selector.description}`, toSerializedTranslation("error.invalidTargetChoice", {card: item.nameKey}));
                }

                choicesProcessed++;

                // Check if we've filled this selector's count
                if (choicesProcessed >= selector.max) {
                    // Move to next selector
                    selectorIndex++;
                    selector = rootSelectors[selectorIndex];
                    choicesProcessed = 0;
                    
                    if (!selector) {
                        return TargetBuilder.completeResponse();
                    }
                }
            }
        }

        if (!selector) {
            return TargetBuilder.completeResponse();
        }

        const normalized = TargetBuilder.normalizeSelectorForPrompt(rootSelectors, selectorIndex, selector, player, item);
        selectorIndex = normalized.selectorIndex;
        selector = normalized.selector;

        if (!selector) {
            return TargetBuilder.completeResponse();
        }

        // Get the next selector to display
        const possibleTargets = selector.selector(player, item);
        
        // Check if this is a choose-one selector
        const isChooseOne = possibleTargets.length > 0 && isChooseOneOptions(possibleTargets[0]);

        if (isChooseOne) {
            // Return choose-one option descriptions
            return {
                description: selector.description,
                min: 1,
                max: 1,
                options: possibleTargets,
                complete: false,
                isChooseOne: true
            };
        } else {
            // Return regular targets as string identifiers
            return {
                description: selector.description,
                min: selector.min,
                max: selector.max,
                options: possibleTargets,
                complete: false,
                isChooseOne: false
            };
        }
    }

    /**
     * Walk through selectors following the user's choices, handling choose-one nesting.
     * Returns the current selector to display based on the partial choices made so far.
     * 
     * @param game The game instance
     * @param player The player building the targets
     * @param item The item card whose effect is being activated
     * @param partialChoices Flat array of all string identifiers chosen so far
     * @param effectId Which effect to activate ("tap" or paid effect index)
     * @param throwIfNotCharged Whether to throw an error if the item is not charged (default: true)
     * @returns Information about the next selector to fill, or completion status, serialized
     */
    static getNextSelector(
        game: Game,
        player: Player,
        item: ItemCard,
        partialChoices: SelectionItem[] = [],
        effectId: number | "tap" = "tap",
        throwIfNotCharged: boolean = true,
        bypassAsserPendingSelection: boolean = false
    ): TargetSelectorResponse {
        const selectorRaw = TargetBuilder.getNextSelectorRaw(game, player, item, partialChoices, effectId, throwIfNotCharged, bypassAsserPendingSelection);
        return {
            description: selectorRaw.description,
            min: selectorRaw.min,
            max: selectorRaw.max,
            options: TargetBuilder.convertToSelectionItems(selectorRaw.options),
            complete: selectorRaw.complete,
            isChooseOne: selectorRaw.isChooseOne
        };
    }
    /**
     * Return an item from a player's inPlay or hand by its index.
     * 
     * @param game The game instance
     * @param player The player owning the item
     * @param itemId The index of the item in the specified set
     * @param type "inPlay" to get from inPlay, "hand" to get from hand (default: "inPlay")
     * @returns The ItemCard found
     */
    static getCard(game: Game,
    player: Player,
    itemId: number,
    type : "inPlay" | "room" | "character" | "hand"): ItemCard {
        if(type === "room" && game.rooms === undefined)
            throw new GameError(`Item not found in player's ${type}.`, toSerializedTranslation("error.itemNotFoundInPlayerInventory", { type: type }));
        const set = type === "inPlay" ? player.inPlay : type === "room" ? game.rooms!.activeRooms : player.hand.cards;
        const card = type === "character" ? player.character : set[itemId];
        if(!card || !(card instanceof ItemCard))
            throw new GameError(`Item not found in player's ${type}.`, toSerializedTranslation("error.itemNotFoundInPlayerInventory", { type: type }));
        return card;
    }

    static convertToSelectionItems(options: any[]): SelectionItem[] {
         return options.map(option => {
            if (option instanceof EffectTextNumber) {
                return {
                    type: "effectTextNumber",
                    payload: option.jsonAPI,
                };
            }

            if (typeof option === 'object' && option !== null && isChooseOneOptions(option)) {
                return {type: "chooseOne", payload: {description: option.description, card: option.card.jsonAPI, visualEffectBox: option.visualEffectBox}};
            }
            if (typeof option === 'object' && option !== null && 'slug' in option && option instanceof Card) {
                return { payload: option.jsonAPI, type: "card" };
            }
            if (typeof option === 'object' && option !== null && 'id' in option && option instanceof Entity) {
                const entity = option;
                return {type: entity.json.type, payload: entity.json};
            }

            if (isStackElement(option)) {
                return { type: "stackElement", payload: option.json };
            }

            if (typeof option === 'number')
                return {type: "number", payload: option};
            if (typeof option === 'string')
            {
                // console.warn("WARNING, string option: ", option);
                return {type: "string", payload: option};
            }
            if (typeof option === 'boolean')
                return {type: "boolean", payload: option};
            if (option === null) {
                return {type: "null", payload: null};
            }
            
            if (typeof option === 'object' && option !== null && '_type' in option && '_order' in option && '_discard' in option) {
                // Deck object
                return { type: "deck", payload: option._type as DeckName };
            }
            
            // { player: Player; hand: Hand }
            const player = option.player;
            if( typeof option === 'object' && 'player' in option && player instanceof Player && 'hand' in option)
                return {type: "couplePlayerHand", payload: {player: player.json , hand: option.hand.cards.map((c: Card) => c.jsonAPI)}};
            
            const serializedTranslationParsed = serializedTranslationSchema.safeParse(option);
            if(serializedTranslationParsed.success) {
                return {type: "serializedTranslation", payload: serializedTranslationParsed.data};
            }
            if (Array.isArray(option) || typeof option === 'object') {
                try {
                    return {type: "array", payload: TargetBuilder.convertToSelectionItems(option)};
                } catch {
                    return {type: "unknown", payload: null};
                }
            }
            return {type: "unknown", payload: null};
            // throw new GameError("Not implemented yet", toSerializedTranslation("error.behaviorError", { error: "Not implemented yet"}));
        });
    }

    /**
     * Resolve a string identifier back to the actual target by matching against possibleTargets.
     * This validates the choice matches one of the selector's options.
     * 
     * Since identifiers no longer have type prefixes, we determine the type from possibleTargets.
     * 
     * @param identifier The string identifier (e.g., "b2-blank_card", "1", "5")
     * @param possibleTargets The array of possible targets from the selector
     * @returns The matched target object, or undefined if not found
     */
    static resolveIdentifier(identifier: SelectionItem, possibleTargets: any[]): any {
        if (possibleTargets.length === 0) 
            throw new GameError("No possible targets available.", toSerializedTranslation("error.noPossibleTargets"));
        switch(identifier.type) {
            case "card":
                return possibleTargets.find(t =>
                    t && t.slug === identifier.payload.slug &&
                    (identifier.payload.globalId === undefined || t.globalId === identifier.payload.globalId)
                );
            case "player":
            case "animated":
            case "monster":
                return possibleTargets.find(t =>
                    t && t instanceof Entity && t.json &&
                    t.json.globalId === identifier.payload.globalId
                );
            case "deck":
                return possibleTargets.find(t => t && t._type === identifier.payload);
            case "chooseOne":
                return (possibleTargets as SerializedChooseOne[]).find(t => t && t.description === identifier.payload.description)
            case "number":
            case "string":
            case "boolean":
                return possibleTargets.find(t => t === identifier.payload);
            case "effectTextNumber":
                return possibleTargets.find(
                    (target) =>
                        target instanceof EffectTextNumber &&
                        target.matches(identifier.payload),
                );
            case "serializedTranslation":
                return possibleTargets.find(t => t.key === identifier.payload.key);
            case "null":
                return possibleTargets.find(t => t === null);
            case "couplePlayerHand":
                return possibleTargets.find(t => 
                    typeof t === 'object' && 'player' in t && 'hand' in t &&
                    t.player.slug === identifier.payload.player.slug &&
                    t.player.globalId === identifier.payload.player.globalId &&
                    JSON.stringify(t.hand.cards.map((c: Card) => ({ slug: c.slug, globalId: c.globalId }))) === JSON.stringify(identifier.payload.hand)
                );
            case "stackElement":
                return possibleTargets.find(t => isStackElement(t) && t.stackId === identifier.payload.id);
            case "array":
                try {
                    const parsed = identifier.payload.map((item: SelectionItem) => {
                        return TargetBuilder.resolveIdentifier(item, possibleTargets);
                    });
                    return possibleTargets.find(t => JSON.stringify(t) === JSON.stringify(parsed));
                } catch {
                    return undefined;
                }
            default:
                return undefined;
        }
    }

    /**
     * Build complete targets from flat array of string identifiers.
     * Returns a flat array of resolved targets matching the flat choice structure.
     * 
     * @param game The game instance
     * @param player The player building targets
     * @param item The item card whose effect is being activated
     * @param partialChoices Flat array of all string identifiers
     * @param effectId Which effect to activate
     * @returns Flat array of resolved targets [target0, target1, target2, ...]
     */
    static buildTargets(
        game: Game,
        player: Player,
        item: ItemCard,
        partialChoices: SelectionItem[],
        effectId: number | "tap" = "tap"
    ): any[] {
        const validTargets = TargetBuilder.validTargetExists(game, player, item, effectId);
        if(validTargets !== true)
            throw new GameError(`Cannot build targets: ${validTargets}`, toSerializedTranslation("error.noPossibleTargets"));

        game.assert.noPendingSelection();
        if(!item)
            throw new GameError(`Item not found.`, toSerializedTranslation("error.itemNotFound"));
        if(item instanceof LootCard && item.trinket)
            return [];
        const rootSelectors = [...item.getEffectTarget(effectId)];
        const result: any[] = [];

        let selectorIndex = 0;
        let choiceIndex = 0;
        let selector: TargetsSelector | undefined = rootSelectors[selectorIndex];

        while (selector) {
            const advanced = TargetBuilder.advanceFullyDeterministicSelectorsForBuild(
                rootSelectors,
                selectorIndex,
                selector,
                player,
                item,
                result
            );
            selectorIndex = advanced.selectorIndex;
            selector = advanced.selector;
            if (!selector) break;
            const possibleTargets = selector.selector(player, item);

            // Check if this is a choose-one selector
            if (possibleTargets.length > 0 && isChooseOneOptions(possibleTargets[0])) {
                if (choiceIndex >= partialChoices.length) {
                    break;
                }

                const choice = partialChoices[choiceIndex]!;
                choiceIndex++; // Move past the option choice
                const chosenOption = (possibleTargets as ChooseOneOptions[]).find(
                    opt => opt.description === (choice.payload as SerializedChooseOne).description
                );

                if (!chosenOption) {
                    throw new GameError(`Invalid choose-one option: ${choice}`, toSerializedTranslation("error.invalidChooseOneOption"));
                }
                result.push(chosenOption.description);
                rootSelectors.splice(selectorIndex+1, 0, ...chosenOption.admissibleTargets);
            } else {
                if (choiceIndex >= partialChoices.length) {
                    break;
                }

                // Regular selector - collect count targets
                for (let i = 0; i < selector.max && choiceIndex < partialChoices.length; i++) {
                    const targetId = partialChoices[choiceIndex]!;
                    const resolved = TargetBuilder.resolveIdentifier(targetId, possibleTargets);
                    if (resolved !== undefined) {
                        result.push(resolved);
                    }else{
                        throw new GameError(`Invalid target choice: ${targetId} for item ${item.name}, selector: ${selector.description}`, toSerializedTranslation("error.invalidTargetChoice", { card: item.nameKey }));
                    }
                    choiceIndex++;
                }
            }

            selectorIndex++;
            selector = rootSelectors[selectorIndex];
        }
        if (!item.targetStillValid(player, effectId, result)) {
            throw new GameError(`One or more targets are no longer valid. ${TargetBuilder.convertToSelectionItems(result).map(o => JSON.stringify(o)).join(", ")}`, toSerializedTranslation("error.invalidTargets"));
        }
        return result;
    }

    static async buildTargetsOnResolve(
        game: Game,
        player: Player,
        item: ItemCard,
        effectId: number | "tap"
    ): Promise<any[]> {
        if(!item)
            throw new GameError(`Item not found or has no active effect.`, toSerializedTranslation("error.itemNotFoundOrNoActiveEffect"));
        if(item instanceof LootCard && item.trinket)
            return [];
        if(effectId === "tap"){
            const activeEffect = item.getActiveEffect();
            if (!activeEffect)
                throw new GameError(`Item ${item.name} has no active effect to copy.`, toSerializedTranslation("error.noActiveEffectToCopy", { card: item.nameKey }));
        }else if (!item.activeEffectList.map(e => e.index).includes(effectId as number)) {
            throw new GameError(`Paid effect with index ${effectId} not found on item ${item.name}, available: ${item.activeEffectList.map(e => e.index).join(", ")}.`, toSerializedTranslation("error.behaviorError", { error: `Paid effect with index ${effectId} not found on item ${item.name}, available: ${item.activeEffectList.map(e => e.index).join(", ")}.`}));
        }
        if(player === undefined)
            throw new GameError(`Effect issuer is not a player.`, toSerializedTranslation("error.effectIssuerNotPlayer"));

        // The next target is expected to be an array of targets for the copied effect
        const targets: any[] = [];
        let options = TargetBuilder.getNextSelectorRaw(game, player, item, targets, effectId, false);
        while(!options.complete)
            {
            if(options.isChooseOne)
            {
                const feasibleChoices = []
                for(const option of options.options)
                {
                    try {
                        const tmp = TargetBuilder.getNextSelectorRaw(game, player, item, [...targets, TargetBuilder.convertToSelectionItems([option])[0]], effectId, false);
                        if(tmp.complete || tmp.options.length > tmp.min)
                        {
                            feasibleChoices.push(option);
                        }
                    } catch (e) {}
                }
                options.options = feasibleChoices;
                if(options.options.length === 0)
                {
                    throw new GameError(`No valid targets available for the copied card.`, toSerializedTranslation("error.noValidTargetsForCopiedCard"));
                }
            }
            const selection = await game.select(
                player,
                options.min,
                options.max,
                options.options,
                toSerializedTranslation("pending.copyCardTargets"),
                {card: item.jsonAPI, },
            );
            const normalizedSelection = selection.selected.map((choice) =>choice);
            targets.push(...normalizedSelection);
            options = TargetBuilder.getNextSelectorRaw(game, player, item, TargetBuilder.convertToSelectionItems(targets), effectId, false);
            if(!options.complete && options.options.length === 0)
            {
                throw new GameError(`No valid targets available for the copied card ${item.name}.`, toSerializedTranslation("error.noValidTargetsForCopiedCardWithName", { card: item.nameKey }));
            }
        }
        return TargetBuilder.buildTargets(game, player, item, TargetBuilder.convertToSelectionItems(targets), effectId);
    }

    /* verifyPaiementCanBeMade checks if the player can pay the cost described by string s. 
    * It specifically handle non-decision based cost (money, health, counters).
    * It returns true if the payment can be made, or a string error message if it cannot.
    */
    static verifyPaiementCanBeMade(game: Game, player: Player, card: ItemCard, s: string): Capability {
        s = s.trim().toLowerCase();
        const coins = parseNumber(s, /^\[paid effect\] pay\s+(\d+)\u00A2:?/u);
        if (coins !== null) {
            if (!game.canLoseCoins(player, coins, false, "paiement")) {
                return toSerializedTranslation("capability.notEnoughCoin");
            }
        }
        const health = parseNumber(s, /^\[paid effect\] pay\s+(\d+)\s+[hp]:?/u);
        if (health !== null) {
            if (player.currentHealthPoints < health) {
                return toSerializedTranslation("capability.notEnoughHealth");
            }
        }
        let countersToRemove = parseNumber(s, /^\[paid effect\] remove (\d+) counters? from this\.?/u);
        if (countersToRemove === null)
            countersToRemove = /^\[paid effect\] remove a counter from this.?/.test(s) ? 1 : null;
        if( countersToRemove !== null)
            if (card.counters.value("normal") === 0 || card.counters.value("normal") < countersToRemove) {
                return toSerializedTranslation("capability.notEnoughCounter");
            }
        let lootsToDiscard = parseNumber(s, /^\[paid effect\] discard (\d+) loot cards?\.?/u);
        if(lootsToDiscard === null)
            lootsToDiscard = /^\[paid effect\] discard a loot card\.?/.test(s) ? 1 : null;
        if (lootsToDiscard !== null) {
            if (player.hand.length < lootsToDiscard) {
                return toSerializedTranslation("capability.notEnoughLoot");
            }
        }
        if(s.startsWith("[paid effect] destroy this") && card.eternal)
            return toSerializedTranslation("capability.cannotDestroyEternal");
        if(s.startsWith("[paid effect] give another non-eternal item you control") && player.inPlay.filter(i => i !== card && !i.eternal).length === 0)
            return toSerializedTranslation("capability.noItemToGive");
        
        return true;
    }

    static validTargetExists(
        game: Game,
        player: Player,
        item: ItemCard,
        effectId: number | "tap" = "tap"
    ): Capability {
        if(!item)
            return toSerializedTranslation("error.itemNotFound");
        if(item instanceof LootCard && item.trinket)
            return true;
        // console.log(`Checking valid targets for item: ${item.name}, effectId: ${effectId} descr ${item.activeEffectList[effectId as number]?.description}`);
        if(effectId !== "tap")
            {
                const id = effectId + (item.hasTapEffect() ? 1 : 0); // if the item has a tap effect, the paid effects start at index 1, otherwise at index 0
                const paiement = TargetBuilder.verifyPaiementCanBeMade(game, player, item, item.activeEffectList[id]?.description || "");
                if(paiement !== true)
                    return paiement;
            }
        // The next target is expected to be an array of targets for the copied effect
        let targets: any[] = [];
        let options = TargetBuilder.getNextSelector(game, player, item, targets, effectId, false, true);
        const backtrackingIndices: number[] = [];
        while(!options.complete)
        {
            const selection = options.options.slice(0, options.max);
            if(selection.length > options.max || selection.length < options.min)
            {
                if(backtrackingIndices.length === 0)
                    return toSerializedTranslation("capability.noValidTargets");
                const lastIndex = backtrackingIndices.pop()!;
                const prevChooseOneOption = targets[lastIndex];
                targets = targets.slice(0, lastIndex);
                options = TargetBuilder.getNextSelector(game, player, item, targets, effectId, false, true);
                const prevChooseOneIdx = options.options.findIndex((opt: any) => opt.payload.description === (prevChooseOneOption.payload as SerializedChooseOne).description);
                    if(prevChooseOneIdx === -1)
                        throw new GameError(`Could not find previous choose-one option "${prevChooseOneOption.description}" among options: ${options.options.map((opt: any) => opt.description).join(", ")}`, toSerializedTranslation("error.behaviorError", { error: `Could not find previous choose-one option "${prevChooseOneOption.description}" among options: ${options.options.map((opt: any) => opt.description).join(", ")}`}));
                    if(options.options.length <= prevChooseOneIdx + 1)
                        return toSerializedTranslation("capability.noValidTargets");
                    targets.push(options.options[prevChooseOneIdx+1]);
                options = TargetBuilder.getNextSelector(game, player, item, targets, effectId, false, true);
                continue;
            }
            if(options.isChooseOne)
                backtrackingIndices.push(targets.length);
            targets.push(...selection);
            options = TargetBuilder.getNextSelector(game, player, item, targets, effectId, false, true);
        }
        return options.complete;
    }

    static buildRandomValidTargets(
        game: Game,
        player: Player,
        item: ItemCard,
        where: "inPlay" | "hand"
    ): string | {index: number | "tap"; targets: any[]} {
        
        if(!item)
            return "Item not found.";
        const indices = [...item.activeEffectList]
        if(where === "hand" && indices.length === 0 && item instanceof LootCard && item.trinket)
        {
            return {index: "tap", targets: []};
        }
        shuffle(Math.random, indices);
        for(const id of indices)
        {
            const effectId = id.index;
            if(effectId !== "tap")
                {
                    const paiement = TargetBuilder.verifyPaiementCanBeMade(game, player, item, item.activeEffectList[effectId]?.description || "");
                    if(paiement !== true)
                    {
                        continue;
                    }
                }
            else if(!item.charged)
            {
                continue;
            }
            // The next target is expected to be an array of targets for the copied effect
            let targets: any[] = [];
            let options = TargetBuilder.getNextSelector(game, player, item, targets, effectId, false, true);
            const backtrackingIndices: number[] = [];
            while(!options.complete)
            {
                // pick a number uniformly between options.min and Math.min(options.max, options.options.length)
                const upper = Math.min(options.max, options.options.length);
                const range = upper - options.min + 1;
                const nbToSelect = options.min + (range > 0 ? Math.floor(Math.random() * range) : 0);
                const shuffledOptions = [...options.options];
                shuffle(Math.random, shuffledOptions);
                const selection = shuffledOptions.slice(0, nbToSelect);
                if(selection.length > options.max || selection.length < options.min)
                {
                    if(backtrackingIndices.length === 0)
                        break;
                    const lastIndex = backtrackingIndices.pop()!;
                    const prevChooseOneOption = targets[lastIndex].description;
                    targets = targets.slice(0, lastIndex);
                    options = TargetBuilder.getNextSelector(game, player, item, targets, effectId, false, true);
                    const prevChooseOneIdx = options.options.findIndex((opt: any) => opt.description === prevChooseOneOption);
                    if(prevChooseOneIdx === -1)
                        throw new GameError(`Could not find previous choose-one option "${prevChooseOneOption}" among options: ${options.options.map((opt: any) => opt.description).join(", ")}`, toSerializedTranslation("error.behaviorError", { error: `Could not find previous choose-one option "${prevChooseOneOption.description}" among options: ${options.options.map((opt: any) => opt.description).join(", ")}`}));
                    if(options.options.length <= prevChooseOneIdx + 1)
                        return "No valid targets. (No option to backtrack to)";
                    targets.push(options.options[prevChooseOneIdx+1]);
                    options = TargetBuilder.getNextSelector(game, player, item, targets, effectId, false, true);
                    // continue;
                }
                if(options.isChooseOne)
                    backtrackingIndices.push(targets.length);
                targets.push(...selection);
                options = TargetBuilder.getNextSelector(game, player, item, targets, effectId, false, true);
            }
            try {
                // Convert serialized selection items into resolved targets expected by game/player APIs
                const resolved = TargetBuilder.buildTargets(game, player, item, targets, effectId);
                return {index: effectId, targets: resolved};
            } catch (e) {
                // console.error(`Error building targets for item ${item.name}, effectId: ${effectId}:`, e);
                // If conversion fails, try next effect
                continue;
            }
        }
        return "No valid targets found for any effect.";
    }
}

// Returns the numeric amount if matched, otherwise null
export function parseNumber(text: string, re: RegExp): number | null {
    const m = text.trim().match(re);
    return m ? Number(m[1]) : null;
}
