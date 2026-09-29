// An active effect is an effect that is triggered by a player action, 
// as opposed to a passive effect which is triggered by a game event.


import { type OnAttackDeclaredData, type OnDeathMonsterData } from "@/models/types/eventTypes";
import {
    findEffectTextNumbers,
    findValidEffectTextNumberReplacements,
    formatEffectTextNumber,
    replaceEffectTextNumber,
} from "@/utils/effectTextNumbers";
import { assertCardMatchesDeck, type Card, CharacterCard, Deck, isDeckType, ItemCard, LootCard, MonsterCard, RoomCard, TreasureCard } from "../cards";
import { LootCardEffect } from '../stackElement';
import { Animated } from "../entities/animated";
import { Entity } from "../entities/entity";
import { Monster } from "../entities/monster";
import { Player } from "../entities/player";
import { Game } from "../game";
import { GameError } from "@/models/GameError";
import type { StackElement } from "../stack";
import { DamageOnStack, DiceRoll, } from "../stackElement";
import { TargetBuilder } from "../targetBuilder";
import { deckSelector, inplayUnchargedItemSelector as inplayChargeableItemSelector, visibleItemSelector } from "../targetSelector";
import { type DeckType, EffectData, type EffectFunction, type SyncEffectFunction, type AsyncEffectFunction, type TargetsSelector } from "../types/cardTypes";
import type { OnTurnEndData } from "../types/eventTypes";
import { effectParser, INFINITY, type ParsedEffect, type SyncParsedEffect } from "./parsing/effectParser";
import { addPassiveEffectToStack } from "./passiveEffect";
import * as room from "./roomEffects";
import { toSerializedTranslation } from "@/utils/translation";
import { shuffle } from "@/utils/auxiliary";
import { type CounterType } from "@/shared/api"
import { EffectTextNumber } from "../effectTextNumber";

const qq = toSerializedTranslation;
export function gainCoinsEffect(game: Game, amount: number, issuerType: "issuer" | "current", youMayHandling: [false]): SyncEffectFunction
export function gainCoinsEffect(game: Game, amount: number, issuerType: "issuer" | "current", youMayHandling: [true]): AsyncEffectFunction
export function gainCoinsEffect(game: Game, amount: number, issuerType: "issuer" | "current" = "issuer", youMayHandling: boolean[] = [false]): EffectFunction {
    return async (data: EffectData) => {
        const issuer = issuerType === "issuer" ? data.issuer : game.currentPlayer;
        if(issuer instanceof Player === false) return false;
        if (youMayHandling[0]) {
            const choice = (await data.selectAndRecord(game, issuer as Player, 0, 1, [data.it], qq("pending.gainCoins"), data.serializedCardAndBox, false, true)).selected;
            if(choice.length === 0) return false;
        }
        youMayHandling[0] = false;
        game.gainCoins(issuer, amount, data.it);
        return true;
    };
}
export function CurrentPlayerDecidesToChangeRoom(game: Game): AsyncEffectFunction{
    return async (data: EffectData) => {
        if(game.rooms === undefined)
            return false;
        const selectedRoom = (await data.selectAndRecord(game, game.currentPlayer, 0, 1, [...game.rooms.activeRooms.filter((r) => r.canBeDiscarded)], qq("pending.canDiscardRoomCard"), data.serializedCardAndBox, true)).selected[0];
        if(selectedRoom)
            game.cardHandler.discard(selectedRoom);
        return selectedRoom !== undefined;
    }
}
export function flushShopOrUnattackedMonstersEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        const selected = (await data.selectAndRecord(game, game.currentPlayer, 0, 1, [game.decks.treasure, game.decks.monster], qq("pending.putShopItemsOrMonstersIntoDiscard"), data.serializedCardAndBox, false)).selected[0];
        if(selected === game.decks.treasure) {
            flushShopEffect(game, "discard")(data);
        }
        if(selected === game.decks.monster) {
            flushMonsterSlotsEffect(game, "discard")(data);
        }
        // Implementation for flushing shop items or unattacked monsters
        return true;
    };
}
export function activeKillsUpToXOtherPlayersEffect(game: Game, maxPlayers: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        const issuer = game.currentPlayer;
        const options = game.players.filter(p => p !== issuer && p.isDead === false);
        const playersToKill = (await data.selectAndRecord(game, issuer, 0, Math.min(maxPlayers, options.length), options, qq("pending.anyPlayers"), data.serializedCardAndBox, false, true)).selected as Player[];
        for (const player of playersToKill) {
            await game.entityHandler.kill(issuer, player, data.cardAndBox);
        }
        return true;
    };
}

export function loseCoinsEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const nb = game.loseCoins(data.issuer, amount, true, "effect");
        return nb === amount;
    };
}

export function eachPlayerRollsSkipNextTurnEffect(game: Game, minRoll: number, maxRoll: number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        for (const player of game.players) {
            const roll = game.rollDice(player, data.it);
            roll.attachEffect(
                [1,2,3,4,5,6].map((value) => (data: EffectData): boolean => {
                    if(value < minRoll || value > maxRoll) return false;
                    game.playerSkipNextTurn(player);
                    return true;
                }),data.it, [], player);
        }
        return true;
    };
}

export function eachNonActivePlayerDiscardsLootEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        const choices = await data.selectMultipleAndRecord(
            game,
            game.players.filter(p => p !== game.currentPlayer).map(p => ({ 
                player: p,
                min: 1,
                max: 1,
                options: p.hand.cards,
                reason: data.serializedCardAndBox,
                description: qq("pending.lootCardToDiscard"),
                canUseOnBoardSelection: true,
            })),
        );
        for(const choice of choices) {
            if(choice.selected.length === 0) continue;
            game.cardHandler.discard(choice.selected[0]!);
        }
        return true;
    };
}

export function putMonstersFromDiscardIntoSlotsEffect(game: Game, maxMonsters: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        const monsters: MonsterCard[] = [];
        if (!data.issuer || !(data.issuer instanceof Player)) return false;
        for (let i = 0; i < maxMonsters; i++) {
            const monster = data.next;
            if (!monster || !(monster instanceof MonsterCard)) break;
            monsters.push(monster);
        }
        if (monsters.length === 0) return false;
        for (const monster of monsters) {
            const card = game.encounters.obtainCardFromDiscard(monster.slug, monster.globalId);
            if(!card) return false;
            if(game.encounters.coverableSlots.length === 0)
                return false;
            game.cardHandler.addTopPosition("monster", card);
            await game.encounters.selectValidIndexAndDraw(game, data.issuer, data);
        }
        return true;
    };
}

export function cancelAttackAndPutMonsterOnBottomEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        const monster = data.next as Monster;
        if(!(monster instanceof Monster))
            throw new GameError(`Target of cancelAttackAndPutMonsterOnBottomEffect should be a Monster`, toSerializedTranslation("error.behaviorError", { error: `Target of cancelAttackAndPutMonsterOnBottomEffect should be a Monster`}));
        if(!monster.isEngagedInCombat)
            throw new GameError(`Target of cancelAttackAndPutMonsterOnBottomEffect should be a monster engaged in combat`, toSerializedTranslation("error.behaviorError", { error: `Target of cancelAttackAndPutMonsterOnBottomEffect should be a monster engaged in combat`}));
        game.entityHandler.endCombat();
        game.encounters.flushMonster(monster, "bottom");
        return true;
    };
}

export function rechargeItemsEffect(game: Game, selectionOnResolve: boolean = false, youMayEffectHanging: boolean[] = [false], selector: TargetsSelector | null = null): AsyncEffectFunction {
    const allowZero = youMayEffectHanging[0];
    youMayEffectHanging[0] = false;
    if(selectionOnResolve && selector === null)
        throw new GameError("Selector must be provided for rechargeItemsEffect when selectionOnResolve is true.", toSerializedTranslation("error.behaviorError", { error: "Selector must be provided for rechargeItemsEffect when selectionOnResolve is true."}));
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if (selectionOnResolve) {
            const options = selector?.selector(data.issuer, data.it)!;
            const selectionResult = await data.selectAndRecord(game, data.issuer, allowZero ? 0 : 1, 1, options, qq("pending.itemToRecharge"), data.serializedCardAndBox, true, true);
            if (selectionResult.selected.length > 0) {
                if(!(selectionResult.selected[0] instanceof ItemCard))
                    throw new GameError(`Card to recharge is not an ItemCard: ${selectionResult.selected[0].name}`, toSerializedTranslation("error.behaviorError", { error: `Card to recharge is not an ItemCard: ${selectionResult.selected[0].name}`}));
                game.cardHandler.recharge(selectionResult.selected[0], data.it);
            }
        }
        else {
            // data.targets is the array of items to recharge
            for (const card of data.targets) {
                if(!(card instanceof ItemCard))
                    throw new GameError(`Card to recharge is not an ItemCard: ${card.name}`, toSerializedTranslation("error.behaviorError", { error: `Card to recharge is not an ItemCard: ${card.name}`}));
                game.cardHandler.recharge(card, data.it);
            }
        }
        return true;
    };
}

export function makePlayerGiveLootCardEffect(game: Game, type: "diceRoll" | "player"): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        let targetPlayer;
        if(type === "diceRoll")
        {   const dice = data.next as DiceRoll;
            if (dice instanceof DiceRoll === false)
            {
                throw new GameError("Target of makePlayerGiveLootCardEffect is not a dice roll.", toSerializedTranslation("error.behaviorError", { error: "Target of makePlayerGiveLootCardEffect is not a dice roll."}));
            }
            targetPlayer = dice.issuer;
        }
        else
        {
            targetPlayer = data.next as Player;
        }
        if(!(targetPlayer instanceof Player))
            throw new GameError("Target of makePlayerGiveLootCardEffect must be a Player.", toSerializedTranslation("error.behaviorError", { error: "Target of makePlayerGiveLootCardEffect must be a Player."}));
        if(targetPlayer === data.issuer) return true;
        if (targetPlayer.hand.length > 0) {
            const cardToGive = (await data.selectAndRecord(game, targetPlayer, 1, 1, targetPlayer.hand.cards, qq("pending.cardToGive"), data.serializedCardAndBox, true, false)).selected[0]!;
            return game.cardHandler.give(targetPlayer, data.issuer, cardToGive);
        }
        return false;
    };
}

export function rechargeEachItemsOfTargetEffect(game: Game, target: "next" | "issuer" | "current"): SyncEffectFunction {
    return (data: EffectData) => {
        const player = target === "next" ? data.next : target === "issuer" ? data.issuer : game.currentPlayer;
        if(!(player instanceof Player))
            throw new GameError("Target of rechargeEachItemsOfTargetEffect must be a Player.", toSerializedTranslation("error.behaviorError", { error: "Target of rechargeEachItemsOfTargetEffect must be a Player."}));
        game.cardHandler.rechargeMultiple(player, data.it);
        return true;
    };
}

export function makeAPlayerWithMostSoulsDestroyASoulEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        const target = data.next;
        if(!(target instanceof Player))
            throw new GameError("Target of makeAPlayerWithMostSoulsDestroyASoulEffect must be a Player.", toSerializedTranslation("error.behaviorError", { error: "Target of makeAPlayerWithMostSoulsDestroyASoulEffect must be a Player."}));
        if (game.playersWithMostSouls.includes(target) && target.totalSouls > 0) {
            const card = (await data.selectAndRecord(game, target, 1, 1, target.targetableSouls, qq("pending.soulToDestroy"), data.serializedCardAndBox, true, true)).selected[0]!;
            return game.cardHandler.destroyCardsOrSouls([card]);
        }
        return false;
    };
}

export function lootBasedOnSoulsComparedToPlayerWithMostSoulsEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        const maxSouls = Math.max(0, ...game.players.map(p => p.totalSouls));
        game.loot(data.issuer as Player, Math.max(0, maxSouls - (data.issuer as Player).totalSouls));
        return true;
    };
}

export function forceAttackMonsterEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const targetMonster = data.next;
        if(!(targetMonster instanceof Monster))
            throw new GameError("Target of forceAttackMonsterEffect must be a Monster.", toSerializedTranslation("error.behaviorError", { error: "Target of forceAttackMonsterEffect must be a Monster."}));
        game.entityHandler.playerMustAttack(game.currentPlayer, [targetMonster], data.it, true);
        return true;
    };
}

export function lookAtTopXDeck(deckName: string, game: Game, nbCards: number): AsyncEffectFunction {
    if(!isDeckType(deckName))
        throw new GameError(`Invalid deck type: ${deckName}`, toSerializedTranslation("error.invalidDeckType", { deckType: deckName }));
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const cards: Card[] = game.decks[deckName].cards.slice(0, nbCards);
        const selectionResult = await data.selectAndRecord(game, data.issuer, 0, 0, cards, qq("pending.lookAtTopCardOfDeck", {deck: game.decks[deckName].translatedType}), data.serializedCardAndBox, true, false);
        return true;
    };
}

export function lookXPutYTopRestBottomEffect(deckName: string, game: Game, nbCards: number, nbCardsToOrderTop: number): AsyncEffectFunction {
    if(!isDeckType(deckName))
        throw new GameError(`Invalid deck type: ${deckName}`, toSerializedTranslation("error.invalidDeckType", { deckType: deckName }));
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const cards = game.cardHandler.getFirstCardsOfDeck(deckName, nbCards);
        const selectionResult = await data.selectAndRecord(game, data.issuer, nbCardsToOrderTop, nbCardsToOrderTop, cards, qq("pending.cardToPutOnTop"), data.serializedCardAndBox, true, false);
        for(const card of selectionResult.selected) {
            game.cardHandler.addTopPosition(deckName, card);
        }
        selectionResult.remaining.forEach((c) => {
            game.cardHandler.addBottomPosition(deckName, c);
        });
        return true;
    };
}

export function look1EachDeckEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const topCards: Card[] = [];
        for (const deckName of game.deckNames) {
            if(!isDeckType(deckName))
                throw new GameError(`Invalid deck type: ${deckName}`, toSerializedTranslation("error.invalidDeckType", { deckType: deckName }));
            const topCard = game.decks[deckName]?.draw();
            topCards.push(topCard!);
        }
        const selectResult = await data.selectAndRecord(game, data.issuer, 0, 3, topCards, qq("pending.cardsToPutOnBottom"), data.serializedCardAndBox, false, false);
        for (const card of topCards) {
            if(selectResult.selected.includes(card))
                game.cardHandler.addBottomPosition(card.type, card);
            else
                game.cardHandler.addTopPosition(card.type, card);
        }
        return true;
    };
}


export function removeCountersEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        if ((data.it as ItemCard).counters.value("normal") as number >= amount) {
            game.cardHandler.addToCounter(data.issuer, data.it, "normal", -amount);
            return true;
        }
        return false;
    };
}

// This becomes a soul and loses all abilities.
export function BecomesSoulEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if(!(data.it instanceof ItemCard))
            throw new GameError(`Card should be an ItemCard to become a soul: ${data.it.name}`, toSerializedTranslation("error.behaviorError", { error: `Card should be an ItemCard to become a soul: ${data.it.name}`}));
        data.it.setEternal(false);
        game.cardHandler.removeInPlay(data.issuer, data.it);
        data.it.soul = 1;
        game.cardHandler.addSoul(data.issuer, data.it);
        return true;
    };
}

export function addToDiceRollEffect(game: Game, toAdd: number): SyncEffectFunction {
    return (data: EffectData) => {
        const chosenDiceRoll: DiceRoll = data.next as DiceRoll;
        chosenDiceRoll.add(toAdd);
        return true;
    };
}

export function chooseOneEffect(s: string, game: Game, selectionOnResolve: boolean=false): ParsedEffect {
    const lines = s.split("\n");
    if (lines.length < 3) {
        throw new GameError(`invalid 'choose one' effect format. s=${s}$ lines=${lines}$`, toSerializedTranslation("error.behaviorError", { error: `invalid 'choose one' effect format. s=${s}$ lines=${lines}$`}));
    }
    const effects: ParsedEffect[] = lines.slice(1).map(line => effectParser(line, game));
    
    return {
        
        effectFunction: async (data: EffectData): Promise<boolean> => {
            if(!(data.issuer instanceof Player))
                throw new GameError("Effect issuer is not a player.", toSerializedTranslation("error.effectIssuerMustBePlayer"));
            const choices = effects.map((effect, i) => ({
                    description: lines[i + 1]!,
                    visualEffectBox: data.it.visualEffectBoxFromDescription(lines[i + 1]!),
                    card: data.it,
                    admissibleTargets: effect.targetSelectors,
                }))
            const description = selectionOnResolve ?
                (await data.selectAndRecord(game, data.issuer, 1, 1, choices, qq("pending.effectToResolve"), data.serializedCardAndBox, true, true)).selected[0]!.description :
                (data.next as string).toLowerCase();
            if(!description)
                throw new GameError("No description found for choose one effect.", toSerializedTranslation("error.behaviorError", { error: "No description found for choose one effect."}));
            data.visualEffectBox = data.it.visualEffectBoxFromDescription(description);
            for(let i = 0; i < effects.length; i++) {
                if (description === lines[i+1]) {

                    // Create new EffectData with chosen options as targets
                    return effects[i]!.effectFunction(data);
                }
            }
            console.log(lines);
            throw new GameError(`choose one effect description not found: ${description}`, toSerializedTranslation("error.behaviorError", { error: `choose one effect description not found: ${description}`}));
        },
        targetSelectors: [{ 
            description: toSerializedTranslation("selector.one"),
            selector: (issuer: Player, card: Card): any[] => {
                // Construct ChooseOneOptions array from parsed effects
                return effects.map((effect, i) => ({
                    description: lines[i + 1]!,
                    visualEffectBox: card.visualEffectBoxFromDescription(lines[i + 1]!),
                    card: card,
                    admissibleTargets: effect.targetSelectors,
                }));
            }, 
            min: 1, 
            max: 1, 
        }]
    };
}

export function addToStackEffect(game: Game, effect: EffectFunction, s: string): SyncEffectFunction {
    return (data: EffectData) => {
        addPassiveEffectToStack(game, effect, data, s, data.visualEffectBox);
        return true;
    };
}

export function searchCurseInMonsterDeckEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        const issuer = data.issuer instanceof Player ? data.issuer : game.currentPlayer;
        const curseCards = game.decks.monster.cards.filter(card => card instanceof MonsterCard && (card as MonsterCard).isCurse);
        if (curseCards.length === 0) return false;
        const selectedCurseCard = (await data.selectAndRecord(game, issuer, 1, 1, curseCards, qq("pending.curseCardToPutInSlot"), data.serializedCardAndBox, true, true)).selected[0] as MonsterCard;
        if(selectedCurseCard === undefined) return false;
        const curseCard = game.encounters.obtainCard(selectedCurseCard.slug, selectedCurseCard.globalId);
        if(game.encounters.coverableSlots.length === 0)
            return false;   
        game.cardHandler.addTopPosition("monster", curseCard!);
        await game.encounters.selectValidIndexAndDraw(game, issuer, data);
        return true;
    };
}

export function searchGuppyItemEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const guppyItems = game.decks["treasure"]!.cards.filter(card => card instanceof ItemCard && (card as ItemCard).isGuppy());
        if (guppyItems.length === 0) return false;
        const selectedGuppyItem = (await data.selectAndRecord(game, data.issuer, 1, 1, guppyItems, qq("pending.guppyItemToAdd"), data.serializedCardAndBox, true, true)).selected[0] as ItemCard;
        if(selectedGuppyItem === undefined) return false;
        game.shop.obtainCard(selectedGuppyItem.slug, selectedGuppyItem.globalId);
        game.cardHandler.addInPlay(data.issuer, selectedGuppyItem);
        return true;
    };
}

export function revealMonsterCardsAndMayPlayEventCards(game: Game, nbCards: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if(!(data.issuer instanceof Player))
            throw new GameError("revealTopCardsOfMonsterDeckEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", { error: "revealTopCardsOfMonsterDeckEffect can only be applied to Players."}));
        const monsterCards = game.decks.monster.drawSeveral(nbCards);
        data.recordSelection(monsterCards);
        const events = monsterCards.filter(c => c.isEvent);
        const revealPromises = data.selectMultipleAndRecord(game, game.players.map(p => ({
            player: p,
            min: 0,
            max: 0,
            options: monsterCards,
            reason: data.serializedCardAndBox,
            description: qq("pending.topMonsterDeckRevealed", {value: nbCards}),
            canUseOnBoardSelection: false,
        })));

        const eventsToPlay = (await data.selectAndRecord(game, data.issuer, 0, Math.min(nbCards, game.encounters.slots.length), events, toSerializedTranslation("pending.cardsToPutInSlot"), data.serializedCardAndBox)).selected;
        for(const event of eventsToPlay)
        {
            game.decks.monster.addTopPosition(event);
            await game.encounters.selectValidIndexAndDraw(game, data.issuer, data, false);
        }
        const remaining = monsterCards.filter(c => !c.isEvent);
        shuffle<MonsterCard>(game.random, remaining);

        for (let i = 0; i < remaining.length; i++) {
            game.cardHandler.addBottomPosition("monster", remaining[i]!);
        }
        await revealPromises;
        return true;
    };
}

export function expandSlotsEffect(slotText: string, numberToExpand: number, game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const slot = slotText === "shop" ? game.shop : game.encounters;
        slot.expand(numberToExpand);
        return true;
    };
}

export function shuffleDeckEffect(game: Game, deckName: string): SyncEffectFunction {
    return (data: EffectData) => {
        if (!isDeckType(deckName)) {
            throw new GameError(`Invalid deck type: ${deckName}`, toSerializedTranslation("error.invalidDeckType", { deckType: deckName }));
        }
        game.decks[deckName]!.shuffle();
        return true;
    };
}

export function destroyCurseEffect(game: Game, selectionOnResolve: false): SyncEffectFunction
export function destroyCurseEffect(game: Game, selectionOnResolve: boolean): AsyncEffectFunction
export function destroyCurseEffect(game: Game, selectionOnResolve: boolean=false): EffectFunction {
    return async (data: EffectData) => {
        let toDestroy = data.next;
        if(selectionOnResolve) {
            toDestroy = (await data.selectAndRecord(game, data.issuer as Player, 1, 1, data.targets, qq("pending.curseToDestroy"), data.serializedCardAndBox, true, true)).selected[0];
        }
        if(!(toDestroy instanceof MonsterCard && toDestroy.isCurse))
            throw new GameError(`Card to destroy is not a curse: ${toDestroy.name}`, toSerializedTranslation("error.cardToDestroyNotCurse", { card: toDestroy.nameKey }));
        return game.cardHandler.destroyCurse([toDestroy]);
    };
}

export function destroyOneEffect(game: Game, selector: TargetsSelector, type: "selectionOnResolve" | "next"): AsyncEffectFunction {
    return async (data: EffectData) => {
        let toDestroy = data.next as Card;
        if(type === "selectionOnResolve") {
            if(data.issuer instanceof Player === false)
                throw new GameError("Effect issuer is not a player.", toSerializedTranslation("error.effectIssuerMustBePlayer"));
            toDestroy = (await data.selectAndRecord(game, data.issuer as Player, 1, 1, selector.selector(data.issuer, data.it), qq("pending.cardToDestroy"), data.serializedCardAndBox, true, true)).selected[0] as Card;
        }
        if(!selector.selector(data.issuer as Player, data.it).includes(toDestroy))
            return false;
        const res = game.cardHandler.destroyCardsOrSouls([toDestroy]);
        return res;
    };
}

export function destroyXItemsEffect(game: Game, x: number): SyncEffectFunction {
    return (data: EffectData) => {
        const toDestroy = [];
        for (let i = 0; i < x; i++) {
            toDestroy.push(data.next as Card);
        }
        return game.cardHandler.destroyCardsOrSouls(toDestroy);
    };
}

export function changeRollDiceResultEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const chosenDiceRoll: DiceRoll = data.next as DiceRoll;
        // const selectionResult = await data.selectAndRecord(game, data.issuer, 1, [1, 2, 3, 4, 5, 6], false, "Select a value to change the roll to.");
        // const newValue = selectionResult.selected[0] as number;
        const newValue: number = data.next as number;
        chosenDiceRoll.value = newValue;
        return true;
    };
}

export function drawAndGainCoinsAsAPlayerEffect(issuer: Player, target: Player, source: Card, game: Game): boolean {

    const nbCardsToDraw = Math.max(0, target.hand.length - issuer.hand.length);
    const lootCards = game.loot(issuer, nbCardsToDraw);
    const nbCoinsToGain = Math.max(0, target.coins - issuer.coins);
    game.gainCoins(issuer, nbCoinsToGain, source);
    return true;
}

export function swapWithNonEternalItemEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const itemToSwap = data.next as ItemCard;
        game.cardHandler.swapItems(data.it as ItemCard, itemToSwap);
        return true;
    };
}

export function copyTapAbilityEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        const itemToCopy = data.next as ItemCard;
        if(itemToCopy.hasTapEffect() === false) // This handle the special case where placebo tries to copy diplopia, which first resolve into turning into a non-active item.
            return false;
        const activeEffect = itemToCopy.getActiveEffect();
        if (!activeEffect)
            throw new GameError(`Item ${itemToCopy.name} has no active effect to copy.`, toSerializedTranslation("error.behaviorError", { error: `Item ${itemToCopy.name} has no active effect to copy.`}));
        const player = data.issuer as Player;
        if(player === undefined)
            throw new GameError("Effect issuer is not a player.", toSerializedTranslation("error.effectIssuerMustBePlayer"));
        try{
            const newTargets = await TargetBuilder.buildTargetsOnResolve(game, player, itemToCopy, "tap");
            const newData: EffectData = new EffectData(data.it, () => data.issuer, newTargets, data.visualEffectBox);
            const res = await activeEffect.effectFunction(newData);
            if(data.it.type === "loot") {
                data.it.cleanup();
            }else {
                (data.it as LootCard).afterEffect = "addInPlay";
            }
            return res;
        }catch(e) {
            return false;
        };
    };
}

export function becomesCopyOfItemIndefinitelyEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const itemToCopy = data.next as ItemCard;
        const thisItem = data.it as ItemCard;
        // Prevent copying multiple cards at the same time.
        // We use a a different restore tag for indefinite copies, so if it copies another card making temporary copies, it reverse correctly to the indefinite copy.
        if(data.it.tags.restoreIndefinite !== undefined)
            data.it.tags.restoreIndefinite();
        
        // Get the owner
        const owner = game.getOwner(thisItem);
        if (!owner) return false;
        
        // Create a temporary copy to get the JSON from
        // const templateCopy = game.cardHandler.copyCard(itemToCopy) as ItemCard;
        
        // Transform this card to become the copy, with effect attachment
        thisItem.becomesCopyOf(itemToCopy, (card) => {
            game.cardHandler.attachEffectsToCard(card);
        });
        data.it.tags.restoreIndefinite = data.it.tags.restore;
        data.it.tags.restore = undefined;
        // Re-subscribe the new effects with the current owner
        thisItem.onAddInPlay(() => owner);
        
        return true;
    };
}

export function becomesCopyOfItemUntilEndOfTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const itemToCopy = data.next as ItemCard;
        const thisItem = data.it as ItemCard;
        // Prevent copying multiple cards at the same time.
        if(data.it.tags.restore !== undefined)
            data.it.tags.restore();

        // Get the owner
        const owner = game.getOwner(thisItem);
        if (!owner) return false;
        
        // Transform this card to become the copy and get the restore function
        const { restore } = thisItem.becomesCopyOf(itemToCopy, (card) => {
            game.cardHandler.attachEffectsToCard(card);
        });
        let restored = false;
        let unsubscribe = (): void => {};
        const restoreOnce = (): void => {
            if (restored) return;
            restored = true;
            restore();
        };
        
        // Re-subscribe the new effects
        thisItem.onAddInPlay(() => owner);
        
        // Subscribe to end of turn event to restore the original card. As the cleaner is registered after the copy, restore() will remove it.
        unsubscribe = game.emitter.on("till:turn:end", (eventData: OnTurnEndData) => {
                restoreOnce();
        });
         data.it.cleaners.push(() => {
            unsubscribe();
        });
        return true;
    };
}

export function becomesCopyOfItemUntilStartOfYourNextTurnAndRechargeEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const itemToCopy = data.next as ItemCard;
        const thisItem = data.it as ItemCard;
        // Prevent copying multiple cards at the same time.
        if(data.it.tags.restore !== undefined)
            data.it.tags.restore();

        // Get the owner
        const owner = game.getOwner(thisItem);
        if (!owner) return false;
        
        // Create a temporary copy to get the JSON from
        // const templateCopy = game.cardHandler.copyCard(itemToCopy) as ItemCard;
        
        game.cardHandler.recharge(thisItem, data.it);
        // Transform this card to become the copy and get the restore function
        const { restore } = thisItem.becomesCopyOf(itemToCopy, (card) => {
            game.cardHandler.attachEffectsToCard(card);
        });
        let restored = false;
        let unsubscribe = (): void => {};
        const restoreOnce = (): void => {
            if (restored) return;
            restored = true;
            restore();
        };
        
        // Re-subscribe the new effects
        thisItem.onAddInPlay(() => owner);
        // Subscribe to end of turn event to restore the original card
        unsubscribe = game.emitter.on("on:turn:start", (eventData: OnTurnEndData) => {
            if (eventData.eventIssuer === owner) {
                restoreOnce();
            }
        });
        data.it.cleaners.push(() => {
            unsubscribe();
        });
        return true;
    };
}

export function replaceCharacterWithOutsideCardEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        const targetCard = data.next as Card;
        if(data.issuer instanceof Player === false)
            return false;
            if(!(targetCard instanceof CharacterCard))
                throw new GameError(`Target of replaceCharacterWithOutsideCardEffect must be a Character card.`, toSerializedTranslation("error.behaviorError", { error: `Target of replaceCharacterWithOutsideCardEffect must be a Character card.`}));

        const player = data.issuer as Player;
        if(player === undefined)
            throw new GameError("Effect issuer is not a player.", toSerializedTranslation("error.effectIssuerMustBePlayer"));
        await game.cardHandler.replaceCharacter(data.issuer, targetCard);
        return true;
    };
}

export function cancelStackElementEffect(game: Game, selectors: TargetsSelector[] = [], selectionOnResolve: boolean= false): AsyncEffectFunction {
    return async (data: EffectData) => {
        const toRemove = !selectionOnResolve 
            ? data.next as StackElement 
            : (await data.selectAndRecord(game, data.issuer as Player, 1, 1, selectors[0]?.selector(data.issuer as Player, data.it)!, selectors[0]!.description, data.serializedCardAndBox, true, true)).selected[0] as StackElement;
            game.cancelStackElement(toRemove);
            if(toRemove instanceof LootCardEffect && !game.decks.loot.discard.includes(toRemove.card)) // must handle the discard.
                game.cardHandler.discard(toRemove.card);
        return true;
    };
}
export function eachOtherPlayerDiscardsLootEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const issuer = data.issuer;
        const choices = [];
        for (const player of game.players) {
            if (player !== issuer && player.hand.length > 0) {
                choices.push({
                player,
                min: 1,
                max: 1,
                options: player.hand.cards,
                reason: data.serializedCardAndBox,
                description: qq("pending.lootCardToDiscard"),
                canUseOnBoardSelection: true,
            });
            }
        }
        const playersChoices:{ playerId: string; selected: LootCard[]; remaining: LootCard[] }[] = await data.selectMultipleAndRecord(game, choices);
        let success = true;
        for (const playerChoice of playersChoices) {
            const player = game.entityHandler.getPlayerById(playerChoice.playerId);
            const index = player.hand.cards.indexOf(playerChoice.selected[0]!);
            success = success && game.cardHandler.discardFromHandAtIndex(player, index, "effect");
        }
        return success;
    }
}

export function modifyCoinGainedEffect(game: Game, modifier: (original:number) => number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const originalAmount = data.next;
        if (!originalAmount || !(originalAmount instanceof Array) || originalAmount.length !== 1 || typeof originalAmount[0] !== "number") {
            throw new GameError(`Invalid original amount for ModifyCoinGainedEffect: ${originalAmount}`, toSerializedTranslation("error.behaviorError", { error: `Invalid original amount for ModifyCoinGainedEffect: ${originalAmount}`}));
        }
        originalAmount[0] = modifier(originalAmount[0]);
        game.gainCoins(data.issuer, originalAmount[0], data.it);
        return true;
    };
}

export function stealSoulEffect(game: Game, from: "next" | "anotherPlayer"): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        let souls: Card[] = [];
        if( from === "next"){
            const target = data.next;
            if(target instanceof Player === false)
                return false;
            souls = target.souls;
        }
        else if(from === "anotherPlayer")
        {
            souls = game.players.filter(p => p !== data.issuer).flatMap(p => p.souls);
        }
        if(souls.length === 0) return false;
        const soulToSteal = (await data.selectAndRecord(game, data.issuer, 1, 1, souls, qq("pending.soulToSteal"), data.serializedCardAndBox, true, true)).selected[0]!;
        const target = game.getOwner(soulToSteal, "soul");
        game.cardHandler.stealSoul(data.issuer, target!, soulToSteal);
        return true;
    };
}

export function stealCoinsEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const target = data.next as Player;
        game.stealCoins(data.issuer, target!, amount, data.it);
        return true;
    };
}

export function lookAtTop3Put1InSlotEffect(game: Game, x: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if(game.entitiesInCombat.length > 0)
            return false;
        if (data.issuer instanceof Player === false) return false;
        const deck = data.next;
        if(!isDeckType(deck._type) || !deck)
            throw new GameError(`Target of lookAtTop3Put1InSlotEffect should be a deck type, got ${deck}`, toSerializedTranslation("error.behaviorError", { error: `Target of lookAtTop3Put1InSlotEffect should be a deck type, got ${deck}`}));
        const topCards = game.cardHandler.getFirstCardsOfDeck(deck._type, x);
        if (topCards.length === 0) return false;
        const selectedCard = (await data.selectAndRecord(game, data.issuer, 1, 1, topCards, qq("pending.cardToPutInSlot"), data.serializedCardAndBox, true, true)).selected[0]!;
        if(!selectedCard)
            return false;
        const slot = deck._type === "monster" ?
            (await data.selectAndRecord(game, data.issuer, 1, 1, game.monsters.filter(m => m.isEngagedInCombat === false), qq("pending.slotToPlaceCardIn"), data.serializedCardAndBox, true)).selected[0]!
            : (await data.selectAndRecord(game, data.issuer, 1, 1, game.rooms?.activeRooms!, qq("pending.slotToPlaceCardIn"), data.serializedCardAndBox, true)).selected[0]!;
        if (!slot) return false;
        if(deck._type === "monster") {
            game.cardHandler.addTopPosition("monster", selectedCard);
            game.encounters.draw(game.encounters.visible.indexOf((slot as Monster).card));
        }
        else {
            game.cardHandler.addTopPosition("room", selectedCard);
            game.rooms?.draw(game.rooms.activeRooms.indexOf(slot as RoomCard));
        }
        return true;
    };
}

export function getCardFromLootDiscardEffect(cardTxt: string | "top", game: Game, exactMatch: boolean): AsyncEffectFunction {
    return async (data: EffectData) => {
        const possibilities = game.decks.loot.discard.filter(card => exactMatch ? card.name === cardTxt : card.name.includes(cardTxt));
        if(possibilities.length === 0 && cardTxt !== "top") return false;
        const card = cardTxt === "top" ? game.decks.loot.discard[0] :
            (await data.selectAndRecord(game, data.issuer as Player, 1, 1, possibilities, qq("pending.cardToGet"), data.serializedCardAndBox, true, true)).selected[0]!;
        if (!card) return false;
        const success = game.decks.loot.getFromDiscard(card);
        if (!success) return false;
        game.cardHandler.addCardToHand(data.issuer as Player, card);
        return true;
    };
}

