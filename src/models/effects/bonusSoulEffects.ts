import { type Card, BsoulCard, ItemCard, TreasureCard } from "../cards";
import { Player } from "../entities/player";
import { Game } from '../game';
import { GameError } from "@/models/GameError";
import type {
    OnCoinGainedData,
    OnDeathBeforePenaltyData,
    OnDeathMonsterData,
    OnEnterPlayAfterData,
    OnLootAddedAfterData,
    OnSoulGainedOrRemovedData,
} from "../types/eventTypes";
import { addPassiveEffectToStack } from "./passiveEffect";
export type OffEffectFunction = () => void;
import { EffectData } from "../types/cardTypes";
import { toSerializedTranslation } from "@/utils/translation";
/**
 * Bsouls are particular for several reasons.
 * First, they are not owned by players.
 * Their trigger and effect is also unique.
 * Therefore, they are not put in the effect file, but handled specifically here.
 * Furthermore, their effect is parsed on game start rather than on deck creation.
 * They are parsed with the first element of their effectOutcomes, which is a bit hacky, but ok because of the uniqueness of their effects.
 * 
 * @param card 
 * @param game 
 * @returns 
 */
export function bSoulEffectParser(card: BsoulCard, game: Game): OffEffectFunction {
    const s = card.effectOutcomes[0];
    if(!s) throw new GameError("Bonus Soul card has no effect outcome: " + card.name, toSerializedTranslation("error.parsingError", {error: "Bonus Soul card has no effect outcome"}));
    switch (s) {
        case "The first player to have 10 or more loot cards in their hand gains this soul.":
            return soulOfGluttonyEffect(game, card);
        case "The first player to have 25\u00A2 or more gains this soul.":
            return soulOfGreedEffect(game, card);
        case "The first player to control 2 or more guppy items gains this soul.":
            return soulOfGuppyEffect(game, card);
        case "The first time a player controls their 3rd soul, the active player chooses a player who controls the fewest souls or tied for fewest. That player gains this soul.":
            return soulOfEnvyEffect(game, card);
        case "Each time a player kills a monster, put a counter on this.":
            return soulOfLustEffect(game, card);
        case "Each time a player gains a treasure, put a counter on this.":
            return soulOfPrideEffect(game, card);
        case "Each time a player dies, put a counter on this.":
            return soulOfWrathEffect(game, card);
        case "The first time a player controls 4 items, the active player chooses a player who controls the fewest items or tied for fewest. That player gains this soul.":
            return soulOfSlothEffect(game, card);

        default:
            throw new GameError("Unknown Bonus Soul effect: " + s, toSerializedTranslation("error.parsingError", {error: "Unknown Bonus Soul effect"}));
    }
}


function soulOfGluttonyEffect(game: Game, card: Card): OffEffectFunction {

    let offEffect: (() => void) | null = null;

    const cleanup = (): void => {
        offEffect?.();
        offEffect = null;
    };

    // Listen for the next damage event on this player
    offEffect = game.emitter.on("on:loot:added:after", (eventData: OnLootAddedAfterData) => {
        const { eventIssuer, card: lootCard } = eventData;
        if (eventIssuer.hand.length < 10) return;
        game.cardHandler.addSoul(eventIssuer, card);
        cleanup();
    });
    return offEffect;
}

function soulOfGreedEffect(game: Game, card: Card): OffEffectFunction {
    let offEffect: (() => void) | null = null;

    const cleanup = (): void => {
        offEffect?.();
        offEffect = null;
    };

    // Listen for the next damage event on this player
    offEffect = game.emitter.on("on:coin:gained:after", (eventData: OnCoinGainedData) => {
        const { eventIssuer, coinGained } = eventData;
        if (eventIssuer.coins < 25) return;
        game.cardHandler.addSoul(eventIssuer, card);
        cleanup();
    });
    return offEffect;
}

function soulOfGuppyEffect(game: Game, card: Card): OffEffectFunction {
    let offEffect: (() => void) | null = null;

    const cleanup = (): void => {
        offEffect?.();
        offEffect = null;
    };

    // Listen for the next damage event on this player
    offEffect = game.emitter.on("on:enter:play:after", (eventData: OnEnterPlayAfterData) => {
        const { eventIssuer, card: item } = eventData;
        if (eventIssuer.inPlay.filter((c: Card) => c instanceof ItemCard && c.isGuppy()).length < 2)
            return;
        game.cardHandler.addSoul(eventIssuer, card);
        cleanup();
    });
    return offEffect;
}

