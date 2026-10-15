// A room effect is an effect that is applied by a room card.


import { Game } from "../game";
import { GameError } from "@/models/GameError";
import { EffectData, type AsyncEffectFunction, type EffectFunction, type SyncEffectFunction } from "../types/cardTypes";
import { Player } from "../entities/player";
import { Card, LootCard, MonsterCard, TreasureCard, ItemCard } from "../cards";
import type { OnAttackDeclaredTopDeckData, OnDamageTakenData, OnDeathMonsterData } from "../types/eventTypes";
import { flushMonsterSlotsEffect, flushShopEffect } from "./activeEffect";
import { addPassiveEffectToStack } from "./passiveEffect";
import { visibleItemSelector } from "../targetSelector";
import { Monster } from "../entities/monster";
import { Entity } from "../entities/entity";
import { Animated } from "../entities/animated";
import type { DiceRoll } from "../stackElement";
import { toSerializedTranslation } from "@/utils/translation";

export function preventGainSoulsEffect(game: Game, issuerType: "all" | "issuer"): SyncEffectFunction {
    return (data: EffectData) => {
        let offGainSoulBefore: (() => void) | null = null;

        offGainSoulBefore = game.emitter.on("on:soul:gained:before", (eventData) => {
            const { eventIssuer, soul } = eventData;
            if(issuerType === "issuer" && eventIssuer !== data.issuer) return;
            if (soul) {
                eventData.soul = null;
            }
        });
        data.it.cleaners.push(() => {
            offGainSoulBefore?.();
            offGainSoulBefore = null;
        });
        return true;
    };
}

export function cancelAttackOnTopOfMonsterDeckEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
         let offAttack: (() => void) | null = null;
        // Listen for the next damage event on this player
        offAttack = game.emitter.on("on:attack:declared:topdeck", (eventData: OnAttackDeclaredTopDeckData) => {
            const { eventIssuer, drawInIndex } = eventData;
            if(eventIssuer !== game.currentPlayer) {
                return; // Not the current player, ignore
            }
            // Create the effect that will execute when the stack resolves
            const effect = async (effectData: EffectData): Promise<boolean> => {
                const selection = await effectData.selectAndRecord(game, game.currentPlayer, 0, 1, [data.it], toSerializedTranslation("pending.doYouWantToCancelAttack"), data.serializedCardAndBox, false, true, false);
                if (selection.selected.length > 0) {
                    game.entityHandler.endCombat();
                }
                return true;
            };
            
            // Add to stack instead of executing immediately
            addPassiveEffectToStack(game, effect, data, "You may cancel your top deck attack.");
        });
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offAttack?.();
            offAttack = null;
        });
        return true;
    };
}

export function otherPlayersAreAttackableEffect(game: Game, evasion: number, onlyIssuer: boolean = false, condition: (player: Player) => boolean = ()=>true): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        let offTurnEnd: (() => void) | null = null;
        if(!onlyIssuer || game.currentPlayer === data.issuer)
            for(const player of game.players) {
                if(player !== game.currentPlayer && condition(player)) {
                    game.entityHandler.makePlayerAttackable(player, evasion);
                }
            }
        game.entityHandler.makePlayerUnattackable(game.currentPlayer);

        offTurnStart = game.emitter.on("on:turn:start", (eventData) => {
            if(onlyIssuer && eventData.eventIssuer !== data.issuer) return;
            for(const player of game.players) {
                if(player !== game.currentPlayer && condition(player)) {
                    game.entityHandler.makePlayerAttackable(player, evasion);
                }
            }
            game.entityHandler.makePlayerUnattackable(game.currentPlayer);
        });
        if(onlyIssuer)
        {
            offTurnEnd = game.emitter.on("on:turn:end", (eventData) => {
                if(eventData.eventIssuer !== data.issuer) return;
                for(const player of game.players)
                    game.entityHandler.makePlayerUnattackable(player);
            });
        }
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
            offTurnEnd?.();
            offTurnEnd = null;
            for(const player of game.players) {
                game.entityHandler.makePlayerUnattackable(player);
            }
        });
        return true;
    }
}

export function giveDeathPenaltyItemToActivePlayerEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDeath: (() => void) | null = null;
        offDeath = game.emitter.on("on:death:penalty", (eventData) => {
            const { eventIssuer, itemsLost } = eventData;
            // // check if the receiver of the death penalty is a player, and not the active player.
            if(eventIssuer === game.currentPlayer || !(eventIssuer instanceof Player)) {
                return; // Not the current player or not a player, ignore
            }
            if(game.currentPlayer.attackedIdsThisTurn.includes(eventIssuer.id)) {
                for(const item of itemsLost) {
                    game.cardHandler.removeInPlay(eventIssuer, item);
                    game.cardHandler.addInPlay(game.currentPlayer, item);
                }
                eventData.itemsLost = []; // Clear the items lost as they are now given to the active player instead of being lost
            }
        });
        
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDeath?.();
            offDeath = null;
        });
        return true;
    };
}