export function lookAtTopXPut1InYourHandRestInAnotherPlayerHandEffect(game: Game, x: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const topCards = game.cardHandler.getFirstCardsOfDeck("loot", x);
        if (topCards.length === 0) return false;
        const selectedCard = (await data.selectAndRecord(game, data.issuer, 1, 1, topCards, qq("pending.cardToPutInHand"), data.serializedCardAndBox, true, true)).selected[0]!;
        if(!(selectedCard instanceof LootCard))
            throw new GameError("Selected card is not an instance of LootCard.", toSerializedTranslation("error.behaviorError", { error: "Selected card is not an instance of LootCard."}));
        const otherCards = topCards.filter(c => c !== selectedCard);
        const otherPlayer = (await data.selectAndRecord(game, data.issuer, 1, 1, game.players.filter(p => p !== data.issuer), qq("pending.playerToGiveLootCardTo"), data.serializedCardAndBox, true, true)).selected[0]!;
        if(!(otherPlayer instanceof Player))
            throw new GameError("Selected player is not an instance of Player.", toSerializedTranslation("error.behaviorError", { error: "Selected player is not an instance of Player."}));
        game.cardHandler.addCardToHand(data.issuer as Player, selectedCard);
        for (const card of otherCards) {
            game.cardHandler.addCardToHand(otherPlayer, card);
        }
        return true;
    };
}

export function stealNonEternalItemEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const itemToSteal = data.next;
        if(itemToSteal.eternal)
            return false;
        return game.cardHandler.stealItemAnywhere(data.issuer, itemToSteal);
    };
}

export function stealNonEternalItemFromTargetEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const target = data.next as Player;
        if(!(target instanceof Player))
            throw new GameError("Target of stealNonEternalItemFromTargetEffect must be a Player.", toSerializedTranslation("error.behaviorError", { error: "Target of stealNonEternalItemFromTargetEffect must be a Player."}));
        const itemToSteal = (await data.selectAndRecord(game, data.issuer, 1, 1, target.inPlay.filter(card => !card.eternal), qq("pending.itemToSteal"), data.serializedCardAndBox, true, true)).selected[0]!;
        if(itemToSteal === undefined ||itemToSteal.eternal)
            return false;
        return game.cardHandler.stealItemAnywhere(data.issuer, itemToSteal);
    };
}

export function stealNonEternalItemFromAnywhereEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const itemToSteal = data.next;
        if(itemToSteal.eternal)
            return false;
        return game.cardHandler.stealItemAnywhere(data.issuer, itemToSteal);
    };
}

export function subtractUpToXFromRollEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const chosenDiceRoll: DiceRoll = data.next as DiceRoll;
        const subtractValue = data.next as number;
        chosenDiceRoll.subtract(subtractValue);
        return true;
    };
}

export function gainCoinsBasedOnMonsterSlotsAndLootInHandEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const player = data.issuer;
        const coinsToGain = game.encounters.slots.length + player.hand.length;
        game.gainCoins(player, coinsToGain, data.it);
        return true;
    };
}

export function lootBasedOnTargetPlayersLootCardsEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const targetPlayer = data.next as Player;
        if(!(targetPlayer instanceof Player)) 
            throw new GameError("Target of lootBasedOnTargetPlayersLootCardsEffect must be a Player.", toSerializedTranslation("error.behaviorError", { error: "Target of lootBasedOnTargetPlayersLootCardsEffect must be a Player."}));
        const lootCardsToDraw = targetPlayer.hand.cards.filter(card => card instanceof LootCard).length;
        const lootedCards = game.loot(data.issuer, lootCardsToDraw);
        return true;
    };
}

export function addUpToXToRollEffect(game: Game, rollType: "attack" | "non-attack" | "any"): SyncEffectFunction {
    return (data: EffectData) => {
        const chosenDiceRoll: DiceRoll = data.next as DiceRoll;
        if(chosenDiceRoll.attackRoll && rollType === "non-attack" || 
          !chosenDiceRoll.attackRoll && rollType === "attack") {
            return false;
        }
        const addValue = data.next as number;
        if(typeof addValue !== "number") {
            throw new GameError(`Invalid value for AddUpTo2ToRollEffect: ${addValue}`, toSerializedTranslation("error.behaviorError", { error: `Invalid value for AddUpTo2ToRollEffect: ${addValue}`}));
        }
        chosenDiceRoll.add(addValue);
        return true;
    };
}

export function addXToRollEffect(x: number): SyncEffectFunction {
    return (data: EffectData) => {
        const chosenDiceRoll: DiceRoll = data.next as DiceRoll;
        chosenDiceRoll.add(x);
        return true;
    };
}

export function shopItemAuctionEffect(game: Game, minPrice: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        const shopItem = data.next as ItemCard;
        if(!(shopItem instanceof ItemCard) || game.shop.cardsOnTop.includes(shopItem) === false)
            return false;
        if(data.issuer instanceof Player === false) return false;
        let highestBid = minPrice;
        let highestBidder: Player | null = null;
        let countSinceLastBid = 0;
        while(countSinceLastBid !== game.players.length - 1) {
            for (const player of game.players) {
                if (player === data.issuer || countSinceLastBid === game.players.length - 1) continue;
                const possibleBids = [0];
                for(const val of [highestBid + 1, highestBid + 3, highestBid + 5])
                    if(val <= player.coins) 
                        possibleBids.push(val);
                const bid = await data.selectAndRecord(game, player, 0, 1, possibleBids, qq("pending.currentHighestBid", { highestBid }), data.serializedCardAndBox, true, true);
                const bidValue = bid.selected[0] as number;
                if (bidValue === 0)
                    countSinceLastBid++;
                else if (bidValue > highestBid) {
                    highestBid = bidValue;
                    highestBidder = player;
                    countSinceLastBid = 0;
                }
            }
        }
        if (highestBidder) {
            await game.giveCoins(highestBidder, data.issuer, highestBid, data.it);
            game.shop.removeCard(shopItem);
            game.cardHandler.addInPlay(highestBidder, shopItem);
        }
        return true;
    };
}

export function lootAndGainAsPlayerEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        return drawAndGainCoinsAsAPlayerEffect(data.issuer, data.next as Player, data.it , game);
    };
}

export function dealDamageToRandomPlayerEffect(game: Game, damage: number, type: "any" | "non-active"): SyncEffectFunction {
    return (data: EffectData) => {
        const validPlayers = type === "non-active" ? game.players.filter(player => player !== game.currentPlayer) : game.players;
        if (validPlayers.length === 0) return false;
        const targetPlayer = validPlayers[Math.floor(game.random() * validPlayers.length)]!;
        game.entityHandler.dealDamage(data.issuer, targetPlayer, data.cardAndBox, damage);
        return true;
    };
}

export function discardLootAndLoseCoinsBasedOnSoulsEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const player = data.issuer;
        const nbSouls = player.totalSouls;
        const lootToDiscard = Math.min(nbSouls, player.hand.length);
        const selectedLootCards = (await data.selectAndRecord(game, player, lootToDiscard, lootToDiscard, player.hand.cards, 
            (lootToDiscard > 1 ?
            qq("pending.manyLootToDiscard", { lootToDiscard: lootToDiscard })
            : qq("pending.oneLootToDiscard")), data.serializedCardAndBox, true, true)).selected;
        for (const card of selectedLootCards) {
            if(!(card instanceof LootCard))
                throw new GameError("Selected card is not an instance of LootCard.", toSerializedTranslation("error.behaviorError", { error: "Selected card is not an instance of LootCard."}));
            const index = player.hand.cards.indexOf(card);
            game.cardHandler.discardFromHandAtIndex(player, index, "effect");
        }
        game.loseCoins(player, nbSouls, true, "effect");
        return true;
    };
}

export function flushMonsterSlotsEffect(game: Game, where: "bottom" | "discard" | "discardAndDraw"): SyncEffectFunction {
    return (data: EffectData) => {
        switch(where) {
            case "bottom":
                game.encounters.flushToBottom();
                break;
            case "discard":
                game.encounters.flush();
                break;
            case "discardAndDraw":
                game.encounters.flushAndDraw();
                break;
        }
        return true;
    };
}

export function ifOnlyActivePlayerAliveTheyWinEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const alivePlayers = game.players.filter(player => player.isDead === false);
        if(alivePlayers.length === 1 && alivePlayers[0] === game.currentPlayer) {
            game.win(game.currentPlayer);
        }
        return true;
    };
}

export function flipAndAddAttackEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const owner = game.getOwner(data.it);
        if(owner === null)
            return false;
        if(data.it.entity instanceof Animated && !data.it.entity?.isDead)
            game.entityHandler.entityRewards(data.it.entity, game.currentPlayer)
        game.cardHandler.flip(owner, data.it);
        game.entityHandler.addAttackThisTurn(game.currentPlayer, 1, data.it);
        return true;
    };
}

export function lookAtHands(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        await data.selectAndRecord(game, data.issuer, 0, 0, game.cardHandler.allHands(), qq("pending.youCanSeeEachPlayersHands"), data.serializedCardAndBox, false, false);
        return true;
    };
}

export function dealXDamageDividedAsYouChooseEffect(game: Game, damage: number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const player = data.issuer;
        const firstTarget = data.next as Entity;
        const secondTarget = data.next as Entity;
        if(!firstTarget)
            return false;
        if(!secondTarget)
            game.entityHandler.dealDamage(player, firstTarget, data.cardAndBox, damage);
        else
        {
            game.entityHandler.dealDamage(player, firstTarget, data.cardAndBox, Math.ceil(damage/2));
            game.entityHandler.dealDamage(player, secondTarget, data.cardAndBox, Math.floor(damage/2));
        }
        return true;
    };
}

export function lookAtAPlayerHand(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const target = data.next as Player;
        await data.selectAndRecord(game, data.issuer, 0, 0, [{
            player: target,
            hand: target.hand
        }], qq("pending.lookAtPlayerHand", { name: target.id }), data.serializedCardAndBox, false, false);
        return true;
    };
}
export function swapNonEternalItemsEffect(game: Game, youMayEffectHanging: boolean[] = [false]): AsyncEffectFunction {
    const allowZero = youMayEffectHanging[0];
    youMayEffectHanging[0] = false;
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        let otherPlayer = data.next;
        if(otherPlayer instanceof DiceRoll)
            otherPlayer = otherPlayer.issuer;
        if(!(otherPlayer instanceof Player))
            throw new GameError("Invalid target player for swapNonEternalItemsEffect", toSerializedTranslation("error.behaviorError", { error: "Invalid target player for swapNonEternalItemsEffect"}));
        if(otherPlayer === data.issuer) return true;
        const itemToSwapFromIssuer = (await data.selectAndRecord(game, data.issuer, allowZero ? 0 : 1, 1, data.issuer.inPlay.filter((card) => card instanceof ItemCard && card.eternal === false), qq("pending.itemToSwapFromYourInPlay"), data.serializedCardAndBox, true, true)).selected[0] as ItemCard;
        if(itemToSwapFromIssuer === undefined) return true;
        const itemToSwapFromOtherPlayer = (await data.selectAndRecord(game, data.issuer, 1, 1, otherPlayer.inPlay.filter((card) => card instanceof ItemCard && card.eternal === false), qq("pending.itemToSwapFromOtherPlayerInPlay"), data.serializedCardAndBox, true, true)).selected[0] as ItemCard;
        if(itemToSwapFromIssuer === undefined) return true;
        if(itemToSwapFromOtherPlayer === undefined) return true;
        return game.cardHandler.swapItems(itemToSwapFromIssuer, itemToSwapFromOtherPlayer);
    }
}
export function flushOneMonsterSlotEffect(game: Game, min: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if(game.monsters.filter((m) => m !== null && !m.isEngagedInCombat).length === 0) return false;
        const monsterToFlush = (await data.selectAndRecord(game, data.issuer, min, 1, game.monsters.filter((m) => m !== null && !m.isEngagedInCombat), qq("pending.monsterToFlush"), data.serializedCardAndBox, true, true)).selected[0] as Monster;
        if(monsterToFlush === undefined) return false;
        if(game.encounters._slots.findIndex(slot => slot.includes(monsterToFlush.card)) === -1) return false;
        game.encounters.flushMonster(monsterToFlush, "discard");
        return true;
    };
}

export function discardMonsterOrShopItem(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        const card = data.next;
        if(card instanceof TreasureCard){
            const success = game.shop.removeCard(card)
            if(success)
                game.decks.treasure.addDiscardTop(card);
            return success;
        }else if(card instanceof MonsterCard && card.entity instanceof Monster && !card.entity.isEngagedInCombat){
            return game.encounters.flushMonster(card.entity, "discard");

        }else{
            return false
        }
    };
}

export function giveAdditionalAttackThisTurnEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const player = data.issuer;
        player.attackThisTurn += amount;
        return true;
    };
}

export function flipThisItemEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const item = data.it as ItemCard;
        game.cardHandler.flip(data.issuer, item);
        return true;
    };
}

export function addCountersAndGainTreasureEffect(countersThreshold: number, toRemove:number, treasureToGain: number, game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const dmg = data.peek() as number;
        game.cardHandler.addToCounter(data.issuer, data.it, "normal", dmg);
        if (data.it.counters.value("normal") >= countersThreshold) {
            game.cardHandler.addToCounter(data.issuer, data.it, "normal", -toRemove);
            game.gainTreasure(data.issuer, treasureToGain);
        }
        return true;
    };
}

export function becomeSoulIfAboveXCountersEffect(countersThreshold: number, game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.it.counters.value("normal") >= countersThreshold) {
            const owner = game.getOwner(data.it);
            if(owner instanceof Player === false)
                return false;
            if(!game.cardHandler.removeInPlay(owner, data.it as ItemCard))
                {
                    return false;
                };
            enterPlayBecomeSoulEffect(game)(new EffectData(data.it, () => owner, [], data.visualEffectBox));
        }
        return true;
    };
}

export function putTopMonsterInValidSlotEffect(game: Game, youMay: boolean): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if(game.encounters.coverableSlots.length === 0)
            return false;
        await game.encounters.selectValidIndexAndDraw(game, data.issuer, data, youMay);
        return true;
    };
}
// if you have 0¢, gain 6¢.
export function gainXCoinsIfYEffect(coinsToHave: number, coinsToGain: number, game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if (data.issuer.coins === coinsToHave) {
            game.gainCoins(data.issuer, coinsToGain, data.it);
        }
        return true;
    };
}

export function lootXIfYEffect(cardsToHave: number, atLeast: boolean, cardsToLoot: number, game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if (atLeast ? data.issuer.hand.length >= cardsToHave : data.issuer.hand.length === cardsToHave) {
            game.loot(data.issuer, cardsToLoot);
        }
        return true;
    };
}

export function discardAnyNumberOfLootCardsEffect(game: Game, youMayEffectHanging: boolean[] = [false]): AsyncEffectFunction {
    const allowZero = youMayEffectHanging[0];
    youMayEffectHanging[0] = false;
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const player = data.issuer;
        const maxToDiscard = player.hand.length;
        const selectionResult = await data.selectAndRecord(game, player, 0, maxToDiscard, player.hand.cards, qq("pending.lootCardsToDiscard"), data.serializedCardAndBox, true, true);
        const nbDiscarded = selectionResult.selected.length;
        let success = true;
        for (const card of selectionResult.selected) {
            const index = player.hand.cards.indexOf(card);
            success = success && game.cardHandler.discardFromHandAtIndex(player, index, "effect");
        }
        data.addTarget(nbDiscarded);
        return success;
    };
}

export function forcePlayerRerollDiceEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const diceRoll = data.next;
        if(!(diceRoll instanceof DiceRoll))
            throw new GameError("Expected a DiceRoll instance.", toSerializedTranslation("error.expectedDiceRollInstance"));
        diceRoll.roll();
        return true;
    };
}

export function lootEqualToCardsDiscardedEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const nbToLoot = data.next as number;
        game.loot(data.issuer, nbToLoot);
        data.targets = []; // reset targets for displaying purposes.
        return true;
    };
}

export function discardTopOfDeckEffect(game: Game, youMayEffectHanging: boolean[] = [false]): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const selection = (await data.selectAndRecord(game, data.issuer, youMayEffectHanging[0] ? 0 : 1, 1, deckSelector(undefined, game)(data.issuer), qq("pending.deckToDiscardTopCardOf"), data.serializedCardAndBox, true, true)).selected;
        if(selection.length === 0) return true;
        const deck = selection[0];
        if(deck === undefined || !isDeckType(deck._type))
            throw new GameError(`Invalid deck type: ${deck._type}`, toSerializedTranslation("error.invalidDeckType", { deckType: deck._type }));
        youMayEffectHanging[0] = false;
        const topCard = deck.draw();
        game.cardHandler.discard(topCard);
        return true;
    };
}

export function lookAtPlayerHandAndTopOfDeckEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const targetPlayer = data.next as Player;
        const deck = data.next;
        if(!(targetPlayer instanceof Player) || !!isDeckType(deck))
            throw new GameError("Invalid target for lookAtPlayerHandAndTopOfDeckEffect.", toSerializedTranslation("error.behaviorError", { error: "Invalid target for lookAtPlayerHandAndTopOfDeckEffect."}));
        await data.selectAndRecord(game, data.issuer, 0, 0, targetPlayer.hand.cards, qq("pending.lookAtPlayerHand", {name: targetPlayer.id}), data.serializedCardAndBox, false, false);
        await data.selectAndRecord(game, data.issuer, 0, 0, [deck.cards[0]], qq("pending.lookAtTopCardOfDeck", {deck: deck.translatedType}), data.serializedCardAndBox, false, false);
        return true;
    };
}

// Look at the top card of a deck. You may put it back.
export function LookAndPutBottomEffect(
    deckName: string,
    game: Game
): AsyncEffectFunction {
    return async (data:EffectData) => {
        if(!isDeckType(deckName))
            throw new GameError(`Invalid deck type: ${deckName}`, toSerializedTranslation("error.invalidDeckType", { deckType: deckName }));
        if (data.issuer instanceof Player === false) return false;
        const deck = game.decks[deckName];
        if (!deck) {
            throw new GameError(`Deck ${deckName} does not exist.`, toSerializedTranslation("error.behaviorError", { error: `Deck ${deckName} does not exist.`}));
        }
        const topCard = deck.draw();
        const res = await data.selectAndRecord(game, data.issuer, 0, 1, [topCard], qq("pending.lookAtTopCardOfNamedDeck", {deck: game.decks[deckName].translatedType}), data.serializedCardAndBox, false, false);
        if (res.selected.length > 0) {
            game.cardHandler.addBottomPosition(deckName, topCard);
        } else {
            game.cardHandler.addTopPosition(deckName, topCard);
        }
        return true;
    };
}
// choose a player at random. That player destroys an item they control.
export function destroyItemOfRandomPlayerEffect(game: Game): AsyncEffectFunction {

    return async (data: EffectData) => {
        const players = game.players;
        const randomIndex = Math.floor(game.random() * players.length);
        const targetPlayer = players[randomIndex]!;
        if(targetPlayer.inPlay.filter((card) => card instanceof ItemCard && card.eternal === false).length === 0) return false;
        const item = (await data.selectAndRecord(game, targetPlayer, 1, 1, targetPlayer.inPlay.filter((card) => card instanceof ItemCard && card.eternal === false), qq("pending.itemToDestroy"), data.serializedCardAndBox, true, true)).selected[0]!;
        return game.cardHandler.destroyCardsOrSouls([item]);
    };
}

export function deactivateAllYourItemsAndCharaEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const player = data.issuer;
        for (const card of player.inPlay) {
            game.cardHandler.deactivateItem(card);
        }
        game.cardHandler.deactivateItem(player.character);
        return true;
    };
}

export function discardAnyNumberOfShopItemsEffect(game: Game, min: number, max: number | "any", selection: "onResolve" | "next"): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const shop = game.shop;
        const shopLength = shop.itemsInShop.filter((slot) => slot !== undefined).length;
        const maxToDiscard = (max === "any") ? shopLength : Math.min(max, shopLength);
        let selectionResult: ItemCard[] = [];
        switch(selection) {
            case "onResolve":
                selectionResult = (await data.selectAndRecord(game, data.issuer, min, maxToDiscard, shop.itemsInShop.filter((slot) => slot !== undefined) as ItemCard[], qq("pending.itemsToDiscardFromShop"), data.serializedCardAndBox, true, true)).selected;
                break;
            case "next":
                if(min !== max)
                    throw new GameError("Not handled case where min and max are different for 'next' selection in discardAnyNumberOfShopItemsEffect.", toSerializedTranslation("error.behaviorError", { error: "Not handled case where min and max are different for 'next' selection in discardAnyNumberOfShopItemsEffect."}));
                for(let i = 0; i < min; i++) {
                    const item = data.next as ItemCard;
                    if(!item)
                        throw new GameError("Not enough items selected for 'next' selection in discardAnyNumberOfShopItemsEffect.", toSerializedTranslation("error.behaviorError", { error: "Not enough items selected for 'next' selection in discardAnyNumberOfShopItemsEffect."}));
                    selectionResult.push(item);
                }
                break;
            default:
                throw new GameError(`Invalid selection timing: ${selection}`, toSerializedTranslation("error.behaviorError", { error: `Invalid selection timing: ${selection}`}));
        }
        for (const card of selectionResult) {
            const index = shop.itemsInShop.indexOf(card);
            game.shop.discardTop(index);
        }
        data.addTarget(selectionResult.length);
        return true;
    };
}

export function selectEternalAmongX(game: Game, x: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (!(data.issuer instanceof Player)) return false;
        const options: TreasureCard[] = game.decks["treasure"]!.drawSeveral(x);
        const selection = await data.selectAndRecord(game, data.issuer, 1, 1, options, qq("pending.startingEternalTreasure"), data.serializedCardAndBox, true, true);
        selection.selected[0]?.setEternal(true);
        game.cardHandler.addInPlay(data.issuer, selection.selected[0]!); 
        for (const card of options) {
            if (card !== selection.selected[0]) {
                game.decks.treasure.addBottomPosition(card);
            }
        }
        await game.resolveCallbacks();
        return true;
    };
}

export function setMonsterAttackToXEffect(game: Game, x: number): SyncEffectFunction {
    return (data: EffectData) => {
        const target = data.next as Monster;
        if(!target || !(target instanceof Monster))
            throw new GameError(`Invalid target for setMonsterAttackToXEffect: ${target}`, toSerializedTranslation("error.behaviorError", { error: `Invalid target for setMonsterAttackToXEffect: ${target}`}));
        target.baseAttackPoints = x;
        return true;
    };
}

export function flipCharacterEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const player = data.issuer;
        const card = player.character;
        if(card.flipData === undefined) return false;
        game.cardHandler.flip(player, card);
        return true;
    }   
}

export function dealDamageToUpToXMonstersOrPlayersEffect(game: Game, maxTargets: number, dmg: number): SyncEffectFunction {
    return (data: EffectData) => {
        for (let i = 0; i < maxTargets; i++) {
            const target = data.next as Entity;
            if(!target || !(target instanceof Entity)) break;
            game.entityHandler.dealDamage(data.issuer as Entity, target, data.cardAndBox, dmg);
        }
        return true;
    }
}

export function destroyItemStealFromShopEffect(game: Game, may: boolean): AsyncEffectFunction {
    return async (data: EffectData) => {
        const itemToDestroy = data.next as ItemCard;
        if(!itemToDestroy || !(itemToDestroy instanceof ItemCard))
            throw new GameError(`Invalid item to destroy in destroyItemStealFromShopEffect: ${itemToDestroy}`, toSerializedTranslation("error.behaviorError", { error: `Invalid item to destroy in destroyItemStealFromShopEffect: ${itemToDestroy}`}));
        const owner = game.getOwner(itemToDestroy);
        const res = game.cardHandler.destroyCardsOrSouls([itemToDestroy]);
        if(!res) 
            return false;
        if(owner instanceof Player) {
            const itemToSteal = (await data.selectAndRecord(game, owner, may ? 0 : 1, 1, game.shop.itemsInShop.filter((slot) => slot !== undefined) as ItemCard[], qq("pending.itemToSteal"), data.serializedCardAndBox, true, true)).selected[0] as ItemCard;
            if(itemToSteal) {
                game.shop.obtainCard(itemToSteal.slug, itemToSteal.globalId);
                game.cardHandler.addInPlay(owner, itemToSteal);
            }
        }
        return true;
    };
}

export function removeCounterAndLootIfAbove(game: Game, counterThreshold: number, lootAmount: number): SyncEffectFunction {
    return (data: EffectData) => {
        if(!(data.issuer instanceof Player)) return false;
        const currentCounters = data.it.counters.value("normal") || 0;
        if(currentCounters >= counterThreshold) {
            game.cardHandler.addToCounter(data.issuer, data.it, "normal", -currentCounters);
            game.loot(data.issuer, lootAmount);
            return true;
        }
        return false;
    };
}

export function lookAndOrderEffect(deckName: string, numberOfCards: number, game: Game): AsyncEffectFunction {
    if(!isDeckType(deckName))
        throw new GameError(`Invalid deck type: ${deckName}`, toSerializedTranslation("error.invalidDeckType", { deckType: deckName }));
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const cards = game.cardHandler.getFirstCardsOfDeck(deckName, numberOfCards);
        const selectionResult = await data.selectAndRecord(game, data.issuer, numberOfCards, numberOfCards, cards, qq("pending.orderCards", { numberOfCards, deckName }), data.serializedCardAndBox, false, false);
        for (let i = 0; i < selectionResult.selected.length; i++) {
            game.cardHandler.addTopPosition(deckName, selectionResult.selected[numberOfCards - 1 - i]!);
        }
        return true;
    };
}
export function putCountersOnItemEffect(amount: number, game: Game): SyncEffectFunction {   
    return (data: EffectData) => {
        game.cardHandler.addToCounter(data.issuer, data.it, "normal", amount);
        return true;
    };
}
export function rerollDiceRollXEffect(game: Game, numberOfDice: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        const diceRoll = data.next;
        if(!(diceRoll instanceof DiceRoll))
            throw new GameError("Expected a DiceRoll instance.", toSerializedTranslation("error.expectedDiceRollInstance"));
        const values = [];
                for(let i = 0; i < numberOfDice; i++)
                    values.push(diceRoll.issuer.rollDice(game.random, diceRoll.data).value);
        const chooser = (await data.selectAndRecord(game, diceRoll.issuer as Player, 1, 1, game.players.filter((p) => p !== diceRoll.issuer), qq("pending.choosePlayerForDiceRoll", { value: values[0], value2: values[1] }), data.serializedCardAndBox, true, true)).selected[0] as Player;
        if(!chooser)
            throw new GameError("No player selected.", toSerializedTranslation("error.noPlayerSelected"));
        const result = await data.selectAndRecord(game, chooser, 1, 1, values, qq("pending.changeDiceRoll"), data.serializedCardAndBox, true, true);
        const newValue = result.selected[0] as number;
        if(newValue < 1 || newValue > 6)
            throw new GameError(`Invalid dice value selected: ${newValue}`, toSerializedTranslation("error.behaviorError", { error: `Invalid dice value selected: ${newValue}`}));
        diceRoll.value = newValue;
        return true;
    };
}

export function bombInLootDeckEffect(game: Game, numberOfCards: number): SyncEffectFunction {
    return (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        const cards = game.decks.loot.drawSeveral(numberOfCards);
        const bombCards = cards.filter((card) => card.name.includes("Bomb"));
        const otherCards = cards.filter((card) => !card.name.includes("Bomb"));
        bombCards.forEach((card) => game.cardHandler.addCardToHand(data.issuer as Player, card));
        otherCards.forEach((card) => game.decks.loot.addBottomPosition(card));
        return true;
    };
}

export function pillsInLootDeckEffect(game: Game, numberOfCards: number): SyncEffectFunction {
    return (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        const cards = game.decks.loot.drawSeveral(numberOfCards);
        const pillsCards = cards.filter((card) => card.name === "Pills!");
        const otherCards = cards.filter((card) => card.name !== "Pills!");
        pillsCards.forEach((card) => game.cardHandler.addCardToHand(data.issuer as Player, card));
        otherCards.forEach((card) => game.decks.loot.addBottomPosition(card));
        return true;
    };
}

export function gainCoinsBasedOnCountersEffect(game: Game): SyncEffectFunction {
        return (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        const counters = data.it.counters.value("normal") || 0;
        game.gainCoins(data.issuer, counters, data.it);
        return true;
    };
}
export function giveThisToAnotherPlayerEffect(game: Game): AsyncEffectFunction {
    return async (effectData: EffectData) => {
        if (!(effectData.issuer instanceof Player)) return false;
        if(game.getOwner(effectData.it, "inplay") !== effectData.issuer)
            return false;
        const otherPlayers = game.players.filter(p => p !== effectData.issuer);
        if (otherPlayers.length === 0) return true;
        const selection = await effectData.selectAndRecord(game, effectData.issuer, 1, 1, otherPlayers, qq("pending.playerToGiveItemTo"), effectData.serializedCardAndBox, true, true);
        if (selection.selected.length > 0) {
            const chosenPlayer = selection.selected[0]!;
            game.cardHandler.give(effectData.issuer, chosenPlayer, effectData.it);
            effectData.issuerProvider = (): Player => chosenPlayer;
        }
        return true;
    };
}
export function discardLootOrTakeDamageEffect(game: Game, damage: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        const player = data.issuer;
        if(player.hand.length === 0) {
            game.entityHandler.dealDamage(player, player, data.cardAndBox, damage);
            return true;
        }
        const card = (await data.selectAndRecord(game, player, 1, 1, player.hand.cards, qq("pending.cardToDiscard"), data.serializedCardAndBox, true, true)).selected[0];
        if(!(card instanceof LootCard))
            return false;
        const idx = player.hand.cards.indexOf(card);
        game.cardHandler.discardFromHandAtIndex(player, idx);
        return true;
    };
}
export function cancelAttackOnMonsterEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        if(data.issuer.isEngagedInCombat === false) return false;
        game.entityHandler.endCombat();
        return true;
    };
}

export function takeDamageAndAddCounterEffect(game: Game, damageAmount: number, counterAmount: number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        game.entityHandler.dealDamage(data.issuer, data.issuer, data.cardAndBox, damageAmount,
            (data: EffectData) => 
            {
                game.cardHandler.addToCounter(data.issuer, data.it, "normal", 1);
                if(data.it.counters.value("normal") >= counterAmount)
                    becomeSoulIfAboveXCountersEffect(counterAmount, game)(data);
                return true;
            }
        );
        return true;
    };
}

export function healMonsterThenDamageAnotherEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const monsterToHeal = data.next as Monster;
        if(monsterToHeal === undefined) throw new GameError("No monster selected to heal.", toSerializedTranslation("error.noMonsterSelected"));
        if(!monsterToHeal.isEngagedInCombat) return false;

        const healAmount = monsterToHeal.healthPoints - monsterToHeal.currentHealthPoints;
        game.entityHandler.heal(monsterToHeal, healAmount);
        const target = (await data.selectAndRecord(game, data.issuer, 1, 1, game.monsters.filter((m) => m !== monsterToHeal && m !== null), qq("pending.anotherMobToDealDamageTo", { value: healAmount }), data.serializedCardAndBox, true, true)).selected[0] as Monster;
        if(target === undefined) 
            return false;
        game.entityHandler.dealDamage(data.issuer, target, data.cardAndBox, healAmount);
        if(game.currentPlayer !== data.issuer) {
            game.entityHandler.endCombat();
            game.entityHandler.addAttackThisTurn(game.currentPlayer, 1, data.it);
        }
        return true;
    }
}

export function putRoomOrMonsterIntoDiscardEffect(game: Game, youMay: boolean): AsyncEffectFunction {
    return async (data: EffectData) => {

        const targets = game.monsters.filter((m) => !m.isEngagedInCombat) as any[];
        if(game.rooms !== undefined) {
            targets.push(...game.rooms.activeRooms);
        }
        if (data.issuer instanceof Player === false) return false;
        const target = (await data.selectAndRecord(game, data.issuer, youMay ? 0 : 1, 1, targets, qq("pending.monsterOrRoomToDiscard"), data.serializedCardAndBox, true, true)).selected[0];
        if(!target)
            return false;
        if(target instanceof RoomCard) {
            game.cardHandler.discard(target);
            return true;
        }
        else if(target instanceof Monster) {
            const index = game.monsters.indexOf(target);
            if(index === -1) throw new GameError("Monster not found in game.", toSerializedTranslation("error.monsterNotFoundInGame"));

            if(!game.encounters.flushMonster(target, "discard"))
            {
                console.log("Failed to flush monster:", target.id);
                console.log("Current monsters in slots:", game.monsters.map(m => m ? m.card.name : null));
                console.log("Current monsters in slots:", game.encounters.cardsOnTop.map(m => m ? m.name : null));
                throw new GameError("Failed to flush monster.", toSerializedTranslation("error.failedToFlushMonster"));
            }
            return true;
        }
        else {
            throw new GameError("Invalid target for putRoomOrMonsterIntoDiscardEffect.", toSerializedTranslation("error.behaviorError", { error: "Invalid target for putRoomOrMonsterIntoDiscardEffect."}));
        }
    };
}

export function destroyAllSoulsEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        game.cardHandler.destroyCardsOrSouls(game.cardHandler.targetableSoulsOwned);
        return true;
    };
}

export function eachOtherPlayerMayGainCoinEffect(game: Game, coinOther: number, baseCoinIssuer: number, VariableCoinIssuer: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const issuer = data.issuer;
        const selections = await data.selectMultipleAndRecord(game, game.players.filter(p => p !== issuer).map(player => ({
            player,
            min: 0,
            max: 1,
            options: [data.it],
            reason: data.serializedCardAndBox,
            description: qq("pending.mayGainTreasure", { value: coinOther }),
            canUseOnBoardSelection: false,
        })));
        let issuerGains = baseCoinIssuer;
        for (const selection of selections) {
            if (selection.selected.length > 0) {
                const player = game.entityHandler.getPlayerById(selection.playerId);
                if(player)
                    {
                        game.gainCoins(player, coinOther, data.it);
                        issuerGains += VariableCoinIssuer;
                    }
                else
                    throw new GameError(`Player with id ${selection.playerId} not found.`, toSerializedTranslation("error.playerNotFound", { player: selection.playerId }));
            }
        }
        game.gainCoins(data.issuer, issuerGains, data.it);
        return true;
    }
}
export function destroyYourItemOnYourNextTurnEndEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offEndTurn : null | (() => void) = null;
        
        offEndTurn = game.emitter.on("on:turn:end", (eventData: OnTurnEndData) => {
            if (eventData.eventIssuer === data.issuer) {
                const effect: EffectFunction = async (data: EffectData) => {
                    if (data.issuer instanceof Player === false) return false;
                    const item = (await data.selectAndRecord(game, data.issuer as Player, 1, 1, data.issuer.inPlay.filter((card) => card.eternal === false), qq("pending.itemToDestroyAtEndOfTurn"), data.serializedCardAndBox, true, true)).selected[0]!;
                    const removed = game.cardHandler.destroyCardsOrSouls([item]);
                    if (offEndTurn) offEndTurn();
                    offEndTurn = null;
                    return removed;
                };
                addPassiveEffectToStack(game, effect, data, `Destroy an item at the next end of your turn effect.`);
                
            }
        });
        return true;
    };
}

export function chooseAnotherPlayerAndLootXEffect(game: Game, lootAmount: number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const targetPlayer = data.next;
        game.loot(data.issuer, lootAmount);
        game.loot(targetPlayer, lootAmount);
        return true;
    };
}

export function removeCountersFromThisEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        if ((data.it as ItemCard).counters.value("normal") as number >= amount) {
            game.cardHandler.addToCounter(data.issuer, data.it, "normal", -amount);
            return true;
        }
        return false;
    };
}

export type cardDestination =
    | "just_watch"
    | "bottom"
    | "discard";

