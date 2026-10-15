import {Game} from "@/models/game.ts";
import type {DeckType, TargetsSelector} from "@/models/types/cardTypes.ts";
import {
    activeEntitySelector,
    anotherPlayerSelector,
    deckSelector,
    inAnotherplayItemSelector,
    inplayCurseSelector,
    inplayItemSelector,
    inplayUnchargedItemSelector,
    itemAndSoulSelector,
    playerSelector,
    rollSelector,
    stackElementSelector,
    topAnyDiscardSelector,
    visibleItemSelector,
    YourItemSelector,
    diceWillRollSelector,
    stackElementThatTargetMyItemOrDiceSelector
} from "@/models/targetSelector.ts";
import {Card, ItemCard, MonsterCard} from "@/models/cards.ts";
import { DiceWillRoll, EffectOnStack, LootCardEffect } from '@/models/stackElement';
import {Player} from "@/models/entities/player.ts";
import {DiceRoll} from "@/models/stackElement.ts";
import type { SerializedTranslation } from "@/shared/api";
import { toSerializedTranslation } from "@/utils/translation.ts";

/**
 * Helper function to create a TargetsSelector with default values.
 */
const createSelector = (
    description: SerializedTranslation,
    selector: (player: Player, card: Card) => any[],
    min: number = 1,
    max: number = 1,
): TargetsSelector => ({description, selector, min, max});
export const noTargets: TargetsSelector[] = [];
export const selectPlayer = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.player"), playerSelector(() => true, game), min, max)];
export const selectAlivePlayer = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.player"), playerSelector((player) => !player.isDead, game), min, max)];
export const selectXCardsFromDiscard = (game: Game, type: DeckType, min: number = 1, max: number = min, filter?: (card: Card) => boolean): TargetsSelector[] =>
    [createSelector(
        min === max ?
            max <= 1 ?
                toSerializedTranslation("selector.aCardFromDiscard", { type: type }) 
                : toSerializedTranslation("selector.nCardFromDiscard", { type: type, max: max }) 
        :   max > 1 ? 
                toSerializedTranslation("selector.upTo1CardFromDiscard", { type: type }) 
                : toSerializedTranslation("selector.upToNCardsFromDiscard", { type: type, max: max }) , (issuer: Player) => {
        return game.decks[type].discard.filter(card => filter ? filter(card) : true);
    })];
export const selectAliveNonActivePlayer = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.player"), playerSelector((player) => !player.isDead && player !== game.currentPlayer, game), min, max)];
export const selectAnotherPlayer = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.anotherPlayer"), anotherPlayerSelector(() => true, game), min, max)];
export const selectPlayerInCombat = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.player"), (issuer: Player) => game.players.filter(p => p.isEngagedInCombat), min, max)];
export const selectMonsterBeingAttacked = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.monsterBeingAttacked"), (issuer: Player) => game.monsters.filter(m => m.isEngagedInCombat && m.currentHealthPoints > 0), min, max)];
export const selectMonsterNotBeingAttacked = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.monsterNotBeingAttacked"), (issuer: Player) => game.monsters.filter(m => !m.isEngagedInCombat && m.currentHealthPoints > 0), min, max)];
export const selectMonsterNotAttackedOrShopItem = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.monsterNotBeingAttackedOrShopItem"), (issuer: Player) => (game.monsters.filter(m => !m.isEngagedInCombat && m.currentHealthPoints > 0).map(e=>e.card) as Card[]).concat(game.shop.cardsOnTop.filter(c=>c!=undefined)), min, max)];
export const selectMonster = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.monster"), (issuer: Player) => game.monsters.filter(m => m.currentHealthPoints > 0), min, max)];
export const selectMomMonster = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.monster"), (issuer: Player) => game.monsters.filter(m => {
        return ["Mom!", "Mom’s Heart!", "It Lives!"].includes(m.card.name) && m.currentHealthPoints > 0;}), min, max)];