function soulOfEnvyEffect(game: Game, card: Card): OffEffectFunction {
    let offEffect: (() => void) | null = null;
    let active = true;

    const cleanup = (): void => {
        offEffect?.();
        offEffect = null;
        active = false;
    };

    // Listen for the next damage event on this player
    offEffect = game.emitter.on("on:soul:gained", (eventData: OnSoulGainedOrRemovedData) => {
        const { eventIssuer, soul } = eventData;
        if(eventIssuer.totalSouls < 3) return;
        if(!active) return;
        active = false;
        const effect = async (data: EffectData) => {
            const fewestSouls = Math.min(...game.players.map(p => p.totalSouls));
            const playersWithFewestSouls = game.players.filter(p => p.totalSouls === fewestSouls);
            const selected = (await game.select(eventIssuer, 1, 1, playersWithFewestSouls, toSerializedTranslation("pending.playerToGainSoulOfEnvy"), data.serializedCardAndBox, false)).selected[0];
            game.cardHandler.addSoul(selected as Player, card);
            return true;
        }
        addPassiveEffectToStack(game, effect, new EffectData(card, ()=> eventData.eventIssuer, []), "Soul of Envy effect");
        cleanup();
    });
    return offEffect;
}

function soulOfLustEffect(game: Game, card: Card): OffEffectFunction {
    let offDeath: (() => void) | null = null;
    card.counters.reset("normal");

    const cleanup = (): void => {
        offDeath?.();
        offDeath = null;
    };

    offDeath = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
        if(!(eventData.target instanceof Player)) return;
        game.cardHandler.addToCounter(eventData.eventIssuer, card, "normal", 1);
        if(card.counters.value("normal") < 6) return;
        game.cardHandler.addSoul(game.currentPlayer, card);
        cleanup();
    });

    return offDeath;
}

function soulOfPrideEffect(game: Game, card: Card): OffEffectFunction {
    let offDeath: (() => void) | null = null;
    card.counters.reset("normal");

    const cleanup = (): void => {
        offDeath?.();
        offDeath = null;
    };

    offDeath = game.emitter.on("on:enter:play:after", (eventData: OnEnterPlayAfterData) => {
        if(!(eventData.card instanceof TreasureCard)) return;
        game.cardHandler.addToCounter(eventData.eventIssuer, card, "normal", 1);
        if(card.counters.value("normal") < 6) return;
        game.cardHandler.addSoul(eventData.eventIssuer, card);
        cleanup();
    });

    return offDeath;
}

function soulOfWrathEffect(game: Game, card: Card): OffEffectFunction {
    let offDeath: (() => void) | null = null;
    card.counters.reset("normal");

    const cleanup = (): void => {
        offDeath?.();
        offDeath = null;
    };

    offDeath = game.emitter.on("on:death:before-penalty", (eventData: OnDeathBeforePenaltyData) => {
        if(!(eventData.eventIssuer instanceof Player)) return;
        game.cardHandler.addToCounter(eventData.eventIssuer, card, "normal", 1);
        if(card.counters.value("normal") < 6) return;
        game.cardHandler.addSoul(game.currentPlayer, card);
        cleanup();
    });

    return offDeath;
}

function soulOfSlothEffect(game: Game, card: Card): OffEffectFunction {
    let offDeath: (() => void) | null = null;
    let active = true;

    const cleanup = (): void => {
        offDeath?.();
        offDeath = null;
        active = false;
    };

    offDeath = game.emitter.on("on:enter:play:after", (eventData: OnEnterPlayAfterData) => {
        if(eventData.eventIssuer.inPlay.length < 4) return; // -2 to exclude character card and eternal.
        if(!active) return;
        active = false; 
        const effect = async (data: EffectData) => {
            const fewestTreasure = Math.min(...game.players.map(p => p.inPlay.length));
            const playersWithFewestTreasures = game.players.filter(p => p.inPlay.length === fewestTreasure);
            const selected = (await game.select(eventData.eventIssuer, 1, 1, playersWithFewestTreasures, toSerializedTranslation("pending.playerToGainSoulOfSloth"), data.serializedCardAndBox, false)).selected[0];
            game.cardHandler.addSoul(selected as Player, card);
            return true;
        };
        addPassiveEffectToStack(game, effect, new EffectData(card, ()=> eventData.eventIssuer, []), "Soul of Sloth effect");
        cleanup();
    });

    return offDeath;
}