export function lookAtTopCardOfDeckEffect(game: Game, canPutWhere: cardDestination, selectionOnResolve:false, reveal: boolean): SyncEffectFunction
export function lookAtTopCardOfDeckEffect(game: Game, canPutWhere: cardDestination, selectionOnResolve:boolean, reveal: boolean): AsyncEffectFunction
export function lookAtTopCardOfDeckEffect(game: Game, canPutWhere: cardDestination, selectionOnResolve:boolean = false, reveal: boolean = false): EffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const deck = selectionOnResolve 
            ? (await data.selectAndRecord(game, data.issuer, 1, 1, deckSelector(undefined, game)(data.issuer), qq("pending.deckToLookAtTopCardOf"), data.serializedCardAndBox, true, true)).selected[0]
            : data.next;
        if(!isDeckType(deck._type))
            throw new GameError(`Invalid deck type: ${deck._type}`, toSerializedTranslation("error.invalidDeckType", { deckType: deck._type }));
        if (!deck)
            throw new GameError(`Deck not found`, toSerializedTranslation("error.deckNotFound"));
        const topCard = deck.draw();
        game.cardHandler.addTopPosition(deck._type, topCard);
        // getFirstCardsOfDeck(deckName, 1)[0];
        const justWatch = canPutWhere === "just_watch";
        const description = 
            canPutWhere === "just_watch" ? qq("pending.lookAtTopCardOfDeck", {deck: deck.translatedType}) 
            : canPutWhere === "bottom" ? qq("pending.lookAtTopCardOfDeckAndPutOnBottom", {deck: deck.translatedType}) 
                : qq("pending.lookAtTopCardOfDeckAndDiscard", {deck: deck.translatedType});
        const selectionResult = reveal
         ? (await data.selectMultipleAndRecord(game, game.players.map(player => ({
                player,
                min: 0,
                max: (justWatch || player !== data.issuer) ? 0 : 1,
                options: [topCard!],
                    reason: data.serializedCardAndBox,
                description: description,
                canUseOnBoardSelection: true,
            })))).find(p => p.playerId === data.issuer.id)!
        : await data.selectAndRecord(game, data.issuer, 0, justWatch ? 0 : 1, [topCard!], description, data.serializedCardAndBox, false, false);
        if (selectionResult.selected[0] === topCard) {
        switch (canPutWhere) {
            case "just_watch":
                return true;
            case "bottom":
            {
                const topCard2 = deck.draw();
                if (topCard2 !== topCard)
                    throw new GameError("Top card mismatch", toSerializedTranslation("error.behaviorError", { error: "Top card mismatch"}));
                game.cardHandler.addBottomPosition(deck._type, topCard);
                break;
            }
            case "discard":
                {
                    const topCard2 = deck.draw();
                    if (topCard2 !== topCard)
                        throw new GameError("Top card mismatch", toSerializedTranslation("error.behaviorError", { error: "Top card mismatch"}));
                    game.cardHandler.discard(topCard);
                    break;
                }
            }
        };
        return true;
    }
}

export function rerollEachItemEffect(game: Game, target: "issuer" | "currentPlayer" | "next" | "eachPlayer" = "next"): SyncEffectFunction {
    return (data: EffectData) => {
        const players = target === "issuer" 
            ? [data.issuer] as Player[] 
            : target === "currentPlayer" 
                ? [game.currentPlayer] 
                : target === "eachPlayer" 
                    ? game.players 
                    : [data.next] as Player[];
        for (const player of players) {
            const inplayItems = player.inPlay.filter((card) => card instanceof ItemCard && !card.eternal) as ItemCard[];
            for (const card of inplayItems) {
                game.cardHandler.reroll(card);
            }
        }
        return true;
    };
}

export function trueEffect(): SyncEffectFunction {
    return (data: EffectData) => {
        return true;
    };
}

export function playForFreeTargetEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const card = data.next as LootCard;
        if (!card) return false;
        const previousLootPlay = data.issuer.remainingLootPlay;
        data.issuer.remainingLootPlay = 1;
        if(TargetBuilder.validTargetExists(game, data.issuer as Player, card, "tap") === true && game.actions.canPlayCard(data.issuer as Player, false) === true) {
            const index = data.issuer.hand.cards.indexOf(card);
            const targets = await TargetBuilder.buildTargetsOnResolve(game, data.issuer as Player, card, "tap");
            game.actions.playCard(data.issuer as Player, index, targets);
        }
        data.issuer.remainingLootPlay = previousLootPlay;
        return true;
    };
}

export function changeNumberInEffectTextEffect(game: Game, val: number, min: number, max: number): AsyncEffectFunction {
    return async (data: EffectData): Promise<boolean> => {
        let offEndTurn : null | (() => void) = null;
        let cleanTarget = (): void => {};
        const target = data.next as (ItemCard | LootCardEffect);
        if(!target || !(target instanceof ItemCard || target instanceof LootCardEffect))
            return false;
        const targetCard = target instanceof ItemCard ? target : target.card;
        const numberChoices = findEffectTextNumbers(targetCard.effectOutcomes)
            .filter(
                ({ value }) =>
                    findValidEffectTextNumberReplacements(
                        value,
                        val,
                        min,
                        max,
                    ).length > 0,
            )
            .map((occurrence) => new EffectTextNumber(targetCard, occurrence));
        if(numberChoices.length === 0)
            return false;
        const selectionResult = await data.selectAndRecord(
            game,
            data.issuer as Player,
            1,
            1,
            numberChoices,
            qq("pending.numberToChange"),
            data.serializedCardAndBox,
            true,
            true,
        );
        const selection = selectionResult.selected[0];
        if(!selection)
            return false;
        const selectionText = selection.textThroughNumber;
        const currentValue = selection.value;
        const possibilities = findValidEffectTextNumberReplacements(
            currentValue,
            val,
            min,
            max,
        );
        const newNumberResult = await data.selectAndRecord(
            game,
            data.issuer as Player,
            1,
            1,
            possibilities,
            qq("pending.newNumber"),
            data.serializedCardAndBox,
            true,
            true,
        );
        const newNumber = newNumberResult.selected[0];
        if(newNumber === undefined)
            return false;

        const newOutcomes = replaceEffectTextNumber(
            targetCard.effectOutcomes,
            selection.occurrenceIndex,
            newNumber,
        );
        const oldOutcomes = targetCard.effectOutcomes;
        targetCard.effectOutcomes = newOutcomes;
        if(targetCard.tags.lastCopiedRestoreOriginalStateIndex !== undefined) {
            for(let i=targetCard.tags.lastCopiedRestoreOriginalStateIndex + 1; i<targetCard.cleaners.length; i++) {
                targetCard.cleaners[i]!();
            }
             targetCard.cleaners.splice(targetCard.tags.lastCopiedRestoreOriginalStateIndex + 1);
        }else
            targetCard.cleanup();
        try {
            const {originalState, restore} = targetCard.becomesCopyOf(targetCard, (card)=>game.cardHandler.attachEffectsToCard(card));
            cleanTarget = (): void => {
                originalState.effectOutcomes = oldOutcomes;
                restore();
                const owner = game.getOwner(targetCard);
                if(owner !== null)
                    targetCard.onAddInPlay(() => owner);
            };
            // game.cardHandler.attachEffectsToCard(targetCard);
        } catch (e) {
            game.toast(
                {
                type: "warning",
                title: toSerializedTranslation("toast.notImplemented.title"),
                message: toSerializedTranslation("toast.notImplemented.message"),
                players: [data.issuer.id],
                });
            game.gainCoins(data.issuer as Player, 15, data.it);
            cleanTarget();
            return true;
        }
        targetCard.onAddInPlay(() => targetCard.owner);
        if(target instanceof LootCardEffect)
        {   
            const lastSelectionLine = selectionText.split("\n").at(-1)!.toLowerCase();
            const formattedNumber = formatEffectTextNumber(newNumber, selection.format);
            const updatedSelectionLine = lastSelectionLine.slice(
                0,
                -selection.sourceText.length,
            ) + formattedNumber;
            // Replace target string with updated text when necessary.
            const newTargets = target.targets.map((targetValue) =>
                typeof targetValue === "string"
                && targetValue.startsWith(lastSelectionLine)
                    ? targetValue.replace(lastSelectionLine, updatedSelectionLine)
                    : targetValue,
            );
            game.addToStack(new LootCardEffect(target.issuer, target.card, newTargets));
            const oldIndex = game.stack._stack.findIndex((e) => e === target);
            game.stack._stack.at(-1)!.stackId = target.stackId;
            game.stack._stack[oldIndex] = game.stack._stack.at(-1)!;
            game.stack._stack.pop();
        }
        offEndTurn = game.emitter.on("on:turn:end", () => {
            cleanTarget()
        });
        
        return true;
    };
}

export function eachPlayersVoteToDestroyItemEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const ListOfItems = visibleItemSelector((card, issuer) => card.eternal === false, false, game)(data.issuer, data.it);

        // Request votes from all players in parallel
        const voteRequests = game.players.map(player => ({
            player,
            min: 1,
            max: 1,
            options: ListOfItems,
            reason: data.serializedCardAndBox,
            description: qq("pending.voteItemToDestroy"),
            canUseOnBoardSelection: true,
        }));
        const voteResults = await data.selectMultipleAndRecord(game, voteRequests);

        // Count the votes
        const votes: Record<number, number> = {};
        for (const result of voteResults) {
            const vote = result.selected[0]!.globalId;
            votes[vote] = (votes[vote] || 0) + 1;
        }

        // Find the item with most votes
        let itemToDestroy: ItemCard | null = null;
        let votesToDestroy = 0;
        for (const [itemGlobalId, voteCount] of Object.entries(votes)) {
            if(voteCount === votesToDestroy) itemToDestroy = null;
            if (voteCount > votesToDestroy) {
                votesToDestroy = voteCount;
                itemToDestroy = ListOfItems.find((item) => item.globalId === Number(itemGlobalId))!;
            }
        }
        if (itemToDestroy !== null && itemToDestroy !== undefined) {
            game.cardHandler.destroyCardsOrSouls([itemToDestroy]);
        }
        return true;
    };
}


export function stealRandomLootCardEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const targetPlayer = data.next as Player;
        if (targetPlayer.hand.length > 0) {
            const randomIndex = Math.floor(game.random() * targetPlayer.hand.length);
            const cardToSteal = targetPlayer.hand.cards[randomIndex]!;
            game.cardHandler.stealLootCard(data.issuer, targetPlayer, cardToSteal as LootCard);
        }
        return true;
    };
}

export function stealAPlayerRandomLootCardEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const targetPlayer = (await data.selectAndRecord(game, data.issuer, 1, 1, game.players.filter((p) => p !== data.issuer), qq("pending.playerToStealRandomLootCardFrom"), data.serializedCardAndBox, true, true)).selected[0] as Player;
        if (targetPlayer.hand.length > 0) {
            const randomIndex = Math.floor(game.random() * targetPlayer.hand.length);
            const cardToSteal = targetPlayer.hand.cards[randomIndex]!;
            game.cardHandler.stealLootCard(data.issuer, targetPlayer, cardToSteal as LootCard);
        }
        return true;
    };
}

export function deactivateItemEffect(game: Game, selectionOnResolve: boolean = false, youMayEffectHanging: boolean[] = [false]): AsyncEffectFunction {
    const minLength = (youMayEffectHanging[0] ? 0 : 1);
    youMayEffectHanging[0] = false;
    return async (data: EffectData) => {
        if(data.issuer instanceof Player === false) 
            throw new GameError("Effect issuer is not a player.", toSerializedTranslation("error.effectIssuerMustBePlayer"));
        const target = selectionOnResolve 
            ? (await data.selectAndRecord(game, data.issuer as Player, minLength, 1, inplayChargeableItemSelector(game)(data.issuer), qq("pending.itemToDeactivate"), data.serializedCardAndBox, true, true)).selected[0] as ItemCard
            : data.next as ItemCard;
        if(target === undefined)
            return false;
        target.charged = false;
        game.cardHandler.deactivateItem(target);
        return true;
    };
}

export function destroyThisEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        return game.cardHandler.destroyCardsOrSouls([data.it]);
    };
}

export function giveLootCardToAnotherPlayerEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const card = (await data.selectAndRecord(game, data.issuer, 1, 1, data.issuer.hand.cards, qq("pending.lootCardToGive"), data.serializedCardAndBox, true, false)).selected[0] as LootCard;
        if (!card) return false;
        const targetPlayer = (await data.selectAndRecord(game, data.issuer, 1, 1, game.players.filter((p) => p !== data.issuer), qq("pending.playerToGiveLootCardTo"), data.serializedCardAndBox, true, true)).selected[0] as Player;
        if (!targetPlayer) return false;
        game.cardHandler.giveCard(data.issuer, targetPlayer, card);
        return true;
    };
}

export function discardNLootCardsEffect(n: number, game: Game, selectionOnResolve: boolean = false, issuerType: "issuer" | "next" | "current" = "issuer"
): AsyncEffectFunction {
    return async (data: EffectData) => {
        const subject = issuerType === "next" ? data.next as Player : issuerType === "current" ? game.currentPlayer : data.issuer as Player;
        if (subject instanceof Player === false) return false;
        let toDiscard: LootCard[] = [];
        if(issuerType === "next" && !selectionOnResolve)
            throw new GameError("Invalid parameters for discardNLootCardsEffect.", toSerializedTranslation("error.behaviorError", { error: "Invalid parameters for discardNLootCardsEffect."}));
        if (selectionOnResolve || !toDiscard) 
            toDiscard = (await data.selectAndRecord(game, subject, n, n, subject.hand.cards, 
                n > 1 ?
                qq("pending.oneLootToDiscard") :
                qq("pending.manyLootToDiscard", { lootToDiscard: n }), data.serializedCardAndBox, true, true)).selected as LootCard[];
        else 
            for (let i = 0; i < n; i++) {
                toDiscard.push(data.next as LootCard);
            }
        // Get indices and sort them in descending order to avoid index shifting
        const indices = toDiscard.map(card => subject.hand.cards.indexOf(card)).sort((a, b) => b - a);
        let success = true;
        for (const index of indices) {
            if (index >= 0) {
                success = success && game.cardHandler.discardFromHandAtIndex(subject, index, "effect");
            }
        }
        return success;
    };
}

export function destroyOneOfYourSoulEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const soulToDestroy = (await data.selectAndRecord(game, data.issuer, 1, 1, data.issuer.targetableSouls, qq("pending.soulToDestroy"), data.serializedCardAndBox, true, true)).selected[0]!;
        return game.cardHandler.destroyCardsOrSouls([soulToDestroy]);
    };
}

export function eachPlayerDestroysASoulEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        const playersWithSouls = game.players.filter(player => player.targetableSouls.filter(soul => soul.eternal === false).length > 0);
        const choices = playersWithSouls.map(player => ({
            player,
            min: 1,
            max: 1,
            options: player.targetableSouls.filter(soul => soul.eternal === false),
            reason: data.serializedCardAndBox,
            description: qq("pending.soulToDestroy"),
            canUseOnBoardSelection: true,
        }));
        const playersChoices:{ playerId: string; selected: Card[]; remaining: Card[] }[] = await data.selectMultipleAndRecord(game, choices);
        for (const playerChoice of playersChoices) {
            game.cardHandler.destroyCardsOrSouls(playerChoice.selected);
        }
        return true;
    };
}

export function giveSoulEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const targetPlayer = data.next as Player;
        if(!targetPlayer)
            throw new GameError("No target player to give soul to", toSerializedTranslation("error.noTargetPlayerToGiveSoulTo"));
        if(data.issuer.targetableSouls.length === 0)
            return false;
        const soulToGive = (await data.selectAndRecord(game, data.issuer, 1, 1, data.issuer.targetableSouls, qq("pending.soulToGive"), data.serializedCardAndBox, true, true)).selected[0]!;
        game.cardHandler.give(data.issuer, targetPlayer, soulToGive);
        return true;
    };
}

export function lookAtPlayerHandAndSwapEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const otherPlayer = data.next as Player;
        if(!otherPlayer)
            throw new GameError("No target player to look at and swap with", toSerializedTranslation("error.noTargetPlayerToLookAtAndSwap"));
        // (await data.selectAndRecord(game, data.issuer, 1, 1, game.players.filter((p) => p !== data.issuer), "Select a player to look at their hand, and swap a loot card.", true, true)).selected[0] as Player;
        const canSwap = otherPlayer.hand.length > 0 && data.issuer.hand.length > 0;
        const selection = await data.selectAndRecord(game, data.issuer, 0, canSwap ? 1 : 0, otherPlayer.hand.cards, qq("pending.lootCardToSwap"), data.serializedCardAndBox, true, false);
        if (selection.selected.length === 0)
            return true;
        const toGive = (await data.selectAndRecord(game, data.issuer, 1, 1, data.issuer.hand.cards, qq("pending.lootToGive", {player: otherPlayer.id}), data.serializedCardAndBox, true, false)).selected[0] as LootCard;
        if (game.cardHandler.give(data.issuer, otherPlayer, toGive))
            game.cardHandler.give(otherPlayer, data.issuer, selection.selected[0] as LootCard);
        return true;
    };
}

export function lookAtHandAndStealLootEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        let otherPlayer = data.next;
        if(otherPlayer instanceof DiceRoll)
            otherPlayer = otherPlayer.issuer;
        if(!(otherPlayer instanceof Player))
            throw new GameError("Invalid target player", toSerializedTranslation("error.invalidTargetPlayer"));
        const canSteal = otherPlayer.hand.length > 0;
        const selection = await data.selectAndRecord(game, data.issuer, 0, canSteal ? 1 : 0, otherPlayer.hand.cards, qq("pending.lootCardToSteal"), data.serializedCardAndBox, true, false);
        if (selection.selected.length === 0)
            return true;
        game.cardHandler.give(otherPlayer, data.issuer, selection.selected[0] as LootCard);
        return true;
    };
}

export function endTurnAndResetStackEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        game.resetStack();
        game.resetCallbacks();
        game.currentPlayer.clearAttackRequirement();
        game.actions.cancelPurchase(game.currentPlayer, true);
        game.entityHandler.endCombat();
        await game.endTurn();
        return true;
    };
}

export function putTopCardOfEachDeckIntoDiscardEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        for (const deckName of game.deckNames) {
            if(!isDeckType(deckName))
                throw new GameError(`Invalid deck type: ${deckName}`, toSerializedTranslation("error.invalidDeckType", { deckType: deckName }));
            const topCard = game.cardHandler.getFirstCardsOfDeck(deckName, 1)[0]!;
            game.cardHandler.discard(topCard);
        }
        return true;
    };
}

export function doubleCardsInHandEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        game.loot(data.issuer, data.issuer.hand.length, "other");
        return true;
    };
}

export function doubleTargetCoins(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const target = data.next;
        if(target instanceof Player === false) return false;
        game.gainCoins(target, target.coins, data.it);
        return true;
    };
}

export function becomesCopyOfEternalItemLosesEternalEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const target = data.next as ItemCard;
        if(!target || !(target instanceof ItemCard))
            throw new GameError("Invalid target for becomesCopyOfEternalItemLosesEternalEffect.", toSerializedTranslation("error.behaviorError", { error: "Invalid target for becomesCopyOfEternalItemLosesEternalEffect."}));
        if(!game.getOwner(data.it))
            return false;
        data.it.becomesCopyOf(target, (card) => {
            game.cardHandler.attachEffectsToCard(card);
        });
        if(!data.it || !(data.it instanceof ItemCard))
            throw new GameError("Invalid source item for becomesCopyOfEternalItemLosesEternalEffect.", toSerializedTranslation("error.behaviorError", { error: "Invalid source item for becomesCopyOfEternalItemLosesEternalEffect."}));
        data.it.setEternal(false);
        return true;
    };
}