export function gainCoinsAtStartOfTurnEffect(game: Game, coins: number, anyPlayer: boolean): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        offTurnStart = game.emitter.on("on:turn:start", (eventData) => {
            const { eventIssuer } = eventData;
            if(!anyPlayer && eventIssuer !== game.currentPlayer) {
                return; // Not the current player, ignore
            }
            game.gainCoins(game.currentPlayer, coins, data.it);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function cheaperShopItemsEffect(game: Game, discount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        let offEndTurn: (() => void) | null = null;
        game.currentPlayer.priceModifier -= discount;
        let active: boolean = true;
        offTurnStart = game.emitter.on("on:turn:start", (eventData) => {
            if(active) return;
            active = true;
            game.currentPlayer.priceModifier -= discount;
        });

        offEndTurn = game.emitter.on("till:turn:end", (eventData) => {
            if(!active) return;
            active = false;
            game.currentPlayer.priceModifier += discount;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
            offEndTurn?.();
            offEndTurn = null;
            game.currentPlayer.priceModifier += discount;
            active = false;

        });
        return true;
    };
}

export function lookAtTopNOnAttackEffect(game: Game, n: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offAttack: (() => void) | null = null;
        offAttack = game.emitter.on("on:attack:declared", (eventData) => {
            const { eventIssuer } = eventData;
            if(eventIssuer !== game.currentPlayer) {
                return; // Not the current player, ignore
            }
            const effect = async (effectData: EffectData): Promise<boolean> => { 
                const topN = game.decks.monster.drawSeveral(n);
                const order = (await data.selectAndRecord(game, game.currentPlayer, n, n, topN, toSerializedTranslation("pending.lookAtTopCardsOfMonsterDeck", { value: n }), data.serializedCardAndBox, false, false)).selected as MonsterCard[];
                for(let i = order.length - 1; i >= 0; i--) {
                    game.decks.monster.addTopPosition(order[i]!);
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `Look at the top ${n} cards of the monster deck and put them back in any order.`);
            // The selectAndRecord function will handle the reordering and putting back of the cards.
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offAttack?.();
            offAttack = null;
        });
        return true;
    };
}

export function doubleRewardsEffect(game: Game): SyncEffectFunction {

    return (data: EffectData) => {
        let offDeath: (() => void) | null = null;
        
        offDeath = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
            
            // Add all effects as a single stack element
            const effect = (effectData: EffectData): boolean => {
                game.entityHandler.entityRewards(eventData.eventIssuer as Monster);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `Double rewards.`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDeath?.();
            offDeath = null;
        });
        return true;
    };
}