export const selectAttackableMonster = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.monster"), (issuer: Player) => game.monsters.filter(m => m.attackable && m.currentHealthPoints > 0), min, max)];
export const selectPassiveAbilityOrMonsterAbility = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.triggeredAbility"), (issuer: Player) => {
        return game.stack.elements.filter(e =>
            e instanceof EffectOnStack
            && ((e.data.it instanceof ItemCard && e.type === "passive" && !e.data.it.eternal) || (e.data.it instanceof MonsterCard && e.type !== "event")))
    }, min, max)];
export const selectCardInPlayOrLootBeingPlayed = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.cardInPlayOrLoot"), (issuer: Player) => {
        const inPlayCards = game.players.flatMap(p => p.inPlay);
        const lootOnStack = game.stack.elements.filter(e => e.json.type === "LootCardEffect");
        return [...inPlayCards, ...lootOnStack];
    }, min, max)];
export const selectPlayerOrMonster = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.playerOrMonster"), activeEntitySelector(() => true, game), min, max)];
export const selectDeck = (game: Game, min: number = 1, max: number = min, filter?: (name: string) => boolean): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.deck"), deckSelector(filter || ((): boolean => true), game), min, max)];
export const selectTopAnyDiscard = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.topAnyDiscard"), topAnyDiscardSelector(() => true, game), min, max)];
export const selectRoll = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.diceRoll"), rollSelector(() => true, game), min, max)];
export const selectRollAndNumber = (game: Game, numbers: number[], min: number = 1, max: number = min, rollType: "attack" | "non-attack" | "any" = "any"): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.diceRoll"), rollSelector((roll: DiceRoll) => {
        if (roll.attackRoll && rollType === "non-attack" ||
            !roll.attackRoll && rollType === "attack") {
            return false;
        }
        return true;
    }, game), min, max),
        createSelector(toSerializedTranslation("selector.number"), () => {
            return numbers;
        }, min, max)];