export function passHandsLeftEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let tempHand = game.players[0]!.hand;
        for (let i = 0; i < game.players.length; i++) {
            const nextPlayer = game.players[(i + 1) % game.players.length]!;
            tempHand = game.cardHandler.setHand(nextPlayer, tempHand);
        }
        return true;
    };
}

export function rerollDiceEffect(): SyncEffectFunction {
    return (data: EffectData) => {
        const chosenDiceRoll: DiceRoll = data.next as DiceRoll;
        chosenDiceRoll.roll();
        return true;
    };
}


export function youMayRechargeThisEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const selectionResult = await data.selectAndRecord(game, data.issuer, 0, 1, [data.it], qq("pending.rechargeThisOrNot"), data.serializedCardAndBox, true, true, false);
        if (selectionResult.selected.length > 0) {
            game.cardHandler.recharge(data.it as ItemCard, data.it);
        }
        return true;
    };
}

export function youMayRechargeAnItemEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const selectionResult = await data.selectAndRecord(game, data.issuer, 0, 1, inplayChargeableItemSelector(game)(data.issuer), qq("pending.rechargeAnItemOrNot"), data.serializedCardAndBox, true, true);
        if (selectionResult.selected.length > 0) {
            game.cardHandler.recharge(selectionResult.selected[0] as ItemCard, data.it);
        }
        return true;
    };
}

export function getAttackRollEffect(dice: DiceRoll, game: Game): SyncEffectFunction[] {
    if(dice.attackData === null || dice.attackData === undefined)
        throw new GameError("No attack data for attack roll", toSerializedTranslation("error.behaviorError", { error: "No attack data for attack roll"}));
    const { damageDealtAdditional, damageDealtMultiplier, damageReceivedAdditional, damageReceivedMultiplier, evasion } = dice.attackData;
    const effects: SyncEffectFunction[] = [];
    for (let i = 0; i < 6; i++) {
        effects.push((data: EffectData) => {
            const diceRoll = data.next; // First target is the DiceRoll itself
            const target = data.next as Entity; // Second target is the monster
            if(data.issuer.isDead || target.isDead) return false;
            if (i + 1 >= evasion) {
                game.entityHandler.dealCombatDamage(data.issuer, target, diceRoll, damageDealtMultiplier * (damageDealtAdditional + game.entityHandler.getAttack(data.issuer)));
            } else {
                game.entityHandler.dealCombatDamage(target, data.issuer, diceRoll, damageReceivedMultiplier * (damageReceivedAdditional + game.entityHandler.getAttack(target)));
                game.emit("on:attack:roll:failed", { eventIssuer: data.issuer, diceRoll });
            }
            return true;
        });
    }
    return effects;
}

export function targetGetCoinRollEffect(game: Game): SyncEffectFunction[] {
    const effects: SyncEffectFunction[] = [];
    for (let i = 0; i < 6; i++) {
        effects.push((data: EffectData) => {
            const target = data.next as Player;
            if(!target) throw new GameError("No target for targetGetCoinRollEffect", toSerializedTranslation("error.behaviorError", { error: "No target for targetGetCoinRollEffect"}));
            game.gainCoins(target, i + 1, data.it);
            return true;
        });
    }
    return effects;
}

export function cancelAttackAndAttackAgain(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const p = data.next;
        if(p === undefined || p instanceof Player === false || !p.isEngagedInCombat)
            return false;
        game.entityHandler.endCombat();
        game.entityHandler.addAttackThisTurn(p, 1, data.it);
        return true;
    };
}

export function rollGainCoinsEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const effects: SyncEffectFunction[] = [];
        for (let i = 0; i < 6; i++) {
            effects.push((data: EffectData) => {
                if(data.issuer instanceof Player === false) throw new GameError("Issuer must be a player for rollGainCoinsEffect", toSerializedTranslation("error.behaviorError", { error: "Issuer must be a player for rollGainCoinsEffect"}));
                game.gainCoins(data.issuer, i + 1, data.it);
                return true;
            });
        }
        const dice = game.rollDice(data.issuer as Player, data.it);
        dice.attachEffect(effects, data.it, [], data.issuer);
        return true;
    };
}

export function targetGetLootRollEffect(game: Game): SyncEffectFunction[] {
    const effects: SyncEffectFunction[] = [];
    for (let i = 0; i < 6; i++) {
        effects.push((data: EffectData) => {
            const target = data.next as Player;
            if(!target) throw new GameError("No target for targetGetCoinRollEffect", toSerializedTranslation("error.behaviorError", { error: "No target for targetGetCoinRollEffect"}));
            game.loot(target, i + 1);
            return true;
        });
    }
    return effects;
}

export function targetGetTreasureRollEffect(game: Game): SyncEffectFunction[] {
    const effects: SyncEffectFunction[] = [];
    for (let i = 0; i < 6; i++) {
        effects.push((data: EffectData) => {
            const target = data.next as Player;
            if(!target) throw new GameError("No target for targetGetCoinRollEffect", toSerializedTranslation("error.behaviorError", { error: "No target for targetGetCoinRollEffect"}));
            game.gainTreasure(target, i + 1);
            return true;
        });
    }
    return effects;
}


export function loot1PutCardOnTopEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        game.loot(data.issuer, 1);
        const cardToPutBack = (await data.selectAndRecord(game, data.issuer, 1, 1, data.issuer.hand.cards, qq("pending.cardToPutOnTop"), data.serializedCardAndBox, true, false)).selected[0] as LootCard;
        const card = game.cardHandler.getCardFromHand(data.issuer, cardToPutBack);
        game.decks["loot"]!.addTopPosition(card);
        return true;
    };
}

export function healEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        // if (data.issuer instanceof Player === false) return false;
        game.entityHandler.heal(data.issuer, amount);
        return true;
    };
}

export function EndOfTurnKillAllPlayer(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        offTurnStart = game.emitter.on("on:turn:end", (eventData) => {
            for(const player of game.players)
                if(!player.isDead)
                    game.entityHandler.kill(data.issuer, player, data.cardAndBox);
            offTurnStart?.();
            offTurnStart = null;
            return true;
        });
        return true;
    };
}

export function eachPlayerLosesCoinsEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        for (const player of game.players) {
                game.loseCoins(player, amount, true, "effect");
        }
        return true;
    };
}

export function rerollItemEffect(game: Game, selectors: TargetsSelector[] = [], selectionOnResolve: boolean = false, anyNumber: boolean = false): AsyncEffectFunction {
    return async (data: EffectData) => {
        let cards = [data.next];
        if(selectionOnResolve === true)
        {
            if(data.issuer instanceof Player === false) 
                throw new GameError("Issuer must be a player for selection on resolve reroll effect", toSerializedTranslation("error.behaviorError", { error: "Issuer must be a player for selection on resolve reroll effect"}));
            const options = selectors[0]!.selector(data.issuer, data.it);
            cards = (await data.selectAndRecord(game, data.issuer, anyNumber ? 0 : 1, anyNumber ? options.length : 1, options, 
                anyNumber ?
                qq("pending.anyNumberItemsToReroll") :
                qq("pending.itemToReroll"), data.serializedCardAndBox, true, true)).selected;
        }

        for (const card of cards) {
            if(card !== undefined && game.visibleItems.includes(card as ItemCard))
                game.cardHandler.reroll(card);
            else
                return false;
        }
        return true;
    };
}

export function healEachMonsterEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        for (const monster of game.monsters) {
            if(monster)
                game.entityHandler.heal(monster, amount);
        }
        return true;
    };
}

export function rerollItemTheyControlEffect(game: Game, youMayEffectHanging: boolean[]): AsyncEffectFunction {
    const includeZero = youMayEffectHanging[0]!;
    youMayEffectHanging[0] = false;
    return async (data: EffectData) => {
        let targetPlayer = data.next;
        if(targetPlayer instanceof DiceRoll)
            targetPlayer = targetPlayer.issuer;
        if(!(targetPlayer instanceof Player))
            throw new GameError("Invalid target player for rerollItemTheyControlEffect", toSerializedTranslation("error.behaviorError", { error: "Invalid target player for rerollItemTheyControlEffect"}));
        if(!(data.issuer instanceof Player))
            throw new GameError("Issuer must be a player for rerollItemTheyControlEffect", toSerializedTranslation("error.behaviorError", { error: "Issuer must be a player for rerollItemTheyControlEffect"}));
        const selectionResult = await data.selectAndRecord(game, data.issuer, (includeZero ? 0 : 1), 1, targetPlayer.inPlay.filter(c => c.eternal === false), 
            includeZero ?
            qq("pending.canItemToReroll") :
            qq("pending.itemToReroll")
        , data.serializedCardAndBox, true, true);
        if(selectionResult.selected.length === 0)
            return false;
        const card = selectionResult.selected[0]!;
        if(card !== undefined)
            game.cardHandler.reroll(card);
        return true;
    };
}

export function flushShopEffect(game: Game, where: "bottom" | "discard" = "bottom"): SyncEffectFunction {
    return (data: EffectData) => {
        switch(where) {
            case "bottom":
                game.shop.flushToBottom();
                break;
            case "discard":
                game.shop.flush();
                break;
        }
        return true;
    };
}

export function playerGivesLootCardEffect(game: Game, reveal: boolean = false, addCardToTarget: boolean = false): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const targetPlayer = data.next as Player;
        if (targetPlayer.hand.length > 0) {
            const cardToSteal = (await data.selectAndRecord(game, targetPlayer, 1, 1, targetPlayer.hand.cards, qq("pending.lootCardToGive"), data.serializedCardAndBox, true, reveal)).selected[0] as LootCard;
            game.cardHandler.stealLootCard(data.issuer, targetPlayer, cardToSteal);
            if(addCardToTarget)
                data.addTarget(cardToSteal);
        }
        return true;
    };
}

export function revealTopCardsOfMonsterDeckEffect(
    game: Game,
    n: number
): AsyncEffectFunction {
    return async (data: EffectData) => {
        if(!(data.issuer instanceof Player))
            throw new GameError("revealTopCardsOfMonsterDeckEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", { error: "revealTopCardsOfMonsterDeckEffect can only be applied to Players."}));
        const monsterCards = game.decks.monster.drawSeveral(n);
        data.recordSelection(monsterCards);
        const curses = monsterCards.filter(c => c.isCurse);
        const revealPromises = data.selectMultipleAndRecord(game, game.players.filter(p => p !== data.issuer).map(p => ({
            player: p,
            min: 0,
            max: 0,
            options: monsterCards,
            reason: data.serializedCardAndBox,
            description: qq("pending.topMonsterDeckRevealed", {value: n}),
            canUseOnBoardSelection: false,
        })));

        for (const curse of curses) {
            const target = (await data.selectAndRecord(game, data.issuer, 1, 1, game.players, qq("pending.playerToGiveCurse", { card: curse.nameKey }), data.serializedCardAndBox, true, true)).selected[0] as Player;
            await game.cardHandler.addCurse(target, curse);
        }
        const nonCurseCards = monsterCards.filter(c => !c.isCurse);
        if(nonCurseCards.length === 0) return true;
        const target = (await data.selectAndRecord(game, data.issuer, nonCurseCards.length, nonCurseCards.length, nonCurseCards, qq("pending.orderRestBottom"), data.serializedCardAndBox, false , false)).selected as MonsterCard[];
        for (let i = 0; i < target.length; i++) {
            game.cardHandler.addBottomPosition("monster", target[i]!);
        }
        await revealPromises;
        return true;
    };
}

export function putMonsterFromDiscardOnTopEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        if(game.decks["monster"]!.discard.filter((card) => card.isEvent === false).length === 0) return false;
        const monsterToPutBack = (await data.selectAndRecord(game, data.issuer, 1, 1, game.decks["monster"]!.discard.filter((card) => card.isEvent === false), qq("pending.monsterToPutOnTopOfMonsterDeck"), data.serializedCardAndBox, true, true)).selected[0] as MonsterCard;
        game.decks["monster"]!.remove(monsterToPutBack);
        game.decks["monster"]!.addTopPosition(monsterToPutBack);
        return true;
    };
}
export function putTopCardFromDiscardOnTopEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const cardToDraw = data.next as Card;
        if(!cardToDraw)
            throw new GameError("No card to draw for putTopCardFromDiscardOnTopEffect", toSerializedTranslation("error.behaviorError", { error: "No card to draw for putTopCardFromDiscardOnTopEffect"}));
        if(!cardToDraw.type)
            throw new GameError("Invalid card type for putTopCardFromDiscardOnTopEffect", toSerializedTranslation("error.behaviorError", { error: "Invalid card type for putTopCardFromDiscardOnTopEffect"}));
        const deckName = cardToDraw.type;
        if(!isDeckType(deckName)) 
            throw new GameError(`Invalid deck type: ${deckName}`, toSerializedTranslation("error.invalidDeckType", { deckType: deckName }));
        const deck = game.decks[deckName];
        if (!deck) {
            throw new GameError(`Deck ${deckName} does not exist.`, toSerializedTranslation("error.behaviorError", { error: `Deck ${deckName} does not exist.`}));
        }
        if (deck.discard.length === 0) {
            return false;
        }
        const card = deck.drawTopDiscard();
        if(card === null)
            return false;
        game.cardHandler.addTopPosition(deckName, card);
        return true;
    };
}

export function rechargeThisEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        game.cardHandler.recharge(data.it as ItemCard, data.it);
        return true;
    };
}
export function forceAttackMonsterDeckEffect(game: Game, times: number, type: "total" | "additional"): SyncEffectFunction {
    return (data: EffectData) => {
        // if(data.issuer instanceof Player === false) return false;
        const player = game.currentPlayer
        const additionalTimes = type === "additional" ? times : times - player.attackedIdsThisTurn.filter((id) => id === "topDeck").length;
        for (let i = 0; i < additionalTimes; i++) {
            game.entityHandler.playerMustAttack(player as Player, "topDeck", data.it, false);
        }
        return true;
    };
}

export function cancelAtIndexEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        game.cancelAt(data.next as number);
        return true;
    };
}

// deal 1 damage to each other player.
export function dealDamageToEachOtherPlayerEffect(game: Game, dmg: number): SyncEffectFunction {
    return (data: EffectData) => {
        for (const player of game.players) {
            if (player !== data.issuer) {
                game.entityHandler.dealDamage(data.issuer, player, data.cardAndBox, dmg);
            }
        }
        return true;
    };
}

export function dealDamageToAPlayerEffect(game: Game, dmg: number, canTargetSelf: boolean=false, issuerIsCurrentPlayer: boolean=false): AsyncEffectFunction {
    return async (data: EffectData) => {
        const issuer = issuerIsCurrentPlayer ? game.currentPlayer : data.issuer;
        if (issuer instanceof Player === false) return false;
        const target = (await data.selectAndRecord(game, issuer, 1, 1, game.players.filter((p) => (canTargetSelf ? true : p !== issuer)), qq("pending.anotherPlayerToDealDamageTo"), data.serializedCardAndBox, true, true)).selected[0] as Player;
        game.entityHandler.dealDamage(issuer, target, data.cardAndBox, dmg);
        return true;
    };
}

export function addInPlayEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        // console.log("adding in play loot card from effect:", data.it.name);
        // game.cardHandler.addInPlay(data.issuer, data.it);
        return true;
    };
}

export function throwEffect(game: Game, s: string): AsyncEffectFunction {
    return (data: EffectData) => {
        throw new GameError(`Function not parsed correctly: ${s}`, toSerializedTranslation("error.parsingError", { error: `Function not parsed correctly: ${s}`}));
    };
}

export function putAnyNumberFromDiscardOnTopEffect(deckName: DeckType, game: Game, condition: (card: Card) => boolean): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const deck: Deck<Card> = game.decks[deckName];
        if (!deck) {
            throw new GameError(`Deck ${deckName} does not exist.`, toSerializedTranslation("error.behaviorError", { error: `Deck ${deckName} does not exist.`}));
        }
        const maxToPutBack = deck.discard.length;
        const selectionResult = await data.selectAndRecord(game, data.issuer, 0, maxToPutBack, deck.discard.filter(condition), qq("pending.cardsToPutBackOnTopOfDeck"), data.serializedCardAndBox, false, false);
        for (let i = 0; i < selectionResult.selected.length; i++) {
            const card = selectionResult.selected[i]!;
            assertCardMatchesDeck(deckName, card);
            deck.remove(card);
            deck.addTopPosition(card);
        }
        return true;
    };
}

export function lootCardsEffect(game: Game, nbCards: number, issuerType: "issuer" | "current" = "issuer"): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const issuer = issuerType === "issuer" ? data.issuer : game.currentPlayer;
        game.loot(issuer, nbCards);
        return true;
    };
}

export function combineEffectFunctions(effects: EffectFunction[]): AsyncEffectFunction {
    return async (data: EffectData) => {
        let result = true;
        for (const effect of effects) {
            result = result && await effect(data);
        }
        return result;
    };
}

export function combineSyncEffectFunctions(effects: SyncEffectFunction[]): SyncEffectFunction {
    return (data: EffectData) => {
        let result = true;
        for (const effect of effects) {
            result = result && effect(data);
        }
        return result;
    };
}

export function rechargeCharaEffect(game: Game, youMayEffectHanging: [false]): SyncEffectFunction
export function rechargeCharaEffect(game: Game, youMayEffectHanging: boolean[]): SyncEffectFunction
export function rechargeCharaEffect(game: Game, youMayEffectHanging: boolean[]): EffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if (data.issuer.character.charged === false) {
            const shouldRecharge = !youMayEffectHanging[0] ||
                (await data.selectAndRecord(game, data.issuer, 0, 1, [data.issuer.character], qq("pending.canRechargeChara"), data.serializedCardAndBox, true, true, false)).selected.length > 0
                
            if (shouldRecharge)
                game.cardHandler.recharge(data.issuer.character, data.it);
        }
        youMayEffectHanging[0] = false;
        return true;
    };
}