export function activePlayerMustAttackTopDeck(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        game.entityHandler.playerMustAttack(game.currentPlayer, "topDeck", data.it, true);
        let init: Player | null = game.currentPlayer;

        offTurnStart = game.emitter.on("on:turn:start", (eventData) => {
            if(init === eventData.eventIssuer)
                return;
            init = null;
            game.entityHandler.playerMustAttack(game.currentPlayer, "topDeck", data.it, true);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            init = null;
            game.currentPlayer.clearAttackRequirementsFromSource(data.it);
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function activePlayerMustAttackAdditionalTimeEffect(game: Game): SyncEffectFunction {
     return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        game.entityHandler.playerMustAttack(game.currentPlayer, "any", data.it, false);
        let init: Player | null = game.currentPlayer;

        offTurnStart = game.emitter.on("on:turn:start", (eventData) => {
            if(init === eventData.eventIssuer)
                return;
            init = null;
            game.entityHandler.playerMustAttack(game.currentPlayer, "any", data.it, false);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            init = null;
            game.currentPlayer.clearAttackRequirementsFromSource(data.it);
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function gainCoinsOnPlayerDeathEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offDeath: (() => void) | null = null;
        offDeath = game.emitter.on("on:death:before-penalty", (eventData) => {
            const { eventIssuer } = eventData;
            for(const player of game.players) {
                if(player !== eventIssuer) {
                    game.gainCoins(player, amount, data.it);
                }
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDeath?.();
            offDeath = null;
        });
        return true;
    };
}


export function lootOnPlayerDeathEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offDeath: (() => void) | null = null;
        offDeath = game.emitter.on("on:death:before-penalty", (eventData) => {
            const { eventIssuer } = eventData;
            for(const player of game.players) {
                if(player !== eventIssuer) {
                    game.loot(player, amount);
                }
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDeath?.();
            offDeath = null;
        });
        return true;
    };
}

export function takeDamageOnLootEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offLoot: (() => void) | null = null;
        offLoot = game.emitter.on("on:loot:added:after", (eventData) => {
            const effect: SyncEffectFunction = (effectData: EffectData) => {
                game.entityHandler.dealDamage(eventData.eventIssuer, eventData.eventIssuer, data.cardAndBox, amount);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `Take ${amount} damage each time you loot.`); // Add the damage as a separate stack element to avoid issues with the loot event data being modified by other effects in the stack
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offLoot?.();
            offLoot = null;
        });
        return true;
    };
}

export function deactivateCharacterAtEndOfTurnEffect(game: Game): SyncEffectFunction {
     return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        offTurnStart = game.emitter.on("on:turn:end", (eventData) => {
            const effect: SyncEffectFunction = (effectData: EffectData) => {
                game.cardHandler.deactivateItem(game.currentPlayer.character);
                return true;
            }
            addPassiveEffectToStack(game, effect, data, `Deactivate your character at the end of the turn.`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function loseCoinsAtEndOfTurnEffect(game: Game, amount: number): SyncEffectFunction {
     return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        offTurnStart = game.emitter.on("on:turn:end", (eventData) => {
            game.loseCoins(game.currentPlayer, amount, true, "effect");
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function monstersGainAttackEffect(game: Game, amount: number, includeSelf: boolean): SyncEffectFunction {
    return (data: EffectData) => {
        game.entityHandler.addAttackToEachMonster(data.issuer as Entity, amount, data.it);
        if(!includeSelf) {
            (data.issuer as Monster).addEvasion(-amount);
        }
        data.it.cleaners.push(() => {
            game.entityHandler.addAttackToEachMonster(data.issuer as Entity, -amount, data.it);
            if(!includeSelf) {
            (data.issuer as Monster).addEvasion(amount);
        }
        });
        return true;
    };
}

export function targetNextKillsAnotherPlayerEffect(game: Game): SyncEffectFunction {
    return  (data: EffectData) => {
        const killer = data.next as Player;
        if(!killer || !(killer instanceof Player))
            return false;
        if(game.players.filter(p => p !== killer && p.isDead == false).length === 0)
            return false; // No valid targets to kill
        const effect: AsyncEffectFunction = async (effectData: EffectData) => {
            if(!killer || !(killer instanceof Player))
                return false;
            if(game.players.filter(p => p !== killer && p.isDead == false).length === 0)
                return false; // No valid targets to kill
            const selected = (await data.selectAndRecord(game, killer, 1, 1, game.players.filter(p => p !== killer && p.isDead == false), toSerializedTranslation("pending.playerToKill"), data.serializedCardAndBox, true, true)).selected[0]! as Player;
            game.entityHandler.kill(killer, selected, data.cardAndBox);
            return true;
        };
        addPassiveEffectToStack(game, effect, data, "Select a player to kill.");
        return true;
    };
}

export function mayRerollItemAtStartOfTurnEffect(game: Game): SyncEffectFunction {
     return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        offTurnStart = game.emitter.on("on:turn:start", (eventData) => {
            const effect: AsyncEffectFunction = async (effectData: EffectData) => {
                const selected = (await effectData.selectAndRecord(game, game.currentPlayer, 0, 1, game.cardHandler.inPlayTargetableCards(game.currentPlayer), toSerializedTranslation("pending.mayRerollItem"), data.serializedCardAndBox, false)).selected[0] as ItemCard | undefined;
                if(selected) {
                    game.cardHandler.reroll(selected);
                    return true;
                }
                return false;
            };
            addPassiveEffectToStack(game, effect, data, "You may reroll an item you control.");
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function mayGainTreasureAtStartOfTurnEffect(game: Game, x: number): SyncEffectFunction {
     return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        offTurnStart = game.emitter.on("on:turn:start", (eventData) => {
            const effect: AsyncEffectFunction = async (effectData: EffectData) => {
                const selected = (await effectData.selectAndRecord(game, game.currentPlayer, 0, 1, [data.it],  toSerializedTranslation("pending.mayGainTreasure", { value: x }), data.serializedCardAndBox, false, true, false)).selected[0] as ItemCard | undefined;
                if(selected !== undefined) {
                    game.gainTreasure(game.currentPlayer, x);
                    return true;
                }
                return false;
            };
            addPassiveEffectToStack(game, effect, data, "You may gain a treasure.");
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function damageIfLowLootAtEndOfTurnEffect(game: Game, lootThreshold: number, amount: number): SyncEffectFunction {
     return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        offTurnStart = game.emitter.on("on:turn:end", (eventData) => {
            const effect: SyncEffectFunction = (effectData: EffectData) => {
                if(game.currentPlayer.hand.length > lootThreshold) return false;
                game.entityHandler.dealDamage(game.currentPlayer, game.currentPlayer, data.cardAndBox, amount);
                return false;
            };
            addPassiveEffectToStack(game, effect, data, "You may gain a treasure.");
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function putThisIntoDiscardAtEndOfTurnEffect(game: Game): SyncEffectFunction {
     return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        offTurnStart = game.emitter.on("on:turn:end", (eventData) => {
            game.cardHandler.discard(data.it);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function discardHandsAndLootEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        for(const player of game.players)
        {
            const handSize = player.hand.length;
            let success = true;
            for(let i = 0; i < handSize; i++) {
                success = game.cardHandler.discardFromHandAtIndex(player, 0, "effect") && success;
            }
            if(success)
                game.loot(player, amount);
        }
        return true;
    };
}

export function enterPlayRerollItemsDiscardHandsLootAndFlushMonstersEffect(game: Game, lootAmount: number): SyncEffectFunction {
    return (data: EffectData) => {
        flushMonsterSlotsEffect(game, "discard")(data);
        discardHandsAndLootEffect(game, lootAmount)(data);
        for(const item of visibleItemSelector((c, p) => c.eternal === false, false, game)(data.issuer as Player, data.it)) {
            game.cardHandler.reroll(item);
        }
        return true;
    };
}

export function eachPlayerGainsCoinsEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offGainCoins: (() => void) | null = null;
        offGainCoins = game.emitter.on("on:coin:gained:after", (eventData) => {
            const { eventIssuer, coinGained, source } = eventData;
            if(source === "gift") return;
            if(source === data.it || (source.slug === "fsp2-magnet" && source.slug != data.it.slug))
                return; // Prevent infinite loop if the coin gain is caused by this effect
            for(const player of game.players) {
                if(player !== eventIssuer) {
                    game.gainCoins(player, coinGained[0]!, data.it);
                }
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offGainCoins?.();
            offGainCoins = null;
        });
        return true;
    };
}

export function discardHandIfNoShopPurchaseAtEndOfTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offEndTurn: (() => void) | null = null;
        let offPurchase: (() => void) | null = null;
        let purchaseMade = false;

        offEndTurn = game.emitter.on("on:turn:end", (eventData) => {
            const { eventIssuer } = eventData;
            if(eventIssuer !== game.currentPlayer) {
                return; // Not the current player, ignore
            }
            if(!purchaseMade) {
                const handSize = game.currentPlayer.hand.length;
                for(let i = 0; i < handSize; i++) {
                    game.cardHandler.discardFromHandAtIndex(game.currentPlayer, 0, "effect");
                }
            }
            purchaseMade = false; // Reset for next turn
        });

        offPurchase = game.emitter.on("on:purchase:success", (eventData) => {
             const { eventIssuer, index } = eventData;
             if(eventIssuer === game.currentPlayer && index !== "top") {
                purchaseMade = true;
             }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offEndTurn?.();
            offEndTurn = null;
            offPurchase?.();
            offPurchase = null;
        });
        return true;
    };
}

export function skipNextTurnOnSoulGainEffect(game: Game): SyncEffectFunction {

    return (data: EffectData) => {
        let offGainSoul: (() => void) | null = null;
        offGainSoul = game.emitter.on("on:soul:gained", (eventData) => {
            const { eventIssuer, soul } = eventData;
            game.turnHandler.skipNextTurn(eventIssuer as Player);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offGainSoul?.();
            offGainSoul = null;
        });
        return true;
    };
}

export function canBeAttackedEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const card = data.it;
        if(card.json.stats === undefined)
        {
            throw new GameError("Expected card stats to be defined for canBeAttackedEffect.",
                toSerializedTranslation("error.behaviorError", { error: "Expected card stats to be defined for canBeAttackedEffect." })
            );
        }
        const { healthPoints, attackPoints, evasionPoints } = card.json.stats;
        if(healthPoints === undefined || attackPoints === undefined || evasionPoints === undefined)
            throw new GameError("Expected all card stats to be defined for canBeAttackedEffect.",
                toSerializedTranslation("error.behaviorError", { error: "Expected all card stats to be defined for canBeAttackedEffect." })
            );
        card.entity = new Animated(card, card.slug, attackPoints, healthPoints, evasionPoints);
        card.entity.attackable = true;
        game.entityHandler.addAnimated(card.entity as Animated);
        card.cleaners.push(() => {
            if(!card.entity) return;
            game.entityHandler.removeAnimated(card.entity as Animated);
            card.entity!.attackable = false;
            card.entity = undefined;
        });
        return true;
    };
}

export function makeAnAttackRollAfterEachAttackRollEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offAttackRolled: (() => void) | null = null;
        let offCombatEnd: (() => void) | null = null;
        // console.log("Registering makeAnAttackRollAfterEachAttackRollEffect for", data.it.name, " current player:", game.currentPlayer.id, " issuer:", data.issuer.id);
        offAttackRolled = game.emitter.on("on:attack:roll", (eventData) => {
            if(eventData.eventIssuer.isEngagedInCombat === false || eventData.eventIssuer.isDead) {
                return; // Not the current player, ignore
            }
            const target = eventData.dice.attackTarget;
            if(eventData.eventIssuer !== game.currentPlayer) {
                return; // Not the current player, ignore
            }
            if(target.isEngagedInCombat === false || target.isDead) {
                return; // Target is not engaged in combat or is dead, ignore
            }
            if(data.issuer === game.currentPlayer)
                throw new GameError("Expected issuer to not be the active player for makeAnAttackRollAfterEachAttackRollEffect.",
                    toSerializedTranslation("error.behaviorError", { error: "Expected issuer to not be the active player for makeAnAttackRollAfterEachAttackRollEffect." })
                );
            if(data.issuer.isDead)
                return; // Dead, ignore
            const effect: SyncEffectFunction = (effectData: EffectData) => {
                if(data.issuer.isDead || target.isEngagedInCombat === false || target.isDead)
                    return false; // Dead, ignore
                if(effectData.issuer instanceof Player === false)
                    throw new GameError("Expected issuer to be a player for makeAnAttackRollAfterEachAttackRollEffect.",
                        toSerializedTranslation("error.behaviorError", { error: "Expected issuer to be a player for makeAnAttackRollAfterEachAttackRollEffect." })
                    );
                    game.actions.attackRoll(effectData.issuer, target);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, "You must make an attack roll against this after each attack roll the active player makes this attack.");
        });

        offCombatEnd = game.emitter.on("on:combat:end", (eventData) => {
            offAttackRolled?.();
            offAttackRolled = null;
            offCombatEnd?.();
            offCombatEnd = null;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offAttackRolled?.();
            offAttackRolled = null;
            offCombatEnd?.();
            offCombatEnd = null;
        });
        return true;
    };
}

export function playerMustDestroyItemOnDeathEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offAttackDeclared: (() => void) | null = null;
        offAttackDeclared = game.emitter.on("on:death:before-penalty", (eventData) => {
            const { eventIssuer  } = eventData;
            if(eventIssuer instanceof Player === false)
                return;
            const effect: AsyncEffectFunction = async (effectData: EffectData) => {
                const selected = (await effectData.selectAndRecord(game, eventIssuer as Player, 1, 1, game.cardHandler.inPlayTargetableCards(eventIssuer as Player), toSerializedTranslation("pending.destroyItem"), data.serializedCardAndBox, false)).selected[0] as ItemCard | undefined;
                if(selected) {
                    game.cardHandler.destroyCardsOrSouls([selected])
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, "You must destroy an item you control.");
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offAttackDeclared?.();
            offAttackDeclared = null;
        });
        return true;
    };
}

export function onAttackDeclaredNonActivePlayersRollToJoinEffect(game: Game, minRoll: number, maxRoll: number): SyncEffectFunction {
    return (data: EffectData) => {
        const rolls:DiceRoll[] = [];
        for(const player of game.players) {
            if(player !== game.currentPlayer && !player.isDead) {
                const roll = game.rollDice(player, data.it);
                roll.attachEffect(
                    [1,2,3,4,5,6].map(value => 
                        (value >= minRoll && value <= maxRoll && data.issuer.isEngagedInCombat) ?
                            makeAnAttackRollAfterEachAttackRollEffect(game) : ((): boolean => true)
                    )
                    , data.it, [], player);
                rolls.push(roll);
            }
        }
        let offCombatEnd: (() => void) | null = null;
        offCombatEnd = game.emitter.on("on:combat:end", (eventData) => {
            rolls.forEach(roll => game.stack.cancelElement(roll));
            offCombatEnd?.();
            offCombatEnd = null;
        });
        return true;
    };
}

export function rerollOnXOrYEffect(game: Game, values: number[]): SyncEffectFunction {
    return (data: EffectData) => {
        let offRoll: (() => void) | null = null;
        offRoll = game.emitter.on("on:dice:would-roll", (eventData) => {
            data.targets = []; // Clear targets to prevent other effects from modifying the roll
            data.clearSelectionRecord(); // Clear selection record to prevent other effects from modifying the roll
            const { eventIssuer, diceRoll } = eventData;
            if(values.includes(diceRoll.value)) {
                const effect: AsyncEffectFunction = async (effectData: EffectData) => {
                    const selected = (await effectData.selectAndRecord(game, game.currentPlayer, 0, 1, [data.it], toSerializedTranslation("pending.doYouWantToReroll"), data.serializedCardAndBox, false, true, false)).selected[0] as Card | undefined;
                    if(selected) {
                        diceRoll.roll();
                        return true;
                    }
                    return false;
                };
                addPassiveEffectToStack(game, effect, data, "You rolled a " + values[0] + " or a " + values[1] + ". Do you want to reroll?");
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offRoll?.();
            offRoll = null;
        });
        return true;
    };
}


// REPLACEMENT EFFECT: Continuous stat modification - does not use the stack.
export function allPlayersPermanentStatModifierEffect(
    adders: ((player: Player, value: number, source: Card) => void)[],
    amount: number,
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        if (amount < 0)
            throw new GameError("allPlayersPermanentStatModifierEffect amount must be non-negative.",
                toSerializedTranslation("error.behaviorError", { error: "allPlayersPermanentStatModifierEffect amount must be non-negative." })
            );
        // Apply the stat modification
        for(const player of game.players) 
            for (const adder of adders)
                adder(player, amount, data.it);

        data.it.cleaners.push(() => {
            for(const player of game.players) 
                for (const adder of adders)
                    adder(player, -amount, data.it);
        });

        return true;
    };
}
export function payHpForTreasureBoostEffect(game: Game, hpAfterPay: number, treasureAmount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        offTurnStart = game.emitter.on("on:turn:start", (eventData) => {
            const effect: AsyncEffectFunction = async (effectData: EffectData) => {
                const difference = Math.max(0, game.currentPlayer.currentHealthPoints - hpAfterPay);
                const selected = (await effectData.selectAndRecord(game, game.currentPlayer, 0, 1, [data.it], toSerializedTranslation("pending.hpToGainTreasure", { value: difference }), data.serializedCardAndBox, false, true, false)).selected[0] as Card | undefined;
                if(selected !== undefined) {
                    game.entityHandler.dealDamage(game.currentPlayer, game.currentPlayer, data.cardAndBox, difference, (data: EffectData) => {
                        let offMonsterDeath: (() => void) | null = null;
                        offMonsterDeath = game.emitter.on("on:death:monster", (eventData) => {
                             const { eventIssuer } = eventData;
                             if(eventIssuer instanceof Monster) {
                                 game.gainTreasure(game.currentPlayer, treasureAmount);
                             }
                        });
                        data.it.cleaners.push(() => {
                            offMonsterDeath?.();
                            offMonsterDeath = null;
                        });
                        return true
                    }); 
                    return true;
                }
                return false;
            };
            addPassiveEffectToStack(game, effect, data, "You can pay " + (game.currentPlayer.currentHealthPoints - 1) + " HP to gain a treasure each time a monster dies this turn. Do you want to?");
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function WhenDealDamageMonsterDealDamageToPlayerToTheEffect(game: Game, amount: number, direction: "left" | "right"): SyncEffectFunction {
    return (data: EffectData) => {
        let offDealDamage: (() => void) | null = null;
        offDealDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target, damage } = eventData;
            if(eventIssuer instanceof Monster && damage > 0 && target instanceof Player ) {
                const effect: SyncEffectFunction = (effectData: EffectData) => {
                    game.entityHandler.dealDamage(target, game.turnHandler.getPlayerTo(target, direction), data.cardAndBox, amount);
                    return true;
                };
                addPassiveEffectToStack(game, effect, data, `When a monster takes damage, the player to their ${direction} also takes ${amount} damage.`);
            }
        });
        data.it.cleaners.push(() => {
            offDealDamage?.();
            offDealDamage = null;
        });
        return true;
    };
}

export function playersWithFewestSoulsAttackBoostEffect(game: Game, attackBoost: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        let offSoulGained: (() => void) | null = null;
        let playersWithFewestSouls: Player[] = [];
        let shouldAddAttackThisTurn = true;
        function computeEffect(): void {
            const minSouls = Math.min(...game.players.map(p => p.totalSouls));
            playersWithFewestSouls = game.players.filter(p => p.totalSouls === minSouls);
            for(const player of playersWithFewestSouls) 
            {
                game.entityHandler.addAttack(player, attackBoost, data.it);
            }
            if(playersWithFewestSouls.includes(game.currentPlayer) && shouldAddAttackThisTurn)
                game.currentPlayer.attackThisTurn += 1;
        }
        function removeEffect(): void {
            for(const player of playersWithFewestSouls) 
            {
                game.entityHandler.addAttack(player, -attackBoost, data.it);
            }
            if(playersWithFewestSouls.includes(game.currentPlayer))
            {
                if(game.currentPlayer.attackThisTurn > 0)
                    game.currentPlayer.attackThisTurn -= 1;
                else
                    shouldAddAttackThisTurn = false;
            }
        }
        computeEffect();
        offTurnStart = game.emitter.on("on:turn:start", (eventData) => {
            if(playersWithFewestSouls.includes(game.currentPlayer))
            {
                game.currentPlayer.attackThisTurn += 1;
                shouldAddAttackThisTurn = true;
            }
        });
        offSoulGained = game.emitter.on("on:soul:gained", (eventData) => {
            removeEffect();
            computeEffect();
        });
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
            offSoulGained?.();
            offSoulGained = null;
            removeEffect();
        });
        return true;
    };
}

export function playersWithFewestSoulsShopItemPriceReductionEffect(
    game: Game,
    finalPrice: number,
): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        let offPurchase: (() => void) | null = null;
        let offTurnEnd: (() => void) | null = null;
        let offSoulGained: (() => void) | null = null;
        let offSoulRemoved: (() => void) | null = null;

        let canUseFreePurchase = true;
        // let effectApplied = false;
        let appliedReduction = 0;
        let playerItIsAppliedTo: Player | null = null;

        function currentPlayerHasFewestSouls(): boolean {
            const minSouls = Math.min(
                ...game.players.map(player => player.totalSouls),
            );

            return game.currentPlayer.totalSouls === minSouls;
        }

        function removeEffect(): void {
            if (!playerItIsAppliedTo) {
                return;
            }
            
            playerItIsAppliedTo.priceModifier += appliedReduction;

            playerItIsAppliedTo = null;
            // effectApplied = false;
            appliedReduction = 0;
        }

        function applyEffect(): void {
            // Idempotent: safe after turn-start, soul-gain, or initialization.
            removeEffect();

            if (!canUseFreePurchase || playerItIsAppliedTo !== null || !currentPlayerHasFewestSouls()) {
                return;
            }
            appliedReduction = game.shop.shopPrice - finalPrice;

            playerItIsAppliedTo = game.currentPlayer;
            playerItIsAppliedTo.priceModifier -= appliedReduction;
        }

        offPurchase = game.emitter.on("on:purchase:success", eventData => {
            const { eventIssuer, index } = eventData;

            const isShopItemPurchase = index !== "top";

            if (
                eventIssuer === game.currentPlayer &&
                isShopItemPurchase &&
                playerItIsAppliedTo !== null
            ) {
                // Consume the effect before later events can reapply it.
                canUseFreePurchase = false;
                removeEffect();
            }
        });

        offTurnStart = game.emitter.on("on:turn:start", () => {
            // The once-per-turn allowance becomes available only here.
            canUseFreePurchase = true;
            applyEffect();
        });

        offTurnEnd = game.emitter.on("on:turn:end", () => {
            removeEffect();
        });

        offSoulGained = game.emitter.on("on:soul:gained", () => {
            applyEffect();
        });

        offSoulRemoved = game.emitter.on("on:soul:removed", () => {
            applyEffect();
        });

        // Cover the case where the card becomes active mid-turn.
        applyEffect();

        data.it.cleaners.push(() => {
            removeEffect();

            offTurnStart?.();
            offTurnStart = null;

            offPurchase?.();
            offPurchase = null;

            offTurnEnd?.();
            offTurnEnd = null;

            offSoulGained?.();
            offSoulGained = null;

            offSoulRemoved?.();
            offSoulRemoved = null;
        });

        return true;
    };
}

/**
 * this room can't be put into discard till 4 goals are completed.
 * 
 *   - play 5 loot cards.
 *   - kill 3 monsters.
 *   - give at least 6¢ to another player at one time.
 *   - purchase 3 items.
 *   - roll a 6 three times. 
 * 
 * when 4 goals are completed, each player gains +2 treasure.
 */
export function socialGoalsEffect(game: Game, numbers: number[]): SyncEffectFunction {
    if(numbers.length < 13) {
        throw new GameError("Expected 13 numbers for socialGoalsEffect, got " + numbers.length,
            toSerializedTranslation("error.parsingError", { error: "Expected 13 numbers for socialGoalsEffect, got " + numbers.length })
        );
    }
    const discardObjective = numbers[0]!;
    const goalsLoot = numbers[2]!;
    const goalsMonster = numbers[4]!;
    const goalsDonation = numbers[6]!;
    const goalsPurchase = numbers[8]!;
    const goalsRoll = numbers[10]!;
    const goalsObjective = numbers[11]!;
    const nbTreasure = numbers[12]!;

    return (data: EffectData) => {
        data.it.canBeDiscarded = false; // Prevent the card from being discarded until goals are completed
        data.it.counters.reset("normal"); // Note that the counter is only there for display purposes.
        let sixCoinGiven: boolean = false;
        let lootPlayed = 0;
        let monstersKilled = 0;
        let itemsPurchased = 0;
        let sixesRolled = 0;
        const tests = [
            (): boolean => lootPlayed >= goalsLoot, 
            (): boolean => monstersKilled >= goalsMonster, 
            (): boolean => sixCoinGiven, 
            (): boolean => itemsPurchased >= goalsPurchase, 
            (): boolean => sixesRolled >= 3];
        let goalsCompleted = 0;

        function tryResolve(): void {
            data.it.counters.reset("normal");
            for(let i = 0; i < tests.length; i++) {
                if(tests[i]!()) {
                    goalsCompleted++;
                    // game.cardHandler.addToCounter(game.currentPlayer, data.it, "normal", 1);
                    tests[i] = (): boolean => false; // Mark this goal as completed to prevent it from being counted multiple times
                }
            }
            game.cardHandler.addToCounter(game.currentPlayer, data.it, "normal", goalsCompleted);
            if(goalsCompleted >= discardObjective)
                data.it.canBeDiscarded = true; 
            if(goalsCompleted >= goalsObjective)
            {
                for(const player of game.players) {
                    game.gainTreasure(player, nbTreasure);
                }
                data.it.canBeDiscarded = true; 
                game.cardHandler.discard(data.it);
            }
        }
        
        tryResolve()

        let offLootPlayed: (() => void) | null = null;
        let offMonsterKilled: (() => void) | null = null;
        let offPurchase: (() => void) | null = null;
        let offRoll: (() => void) | null = null;
        let offDonation: (() => void) | null = null;

        offLootPlayed = game.emitter.on("on:loot:added:after", (eventData) => {
            lootPlayed++;
            tryResolve();
        });

        offMonsterKilled = game.emitter.on("on:death:monster", (eventData) => {
            monstersKilled++;
            tryResolve();
        });

        offPurchase = game.emitter.on("on:purchase:success", (eventData) => {
            itemsPurchased++;
            tryResolve();
        });

        offRoll = game.emitter.on("on:dice:resolved", (eventData) => {
            const { dice } = eventData;
            if(dice.value === goalsRoll) {
                sixesRolled++;
                tryResolve();
            }
        });

        offDonation = game.emitter.on("on:coin:given", (eventData) => {
            const { eventIssuer, amount, target } = eventData;
            if(amount >= goalsDonation) {
                sixCoinGiven = true;
                tryResolve();
            }
        });

        data.it.cleaners.push(() => {
            data.it.canBeDiscarded = true;
            offLootPlayed?.();
            offLootPlayed = null;
            offMonsterKilled?.();
            offMonsterKilled = null;
            offPurchase?.();
            offPurchase = null;
            offRoll?.();
            offRoll = null;
            offDonation?.();
            offDonation = null;
        });

        return true;
    }
}

export function playersCanOnlyActivateOnceATurn(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offActivate: (() => void) | null = null;
        let offStartTurn: (() => void) | null = null;
        let playersWhoActivatedThisTurn: Player[] = [];

        offStartTurn = game.emitter.on("on:turn:start", (eventData) => {
            playersWhoActivatedThisTurn = [];
        });
        offActivate = game.emitter.on("on:card:activated", (eventData) => {
            const { eventIssuer } = eventData;
            eventIssuer.addToCanIActivateThisTurn(1);
            playersWhoActivatedThisTurn.push(eventIssuer);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offActivate?.();
            offActivate = null;
            for(const player of playersWhoActivatedThisTurn) {
                player.addToCanIActivateThisTurn(-1);
            }
            offStartTurn?.();
            offStartTurn = null;
            playersWhoActivatedThisTurn = []
        });
        return true;
    };
}

export function playersCanOnlyPlayLootOnceATurn(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offPlayLoot: (() => void) | null = null;
        let offStartTurn: (() => void) | null = null;
        let playersWhoPlayedLootThisTurn: Player[] = [];

        offStartTurn = game.emitter.on("on:turn:start", (eventData) => {
            playersWhoPlayedLootThisTurn = [];
        });
        offPlayLoot = game.emitter.on("on:loot:played", (eventData) => {
            const { eventIssuer } = eventData;
            eventIssuer.addToCanIUseLootThisTurn(1);
            playersWhoPlayedLootThisTurn.push(eventIssuer);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offPlayLoot?.();
            offPlayLoot = null;
            for(const player of playersWhoPlayedLootThisTurn) {
                player.addToCanIUseLootThisTurn(-1);
            }
            offStartTurn?.();
            offStartTurn = null;
            playersWhoPlayedLootThisTurn = []
        });
        return true;
    };
}

export function payOtherPlayersToAttackEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offCanDeclareAttack: (() => void) | null = null;
        let offAttackDeclared: (() => void) | null = null;

        function getTaxForMostSoulsAttack(game: Game, player: Player, amount: number): number {
            const maxSoul = Math.max(...game.players.map(p => p.totalSouls));
            if (maxSoul === 0) {
                return 0;
            }
            if (player.totalSouls < maxSoul) {
                return 0;
            }
            return amount * Math.max(0, game.players.length - 1);
        }
        
        offCanDeclareAttack = game.emitter.on("on:can:declare:attack", (eventData) => {
            const { eventIssuer } = eventData;
            const requiredCoins = getTaxForMostSoulsAttack(game, eventIssuer, amount);
            if (requiredCoins === 0) {
                return;
            }
            if (eventIssuer.coins < requiredCoins) {
                eventData.canDeclare[0] = false;
                eventData.reason[0] = toSerializedTranslation("capability.paidAttack", { value: requiredCoins, coins: eventIssuer.coins });
                eventIssuer.clearAttackRequirement();
            }
        });

        offAttackDeclared = game.emitter.on("on:attack:declared", (eventData) => {
            const { eventIssuer } = eventData;
            const requiredCoins = getTaxForMostSoulsAttack(game, eventIssuer, amount);
            if (requiredCoins > 0)
            {
                const effect: SyncEffectFunction = (effectData: EffectData) => {
                    for(const player of game.players) {
                        if(player !== eventIssuer)
                            game.forceGiveCoins(eventIssuer, player, amount, data.it);
                    }
                    return true;
                };
                addPassiveEffectToStack(game, effect, data, `Pay each other player ${amount}¢ to attack.`);
            }
        });

        data.it.cleaners.push(() => {
            offCanDeclareAttack?.();
            offCanDeclareAttack = null;
            offAttackDeclared?.();
            offAttackDeclared = null;
        });

        return true;
    }
}