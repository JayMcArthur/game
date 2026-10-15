import { toSerializedTranslation } from "@/utils/translation";
import type { Player } from "./entities/player";
import type { SerializedPlayerStatsSchema, SerializedTranslation } from "@/shared/api";
import { shuffle } from "@/utils/auxiliary";

export class PlayerStats {
    nbAttacksDeclared: number = 0;
    nbLootPlayed: number = 0;
    nbPurchases: number = 0;
    nbPurchaseTopDeck: number = 0;
    nbPurchaseCancelled: number = 0;
    nbRoomActivated: number = 0;
    nbItemActivated: number = 0;
    nbMobKilled: number = 0;
    nbPlayerKilled: number = 0;
    nbSuicides: number = 0;
    nbDeaths: number = 0;
    nbLootGained: number = 0;
    nbAttackTopDeck: number = 0;
    nbItemGained: number = 0;
    nbCoinsGained: number = 0;
    coinsGiven: number = 0;
    coinsPaid: number = 0;
    nbDamageTaken: number = 0;
    nbDamageDealt: number = 0;
    nbNonAttackRolledValues = [0, 0, 0, 0, 0, 0];
    nbAttackRolledValues = [0, 0, 0, 0, 0, 0];


    get json(): SerializedPlayerStatsSchema {
        return {
            nbAttacksDeclared: this.nbAttacksDeclared,
            nbLootPlayed: this.nbLootPlayed,
            nbPurchases: this.nbPurchases,
            nbPurchaseTopDeck: this.nbPurchaseTopDeck,
            nbPurchaseCancelled: this.nbPurchaseCancelled,
            nbRoomActivated: this.nbRoomActivated,
            nbItemActivated: this.nbItemActivated,
            nbMobKilled: this.nbMobKilled,
            nbPlayerKilled: this.nbPlayerKilled,
            nbSuicides: this.nbSuicides,
            nbDeaths: this.nbDeaths,
            nbLootGained: this.nbLootGained,
            nbAttackTopDeck: this.nbAttackTopDeck,
            nbItemGained: this.nbItemGained,
            nbCoinsGained: this.nbCoinsGained,
            coinsGiven: this.coinsGiven,
            coinsPaid: this.coinsPaid,
            nbDamageTaken: this.nbDamageTaken,
            nbDamageDealt: this.nbDamageDealt,
            nbNonAttackRolledValues: this.nbNonAttackRolledValues,
            nbAttackRolledValues: this.nbAttackRolledValues,
        };
    }
}

const Titles = {
    nbAttacksDeclared: [toSerializedTranslation("title.pacifist"), toSerializedTranslation("title.aggressive")],
    nbLootPlayed: [toSerializedTranslation("title.lazy"), toSerializedTranslation("title.player")],
    nbPurchases: [toSerializedTranslation("title.cheap"), toSerializedTranslation("title.buyer")],
    nbPurchaseTopDeck: [toSerializedTranslation("title.cautious"), toSerializedTranslation("title.gambler")],
    nbPurchaseCancelled: [toSerializedTranslation("title.decisive"), toSerializedTranslation("title.dreamer")],
    nbRoomActivated: [toSerializedTranslation("title.adventurer"), toSerializedTranslation("title.homebody")],
    nbItemActivated: [toSerializedTranslation("title.spiritualist"), toSerializedTranslation("title.materialist")],
    nbMobKilled: [toSerializedTranslation("title.shy"), toSerializedTranslation("title.slayer")],
    nbPlayerKilled: [toSerializedTranslation("title.peaceful"), toSerializedTranslation("title.hunter")],
    nbSuicides: [toSerializedTranslation("title.martyr"), toSerializedTranslation("title.survivor")],
    nbDeaths: [toSerializedTranslation("title.mortal"), toSerializedTranslation("title.immortal")],
    nbLootGained: [toSerializedTranslation("title.stuck"), toSerializedTranslation("title.looter")],
    nbAttackTopDeck: [toSerializedTranslation("title.calculator"), toSerializedTranslation("title.crazy")],
    nbItemGained: [toSerializedTranslation("title.frugal"), toSerializedTranslation("title.collector")],
    nbCoinsGained: [toSerializedTranslation("title.poor"), toSerializedTranslation("title.rich")],
    coinsGiven: [toSerializedTranslation("title.selfish"), toSerializedTranslation("title.generous")],
    coinsPaid: [toSerializedTranslation("title.minimalist"), toSerializedTranslation("title.spender")],
    nbDamageTaken: [toSerializedTranslation("title.shadow"), toSerializedTranslation("title.tank")],
    nbDamageDealt: [toSerializedTranslation("title.inoffensive"), toSerializedTranslation("title.berserker")],
    diceRolled: [toSerializedTranslation("title.unlucky"), toSerializedTranslation("title.lucky")],
}

function sum(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0);
}

class Title{
    name: SerializedTranslation;
    distanceWithNormalizedMean: number;
    constructor(name: SerializedTranslation, distanceWithNormalizedMean: number) {
        this.name = name;
        this.distanceWithNormalizedMean = distanceWithNormalizedMean;
    }
}