export function removeCounterAndDamageIfAboveX(game: Game, toRemove: number, damage: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if(data.it.counters.value("normal") >= toRemove) {
            game.cardHandler.addToCounter(data.issuer, data.it, "normal", -data.it.counters.value("normal"));
            const damageTarget = (await data.selectAndRecord(game, data.issuer, 1, 1, game.playersAndMonsters, qq("pending.playerToDealDamageTo"), data.serializedCardAndBox, true, true)).selected[0] as Player;
            game.entityHandler.dealDamage(data.issuer, damageTarget, data.cardAndBox, damage);
        }
        return true;
    }
}

export function doubleCoinTarget(game:Game): SyncEffectFunction {
    return (data: EffectData) => {
        const target = data.next;
        if(target instanceof Player === false) return false;
        game.gainCoins(target, target.coins, data.it);
        return true;
    }
}

export function loseAllCoinTarget(game:Game): SyncEffectFunction {
    return (data: EffectData) => {
        const target = data.next;
        if(target instanceof Player === false) return false;
        game.loseCoins(target, target.coins, true, "effect");
        return true;
    }
}

export function rechargeUpToXItems(game: Game, x: number, type: "youControl" | "any", youMayEffectHanging: boolean[]): AsyncEffectFunction {
    youMayEffectHanging[0]! = false;
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const possible = type === "youControl" ? data.issuer.inPlay : game.players.flatMap(p => p.inPlay);
        const itemsToRecharge = (await data.selectAndRecord(game, data.issuer, 0, x,possible, qq("selector.rechargeableItems"), data.serializedCardAndBox, false, true, true)).selected;
        for(let i = 0; i < x; i++) {
            const next = data.next;
            if(!next || !(next instanceof ItemCard) || !game.visibleItems.includes(next) || next === data.it)
                break;
            itemsToRecharge.push(next as ItemCard);
        }
        for (const item of itemsToRecharge) {
            game.cardHandler.recharge(item, data.it);
        }
        return true;
    };
}

export function rechargeUpToXOtherItemsEffect(game: Game, x: number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;

        const itemsToRecharge = [];
        for(let i = 0; i < x; i++) {
            const next = data.next;
            if(!next || !(next instanceof ItemCard) || !game.visibleItems.includes(next) || next === data.it)
                break;
            itemsToRecharge.push(next as ItemCard);
        }
        for (const item of itemsToRecharge) {
            game.cardHandler.recharge(item, data.it);
        }
        return true;
    };
}

export function obtainRollResults(s: string): string[] {
    s = s.split("roll-")[1]!.trim();
    const lines: string[] = s.split("\n");
    const results: string[] = new Array<string>(6).fill("");
    for (let line of lines) {
        line = line.trim();
        if (line.length > 0) {
            switch (line[1]) {
                case '-':
                    const minVal = Math.min(Number(line[0]), Number(line[2]));
                    const maxVal = Math.max(Number(line[0]), Number(line[2]));

                    for (let i = minVal; i <= maxVal; i++) {
                        results[i - 1] = results[i - 1] === "" ? line.substring(4).trim() : results[i - 1] + ", then " + line.substring(4).trim();
                    }
                    break;
                default:
                    results[Number(line[0]) - 1] = results[Number(line[0]) - 1] === "" ? line.substring(3).trim() : results[Number(line[0]) - 1] + ", then " + line.substring(3).trim();
                    break;
            }
        }
    }
    for(let i = 0; i < results.length; i++){
        if(results[i] === "do all of the above.")
        {
            results[i] = results.slice(0, i).filter((r, idx) => idx === results.indexOf(r)).join(", then ");
        }
    }
    return results;
}

export function putOnTopOfMonsterDeckOnRollEffect(game: Game, rolls: number[]): SyncEffectFunction {
    return (data: EffectData) => {
        if(!(data.it instanceof MonsterCard))
            throw new GameError("putOnTopOfMonsterDeckOnRollEffect can only be applied to monster cards.", toSerializedTranslation("error.behaviorError", { error: "putOnTopOfMonsterDeckOnRollEffect can only be applied to monster cards."}));
        data.it.afterEffect = "nothing"; // Card placement is handled by the game by default
        
        const roll = game.rollDice(game.currentPlayer as Player, data.it);
        roll.attachEffect([1,2,3,4,5,6].map(n => (data:EffectData): boolean => {
            if(!(data.it instanceof MonsterCard))
                throw new GameError("putOnTopOfMonsterDeckOnRollEffect can only be applied to monster cards.", toSerializedTranslation("error.behaviorError", { error: "putOnTopOfMonsterDeckOnRollEffect can only be applied to monster cards."}));
            game.encounters.removeFromSlot(data.it);
            if(rolls.includes(n)) {
                // data.it.afterEffect = "handled"; // Card placement is handled by this effect
                if(game.decks.monster.discard.includes(data.it)) {
                    game.encounters.obtainCardFromDiscard(data.it.slug, data.it.globalId);
                }
                game.decks.monster.addTopPosition(data.it);
                return true;
            }else
            {
                if(!data.it.entity || !(data.it.entity instanceof Monster))
                    throw new GameError("putOnTopOfMonsterDeckOnRollEffect can only be applied to monster cards that are in play.", toSerializedTranslation("error.behaviorError", { error: "putOnTopOfMonsterDeckOnRollEffect can only be applied to monster cards that are in play."}));
                data.it.afterEffect = "discard";
            }
            return false;
        }), data.it, []);
        return true;
    };
}


export function rollAndGainXTimesResultEffect(game: Game, mult: number): SyncParsedEffect {
    return {
        effectFunction: (data: EffectData): boolean => {
            if (data.issuer instanceof Player === false) return false;
            const roll = game.rollDice(data.issuer, data.it);
            roll.attachEffect([1,2,3,4,5,6].map((value) => (data: EffectData): boolean => {
                if (data.issuer instanceof Player === false) return false;
                game.gainCoins(data.issuer, value * mult, data.it);
                return true;
            }), data.it, data.targets, data.issuer);
            return true;
        }, targetSelectors: []
    };
}

export function rollAndDestroyIfLessThanCounters(game: Game): SyncParsedEffect {
    return {
        effectFunction: (data: EffectData): boolean => {
            if (data.issuer instanceof Player === false) return false;
            const roll = game.rollDice(data.issuer, data.it);
            roll.attachEffect([1,2,3,4,5,6].map((value) => (data: EffectData): boolean => {
            if(value < (data.it.counters.value("normal") || 0)) {
                if (data.issuer instanceof Player === false) return false;
                const itemsToDestroy = [data.it, ...data.issuer.inPlay.filter(c => c !== data.it && c.eternal === false)];
                return game.cardHandler.destroyCardsOrSouls(itemsToDestroy);
            }
            return true;
        }), data.it, data.targets, data.issuer);
            return true;
        }, targetSelectors: []
    };
}

export function preventDeathEndTurnEffect(game: Game): EffectFunction {
    return async (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        game.entityHandler.preventDeath(data.issuer);
        if (game.currentPlayer === data.issuer) {
            return endTurnAndResetStackEffect(game)(data);
        }
        return true;
    };
}

export function removeCountersAndLootOrDamageEffect(game: Game, minCounterToRemove: number, lootAmount: number, counterThreshold: number, damageAmount: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        const possibilities = [];
        for (let i = minCounterToRemove; i <= data.it.counters.value("normal"); i++) {
            possibilities.push(i);
        }
        const countersToRemove = (await data.selectAndRecord(game, data.issuer, 1, 1, possibilities, 
            qq("pending.howManyCountersToRemove", { value: minCounterToRemove }), data.serializedCardAndBox, true, true)).selected[0] as number;
        if(countersToRemove === undefined) return false;
        game.cardHandler.addToCounter(data.issuer, data.it, "normal", -countersToRemove);
        if(countersToRemove < counterThreshold) {
            game.loot(data.issuer, lootAmount);
        } else {
            const target = (await data.selectAndRecord(game, data.issuer, 1, 1, game.monsters, qq("pending.monsterToDealDamageTo"), data.serializedCardAndBox, true, true)).selected[0];
            if(!target) return false;
            game.entityHandler.dealDamage(data.issuer, target, data.cardAndBox, damageAmount);
        }
        return true;
    };
}

export function halfLootAndCoinsAndGiveItemEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        const target = data.next as Player;
        if(!target || !(target instanceof Player))
            throw new GameError("No target player for halfLootAndCoinsAndGiveItemEffect", toSerializedTranslation("error.behaviorError", { error: "No target player for halfLootAndCoinsAndGiveItemEffect"}));
        const coinsToLose = Math.floor(target.coins / 2);
        game.forceGiveCoins(target, data.issuer, coinsToLose, data.it);

        const lootToLose = Math.floor(target.hand.length / 2);
        const loots = (await data.selectAndRecord(game, target, lootToLose, lootToLose, target.hand.cards,
            lootToLose > 1 ?
            qq("pending.lootCardsToGiveTo", { value: lootToLose, player: data.issuer.id }) :
            qq("pending.lootCardToGiveTo", { player: data.issuer.id }), data.serializedCardAndBox, true, false)).selected as LootCard[];
        for(const loot of loots)
            game.cardHandler.giveCard(target, data.issuer, loot);
        
        const treasure = (await data.selectAndRecord(game, target, 1, 1, target.inPlay.filter(c => c.eternal === false), qq("pending.treasureToGive", { player: data.issuer.id }), data.serializedCardAndBox, true, true)).selected[0] as TreasureCard;
        if(treasure === undefined) return false;
        game.cardHandler.give(target, data.issuer, treasure);

        return true;
    };
}

export function preventDeathHealFullCancelAttackEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if(data.issuer instanceof Player === false) return false;
        game.entityHandler.preventDeath(data.issuer);
        game.entityHandler.heal(data.issuer, data.issuer.healthPoints);
        game.entityHandler.endCombat();
        return true;
    };
}

export function dealRollDamageEffect(s: string, game: Game): SyncParsedEffect {
    return {
        effectFunction: (data: EffectData): boolean => {
            if (data.issuer instanceof Player === false) return false;
            const target = data.next as Entity;
            const roll = game.rollDice(data.issuer, data.it);
            roll.attachEffect([...Array(6).keys()].map((i) =>
                (data: EffectData): boolean => {
                    game.entityHandler.dealDamage(data.issuer, data.next as Entity, data.cardAndBox, i + 1);
                    return true;
                }), data.it, [target]);
            return true;
        },
        targetSelectors: [] // Special roll damage handling
    };
}


export function takeDamageGainCoinsEffect(s: string, damage: number, coins: number, game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const life_before = data.issuer.currentHealthPoints;

        const callback = (data: EffectData): boolean => {
            if (data.issuer instanceof Player === false) return false;
            const damageInstance: DamageOnStack = data.next;
            if (damageInstance.damage[0]! >= damage!) {
                game.gainCoins(data.issuer, coins!, data.it);
                return true;
            }
            return false;
        }
        game.entityHandler.dealDamage(data.issuer, data.issuer, data.cardAndBox, damage, callback);
        return true;
    };
}

export function dataNextIsIssuerEffect(game: Game, effects: EffectFunction[]): AsyncEffectFunction {
    return async (data: EffectData) => {
        const issuer = data.next;
        if(issuer instanceof Player === false) return false;
        let result = true;
        for(const effect of effects) {
            result = result && await effect(new EffectData(data.it, () => issuer as Player, data.targets, data.visualEffectBox));
        }
        return result; 
    };
}

export function killTargetEffect(game: Game, selectors: TargetsSelector[] = [], selectionOnResolve: boolean = false, issuerIsCurrentPlayer=false): AsyncEffectFunction {
    return async (data: EffectData) => {
        const issuer = issuerIsCurrentPlayer ? game.currentPlayer : data.issuer;
        if(selectionOnResolve){
            if(issuer instanceof Player === false) 
                throw new GameError("Issuer should be a player to select target for killTargetEffect.", toSerializedTranslation("error.behaviorError", { error: "Issuer should be a player to select target for killTargetEffect."}));
            const target = await data.selectAndRecord(game, issuer as Player, 1, 1, selectors[0]!.selector(issuer, data.it), qq("pending.targetToKill"), data.serializedCardAndBox, true, true);
            if(target.selected.length === 0) return false;
            game.entityHandler.kill(issuer, target.selected[0] as Entity, data.cardAndBox);
            return true;
        }
        game.entityHandler.kill(issuer, data.next as Entity, data.cardAndBox);
        return true;
    };
}

/**
 * choose a non-active player. 
 * the next time the active player declares an attack this turn, 
 * the chosen player must make an attack roll after each attack roll the active player makes for the attack. 
 * if that monster dies this attack, the chosen player also gains the rewards.
 */
export function nonActivePlayerHelpFight(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDeclareAttack: (() => void) | null = null;
        let offEndTurn: (() => void) | null = null;
        let offDeath: (() => void) | null = null;
        offDeclareAttack = game.emitter.on("on:attack:declared", (eventData: OnAttackDeclaredData) => {
            const helper = data.next as Player;
            if(!helper || !(helper instanceof Player))
                throw new GameError("Player invalid for nonActivePlayerHelpFight", toSerializedTranslation("error.behaviorError", { error: "Player invalid for nonActivePlayerHelpFight"}));
            const newData = new EffectData(data.it, () => helper, [], data.visualEffectBox);
            room.makeAnAttackRollAfterEachAttackRollEffect(game)(newData);
                    
            offDeath = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
                const { eventIssuer, target, source } = eventData;
                if(game.entitiesInCombat.length === 0)
                    {
                        offDeath?.();
                        offDeath = null;
                    }
                if (!(eventIssuer instanceof Monster)) return;
                if(source instanceof DiceRoll === false || (source as DiceRoll).issuer !== helper) return;
                
                // Add all effects as a single stack element
                const effect = (effectData: EffectData): boolean => {
                    game.entityHandler.entityRewards(eventIssuer, helper)
                    return true;
                };
                addPassiveEffectToStack(game, effect, data, `${helper.id} also gains rewards from killing ${target.id}.`);
                offDeath?.();
                offDeath = null;
            });
            offDeclareAttack?.();
            offDeclareAttack = null;
            offEndTurn?.();
            offEndTurn = null;
            return true;
        });
        offEndTurn = game.emitter.on("on:turn:start", () => {
            offDeclareAttack?.();
            offDeclareAttack = null;
            offEndTurn?.();
            offEndTurn = null;
            offDeath?.();
            offDeath = null;
        });
        return true;
    };
}

export function issuerSkipNextTurnEffect(game: Game, issuerIsCurrentPlayer: boolean = false): SyncEffectFunction {
    return (data: EffectData) => {
        const issuer = issuerIsCurrentPlayer ? game.currentPlayer : data.issuer;
        if(issuer instanceof Player === false) 
            return false;
        game.playerSkipNextTurn(issuer);
        return true;
    };
}

export function deathTargetEffect(game: Game, selectionOnResolve: boolean = false): AsyncEffectFunction {
    return async (data: EffectData) => {
        const target = data.next as Entity;
        if(selectionOnResolve){
            if(data.issuer instanceof Player === false) 
                throw new GameError("Issuer should be a player to select target for deathTargetEffect.", toSerializedTranslation("error.behaviorError", { error: "Issuer should be a player to select target for deathTargetEffect."}));
            const target = await data.selectAndRecord(game, data.issuer as Player, 1, 1, game.players, qq("pending.targetToKill"), data.serializedCardAndBox, true, true);
            if(target.selected.length === 0) return false;
            game.entityHandler.death(target.selected[0] as Entity, data.issuer,data.cardAndBox);
            return true;
        }
        if(!target) 
            throw new GameError("No target for deathTargetEffect", toSerializedTranslation("error.behaviorError", { error: "No target for deathTargetEffect"}));
        game.entityHandler.death(data.next, data.issuer,data.cardAndBox);
        return true;
    };
}

export function dieEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        game.entityHandler.death(data.issuer, data.issuer,data.cardAndBox);
        return true;
    };
}

export function gainTreasuresEffect(game: Game, amount: number, issuerType: "issuer" | "next" = "issuer"): SyncEffectFunction {
    return (data: EffectData) => {
        const issuer = issuerType === "issuer" ? data.issuer : data.next;
        if (issuer instanceof Player === false) return false;
        game.gainTreasure(issuer, amount);
        return true;
    };
}

export function payHealthEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        return game.entityHandler.healthLoss(data.issuer, data.issuer,data.cardAndBox, amount);
    };
}

export function payCoinsEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        return game.loseCoins(data.issuer, amount, false, "paiement") >= 0;
    };
}

export function putCountersBasedOnLootCardsInHandEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const countersToAdd = data.issuer.hand.length;
        game.cardHandler.addToCounter(data.issuer, data.it, "normal", countersToAdd);
        return true;
    };
}

export function conditionalLootBasedOnCountersEffect(game: Game, amountToLoot: number): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const counters = data.it.counters.value("normal") || 0;
        if(counters > data.issuer.hand.length) {
            game.loot(data.issuer, amountToLoot);
        }
        return true;
    };
}

export function eachPlayerGainsCoinsEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        for (const player of game.players) {
            game.gainCoins(player, amount, data.it);
        }
        return true;
    };
}

export function eachPlayerLootsEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        for (const player of game.players) {
            game.loot(player, amount);
        }
        return true;
    };
}

export function putXCardFromYourHandOnTopOfLootDeck(game: Game, x: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const cardsToPutBack = (await data.selectAndRecord(game, data.issuer, x, x, data.issuer.hand.cards, 
            x > 1 ?
            qq("pending.cardsToPutOnTopOfLootDeck", { value: x }) :
            qq("pending.cardToPutOnTopOfLootDeck"), data.serializedCardAndBox, true, false)).selected as Card[];
        for (let i = cardsToPutBack.length - 1; i >= 0; i--) {
            const card = game.cardHandler.getCardFromHand(data.issuer, cardsToPutBack[i]! as LootCard);
            game.decks["loot"]!.addTopPosition(card);
        }
        return true;
    };
}

export function rechargeUpToXChara(game: Game, x: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if(data.issuer instanceof Player === false)
            return false;
        const charas = game.players.map(p=>p.character);
        const toRecharge = (await data.selectAndRecord(game, data.issuer, 0, x, charas, qq("pending.upToXCharacters", {value: x}), data.serializedCardAndBox, true, true, true)).selected;
        game.cardHandler.rechargeMultiple(data.issuer, data.it, toRecharge);
        return true;
    };
}