export const selectItem = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.rechargeableItem"), inplayUnchargedItemSelector(game), min, max)];
export const selectCurse = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.curse"), inplayCurseSelector((player, card) => true, game), min, max)];
export const selectNonEternalItem = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.nonEternalItem"), inplayItemSelector((player: Player, card: ItemCard) => card.eternal === false, game), min, max)];
export const selectTapItem = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.tapItem"), inplayItemSelector((player: Player, card: ItemCard) => card.hasTapEffect(), game), min, max)];
export const selectCharacterCardFromOutside = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.characterCard"), () => game.decks.character.cards, min, max)];
export const selectShopItem = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.shopItem"), (issuer: Player) => game.shop.itemsInShop.filter((slot) => slot !== undefined) as ItemCard[], min, max)];
export const selectNonEternalItemOrASoul = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.nonEternalItemOrSoul"), itemAndSoulSelector((player: Player, card: ItemCard) => card.eternal === false, game), min, max)];
export const selectNonEternalTapItem = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.nonEternalItem"), visibleItemSelector((card: ItemCard, issuer: Player) => card.eternal === false && card.activeEffectList.length > 0 && card.hasTapEffect() && card.slug != "b2-placebo", false, game), min, max)];
export const selectAnyTapItem = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.tapItem"), visibleItemSelector((card: ItemCard, issuer: Player) => card.activeEffectList.length > 0 && card.hasTapEffect(), false, game), min, max)];
export const selectAnotherPlayerNonEternalItem = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.anotherPlayerNonEternalItem"), inAnotherplayItemSelector((player: Player, card: ItemCard) => card.eternal === false, game), min, max)];
export const selectNonEternalPassiveItem = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.nonEternalPassiveItem"), visibleItemSelector((card: ItemCard, issuer: Player) => card.eternal === false && card.activeEffectList.length === 0, false, game), min, max)];
export const selectItemYouControl = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.itemYouControl"), YourItemSelector((player: Player, card: ItemCard) => true, false, game), min, max)];
export const selectNonEternalItemYouControl = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.nonEternalItemYouControl"), YourItemSelector((player: Player, card: ItemCard) => card.eternal === false, false, game), min, max)];
export const selectEternalItemYouControl = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.eternalItemYouControl"), YourItemSelector((player: Player, card: ItemCard) => card.eternal === true, false, game), min, max)];
export const selectAnotherItemYouControl = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.anotherItemYouControl"), YourItemSelector((player: Player, card: ItemCard) => card.eternal === false, true, game), min, max)];
export const selectSoulYouControl = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.destroySoulYouControl"), (issuer: Player) => issuer.targetableSouls, min, max)];
export const selectNonEternalItemFromAnywhere = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.nonEternalItemFromPlayerOrShop"), visibleItemSelector((card: ItemCard, issuer: Player) => card.eternal === false, false, game), min, max)];
export const selectAnotherNonEternalItemFromAnywhere = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.anotherNonEternalItemFromPlayerOrShop"), visibleItemSelector((card: ItemCard, issuer: Player) => card.eternal === false, true, game), min, max)];
export const selectAnotherItemFromAnywhere = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.nonEternalItemFromPlayerOrShop"), visibleItemSelector((card: ItemCard, issuer: Player) => true, true, game), min, max)];
export const selectPlayerWithMostSouls = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.playerWithMostSouls"), playerSelector((p) => p.targetableSouls.length === Math.max(...game.players.map(p => p.targetableSouls.length)), game), min, max)];
export const selectRollAddOrSubtract = (game: Game, x: number): TargetsSelector[] => [
    createSelector(toSerializedTranslation("selector.diceRoll"), rollSelector(() => true, game)),
    createSelector(toSerializedTranslation("selector.addOrSubtract", { value: x }), (issuer: Player) => [x, -x])
];
export const selectLootInYourHand = (game: Game, min: number = 1, max: number = min, selectionOnResolve: boolean = false): TargetsSelector[] =>
    selectionOnResolve ? noTargets :
        [createSelector(toSerializedTranslation("selector.lootCardInHand"), (issuer: Player) => issuer.hand.cards, min, max)];
export const selectUsableAbilityStackElement = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.itemAbility"), stackElementSelector((element) => element instanceof EffectOnStack && element.data.it instanceof ItemCard && (element.type === "active" || element.type === "paid"), game), min, max)];
export const selectStackElementOrLoot = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.itemOrLootAbility"), stackElementSelector((element) => element instanceof LootCardEffect || (element instanceof EffectOnStack && element.data.it instanceof ItemCard && (element.type === "active" || element.type === "paid")), game), min, max)];
export const selectStackElementOrLootTargetingYourItemOrDice = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.itemOrLootAbility"), stackElementThatTargetMyItemOrDiceSelector((element) => element instanceof LootCardEffect || (element instanceof EffectOnStack && element.data.it instanceof ItemCard && (element.type === "active" || element.type === "paid")), game), min, max)];
export const selectLootOnStack = (game: Game, min: number = 1, max: number = min): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.lootCardOnStack"), stackElementSelector((element) => element instanceof LootCardEffect, game), min, max)];
export function selectDiceWillRoll(game: Game, min: number = 1, max: number = min): TargetsSelector[]{
    return [createSelector(toSerializedTranslation("selector.diceWillRoll"), diceWillRollSelector(() => true, game), min, max)];
}
export const selectNumber1to6 = (): TargetsSelector[] =>
    [createSelector(toSerializedTranslation("selector.number"), () => [1, 2, 3, 4, 5, 6], 1, 1)];

export function decideEntitySelector(s: string, game: Game): TargetsSelector[] {
    let selector = selectMonster(game);
    if (s.includes("player")) {
        selector = selectPlayer(game);
        if (s.includes("monster"))
            selector = selectPlayerOrMonster(game);
    }
    return selector;
}