export function getTitles(players: Player[]): Record<string, Title[]> {
    const titles: Record<string, Title[]> = {};
    for (const player of players) {
        titles[player.id] = [];
    }
    
    const expecations = players.map((p) => sum([0,1,2,3,4,5].map((i) => (p.stats.nbNonAttackRolledValues[i]! + p.stats.nbAttackRolledValues[i]!) * (i + 1)))/(Math.max(1, (sum(p.stats.nbNonAttackRolledValues) + sum(p.stats.nbAttackRolledValues)))));

    // contestant if esperance is above 3 +/- epsilon, with at least 10 rolls, and the second closest esperance is at least epsilon away.
    // maxExpectation = players[expecations.indexOf(Math.max(...expecations))]!;
    // const secondMaxExpectation = players[expecations.indexOf(Math.max(...expecations))]!;
    // minExpectation = players[expecations.indexOf(Math.min(...expecations))]!;
    // const secondMinExpectation = players[expecations.indexOf(Math.min(...expecations))]!;
    let minExpectation: number | null = null;
    let secondMinExpectation: number | null = null;
    let maxExpectation: number | null = null;
    let secondMaxExpectation: number | null = null;
    
    const total = sum(expecations);
    for(let playerId = 0; playerId < players.length; playerId++) {
        const player = players[playerId];
        if(minExpectation === null || expecations[playerId]! < expecations[minExpectation]!) {
            secondMinExpectation = minExpectation;
            minExpectation = playerId;
        } else if(secondMinExpectation === null || expecations[playerId]! < expecations[secondMinExpectation]!) {
            secondMinExpectation = playerId;
        }
        if(maxExpectation === null || expecations[playerId]! > expecations[maxExpectation]!) {
            secondMaxExpectation = maxExpectation;
            maxExpectation = playerId;
        } else if(secondMaxExpectation === null || expecations[playerId]! > expecations[secondMaxExpectation]!) {
            secondMaxExpectation = playerId;
        }
    }
    if(minExpectation !== null && secondMinExpectation !== null && maxExpectation !== null && secondMaxExpectation !== null) {
        titles[players[minExpectation]!.id]!.push(new Title(Titles["diceRolled"][0]!, Math.abs(minExpectation! - secondMinExpectation!) / Math.max(1, total)));
        titles[players[maxExpectation]!.id]!.push(new Title(Titles["diceRolled"][1]!, Math.abs(maxExpectation! - secondMaxExpectation!) / Math.max(1, total)));
    }
    
        // if(minExpectation === player)
        //     titles[player.id]!.push(Titles.diceRolled[0]!);
        // if(maxExpectation === player)
        //     titles[player.id]!.push(Titles.diceRolled[1]!);
    for(const stat of Object.keys(players[0]!.stats) as (keyof PlayerStats)[]) {
        if(stat === "nbNonAttackRolledValues" || stat === "nbAttackRolledValues" || stat === "json") {
            continue;
        }
        let min: Player | null = null;
        let secondMin: Player | null = null;
        let max: Player | null = null;
        let secondMax: Player | null = null;
        const total = players.reduce((acc, p) => acc + p.stats[stat], 0);
        const mean = total / players.length;
        for(const player of players) {
            if(min === null || player.stats[stat] < min.stats[stat]) {
                secondMin = min;
                min = player;
            } else if(secondMin === null || player.stats[stat] < secondMin.stats[stat]) {
                secondMin = player;
            }
            if(max === null || player.stats[stat] > max.stats[stat]) {
                secondMax = max;
                max = player;
            } else if(secondMax === null || player.stats[stat] > secondMax.stats[stat]) {
                secondMax = player;
            }
        }
        titles[min!.id]!.push(new Title(Titles[stat][0]!, Math.abs(min!.stats[stat] - secondMin!.stats[stat]) / Math.max(1, total)));
        titles[max!.id]!.push(new Title(Titles[stat][1]!, Math.abs(max!.stats[stat] - secondMax!.stats[stat]) / Math.max(1, total)));
    }
    for (const player of players) {
        if(titles[player.id]!.length === 0)
            titles[player.id]!.push(new Title(toSerializedTranslation("title.average"), 0));
        titles[player.id] = titles[player.id]!.sort((a, b) => b.distanceWithNormalizedMean - a.distanceWithNormalizedMean);
    }
    for(const player of players) {
        for(const title of titles[player.id]!) {
            console.log(`Player ${player.id} has title ${title.name.key} with distance ${title.distanceWithNormalizedMean}`);
        }
    }
    return titles;
}

export function getMainTitle(players: Player[]): Record<string, SerializedTranslation> {
    const titles = getTitles(players);
    const res:Record<string, SerializedTranslation>  = {};
    for(const player of players) {
        shuffle<Title>(Math.random, titles[player.id]!);
        titles[player.id] = titles[player.id]!.sort((a, b) => b.distanceWithNormalizedMean - a.distanceWithNormalizedMean);
        res[player.id] = titles[player.id]![0]!.name;
    }
    return res;
}