export function addOrRemoveCounterOnCardEffect(game: Game, amount: number, type: "any" | "alreadyOnIt", target: "next" | "selectionOnResolve", youMayEffectHanging: boolean[], targetSelector: TargetsSelector[]=[]): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if(target === "selectionOnResolve" && targetSelector.length === 0)
            return false;
        const card = target === "next" ? data.next as Card : (await data.selectAndRecord(game, data.issuer, youMayEffectHanging[0] ? 1 : 0, 1, targetSelector[0]!.selector(data.issuer, data.it), 
            qq("pending.cardToAddOrRemoveCountersFrom"), data.serializedCardAndBox, true, true)).selected[0] as Card;
        youMayEffectHanging[0] = false;
        if(!card)
            return false;
        const AllCountersTypes: CounterType[] = ["normal", "golden"];
        const counterTypes = type === "alreadyOnIt" ? card.counters.counterOwned : AllCountersTypes;
        const selectedType = (await data.selectAndRecord(game, data.issuer, 1, 1, counterTypes, 
            qq("pending.counterTypeToAddOrRemoveCountersFrom"), data.serializedCardAndBox, true, true)).selected[0];
        if(selectedType === undefined)
            return false;
        const toAdd = (await data.selectAndRecord(game, data.issuer, 1, 1, [-amount, amount], qq("pending.doYouWantToAddOrRemoveCounters", { value: amount, CounterType: selectedType }), data.serializedCardAndBox, true, true)).selected[0] as number;
        if(toAdd === undefined)
            return false;
        if (card.counters.value(selectedType) > 0 || (type === "any" && toAdd > 0)) {
            game.cardHandler.addToCounter(data.issuer, card, selectedType, toAdd);
        }
        return true;
    };
}

export function dealDamageToEachPlayerEffect(game: Game, amount: number, includeActivePlayer: boolean = true): SyncEffectFunction {
    return (data: EffectData) => {
        for (const player of game.players) {
            if (!includeActivePlayer && player === game.currentPlayer) continue;
            game.entityHandler.dealDamage(data.issuer, player, data.cardAndBox, amount);
        }
        return true;
    };
}

export function dealDamageToEachMonsterEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        for (const monster of [...game.monsters]) {
            game.entityHandler.dealDamage(data.issuer, monster, data.cardAndBox, amount);
        }
        return true;
    };
}

export function dealDamageToEachMonsterAndPlayerEffect(game: Game, amount: number, includeActivePlayer: boolean = true): SyncEffectFunction {
    return (data: EffectData) => {
        for (const monster of [...game.monsters]) {
            game.entityHandler.dealDamage(data.issuer, monster, data.cardAndBox, amount);
        }
        for (const player of game.players) {
            if (!includeActivePlayer && player === game.currentPlayer) continue;
            game.entityHandler.dealDamage(data.issuer, player, data.cardAndBox, amount);
        }
        return true;
    };
}

export function chooseOneOfListEffect(game: Game, selectors: TargetsSelector, selectionOnResolve: false): SyncEffectFunction
export function chooseOneOfListEffect(game: Game, selectors: TargetsSelector, selectionOnResolve: boolean): AsyncEffectFunction
export function chooseOneOfListEffect(game: Game, selectors: TargetsSelector, selectionOnResolve: boolean): EffectFunction {
    return async (data: EffectData) => {
        const issuer = data.issuer instanceof Player ? data.issuer : game.currentPlayer;
        const selection = selectionOnResolve ? (await data.selectAndRecord(game, issuer, 1, 1, selectors.selector(issuer, data.it), qq("pending.option"), data.serializedCardAndBox, true, true)).selected[0] : data.next;
        if(selection === undefined)
            return false;
        data.addTarget(selection);
        return true;
    };
}

export function takeDamageEffect(game: Game, amount: number, CurrentPlayerIfIssuerIsMonster: boolean = false): SyncEffectFunction {
    return (data: EffectData) => {
        const issuer = CurrentPlayerIfIssuerIsMonster && data.issuer instanceof Monster ? game.currentPlayer : data.issuer;
        game.entityHandler.dealDamage(issuer, issuer, data.cardAndBox, amount);
        return true;
    };
}

export function discardHandEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const handSize = data.issuer.hand.length;
        let success = true;
        for (let idx = handSize - 1; idx >= 0; idx--) {
            if (idx >= 0) {
                success = success && game.cardHandler.discardFromHandAtIndex(data.issuer, idx, "effect");
            }
        }
        data.addTarget(handSize);
        return success;
    };
}

export function dealDamageToTargetEffect(game: Game, amount: number, selectionOnResolve: false, selectors: TargetsSelector[], issuerType: "issuer" | "current"): SyncEffectFunction
export function dealDamageToTargetEffect(game: Game, amount: number, selectionOnResolve: boolean, selectors: TargetsSelector[], issuerType: "issuer" | "current"): AsyncEffectFunction
export function dealDamageToTargetEffect(game: Game, amount: number, selectionOnResolve: boolean = false, selectors: TargetsSelector[] = [], issuerType: "issuer" | "current" = "issuer"): EffectFunction {
    return async (data: EffectData) => {
        let target = data.next;
        const issuer = issuerType === "current" ? game.currentPlayer : data.issuer;
        if(target instanceof DiceRoll)
            target = target.issuer;
        if(selectionOnResolve){
            if(issuer instanceof Player === false) 
                throw new GameError("Issuer should be a player to select target for dealDamageToTargetEffect.", toSerializedTranslation("error.behaviorError", { error: "Issuer should be a player to select target for dealDamageToTargetEffect."}));
            const targets = selectors[0]!.selector(issuer, data.it);
            if(targets.length === 0)
                return false;
            let sentence = qq("pending.targetToDealDamageTo", { value: amount });
            if(targets.every(e => e instanceof Monster) ) // all monsters
                sentence = qq("pending.monsterToDealXDamageTo", { value: amount });
            else if(targets.every(e => e instanceof Player)) // all players
                sentence = qq("pending.playerToDealXDamageTo", { value: amount });
            const selectionResult = (await data.selectAndRecord(game, issuer, 1, 1, targets, sentence, data.serializedCardAndBox, true, true));
            target = selectionResult.selected[0];
        }
        if(!(target instanceof Entity))
            throw new GameError(`Invalid target for dealDamageToTargetEffect (${target}), all: ${data.targets}, source: ${data.it.slug}, issuer: ${issuer.id}, resolve on: ${selectionOnResolve}, selectors: ${selectors.length}`, toSerializedTranslation("error.behaviorError", { error: `Invalid target for dealDamageToTargetEffect (${target}), all: ${data.targets}, source: ${data.it.slug}, issuer: ${issuer.id}, resolve on: ${selectionOnResolve}, selectors: ${selectors.length}`}));
        game.entityHandler.dealDamage(data.issuer, target, data.cardAndBox, amount);
        return true;
    };
}

export function activePlayerChoosePlayerMustAttackThisAfterEachAttackRollEffect(game: Game, nbTreasureCompensation: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        const issuer = game.currentPlayer;
        const target = (await data.selectAndRecord(game, issuer, 1, 1, game.players.filter(p => p !== issuer && !p.isDead), qq("pending.playerThatMustAttackThisMonster"), data.serializedCardAndBox, true, true)).selected[0] as Player;
        if(!target)
            return false;
        // If the current player dies in the mean time or is not in combat anymore, we can end the effect immediately.
        if(issuer.isEngagedInCombat === false)
            return false;
        room.makeAnAttackRollAfterEachAttackRollEffect(game)(new EffectData(data.it, () => target, [], data.visualEffectBox));
        let offEndTurn: (() => void) | null = null;
        let offDeath: (() => void) | null = null;

        const cleanup = (): void => {
            offEndTurn?.();
            offEndTurn = null;
            offDeath?.();
            offDeath = null;
        }
        offDeath = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
            const { eventIssuer } = eventData;
            if(eventIssuer !== data.it.entity)
                return;
            game.gainTreasure(target, nbTreasureCompensation);
            cleanup();
        });

        offEndTurn = game.emitter.on("on:turn:end", () => {
            cleanup();
        });

        data.it.cleaners.push(cleanup);
        return true;
    };
}

export function giveItemToAnotherPlayerEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const itemToGive = data.next as ItemCard;
        if(itemToGive === undefined || itemToGive === data.it)
            return false;
        const targetPlayer = data.next as Player;
        return game.cardHandler.give(data.issuer, targetPlayer, itemToGive);
    };
}

export function putMonsterUnderThisEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        data.it.tags.underThis = data.it.tags.underThis || [];
        const monster = data.next as Monster;
        // console.log("monsters: ", game.monsters.map(m => m.card.name), "target monster: ", monster?.card.name)
        if(monster === undefined || !(monster instanceof Monster) || monster.isEngagedInCombat)
        {
            console.log(monster === undefined , !(monster instanceof Monster) , monster.isEngagedInCombat , !game.monsters.includes(monster) , monster.isDead)
            throw new GameError("Invalid target for putMonsterUnderThisEffect", toSerializedTranslation("error.behaviorError", { error: "Invalid target for putMonsterUnderThisEffect"}));
        }
        if(!game.monsters.includes(monster) || monster.isDead)
            return false;
        if(game.encounters.removeCard(monster.card))
            data.it.tags.underThis.push(monster.card);
        return true;
    };
}

export function putMonsterFromUnderThisIntoSlotEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        const monsterCard = (await data.selectAndRecord(game, data.issuer as Player, 1, 1, data.it.tags.underThis || [], qq("pending.monsterToPutIntoSlot"), data.serializedCardAndBox, true, true)).selected[0] as MonsterCard;
        if(!monsterCard)
            return false;
        if(data.issuer instanceof Player === false)
            throw new GameError("Issuer should be a player for putMonsterFromUnderThisIntoSlotEffect", toSerializedTranslation("error.behaviorError", { error: "Issuer should be a player for putMonsterFromUnderThisIntoSlotEffect"}));
        if(game.encounters.coverableSlots.length === 0)
            return false;
        game.decks.monster.addTopPosition(monsterCard);
        await game.encounters.selectValidIndexAndDraw(game, data.issuer, data);
        data.it.tags.underThis = data.it.tags.underThis.filter((c: Card) => c !== monsterCard);
        const req = [game.monsters.find(m => m.card === monsterCard)!]
        if(req.length !== 1)
            throw new GameError("Invalid number of monsters found for putMonsterFromUnderThisIntoSlotEffect", toSerializedTranslation("error.behaviorError", { error: "Invalid number of monsters found for putMonsterFromUnderThisIntoSlotEffect"}));
        game.entityHandler.playerMustAttack(game.currentPlayer, req, data.it, false);
        return true;
    };
}

export function lookAndReorderTopCardsEffect(game: Game, numberCards: number, deckNameParam: string | undefined, issuerType: "currentPlayer" | "dataIssuer" | "diceOwner"): SyncEffectFunction
export function lookAndReorderTopCardsEffect(game: Game, numberCards: number, deckNameParam: string | undefined | "selectOnResolve" = undefined, issuerType: "currentPlayer" | "dataIssuer" | "diceOwner" = "dataIssuer"): EffectFunction {
    return async (data: EffectData) => {
        let issuer = data.issuer;
        if(issuerType === "currentPlayer")
            issuer = game.currentPlayer;
        if(issuerType === "diceOwner") {
            const roll = data.next as DiceRoll;
            if(!roll || !(roll instanceof DiceRoll) || !roll.issuer)
                throw new GameError("Invalid dice roll for lookAndReorderTopCardsEffect", toSerializedTranslation("error.behaviorError", { error: "Invalid dice roll for lookAndReorderTopCardsEffect"}));
            issuer = roll.issuer;
        }
        if (issuer instanceof Player === false) return false;
        let deckName = deckNameParam;
        if(deckName === undefined) {
            const deck = data.next as Deck<Card>;
            if(!deck)
                throw new GameError("No deck provided for lookAndReorderTopCardsEffect", toSerializedTranslation("error.behaviorError", { error: "No deck provided for lookAndReorderTopCardsEffect"}));
            deckName = deck._type;
        }
        if(deckNameParam === "selectOnResolve")
            deckName = (await data.selectAndRecord(game, issuer, 1, 1, deckSelector(undefined, game)(issuer), qq("pending.deckToLookAtTopCardOf"), data.serializedCardAndBox, true, true)).selected[0]!._type as DeckType;
        if(!isDeckType(deckName))
            throw new GameError(`Invalid deck type: ${deckName}`, toSerializedTranslation("error.invalidDeckType", { deckType: deckName }));
        const top5Cards = game.cardHandler.getFirstCardsOfDeck(deckName, numberCards);
        const selectionResult = await data.selectAndRecord(game, issuer, numberCards, numberCards, top5Cards, qq("pending.orderToPutBackCards"), data.serializedCardAndBox, false, false);
        for (let i = selectionResult.selected.length - 1; i >= 0; i--) {
            game.cardHandler.addTopPosition(deckName, selectionResult.selected[i]!);
        }
        return true;
    };
}

export function addOrSubtractXFromRollEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const chosenDiceRoll: DiceRoll = data.next as DiceRoll;
        const value = data.next as number;
        if (value === 1) 
            chosenDiceRoll.add(1);
        else if (value === -1)
            chosenDiceRoll.subtract(1);
        return true;
    };
}

export function eachOtherPlayerLootsAndYouLootEffect(game: Game, amount: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        for (const player of game.players) {
            if (player !== data.issuer) {
                const choice = (await data.selectAndRecord(game, data.issuer, 1, 1, ["Yes", "No"], qq("pending.doYouWantToLootCards", { value: amount, player: data.issuer.id }), data.serializedCardAndBox, true, true)).selected[0];
                if(choice === "Yes")
                {
                    game.loot(player, amount);
                    const cardToGive = (await data.selectAndRecord(game, player, 1, 1, player.hand.cards, qq("pending.cardToGiveTo", { player: data.issuer.id }), data.serializedCardAndBox, true, false)).selected[0] as LootCard;
                    if(!cardToGive)
                        throw new GameError("No card selected to give.", toSerializedTranslation("capability.noCardToGive"));
                    game.cardHandler.giveCard(player, data.issuer, cardToGive);
                }
            }
        }

        return true;
    };
}

export function putThisIntoDiscardEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if(data.it instanceof MonsterCard === false && data.it instanceof RoomCard === false)
            throw new GameError("Card is not a monster card for putThisIntoDiscardEffect", toSerializedTranslation("error.behaviorError", { error: "Card is not a monster card for putThisIntoDiscardEffect"}));
        if(data.it instanceof MonsterCard)
            data.it.afterEffect = "nothing"; // card placement is handled by the effect itself.
        game.cardHandler.discard(data.it);
        return true;
    };
}

export function killMonsterEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const targetMonster = data.next as Monster;
        game.entityHandler.kill(data.issuer, targetMonster, data.cardAndBox);
        return true;
    };
}

export function enterPlayBecomeSoulEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        game.cardHandler.removeInPlay(data.issuer, data.it as ItemCard);
        if(data.it instanceof LootCard === true)
            data.it.afterEffect = "nothing"; // card placement is handled by the effect itself.
        data.it.soul = 1;
        game.cardHandler.addSoul(data.issuer, data.it);
        return true;
    };
}

export function playUnlimitedLootCardsThisTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        game.entityHandler.addLootPlay(data.issuer, INFINITY, data.it);
        return true;
    };
}

export function dealDamageNotEngagedInCombatEffect(game: Game, amount: number, targetType: "aPlayerOrMonster" | "eachMonster"): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const feasibleTargets = game.playersAndMonsters.filter(e => e.isEngagedInCombat === false || e === data.issuer);
        if (feasibleTargets.length === 0) return false;
        const targetsSelected = targetType === "aPlayerOrMonster" 
                ? (await data.selectAndRecord(game, data.issuer, 1, 1, feasibleTargets, qq("pending.targetToDealDamageTo", { value: amount }), data.serializedCardAndBox, true, true)).selected as Entity[]
                : game.monsters.filter(m => !m.isEngagedInCombat);
        for(const target of targetsSelected)
            game.entityHandler.dealDamage(data.issuer, target, data.cardAndBox, amount);
        return true;
    }
}


export function putThisOnBottomOfLootDeckEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if(data.it instanceof LootCard === false)
            throw new GameError("Card is not a loot card for putThisOnBottomOfLootDeckEffect", toSerializedTranslation("error.behaviorError", { error: "Card is not a loot card for putThisOnBottomOfLootDeckEffect"}));
        data.it.afterEffect = "nothing"; // card placement is handled by the effect itself.
        game.cardHandler.addBottomPosition("loot", data.it);
        
        return true;
    };
}

export function takeExtraTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if (game.currentPlayer === data.issuer) {
            game.addExtraTurn(data.issuer);
            return true;
        }
        return false;
    };
}

export function giveThisToPlayerOnLeftEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const targetPlayer = game.turnHandler.getPlayerTo(data.issuer, "left")!;
        if(data.it instanceof LootCard === false)
            throw new GameError("Card is not a loot card for giveThisToPlayerOnLeftEffect", toSerializedTranslation("error.behaviorError", { error: "Card is not a loot card for giveThisToPlayerOnLeftEffect"}));
        if(!targetPlayer || !(targetPlayer instanceof Player))
            throw new GameError("Target player is not valid for giveThisToPlayerOnLeftEffect", toSerializedTranslation("error.behaviorError", { error: "Target player is not valid for giveThisToPlayerOnLeftEffect"}));
        try{
            game.decks.loot.remove(data.it);
        } catch (e) {
            // card might not be in loot deck, ignore error
            data.it.afterEffect = "discardNextTime"; // card placement is handled by the effect itself.
        }
        game.cardHandler.addCardToHand(targetPlayer, data.it);
        return true;
    };
}

export function rerollDiceByControllerEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const chosenDiceRoll: DiceRoll = data.next as DiceRoll;
        chosenDiceRoll.roll();
        return true;
    };
}

export function thisBecomeSoulGainItEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        if(data.it instanceof ItemCard === true || data.it instanceof MonsterCard === true)
            game.obtainCard(data.it.slug, data.it.globalId);
        data.it.soul = 1;
        if(data.it instanceof MonsterCard)
            data.it.afterEffect = "handled";
        game.cardHandler.addSoul(data.issuer, data.it);
        return true;
    };
}
