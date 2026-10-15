import { type Card, ItemCard, MonsterCard } from "./cards";
import type { Entity } from "./entities/entity";
import { Game } from "./game";
import { Player } from "./entities/player";
import { DiceRoll, DiceWillRoll, EffectOnStack, LootCardEffect } from "./stackElement";
import type { StackElement } from "./stack";
import { type TargetsSelector } from "./types/cardTypes";
import { type VisualEffectBox } from "@/shared/api";

export function inplayUnchargedItemSelector(game: Game): (issuer: Player) => ItemCard[] {
    return (inplayItemSelector((player: Player, card: ItemCard) => card.isActiveItem(), game));
}

export function inplayCurseSelector(filter: (player: Player, card: MonsterCard) => boolean, game: Game): (issuer: Player) => MonsterCard[] {
    return (issuer: Player) => {
        return game.inPlayCurses.filter(({ player, card }) => filter(player, card)).map(({ card }) => card);
    };
}
export function inplayItemSelector(filter: (player: Player, card: ItemCard) => boolean, game: Game): (issuer: Player) => ItemCard[] {
    return (issuer: Player) => {
        return game.inPlayItems.filter(({ player, card }) => filter(player, card)).map(({ card }) => card);
    };
}

export function itemAndSoulSelector(filter: (player: Player, card: ItemCard) => boolean, game: Game): (issuer: Player) => Card[] {
    return (issuer: Player) => {
        return [...game.shop.itemsInShop.filter(c=>c !== undefined), ...game.inPlayItems.filter(({ player, card }) => filter(player, card)).map(({ card }) => card), ...game.players.flatMap(p => p.targetableSouls)];
    };
}

export function YourItemSelector(filter: (player: Player, card: ItemCard) => boolean, anotherItem: boolean, game: Game): (issuer: Player, card: Card) => ItemCard[] {
    return (issuer: Player, c: Card) => {
        return game.inPlayItems.filter(({ player, card }) => player === issuer && (!anotherItem || c !== card) && filter(player, card)).map(({ card }) => card);
    };
}
export function inAnotherplayItemSelector(filter: (player: Player, card: ItemCard) => boolean, game: Game): (issuer: Player) => ItemCard[] {
    return (issuer: Player) => {
        return game.inPlayItems.filter(({ player, card }) => filter(player, card) && issuer.id !== player.id).map(({ card }) => card);
    };
}

export function visibleItemSelector(filter: (card: ItemCard, issuer: Player) => boolean, anotherItem: boolean, game: Game): (issuer: Player, card: Card) => ItemCard[] {
    return (issuer: Player, card: Card) => {
        return game.visibleItems.filter((c) => (!anotherItem || c !== card) && filter(c, issuer));
    };
}

export function playerSelector(filter: (player: Player) => boolean = () => true, game: Game): (issuer: Player) => Player[] {
    return (issuer: Player) => {
        return game.players.filter((player) => filter(player));
    };
}

export function anotherPlayerSelector(filter: (player: Player) => boolean = () => true, game: Game): (issuer: Player) => Player[] {
    return (issuer: Player) => {
        return playerSelector((player) => player !== issuer && filter(player), game)(issuer);
    };
}

export function activeEntitySelector(filter: (player: Entity) => boolean = () => true, game: Game): (issuer: Player) => Entity[] {
    return (issuer: Player) => {
        return game.playersAndMonsters.filter((entity) => filter(entity));
    }
}
export interface ChooseOneOptions {
    description: string;
    card: Card;
    visualEffectBox: VisualEffectBox;
    admissibleTargets: TargetsSelector[];
}

export interface CardEffectOptions {
    index: number;
    card: Card;
    visualEffectBox: VisualEffectBox;
}

export const isChooseOneOptions = (x: any): x is ChooseOneOptions => {
    return typeof x === 'object' && x !== null && 'description' in x && 'admissibleTargets' in x && 'visualEffectBox' in x && "card" in x;
};

export const isCardEffectOptions = (x: any): x is CardEffectOptions => {
    return typeof x === 'object' && x !== null && 'index' in x && 'card' in x && 'visualEffectBox' in x && "card" in x;
};

export function deckSelector(filter: (name: string) => boolean = () => true, game: Game): (issuer: Player) => any[] {
    return (issuer: Player) => {
        return [game.decks.loot, game.decks.treasure, game.decks.monster, ...(game.rooms !== undefined ? [game.decks.room] : [])].filter((deck) => filter(deck._type));
    }
}

export function topAnyDiscardSelector(filter: (card: Card) => boolean = () => true, game: Game): (issuer: Player) => any[] {
    return (issuer: Player) => {
        const cards = [] as Card[];
        for (const deckName of game.deckNames) {
            const deck = game.decks[deckName];
            if(deck && deck.discard.length > 0){
                const topCard = deck.discard[0];
                if(filter(topCard as Card))
                    cards.push(topCard as Card);
            }
        }
        return cards;
    }
}

export function diceWillRollSelector(filter: (element: StackElement) => boolean = () => true, game: Game): (issuer: Player) => any[] {
    return (issuer: Player) => {
        return game.stack.elements.filter((element) => element instanceof DiceWillRoll && filter(element));
    }
}

export function stackElementSelector(filter: (element: StackElement) => boolean = () => true, game: Game): (issuer: Player) => any[] {
    return (issuer: Player) => {
        return game.stack.elements.filter((element) => filter(element));
    }
}

function containMyItemOrDice(arr: any[], issuer: Player)
{
    for(const el of arr)
    {
        if(el instanceof DiceRoll && el.issuer === issuer)
            return true;
        if(el instanceof ItemCard && issuer.inPlay.includes(el))
            return true;
    }
}
export function stackElementThatTargetMyItemOrDiceSelector(filter: (element: StackElement) => boolean = () => true, game: Game): (issuer: Player) => any[] {
    return (issuer: Player) => {
        return game.stack.elements.filter((element) => filter(element) && 
            ((element instanceof EffectOnStack && ["active", "paid"].includes(element.type) && containMyItemOrDice(element.data.targets, issuer))
            || 
            ((element instanceof LootCardEffect && containMyItemOrDice(element.targets, issuer))))
        );
    }
}

export function rollSelector(filter: (roll: DiceRoll) => boolean = () => true, game: Game): (issuer: Player) => any[] {
    return stackElementSelector((element) => element instanceof DiceRoll && filter(element), game);
}

export function attackRollSelector(game: Game): (issuer: Player) => any[] {
    return rollSelector((roll) => roll.attackRoll, game);
}

export function nonAttackRollSelector(game: Game): (issuer: Player) => any[] {
    return rollSelector((roll) => !roll.attackRoll, game);
}