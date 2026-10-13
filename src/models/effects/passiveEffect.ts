import { type TriggerEvent } from '@/models/types/eventTypes';
import type { SerializedTranslation, TemporaryEffect, VisualEffectBox, CounterType } from "@/shared/api";
import { Card, ItemCard, LootCard, MonsterCard, TreasureCard } from "../cards";
import { DamageOnStack, DiceWillRoll, EffectOnStack, LootCardEffect } from '../stackElement';
import { Entity } from "../entities/entity";
import { Monster } from "../entities/monster";
import { Player } from "../entities/player";
import { Game } from "../game";
import { GameError } from "@/models/GameError";
import { DiceRoll } from "../stackElement";
import { TargetBuilder } from "../targetBuilder";
import { EffectData, type EffectFunction, type SyncEffectFunction, type AsyncEffectFunction, type TargetsSelector } from "../types/cardTypes";
import type {
    OnRollData,
    OnCardFlippedData,
    OnCoinGainedData,
    OnCoinsLostBeforeData,
    OnCounterModifiedData,
    OnCardDiscardBeforeData,
    OnDamageTakenData,
    OnDamageWouldTakeData,
    OnDeathAfterPenaltyData,
    OnDeathBeforePenaltyData,
    OnDeathMonsterData,
    OnDeathPenaltyData,
    OnDiceBeingRolledData,
    OnDiceWouldRollData,
    OnItemDestroyedData,
    OnItemGainedData,
    OnLootPlayedData,
    OnLootStepData,
    OnLootWouldData,
    OnLootWouldDiscardData,
    OnRechargeData,
    OnTurnEndData,
    OnTurnStartData,
    OnDeathWouldDeathData,
    OnAttackDeclaredMonsterData
} from "../types/eventTypes";
import * as active from "./activeEffect";
import { type ParsedEffect, type SyncParsedEffect } from "./parsing/effectParser";
import {selectPlayerOrMonster} from "@/models/effects/parsing/selectors.ts";
import { noTargetEffect } from './parsing/logicParsers';
import { toSerializedTranslation } from '@/utils/translation';

function getTemporaryEffect(data: EffectData): TemporaryEffect {
    return{
            card: data.it.jsonAPI,
            issuer: data.issuer.id,
            targets: TargetBuilder.convertToSelectionItems(data.targets),
            visualEffectBox: data.visualEffectBox
        };
}
export function addPassiveEffectToStack(
    game: Game,
    effectFunction: EffectFunction,
    data: EffectData,
    description: string,
    visualEffectBox?: VisualEffectBox
): number {
    const effectOnStack = new EffectOnStack(effectFunction, data, description, "passive", data.visualEffectBox);
    game.addAnimation({
        id: game.nextAnimationId,
        type: "activateInPlay",
        card: data.it.jsonAPI,
    });
    return game.addToStack(effectOnStack);
}

// REPLACEMENT EFFECT: Uses "prevent" - does not use the stack.
// Card text: "Prevent the next instance of up to X damage they would take this turn."
export function preventNextDamageUpToEffect(amount: number, game: Game): SyncEffectFunction {
    return (data:EffectData) => {
        let offDamage: (() => void) | null = null;
        let offTurn: (() => void) | null = null;
        const temp: TemporaryEffect = getTemporaryEffect(data);
        let target = data.peek();
        if(data.targets.length == 0)
            target = data.issuer;

        for(let i = game.stack.size - 1; i >= 0; i--)
            if(game.stack.elements[i] instanceof DamageOnStack)
            {
                const damageOnStack = game.stack.elements[i] as DamageOnStack;
                if(damageOnStack.damage[0]! <= 0)
                    continue;
                if( damageOnStack.receiver === target)
                {
                    const current = damageOnStack.damage[0] ?? 0;
                    const prevented = Math.min(current, amount);
                    damageOnStack.damage[0] = current - prevented;
                    return true;
                }
            }

        target.addTemporaryEffect(temp);

        const cleanup = (): void => {
            target.removeTemporaryEffect(temp);
            offDamage?.();
            offTurn?.();
            offDamage = null;
            offTurn = null;
        };

        // Listen for the next damage event on this player
        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, damageArray } = eventData;
            // let target = data.peek();
            // if(data.targets.length == 0)
            //     target = data.issuer;
            // const target = data.targets.length > 0 ? data.peek() : data.issuer;
            if (target !== eventIssuer) return;
            const current = damageArray[0] ?? 0;
            if( current <= 0) return false;
            const effect: EffectFunction = () => {
                const current = damageArray[0] ?? 0;
                if( current <= 0) return false;
                const prevented = Math.min(current, amount);
                damageArray[0] = current - prevented;
                cleanup(); // One-shot: remove listeners after first use
                return true;
            }
            addPassiveEffectToStack(game, effect, data, "", data.visualEffectBox);
        });

        // Expire at end of turn if unused
        offTurn = game.emitter.on("on:turn:end", cleanup);

        return true;
    };
}

export function preventDamageToCurrentPlayerAndDealToRandomPlayerEffect(game: Game, damage: number): SyncEffectFunction {
    return (data:EffectData) => {
        let offDamage: (() => void) | null = null;

        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, target } = eventData;
            if (data.issuer !== target) return;
            if(game.currentPlayer !== eventIssuer) return;
            const effect: EffectFunction = (effectData: EffectData) => {
                eventData.damageArray[0] = 0;
                const target = game.players[Math.floor(game.random() * game.players.length)]!;
                game.entityHandler.dealDamage(data.issuer, target, data.cardAndBox, damage);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, "When this would deal combat damage to the active player, prevent it, then this deals damage to a player chosen at random.");
        });

        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

/**
 *each living player votes either whip or whiff-
 * if whip wins, prevent the damage this would take and each non-active player takes x damage.
 * if whiff wins or there is a tie, the active player loots x.":
 * @param game 
 * @param damageIfWhipWins 
 * @param lootIfWhiffWins 
 * @returns 
 */

export function voteOnWhipOrWhiffEffect(game: Game, damageIfWhipWins: number, lootIfWhiffWins: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offWouldTakeDamage: (() => void) | null = null;

        offWouldTakeDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            if(eventData.eventIssuer !== data.it.entity) return false;
                     // Request votes from all players in parallel
            const effect: EffectFunction = async (data: EffectData) => {
                const voteRequests = game.players.filter(p => !p.isDead).map(player => ({
                    player,
                    min: 1,
                    max: 1,
                    options: [`WHIP! (prevent the damage this would take and each non-active player takes ${damageIfWhipWins} damage)`, 
                            `WHIFF! (the active player loots ${lootIfWhiffWins})`],
                    description: toSerializedTranslation("pending.voteOne"),
                    reason: data.serializedCardAndBox,
                    canUseOnBoardSelection: true,
                }));
                const voteResults = await data.selectMultipleAndRecord(game, voteRequests);

                // Count the votes
                const votes = {"WHIP": 0, "WHIFF": 0};
                for (const result of voteResults) {
                    const vote = result.selected[0]!;
                    if(vote.startsWith("WHIP"))
                        votes["WHIP"]++;
                    else if(vote.startsWith("WHIFF"))
                        votes["WHIFF"]++;
                    else 
                        throw new GameError(`Invalid vote option: ${vote}`, toSerializedTranslation("error.invalidVoteOption", {vote: vote}));
                }
                if(votes["WHIP"] > votes["WHIFF"]) {
                    eventData.damageArray[0] = 0; // prevent the damage this would take
                    for(const player of game.players) {
                        if(player !== game.currentPlayer && !player.isDead) {
                            game.entityHandler.dealDamage(data.issuer, player, data.cardAndBox, damageIfWhipWins);
                        }
                    }
                } else {
                    game.loot(game.currentPlayer, lootIfWhiffWins);
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, "Vote whip or whiff.");
        });

        data.it.cleaners.push(() => {
            offWouldTakeDamage?.();
            offWouldTakeDamage = null;
        });
        return true;
    };
}

export function extraAttackAndDeathTriggerEffect(game: Game, dc: number): AsyncEffectFunction {
    return async (data:EffectData) => {
        let offDeath: (() => void) | null = null;
        let offTurnEnd: (() => void) | null = null;
        const issuer = game.currentPlayer;
        const target = (await data.selectAndRecord(game, issuer as Player, 1, 1, game.players.filter(p => p !== issuer && !p.isDead), toSerializedTranslation("pending.playerToAttack"), data.serializedCardAndBox, true, true)).selected[0];
        if(!target) return false;
        game.entityHandler.makePlayerAttackable(target, dc);
        game.entityHandler.playerMustAttack(issuer, [target], data.it, false);
        offDeath = game.emitter.on("on:death:penalty", (eventData: OnDeathPenaltyData) => {
            if(eventData.eventIssuer !== target) return;
            eventData.itemsLost.forEach(item => {
                game.cardHandler.give(target, issuer, item);
            });
            eventData.itemsLost = [];
        });
        offTurnEnd = game.emitter.on("on:turn:end", ({ eventIssuer }) => {
                offDeath?.();
                offTurnEnd?.();
                offDeath = null;
                offTurnEnd = null;
        });

        return true;
    }
}

export function onlyRechargeableByOwnAbilitiesEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offRecharge: (() => void) | null = null;

        offRecharge = game.emitter.on("on:recharge", (eventData: OnRechargeData) => {
            if (data.it !== eventData.card) return;
            if(eventData.reason === data.it) return;
            eventData.shouldRecharge = false;
        });
        data.it.cleaners.push(() => {
            offRecharge?.();
            offRecharge = null;
        });
        return true;
    };
}

// NOT a triggered effect. This effect is always activated through the stack.
// Card text examples: "+X [stat] till end of turn" or "Gain +X [stat] this turn."
// This modifies the stat value directly rather than replacing an event.
export function temporaryStatModifierEffect(
    adders: ((entity: Entity, value: number, source: Card) => void)[],
    amount: number,
    game: Game,
    targetType: "selectionOnResolve",
    onResolveTargets?: TargetsSelector
): AsyncEffectFunction 
export function temporaryStatModifierEffect(
    adders: ((entity: Entity, value: number, source: Card) => void)[],
    amount: number,
    game: Game,
    targetType: "current" | "next" | "issuer",
    onResolveTargets?: TargetsSelector
): SyncEffectFunction 
export function temporaryStatModifierEffect(
    adders: ((entity: Entity, value: number, source: Card) => void)[],
    amount: number,
    game: Game,
    targetType: "current" | "next" | "issuer" | "selectionOnResolve",
    onResolveTargets?: TargetsSelector
): EffectFunction 
{
    return async (data:EffectData) => {
        let target = null;
        switch(targetType)
        {
            case "current":
                target = game.currentPlayer;
                break;
            case "next":
                target = data.next;
                if(target instanceof DiceRoll)
                    target = target.issuer;

                break;
            case "issuer":
                target = data.issuer;
                break;
            case "selectionOnResolve":
                if(!onResolveTargets)
                    throw new GameError("selectionOnResolve targetType requires an onResolveTargets function.", toSerializedTranslation("error.behaviorError", {error: "selectionOnResolve targetType requires an onResolveTargets function."}));
                if(data.issuer instanceof Player === false)
                    throw new GameError("selectionOnResolve targetType can only be used when issuer is a Player.", toSerializedTranslation("error.behaviorError", {error: "selectionOnResolve targetType can only be used when issuer is a Player."}));
                target = (await data.selectAndRecord(game, data.issuer, 1, 1, onResolveTargets.selector(data.issuer, data.it), toSerializedTranslation("pending.targetForThisEffect"), data.serializedCardAndBox, true, true)).selected[0];
                break;
            default:
                throw new GameError(`Invalid targetType ${targetType} for temporaryStatModifierEffect.`, toSerializedTranslation("error.behaviorError", {error: `Invalid targetType ${targetType} for temporaryStatModifierEffect.`}));
        }
        if(!target || !(target instanceof Entity))
            return false;
        const temp: TemporaryEffect = getTemporaryEffect(data);
        target.addTemporaryEffect(temp);

        for(const adder of adders)
            adder(target, amount, data.it);
        
        // Register cleanup to reverse at end of turn
        const offTurn = game.emitter.on("till:turn:end", () => {
            for(const adder of adders)
                adder(target, -amount, data.it);
            target.removeTemporaryEffect(temp);
            offTurn();
        });
        
        return true;
    };
}


export function onFirstKillMonsterYourTurnEffect(effectFunctions: EffectFunction[], game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offKill: (() => void) | null = null;
        let offTurnStart: (() => void) | null = null;
        let counter = 0;

        offKill = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
            if(game.currentPlayer !== data.issuer) return;
            if (eventData.target !== data.issuer) return;
            if(counter++ > 0) return;
            const effect:EffectFunction = async (effectData: EffectData) => {
                let success = true;
                for (const func of effectFunctions)
                    success = success && await func(effectData);
                return success;
            };
            addPassiveEffectToStack(game, effect, data, "First time you kill a monster on your turn.");
        });

        offTurnStart = game.emitter.on("on:turn:start", ({ eventIssuer }) => {
            counter = 0;
        });

        data.it.cleaners.push(() => {
            offKill?.();
            offTurnStart?.();
            offKill = null;
            offTurnStart = null;
        });

        return true;
    }
}

export function preventDamageNotOnYourTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;

        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, damageArray } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(game.currentPlayer === data.issuer) return;
            const effect:EffectFunction = () => 
                {
                    eventData.damageArray[0] = 0;
                    return true;
                }
            addPassiveEffectToStack(game, effect, data, "", data.visualEffectBox);
        });
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function cancelLootCardThatTargetsYouEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let asBeenUsedThisTurn = false;
        let offLoot: (() => void) | null = null;
        let offTurnEnd: (() => void) | null = null;

        offTurnEnd = game.emitter.on("till:turn:end", ({ eventIssuer }) => {
            asBeenUsedThisTurn = false;
        });

        offLoot = game.emitter.on("on:loot:played", (eventData: OnLootPlayedData) => {
            const { eventIssuer, card, targets, stackId } = eventData;
            if (data.issuer === eventIssuer) return;
            if (asBeenUsedThisTurn) return;
            if (!targets.some(target => target.id === data.issuer?.id || (target instanceof Card && game.getOwner(target) === data.issuer))) return;
            const effect: EffectFunction = (effectData: EffectData) => {
                const element = game.stack.elements.find(el => el.stackId === stackId);
                if(element === undefined) return false;
                game.cancelStackElement(element);
                return true;
            }
            addPassiveEffectToStack(game, effect, data, "Cancel the first loot card that targets you each turn.");
            asBeenUsedThisTurn = true;
        });
        return true;
    };
}

/**
 * Set coin gain to 0, but add it as a target for other effects to reference.
 * @param effectFunctions 
 * @param game 
 * @param description 
 * @returns 
 */
export function interceptFirstGainCoinYourTurnEffect(effectFunctions: EffectFunction[],
    game: Game, description: string): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        let offTurn: (() => void) | null = null;

        let active = true;
        offDamage = game.emitter.on("on:coin:gained", ({ eventIssuer, coinGained }) => {
            if (data.issuer !== eventIssuer) return;
            if(!active) return;
            if(coinGained[0]! <= 0) return;
            active = false;
            const newData: EffectData = new EffectData(data.it, data.issuerProvider, [[coinGained[0]]], data.visualEffectBox);
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of effectFunctions) {
                    await func(effectData);
                }
                active = false;
                return true;
            };
            coinGained[0] = 0;
            addPassiveEffectToStack(game, effect, newData, description);
        });

        offTurn = game.emitter.on("on:turn:start", ({ eventIssuer }) => {
            if (data.issuer !== eventIssuer) return;
            active = true;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offTurn?.();
            offDamage = null;
            offTurn = null;
        });
        return true;
    };
}

// Associated with the coin gained replacement effect. It is therefore also considered as a replacement effect.
export function lvlXaddListenerEffect(
    functions: SyncEffectFunction[],
    lvl: number,
    game: Game): SyncEffectFunction {

    return (data: EffectData) => {
        if (data.it.counters.value("normal") >= lvl)
        {
            for (const func of functions)
                func(data);
        }
        else
            {

            const offTurn = game.emitter.on("on:counter:modified", (eventData: OnCounterModifiedData) => {
                const { eventIssuer } = eventData;
                if (data.issuer !== eventIssuer) return;
                if (data.it.counters.value("normal") < lvl) return;
                const effect: EffectFunction = async (effectData: EffectData) => {
                    for (const func of functions)
                        func(data);
                    return true;
                };
                addPassiveEffectToStack(game, effect, data, `Level ${lvl} effect`);
                offTurn();
            });

            data.it.cleaners.push(() => {
                offTurn?.();
            });
        }
        return true;
    };
}

// REPLACEMENT EFFECT: Continuous stat modification - does not use the stack.
export function permanentStatModifierEffect(
    adders: ((player: Player, value: number, source: Card) => void)[],
    amount: number,
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        if (amount < 0)
            throw new GameError("permanentStatModifierEffect amount must be non-negative.", toSerializedTranslation("error.behaviorError", {error: "permanentStatModifierEffect amount must be non-negative."}));
        // Apply the stat modification
        const target = data.targets.length > 0 ? data.peek() : data.issuer;
        for (const adder of adders)
            adder(target, amount, data.it);

        data.it.cleaners.push(() => {
            for (const adder of adders)
                adder(target, -amount, data.it);
        });

        return true;
    };
}

export function rollAndMayChangeNextRollForThis(game: Game): SyncParsedEffect {
    return {
        effectFunction:(data: EffectData): boolean => {
            if(!(data.issuer instanceof Player))
                throw new GameError("rollAndMayChangeNextRollForThis issuer should be a player.", toSerializedTranslation("error.behaviorError", {error: "rollAndMayChangeNextRollForThis issuer should be a player."}));
            let offEndTurn: (() => void) | null = null;
            let offRoll: (() => void) | null = null;

            const savedRoll = game.rollDice(data.issuer, data.it);
            const effect = (effectData: EffectData): boolean => {
                offRoll = game.emitter.on("on:dice:being-rolled", ({ diceRoll }) => {
                    if(diceRoll.card === data.it)
                        return;
                    const effect:EffectFunction = async (effectData: EffectData): Promise<boolean> => {
                        if(!(data.issuer instanceof Player))
                            throw new GameError("rollAndMayChangeNextRollForThis issuer should be a player.", toSerializedTranslation("error.behaviorError", {error: "rollAndMayChangeNextRollForThis issuer should be a player."}));
                        if (diceRoll.issuer !== data.issuer) return false;
                        if( savedRoll === diceRoll) return false;
                        if(savedRoll.value !== diceRoll.value)
                        {
                            const newValue = (await data.selectAndRecord(game, data.issuer, 1, 1, [diceRoll.value, savedRoll.value], toSerializedTranslation("pending.resultOfDiceRoll"), data.serializedCardAndBox, true, true)).selected[0]!;
                            diceRoll.value = newValue;
                        }
                        return true;
                    }
                    addPassiveEffectToStack(game, effect, data, "Choose the result of this dice roll.");
                    offRoll!();
                    offEndTurn!();
                });
                return true;
            };
            savedRoll.attachEffect(effect, data.it, data.targets, data.issuer);

            offEndTurn = game.emitter.on("on:turn:end", ({ eventIssuer }) => {
                offRoll!();
                offEndTurn!();
            });
            return true;
        }, targetSelectors: []
    };
}

export function combatDamageModifierOnAttackRollEffect(game: Game, attackRolls: number[], modifier: number | "double", side: "taken" | "dealt"): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;

        offDamage = game.emitter.on("on:attack:roll:modifier", (eventData: OnRollData) => {
            const { eventIssuer, dice} = eventData;
            if (eventIssuer !== data.issuer) return;
            if (!attackRolls.includes(dice.value)) return;
            if(side === "taken"){
                if (modifier === "double") {
                    dice.damageReceivedMultiplier! *= 2;
                } else {
                    dice.additionalDamageReceived += modifier;
                }
            }
            if(side === "dealt"){
                if (modifier === "double") {
                    dice.damageDealtMultiplier! *= 2;
                } else {
                    dice.additionalDamageDealt += modifier;
                }
            }
        });

        data.it.cleaners.push(() => {
            offDamage?.();
        });
        return true;
    };
}

export function endTurnOnAttackRollXEffect(game: Game, rollValue: number) {
    return (data: EffectData): boolean => {
        let offDamage: (() => void) | null = null;

        offDamage = game.emitter.on("on:attack:roll", (eventData: OnRollData) => {
            const { eventIssuer, dice } = eventData;
            if (eventIssuer !== data.issuer) return;
            if (dice.value !== rollValue) return;
            addPassiveEffectToStack(game, active.endTurnAndResetStackEffect(game), data, `End your turn on attack roll of ${rollValue}.`);
        });

        data.it.cleaners.push(() => {
            offDamage?.();
        });
        return true;
    };
}

export function cancelNextDeathOfAPlayer(game: Game, description: string): AsyncEffectFunction{
    return async (data: EffectData) => {
        const target = data.next;

        if(game.entityHandler.preventDeath(target))
        {
            await active.endTurnAndResetStackEffect(game)(data);
            return true;
        }
        let offDeath: (() => void) | null = null;
        let offEndTurn: (() => void) | null = null;
        const temp: TemporaryEffect = getTemporaryEffect(data);
        target.addTemporaryEffect(temp);

        const clean: ()=> void =()=>
        {
            target.removeTemporaryEffect(temp);
            offDeath?.();
            offDeath = null;
            offEndTurn?.();
            offEndTurn = null;
        }
        offDeath = game.emitter.on("on:death:would-death", (eventData) => {
            const eventIssuer = eventData.eventIssuer;
            if(eventIssuer !== target)
                return false;
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                game.entityHandler.preventDeath(target);
                if(game.currentPlayer === target)
                    await active.endTurnAndResetStackEffect(game)(data);
                clean();
                return true;
            };
            addPassiveEffectToStack(game, effect, data, description);
        });
        offEndTurn = game.emitter.on("till:turn:end", ()=>{clean();});
        return true;
    };
}

export function chooseMonsterWhenAnotherPlayerAttacksMonsterEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offAttack: (() => void) | null = null;
        offAttack = game.emitter.on("on:attack:declared:monster", ({ eventIssuer, monster }) => {
            if (eventIssuer === data.issuer) return;
            const effect: EffectFunction = async (effectData: EffectData) => {
                const monsters = game.encounters.monsters.filter(m => game.actions.canDeclareAttackOnEntity(eventIssuer, m, false));
                if(monsters.length === 0) return false;
                if(!data.issuer || !(data.issuer instanceof Player))
                    throw new GameError("chooseMonsterWhenAnotherPlayerAttacksMonsterEffect issuer should be a player.", toSerializedTranslation("error.behaviorError", {error: "chooseMonsterWhenAnotherPlayerAttacksMonsterEffect issuer should be a player."}));
                const selected = (await data.selectAndRecord(game, data.issuer, 0, 1, monsters, toSerializedTranslation("pending.monsterToBeAttacked"), data.serializedCardAndBox, true, true)).selected;
                if(selected.length === 0) return false;
                const newMonster = selected[0]!;
                monster[0] = newMonster;
                return true;
            }             
            addPassiveEffectToStack(game, effect, data, `Choose which monster ${eventIssuer.id} attacks.`);
        });
        data.it.cleaners.push(() => {
            offAttack?.();
            offAttack = null;
        });
        return true;
    };
}


export function rollXChoose1Effect(game: Game, x: number, exactlyOnce: boolean, chooserType: "issuer" | "left"): SyncEffectFunction {
    return (data: EffectData) => {
        let offRoll: (() => void) | null = null;
        offRoll = game.emitter.on("on:dice:being-rolled", ({ eventIssuer, diceRoll }) => {
            const effect:EffectFunction = async (effectData: EffectData) => {
                const values = [diceRoll.value];
                for(let i = 0; i < x - 1; i++)
                    values.push(eventIssuer.rollDice(game.random, diceRoll.data).value);
                const chooser = chooserType === "issuer" ? data.issuer : game.turnHandler.getPlayerTo(eventIssuer, "left");
                if(!(chooser instanceof Player))
                    throw new GameError("rollXChoose1Effect issuer should be a player.", toSerializedTranslation("error.behaviorError", {error: "rollXChoose1Effect issuer should be a player."}));
                const newValue = (await data.selectAndRecord(game, chooser, 1, 1, values, toSerializedTranslation("pending.resultOfDiceRoll"), data.serializedCardAndBox, true, true)).selected[0]!;
                diceRoll.value = newValue;
                return true;
            }

            addPassiveEffectToStack(game, effect, data, "Choose the result of the next dice roll among four results.");
            if(exactlyOnce)
            {
                offRoll?.();
                offRoll = null;
            }
        });
        data.it.cleaners.push(() => {
            if(!exactlyOnce)
            {
                offRoll?.();
                offRoll = null;
            }
        });
        return true;
    };
}

export function nextShopItemThisTurnCosts(game: Game, cost: number): SyncEffectFunction {
    return (data: EffectData) => {
        const initShopPrice = game.shop.shopPrice;
        game.shop.shopPrice = cost;
        let offPurchase: (() => void) | null = null;
        let offEndTurn: (() => void) | null = null;

        const clean:()=>void = ()=>{
            game.shop.shopPrice = initShopPrice;
            offPurchase?.();
            offEndTurn?.();
            offPurchase = null;
            offEndTurn = null;
        }
        offPurchase = game.emitter.on("on:purchase:success", ({ eventIssuer }) => {
            clean();
        });
        offEndTurn = game.emitter.on("on:turn:end", ({ eventIssuer }) => {
            clean();
        });
        return true;
    };
}

// REPLACEMENT EFFECT: Continuous priority modification - does not use the stack.
export function noPriorityPassesOnYourTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const issuer = data.issuer;
        if(!(issuer instanceof Player))
            throw new GameError("noPriorityPassesOnYourTurnEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "noPriorityPassesOnYourTurnEffect can only be applied to Players."}));

        // Apply immediately if this effect starts during issuer's turn.
        if (game.currentPlayer === issuer) {
            game.entityHandler.applyLootOrActivateRestrictionForCurrentTurn(issuer);
        }

        const offStartTurn = game.emitter.on("on:turn:start", ({ eventIssuer }) => {
            if (eventIssuer !== issuer) return;
            game.entityHandler.applyLootOrActivateRestrictionForCurrentTurn(issuer);
        });
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            if(game.currentPlayer === issuer)
                game.entityHandler.applyLootOrActivateRestrictionForCurrentTurn(issuer, -1);
            offStartTurn();
        });
        return true;
    };
}

// REPLACEMENT EFFECT: Continuous priority modification - does not use the stack.
export function noPriorityPassesTillEndOfTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const offEndTurn: (() => void) | null = null;
        const issuer = data.issuer;
        if(!(issuer instanceof Player))
            throw new GameError("noPriorityPassesTillEndOfTurnEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "noPriorityPassesTillEndOfTurnEffect can only be applied to Players."}));

        game.entityHandler.applyLootOrActivateRestrictionForCurrentTurn(issuer);
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            game.entityHandler.applyLootOrActivateRestrictionForCurrentTurn(issuer, -1);
        });
        return true;
    };
}

// REPLACEMENT EFFECT: Modifies damage before it's taken - does not use the stack.
// Replaces damage amount with a specific value.
export function setNextDamageToXEffect(setTo: number, game: Game): SyncEffectFunction {
    return (data:EffectData) => {
        let offDamage: (() => void) | null = null;
        let offTurn: (() => void) | null = null;
        const temp: TemporaryEffect = getTemporaryEffect(data);
        const target = data.targets.length > 0 ? data.peek() : data.issuer;
        target.addTemporaryEffect(temp);

        const cleanup = (): void => {
            target.removeTemporaryEffect(temp);
            offDamage?.();
            offTurn?.();
            offDamage = null;
            offTurn = null;
        };
        // Listen for the next damage event on this player
        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, damageArray } = eventData;
            if (target !== eventIssuer) return;
            const effect:EffectFunction = () => 
                {
                    damageArray[0] = setTo;
                    return true;
                }
            addPassiveEffectToStack(game, effect, data, "", data.visualEffectBox);
            cleanup(); // One-shot: remove listeners after first use
        });
        // Expire at end of turn if unused
        offTurn = game.emitter.on("on:turn:end", cleanup);
        return true;
    };
}

// REPLACEMENT EFFECT: Continuous stat modification on your turn - does not use the stack.
export function onYourTurnModifier(
    adders: ((player: Player, value: number, source: Card) => void)[],
    amount: number,
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        if (amount < 0)
            throw new GameError("onYourTurnModifier amount must be non-negative.", toSerializedTranslation("error.behaviorError", {error: "onYourTurnModifier amount must be non-negative."}));
        let active = false;
        if(game.currentPlayer === data.issuer) {
            // Apply the stat modification
            const target = data.targets.length > 0 ? data.peek() : data.issuer;
            active = true;
            for (const adder of adders)
                adder(target, amount, data.it);
        }

        let offTurn = game.emitter.on("on:turn:start", (eventData: OnTurnStartData) => {
            const { eventIssuer } = eventData;
            if (eventIssuer !== data.issuer) return;
            const target = data.targets.length > 0 ? data.peek() : data.issuer;
            active = true;
            for (const adder of adders)
                adder(target, amount, data.it);
        });
        let offTurnEnd = game.emitter.on("till:turn:end", (eventData: OnTurnEndData) => {
            const { eventIssuer } = eventData;
            if (eventIssuer !== data.issuer) return;
            const target = data.targets.length > 0 ? data.peek() : data.issuer;
            
            if(active)
            {
                active = false;
                for (const adder of adders)
                    adder(target, -amount, data.it);
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed

        data.it.cleaners.push(() => { 
            if (game.currentPlayer === data.issuer && active) {
                const target = data.targets.length > 0 ? data.peek() : data.issuer;
                active = false;
                for (const adder of adders)
                    adder(target, -amount, data.it);
            }
            offTurn();
            offTurn = (): null => null;
            offTurnEnd();
            offTurnEnd = (): null => null;
        });

        return true;
    };
}

export async function giveCurseToEffect(restEffectFunction: EffectFunction, game: Game, data: EffectData, giveTo: Player): Promise<void> {
    if(!(data.it instanceof MonsterCard))
            throw new GameError("Curse effect can only be applied by MonsterCards.", toSerializedTranslation("error.behaviorError", {error: "Curse effect can only be applied by MonsterCards."}));
            
    // Add the curse to their in play area.
    await game.cardHandler.addCurse(giveTo, data.it);
    // Apply the rest of the effect.
    await restEffectFunction(new EffectData(data.it, () => giveTo, [], data.visualEffectBox));
    // Add Listener to remove the curse when the owner dies.
    let offDeath: (() => void) | null = null;
    offDeath = game.emitter.on("on:death:after-penalty", (eventData: OnDeathAfterPenaltyData) => {
        const { eventIssuer } = eventData;
        if (giveTo !== eventIssuer) return;
        if(!(data.it instanceof MonsterCard))
            throw new GameError("Curse effect can only be applied by MonsterCards.", toSerializedTranslation("error.behaviorError", {error: "Curse effect can only be applied by MonsterCards."}));
        game.cardHandler.discard(data.it);
        game.cardHandler.removeCurse(giveTo, data.it);
        offDeath?.();
        offDeath = null;
    });
    data.it.cleaners.push(() => {
        offDeath?.();
        offDeath = null;
    });
}

export function curseEffect(restEffectFunction: SyncEffectFunction, game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        if(!(data.issuer instanceof Player))
            throw new GameError("Curse effect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "Curse effect can only be applied to Players."}));

        let offDeath: (() => void) | null = null;
        offDeath = game.emitter.on("on:death:after-penalty", (eventData: OnDeathAfterPenaltyData) => {
            const { eventIssuer } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(data.issuer instanceof Player))
                throw new GameError("Curse effect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "Curse effect can only be applied to Players."}));
            if(!(data.it instanceof MonsterCard))
                throw new GameError("Curse effect can only be applied by MonsterCards.", toSerializedTranslation("error.behaviorError", {error: "Curse effect can only be applied by MonsterCards."}));
            game.cardHandler.discard(data.it);
            game.cardHandler.removeCurse(data.issuer, data.it);
            offDeath?.();
            offDeath = null;
        });

        data.it.cleaners.push(() => {
            offDeath?.();
            offDeath = null;
        });

        restEffectFunction(new EffectData(data.it, () => data.issuer, [], data.visualEffectBox));
        return true;
    }
}

// REPLACEMENT EFFECT: Continuous stat modification on your turn - does not use the stack.
export function firstRollDiceModifier(
    amount: number,
    game: Game,
    type: "attack" | "any"
): SyncEffectFunction {
    const modifier = type === "any" ? game.entityHandler.addDiceModifier : game.entityHandler.addAttackDiceModifier;
    const event = type === "any" ? "on:roll:modifier" : "on:attack:roll:modifier";
    const rollThisTurn = type === "any" ? "rollThisTurn" : "attackRollThisTurn";
    return (data: EffectData) => {
        if (amount < 0)
            throw new GameError("firstRollDiceModifier amount must be non-negative.", toSerializedTranslation("error.behaviorError", {error: "firstRollDiceModifier amount must be non-negative."}));
        const issuer = data.issuer;
        if(!(issuer instanceof Player))
            throw new GameError("firstRollDiceModifier can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "firstRollDiceModifier can only be applied to Players."}));
        let active = issuer[rollThisTurn] ===  0;
        if(active)
            modifier(issuer, amount, data.it);

        const offTurn = game.emitter.on("on:turn:start", (eventData: OnTurnStartData) => {
            const { eventIssuer } = eventData;
            if (eventIssuer !== issuer) return;
            if(active) return;
            modifier(issuer, amount, data.it);
            active = true;
        });

        const offEvent = game.emitter.on(event, (eventData: OnRollData) => {
            const { eventIssuer } = eventData;
            if (eventIssuer !== issuer) return;
            if(!active) return
            if(issuer[rollThisTurn] > 1)
            {
                active = false;
                modifier(issuer, -amount, data.it);
            }
        });

        const offDiceBeingRolled = game.emitter.on("on:dice:being-rolled", () => {
            if(!active) return
            if(issuer[rollThisTurn] > 1)
            {
                active = false;
                modifier(issuer, -amount, data.it);
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed

        data.it.cleaners.push(() => {            
            if(active)
            {
                active = false;
                modifier(data.issuer, -amount, data.it);
            }
            offTurn();
            offEvent();
            offDiceBeingRolled();
        });

        return true;
    };
}

// Continuous effect, no stack.
// First attack roll stat modifier: adds value to a stat until end of turn
export function firstAttackRollStatModifierEffect(
    damageDealtModifier: number=0,
    damageReceivedModifier: number=0,
    evasionModifier: number=0,
    game: Game
): SyncEffectFunction {
    return (data:EffectData) => {
        let offAttack: (() => void) | null = null;

        const cleanup = (): void => {
            offAttack?.();
            offAttack = null;
        };
        // Register cleanup to reverse at end of turn
        offAttack = game.emitter.on("on:attack:roll:first-time-each-turn", (eventData: OnRollData) => {
            const { eventIssuer, dice} = eventData;
            if (data.issuer !== eventIssuer) return;
            dice.additionalDamageDealt += damageDealtModifier;
            dice.additionalDamageReceived += damageReceivedModifier;
            dice.evasion += evasionModifier;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push( () => {
            cleanup();
        });
        return true;
    };
}

/*
TRIGGERED EFFECT: Uses the stack.
Each time you take damage, [do something].
*/
export function onDamageTakenEffect(
    // callbacks: ((player: Player, dmg: number) => void)[],
    effectFunctions: EffectFunction[],
    // amount: number,
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        // if (amount < 0)
        //     throw new GameError("permanentStatModifierEffect amount must be non-negative.", toSerializedTranslation("error.behaviorError", {error: "permanentStatModifierEffect amount must be non-negative."}));
        let offDamage: (() => void) | null = null;

        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target: dealer, source, damage } = eventData;
            if (data.issuer !== eventIssuer) return;
            const index = data.targets.findIndex((c) => c.damageTaken !== undefined) < 0 
                ? data.targets.length 
                : data.targets.findIndex((c) => c.damageTaken !== undefined);
            data.targets = [];
            data.clearSelectionRecord();
            data.addTarget(damage);
            
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of effectFunctions) {
                    await func(effectData);
                }
                return true;
            };
            // Should not work if damage is 0 or less
            if(damage != null && damage > 0) 
                addPassiveEffectToStack(game, effect, data, "On damage taken effect");
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

// TRIGGERED EFFECT: Uses the stack.
// Executes effects before death penalty is applied.
export function beforeDeathPenaltyEffect(
    // callbacks: ((player: Player, dmg: number) => void)[],
    effectFunctions: EffectFunction[],
    // amount: number,
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        // if (amount < 0)
        //     throw new GameError("permanentStatModifierEffect amount must be non-negative.", toSerializedTranslation("error.behaviorError", {error: "permanentStatModifierEffect amount must be non-negative."}));
        let offDamage: (() => void) | null = null;

        offDamage = game.emitter.on("on:death:before-penalty", (eventData: OnDeathBeforePenaltyData) => {
            const { eventIssuer, target: dealer, source } = eventData;
            if (data.issuer !== eventIssuer) return;
            
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of effectFunctions) {
                    await func(effectData);
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, "Before death penalty effect");
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function gainEternalTillEndOfTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurn: (() => void) | null = null;

        let turnedEternal: ItemCard[] = [];
        const target = data.next;
        if(!target || !(target instanceof Player))
            throw new GameError("gainEternalTillEndOfTurnEffect can only target Players.", toSerializedTranslation("error.behaviorError", {error: "gainEternalTillEndOfTurnEffect can only target Players."}));
        for(const inPlay of target.inPlay)
            if(!inPlay.eternal)
            {
                inPlay.setEternal(true);
                turnedEternal.push(inPlay);
            }
        offTurn = game.emitter.on("on:turn:end", ({ eventIssuer }) => {
            for(const card of turnedEternal)
                card.setEternal(false);
            turnedEternal = [];
        });
        
        data.it.cleaners.push(() => {
            offTurn?.();
            offTurn = null;
        });
        return true;
    };
}

// TRIGGERED EFFECT: Uses the stack.
// Executes effects after death penalty is applied.
export function afterDeathPenaltyEffect(
    // callbacks: ((player: Player, dmg: number) => void)[],
    effectFunctions: EffectFunction[],
    // amount: number,
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        // if (amount < 0)
        //     throw new GameError("permanentStatModifierEffect amount must be non-negative.", toSerializedTranslation("error.behaviorError", {error: "permanentStatModifierEffect amount must be non-negative."}));
        let offDamage: (() => void) | null = null;

        offDamage = game.emitter.on("on:death:after-penalty", (eventData: OnDeathAfterPenaltyData) => {
            const { eventIssuer, target: dealer, source } = eventData;
            if (data.issuer !== eventIssuer) return;
            
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of effectFunctions) {
                    await func(effectData);
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, "After death penalty effect");
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function gainTreasureOnDestroyEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offDestroy: (() => void) | null = null;

        offDestroy = game.emitter.on("on:item:destroyed", (eventData: OnItemDestroyedData) => {
            if (!eventData.cards.includes(data.it)) return;
            if(!data.issuer || !(data.issuer instanceof Player))
                return;
            game.gainTreasure(data.issuer, amount);
        });

        data.it.cleaners.push(() => {
            offDestroy?.();
            offDestroy = null;
        });
        return true;
    };
}

export function gainCoinsAndLootOnDestroyBasedOnCountersEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDestroy: (() => void) | null = null;

        offDestroy = game.emitter.on("on:item:destroyed", (eventData: OnItemDestroyedData) => {
            if (!eventData.cards.includes(data.it)) return;
            if(!data.issuer || !(data.issuer instanceof Player))
                return;
            const counters = data.it.counters.value("normal");
            game.gainCoins(data.issuer, counters, data.it);
            game.loot(data.issuer, counters, "other");

        });

        data.it.cleaners.push(() => {
            offDestroy?.();
            offDestroy = null;
        });
        return true;
    };
}

export function preventNonCombatDamageEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            if (data.issuer !== eventData.eventIssuer) return;
            if (eventData.source !instanceof DiceRoll ) return;
            const effect:EffectFunction = () => 
                {
                    eventData.damageArray[0] = 0;
                    return true;
                }
            addPassiveEffectToStack(game, effect, data, "", data.visualEffectBox);
        });
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function chosenumberDamageOnRollThisTurnEffect(game: Game, damageAmount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        let offTurn: (() => void) | null = null;
        const nextRoll = data.next as DiceWillRoll;
        
        const nb = data.next as number;
        if ([1,2,3,4,5,6].includes(nb) === false) {
            throw new GameError("chosenumberDamageOnRollThisTurnEffect: nb must be a number between 1 and 6.", toSerializedTranslation("error.behaviorError", {error: "chosenumberDamageOnRollThisTurnEffect: nb must be a number between 1 and 6."}));
        }
        const previouslyRolledDices = game.stack.elements.filter(e => e instanceof DiceRoll);
        offDamage = game.emitter.on("on:dice:resolved", (eventData: OnRollData) => {
            const { eventIssuer, dice } = eventData;
            if(previouslyRolledDices.includes(dice))
                return;
            if (dice.value !== nb) return;
            const effect = active.dealDamageToTargetEffect(game, damageAmount, true, selectPlayerOrMonster(game), "issuer");
            addPassiveEffectToStack(game, effect, data, `Deal ${damageAmount} damage to a target because a ${nb} was rolled.`);
        });

        offTurn = game.emitter.on("till:turn:end", ({ eventIssuer }) => {
            offDamage?.();
            offDamage = null;
            offTurn?.();
            offTurn = null;
        });
        return true;
    };
}

export function WouldDieYourTurnEffect(
    effectFunctions: EffectFunction[],
    game: Game,
    description: string,
    duringYourTurnOnly: boolean = false
): SyncEffectFunction {
    return (data: EffectData) => {
        let offDeath: (() => void) | null = null;
        
        offDeath = game.emitter.on("on:death:would-death", ({ eventIssuer, target, source, deathOnStack}) => {
            if (data.issuer !== eventIssuer) return;
            if (duringYourTurnOnly && game.currentPlayer !== data.issuer) return;
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                if(game.stack.elements.every(e => e !== deathOnStack)) return false; // Only trigger on the first "would death" event in the stack, to avoid infinite loops with replacement effects that prevent death.
                for (const func of effectFunctions) {
                    await func(effectData);
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, description);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDeath?.();
            offDeath = null;
        });
        return true;
    };
}



/*
TRIGGERED EFFECT: Uses the stack.
Each time triggerEvent triggers, if you are the eventIssuer, call effectFunctions.
*/
export function onYourEventEffect(
    triggerEvent: TriggerEvent,
    effectFunctions: ((effectData: EffectData, eventData: any) => boolean | Promise<boolean>)[],
    game: Game,
    description: string,
    duringYourTurnOnly: boolean = false,
    condition: (effectData: EffectData, eventData: any) => boolean = () => true,
): SyncEffectFunction {
    return (data: EffectData) => {
        let offEvent: (() => void) | null = null;
        
        offEvent = game.emitter.on(triggerEvent, (eventData) => {
            const eventIssuer = eventData.eventIssuer;
            if (data.issuer !== eventIssuer) return;
            if (duringYourTurnOnly && game.currentPlayer !== data.issuer) return;
            if(!condition(data, eventData)) return;
            data.targets = [];
            data.clearSelectionRecord();
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of effectFunctions) {
                    await func(effectData, eventData);
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, description);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offEvent?.();
            offEvent = null;
        });
        return true;
    };
}

export function aPlayerRollSameResTwiceInRow(effectFunctions: EffectFunction[],
    game: Game,
    description: string): SyncEffectFunction {
        return (data: EffectData) => {
        let prevRoll: Map<Player, number> = new Map(game.players.map(p=>[p, -1]));
        let offTurnStart: (() => void) | null = null;
        let offRoll: (() => void) | null = null;
        
        offTurnStart = game.emitter.on("on:turn:start", (eventData: OnTurnStartData) => {
            prevRoll = new Map(game.players.map(p=>[p, -1]));
        });

        offRoll = game.emitter.on("on:dice:resolved", (eventData: OnRollData) => {
            const roll = eventData.dice;
            const issuer = eventData.eventIssuer;
            if(prevRoll.get(issuer) === roll.value)
            {
                const effect = async (effectData: EffectData): Promise<boolean> => {
                    for (const func of effectFunctions) {
                        await func(effectData);
                    }
                    return true;
                };
                addPassiveEffectToStack(game, effect, data, description);
            }
            prevRoll.set(issuer, roll.value);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
            offRoll?.();
            offRoll = null;
        });
        return true;
    };
}

export function onYourKillEffect(
    effectFunctions: EffectFunction[],
    game: Game,
    description: string,
    condition: (effectData: EffectData, eventData: any) => boolean = () => true,
): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:death:before-penalty", (eventData: OnDeathBeforePenaltyData) => {
            if (data.issuer !== eventData.target) return;
            if(!condition(data, eventData)) return;
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of effectFunctions) {
                    await func(effectData);
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, description);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function noDeathPenaltyCoinsAndLootEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDeath: (() => void) | null = null;
        
        offDeath = game.emitter.on("on:death:before-penalty", (eventData: OnDeathBeforePenaltyData) => {
            if (data.issuer !== eventData.eventIssuer) return;
            eventData.values.nbCoinsToLose = 0;
            eventData.values.nbLootCardsToLose = 0;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDeath?.();
            offDeath = null;
        });
        return true;
    };
}

export function onDamageYouDealtEffect(
    effectFunctions: EffectFunction[],
    game: Game,
    description: string
): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            if (data.issuer !== eventData.target) return;
            
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of effectFunctions) {
                    await func(effectData);
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, description);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function noLootDiscardOrCoinLossEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDeath: (() => void) | null = null;
        let offLoseCoins: (() => void) | null = null;
        let offLoseLoot: (() => void) | null = null;
        
        offDeath = game.emitter.on("on:death:before-penalty", (eventData: OnDeathBeforePenaltyData) => {
            if (data.issuer !== eventData.eventIssuer) return;
            eventData.values.nbCoinsToLose = 0;
            eventData.values.nbLootCardsToLose = 0;
        });

        offLoseCoins = game.emitter.on("on:coin:lost:before", (eventData: OnCoinsLostBeforeData) => {
            if (data.issuer !== eventData.eventIssuer) return;
            if(!["death", "effect"].includes(eventData.reason)) return
            eventData.coinToLose = 0;
        });

        offLoseLoot = game.emitter.on("on:loot:discard:before", (eventData: OnLootWouldDiscardData) => {
            if (data.issuer !== eventData.eventIssuer) return;
            if(!["death", "effect"].includes(eventData.reason)) return
            eventData.indice[0] = -1; // Prevent discarding any loot cards
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDeath?.();
            offDeath = null;
            offLoseCoins?.();
            offLoseCoins = null;
            offLoseLoot?.();
            offLoseLoot = null;
        });
        return true;
    };
}


export function addToYourRollValueEffect(game: Game, values: number[], rollType: "attack" | "non-attack" | "any", youMayEffectHanging: boolean[]): SyncEffectFunction {
    const youMay = youMayEffectHanging[0];
    youMayEffectHanging[0] = false;
    return (data: EffectData) => {
        let offRoll: (() => void) | null = null;
        
        offRoll = game.emitter.on("on:dice:being-rolled", ({ diceRoll }) => {
            const eventIssuer = diceRoll.issuer;
            if(!(data.issuer instanceof Player)) {
                throw new GameError("addToYourRollValueEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "addToYourRollValueEffect can only be applied to Players."}));
            }
            if (data.issuer !== eventIssuer) return;
            if(rollType === "attack" && !diceRoll.attackRoll) return;
            if(rollType === "non-attack" && diceRoll.attackRoll) return;
            
            const effect = async (effectData: EffectData): Promise<boolean> => {
                if(!(data.issuer instanceof Player)) {
                    throw new GameError("addToYourRollValueEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "addToYourRollValueEffect can only be applied to Players."}));
                }
                const selected = (await data.selectAndRecord(game, data.issuer, (youMay ? 0 : 1), 1, values, toSerializedTranslation("pending.valueToAddToRoll"), data.serializedCardAndBox, true, true)).selected;
                if(selected.length === 0) return false; // Player chose not to select a value
                const toAdd = selected[0]!;
                diceRoll.value += toAdd;
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `You may add or subtract 1 from any of your non-attack rolls.`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offRoll?.();
            offRoll = null;
        });
        return true;
    };
}

export function stealCoinOnGainEffect(amount: number, game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offCoinGain: (() => void) | null = null;
        
        offCoinGain = game.emitter.on("on:coin:gained:after", ({ eventIssuer, coinGained, source }) => {
            if(source === "gift") return;
            if (data.issuer === eventIssuer) return;
            if(!(data.issuer instanceof Player)) {
                throw new GameError("stealCoinOnGainEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "stealCoinOnGainEffect can only be applied to Players."}));
            }
            if(source.slug === data.it.slug && source.slug) return; // Avoid infinite loops.
            const effect = (effectData: EffectData): boolean => {
                if(!(data.issuer instanceof Player)) {
                    throw new GameError("stealCoinOnGainEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "stealCoinOnGainEffect can only be applied to Players."}));
                }
                const stealAmount = Math.min(coinGained[0] ?? 0, amount);
                if(stealAmount <= 0) return false;
                game.forceGiveCoins(eventIssuer, data.issuer, stealAmount, data.it);
                return true;
            }
            addPassiveEffectToStack(game, effect, data, `Steal ${amount}¢ from another player when they gain coins.`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offCoinGain?.();
            offCoinGain = null;
        });
        return true;
    };
}

export function statModifierBasedOnCountersEffect(game: Game,
    adders: ((entity: Entity, value: number, source: Card) => void)[],
    countersPerModifier: number, 
    modifier: number): SyncEffectFunction {
    return (data: EffectData) => {
        const issuer = data.issuer;
        if(!(issuer instanceof Player))
            throw new GameError("statModifierBasedOnCountersEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "statModifierBasedOnCountersEffect can only be applied to Players."}));
        const toAdd = Math.floor((data.it.counters.value("normal") ?? 0) / countersPerModifier);
        for (const adder of adders) {
            adder(issuer, toAdd * modifier, data.it);
        }
        let offCounterModifier: (() => void) | null = null;
        offCounterModifier = game.emitter.on("on:counter:modified", ({ eventIssuer, card, counterName, previousValue, newValue }) => {
            if(card !== data.it) return;
            const toAdd = Math.floor(newValue / countersPerModifier) - Math.floor(previousValue / countersPerModifier);
            if(toAdd === 0) return;
            for (const adder of adders) {
                adder(issuer, toAdd * modifier, data.it);
            }
        });

        data.it.cleaners.push(() => {
            for (const adder of adders) {
                adder(issuer, -Math.floor((data.it.counters.value("normal") ?? 0) / countersPerModifier) * modifier, data.it); // Remove all modifiers from this effect.
            }
            offCounterModifier?.();
            offCounterModifier = null;
        });
        return true;
    };
}

export function noRechargeCharaDuringRechargeStepEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offBeforeRechargeStep: (() => void) | null = null;
        offBeforeRechargeStep = game.emitter.on("on:turn:start:before:recharge:step", (eventData) => {
            const issuer = data.issuer;
            if (issuer !== eventData.eventIssuer) return;
            if(!(issuer instanceof Player)) {
                throw new GameError("noRechargeCharaDuringRechargeStepEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "noRechargeCharaDuringRechargeStepEffect can only be applied to Players."}));
            }
            eventData.charactersToRecharge = [];
        });

        data.it.cleaners.push(() => {
            offBeforeRechargeStep?.();
            offBeforeRechargeStep = null;
        });
        return true;
    };
}

export function maxHandSizeEffect(game: Game, newMaxHandSize:number): SyncEffectFunction{
    return (data: EffectData) => {
        const issuer = data.issuer;
        if(issuer instanceof Player === false)
            return false;
        issuer.maxHandSize = newMaxHandSize;
        data.it.cleaners.push(()=>{
            issuer.maxHandSize = game.gameParameters.maxHandSize.value;
        })
        return true;
    }
}

export function rechargeOneDuringRechargeStepEffect(game: Game, nb: number, target: "mostsouls" | "issuer"): SyncEffectFunction {
    return (data: EffectData) => {
        let offBeforeRechargeStep: (() => void) | null = null;
        offBeforeRechargeStep = game.emitter.on("on:turn:start:before:recharge:step", ({ eventIssuer, itemsToRecharge }) => {
            const issuer = eventIssuer;
            if (!(issuer instanceof Player)) {
                throw new GameError("rechargeOneDuringRechargeStepEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "rechargeOneDuringRechargeStepEffect can only be applied to Players."}));
            }
            if(target === "issuer" && issuer !== data.issuer) return;
            if (itemsToRecharge.length === 0) return;

            const currentOptions = [...itemsToRecharge];
            const effect = async (effectData: EffectData): Promise<boolean> => {
                const selected = (await data.selectAndRecord(game, issuer, 0, nb, currentOptions, toSerializedTranslation("pending.itemToRecharge"), data.serializedCardAndBox, true, true)).selected[0]!;
                if (selected) {
                    itemsToRecharge.splice(0, itemsToRecharge.length, selected);
                }
                return true;
            }
            addPassiveEffectToStack(game, effect, data, `Recharge only one of your items during the recharge step.`);
        });

        data.it.cleaners.push(() => {
            offBeforeRechargeStep?.();
            offBeforeRechargeStep = null;
        });
        return true;
    };
}

/*
TRIGGERED EFFECT: Uses the stack.
Each time triggerEvent triggers, if you are the eventIssuer, call effectFunctions.
*/
export function onAnotherPlayerEventEffect(
    triggerEvent: TriggerEvent,
    effectFunctions: EffectFunction[],
    game: Game,
    description: string,
    condition: (effectData: EffectData, eventData: any) => boolean = () => true,
): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on(triggerEvent, (eventData) => {
            const eventIssuer = eventData.eventIssuer;
            if (data.issuer === eventIssuer) return;
            if(!(eventIssuer instanceof Player)) return;
            if(!condition(data, eventData)) return;
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of effectFunctions) {
                    await func(effectData);
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, description);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

/*
TRIGGERED EFFECT: Uses the stack.
Each time triggerEvent triggers, if you are the eventIssuer, call effectFunctions.
*/
export function onAnyEventEffect(
    triggerEvent: TriggerEvent,
    effectFunctions: EffectFunction[],
    game: Game,
    description: string,
    condition: (effectData: EffectData, eventData: any) => boolean = () => true,
    issuerIsEventIssuer: boolean = true
): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on(triggerEvent, (eventData) => {
            const eventIssuer = eventData.eventIssuer;
            if(!condition(data, eventData)) return;
            if (issuerIsEventIssuer && eventIssuer && eventIssuer instanceof Entity) {
                data.issuerProvider = (): Entity => eventIssuer;
            }
            
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of effectFunctions) {
                    await func(effectData);
                }
                return true;
            };
            if(effectFunctions.length > 0)
                addPassiveEffectToStack(game, effect, data, description);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function copyAbilitiesFromGoldCounterItemsEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        // console.log("Activating copyAbilitiesFromGoldCounterItemsEffect", data.issuer.id);
        if(!(data.it instanceof ItemCard)) return false;
        if(!data.issuer || !(data.issuer instanceof Player)) return false;
        const goldenItems = game.visibleItems.filter(item => item.counters.value("golden") > 0);
        data.it.swapEffectInterfaces();
        for (const item of goldenItems) {
            game.cardHandler.gainAbilities(data.issuer, data.it, item);
        }
        let offCounterChange: (() => void) | null = null;
        offCounterChange = game.emitter.on("on:counter:modified", ({ eventIssuer, card, counterName, previousValue, newValue }) => {
            if (counterName !== "golden") return;
            if(!(data.it instanceof ItemCard)) return;
            if(!data.issuer || !(data.issuer instanceof Player)) return false;
            if(!(card instanceof ItemCard)) return;
            if (card.counters.value("golden") > 0 && previousValue === 0) {
                game.cardHandler.gainAbilities(data.issuer, data.it, card);
            }
            else if(newValue === 0 && previousValue > 0) {
                const toRemove = (data.it.tags.copiedCards as ItemCard[]).find(c => c.slug === card.slug);
                toRemove?.cleanup();
                data.it.tags.copiedCards = (data.it.tags.copiedCards as ItemCard[]).filter(c => c !== toRemove);
            }
        });
        
        data.it.cleaners.push(() => {
            data.it.swapEffectInterfaces();
            offCounterChange?.();
            offCounterChange = null;
        });
        return true;
    };
}

export function giveCounterToAnotherItemOnEnterPlayEffect(game: Game, counterType: CounterType): AsyncEffectFunction {
    return async (data: EffectData) => {
        if (data.issuer instanceof Player === false) return false;
        const itemToGiveCounter = (await data.selectAndRecord(game, data.issuer, 1, 1, data.issuer.inPlay.filter(item => item !== data.it && !item.eternal), toSerializedTranslation("pending.itemToGiveGoldCounterTo"), data.serializedCardAndBox, true)).selected[0]!;
        if(!itemToGiveCounter)
            return false;
        game.cardHandler.addToCounter(data.issuer, itemToGiveCounter, counterType, 1);
        return true;
    };
}


// Reduces any damage to a maximum of x.
export function reduceDamageToXEffect(game: Game, maxDamage: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        // Listen for the next damage event on this player
        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, damageArray } = eventData;
            if (data.issuer !== eventIssuer) return;
            
            // Create the effect that will execute when the stack resolves
            const effect = (effectData: EffectData): boolean => {
                damageArray[0] = Math.min(damageArray[0] ?? 0, maxDamage);
                return true;
            };
            
            // Add to stack instead of executing immediately
            addPassiveEffectToStack(game, effect, data, `Reduce damage to ${maxDamage}`, data.visualEffectBox);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function redirectSoulGainEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offSoulGain: (() => void) | null = null;
        
        offSoulGain = game.emitter.on("on:soul:gained:before", (eventData) => {
            const { eventIssuer, soul } = eventData;
            if (eventIssuer !== game.currentPlayer) return;
            if(data.issuer.card !== soul) return;
            eventData.soul = null; // Prevent the soul from being gained by the original target for now.
            game.cardHandler.removeSoul(eventIssuer, soul);
            const effect = async (effectData: EffectData): Promise<boolean> => {
                const target = (await data.selectAndRecord(game, eventIssuer, 1, 1, game.players.filter(p => p !== eventIssuer), toSerializedTranslation("pending.playerToGainSoulInstead"), data.serializedCardAndBox, true)).selected[0]!;
                if(!(target instanceof Player)) return false;
                game.cardHandler.addSoul(target, soul);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `Redirect soul gain to this card.`);
            offSoulGain?.();
            offSoulGain = null;
        });

        // // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            if(data.issuer.isDead) // Soul will be gained, and will remove the listener.
                return;
            offSoulGain?.();
            offSoulGain = null;
        });
        return true;
    };
}

// REPLACEMENT EFFECT: Starts with "this enters play" - does not use the stack.
// Card text: "This enters play deactivated."
export function enterPlayDeactivatedEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        data.it.charged = false;
        return true;
    };
}

export function lootOnNextRollEffect(game: Game, x: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offRoll: (() => void) | null = null;
        let offTurn: (() => void) | null = null;

        const willRoll = data.next as DiceWillRoll;
        if(willRoll === undefined || !(willRoll instanceof DiceWillRoll))
            return false;
        const guess = data.next;
        if(guess < 1 || guess > 6) {
            throw new GameError("lootOnNextRollEffect target must be a number between 1 and 6.", toSerializedTranslation("error.behaviorError", {error: "lootOnNextRollEffect target must be a number between 1 and 6."}));
        }
        // Listen for the next roll event on this player
        const previouslyRolledDices = game.stack.elements.filter(e => e instanceof DiceRoll);
        offRoll = game.emitter.on("on:dice:resolved", (eventData: OnRollData) => {
            const { dice } = eventData;
            if(willRoll.diceRoll !== dice)
                return;
            
            if(dice.value === guess) {
                // Create the effect that will execute when the stack resolves
                const effect = (effectData: EffectData): boolean => {
                    if (!(effectData.issuer instanceof Player)) return false;
                    game.loot(effectData.issuer, x, "other");
                    return true;
                };
                
                // Add to stack instead of executing immediately
                addPassiveEffectToStack(game, effect, data, `Loot ${x} from correct roll`);
            }
            offRoll?.();
            offRoll = null;
            offTurn?.();
            offTurn = null;
        });
        offTurn = game.emitter.on("till:turn:end", ({ eventIssuer }) => {
            offRoll?.();
            offRoll = null;
            offTurn?.();
            offTurn = null;
        });
        return true;
    };
}

export function soulDiffDCModifierOnYourTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurn: (() => void) | null = null;
        let offEndTurn: (() => void) | null = null;
        let offGainSoul: (() => void) | null = null;
        let diff = 0;
        if(game.currentPlayer === data.issuer) {
            diff = Math.max(...game.players.map((p) => p.totalSouls)) - game.currentPlayer.totalSouls;
            game.entityHandler.addDCToEachMonster(data.issuer, -diff, data.it);
        }

        offTurn = game.emitter.on("on:turn:start", (eventData: OnTurnStartData) => {
            const { eventIssuer } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(data.issuer instanceof Player)) return;

            // Calculate the difference in souls
            diff = Math.max(...game.players.map((p) => p.totalSouls)) - data.issuer.totalSouls;
            game.entityHandler.addDCToEachMonster(data.issuer, -diff, data.it);
        });

        offGainSoul = game.emitter.on("on:soul:gained", ({ eventIssuer }) => {
            if(!(data.issuer instanceof Player)) return;
            const newDiff = Math.max(...game.players.map((p) => p.totalSouls)) - data.issuer.totalSouls;
            if(newDiff !== diff) {
                game.entityHandler.addDCToEachMonster(data.issuer, - newDiff + diff, data.it);
                diff = newDiff;
            }
        });
        

        offEndTurn = game.emitter.on("on:turn:end", (eventData: OnTurnEndData) => {
            const { eventIssuer } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(data.issuer instanceof Player)) return;

            // Remove the DC modifier at the end of the turn
            game.entityHandler.addDCToEachMonster(data.issuer, diff, data.it);
            diff = 0;
        });
        data.it.cleaners.push(() => {
            offTurn?.();
            offTurn = null;
            offEndTurn?.();
            offEndTurn = null;
            offGainSoul?.();
            offGainSoul = null;
        });
        return true;
    };
}

export function gainAbilitiesUntilEffect(game: Game, triggerEvent: TriggerEvent, targetsSelector: TargetsSelector, recharge: boolean): AsyncEffectFunction {
    return async (data: EffectData) => {
        const issuer = data.issuer;
        if(data.it instanceof ItemCard === false)
            throw new GameError("gainAbilitiesUntilEffect card must be an ItemCard.", toSerializedTranslation("error.behaviorError", {error: "gainAbilitiesUntilEffect card must be an ItemCard."}));
        if(issuer instanceof Player === false)
            throw new GameError("gainAbilitiesUntilEffect issuer must be a Player.", toSerializedTranslation("error.behaviorError", {error: "gainAbilitiesUntilEffect issuer must be a Player."}));
        
        let offTrigger: (() => void) | null = null;
        if(targetsSelector.selector(issuer, data.it).length === 0)
            return false;
        const target = (await data.selectAndRecord(game, issuer, 1, 1, targetsSelector.selector(issuer, data.it), toSerializedTranslation("pending.cardToGainAbilities"), data.serializedCardAndBox, true)).selected[0]!;
        if(!target || !(target instanceof ItemCard)) {
            throw new GameError("gainAbilitiesUntilEffect target must be a Card.", toSerializedTranslation("error.behaviorError", {error: "gainAbilitiesUntilEffect target must be a Card."}));
        }
        const copiedRef = game.cardHandler.gainAbilities(issuer, data.it, target);
        
        if(recharge)
            game.cardHandler.recharge(data.it as ItemCard, data.it);

        offTrigger = game.emitter.on(triggerEvent, (eventData: any) => {
            if (data.issuer !== eventData.eventIssuer) return;
            // console.log("Cleaning up gainAbilitiesUntilEffect for", data.it.name);
            data.it.tags.copiedCards  = (data.it.tags.copiedCards as ItemCard[]).filter((c) => c !== copiedRef && c.activeEffectList.length > 0);
            copiedRef.cleanup();
            offTrigger?.();
            offTrigger = null;
        });

        return true;
    };
}

export function copyNextNonTrinketNonAmbushLootThisTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offLoot: (() => void) | null = null;
        let offTurn: (() => void) | null = null;
        const temp: TemporaryEffect = getTemporaryEffect(data);
        data.issuer.addTemporaryEffect(temp);

        // Listen for the next loot event on this player
        offLoot = game.emitter.on("on:loot:played", (eventData: OnLootPlayedData) => {
            let { eventIssuer, card, targets } = eventData;
            card = card;
            if (data.issuer !== eventIssuer) return;
            if( card.trinket) return;
            
            // Create the effect that will execute when the stack resolves
            const effect = async (effectData: EffectData): Promise<boolean> => {
                if (!(effectData.issuer instanceof Player)) return false;
                try{
                    const newTargets = await TargetBuilder.buildTargetsOnResolve(game, eventIssuer, card, "tap");
                    const copy = game.cardHandler.copyCard(card, eventIssuer) as LootCard; 
                    copy.afterEffect = "nothing";
                    const lootCardEffect = new LootCardEffect(eventIssuer, copy, newTargets);
                    game.addToStack(lootCardEffect);
                    return true;
                } catch (error) {
                    return false;
                }
            };
            
            // Add to stack instead of executing immediately
            addPassiveEffectToStack(game, effect, data, "Copy loot card effect");
            data.issuer.removeTemporaryEffect(temp);
            offLoot?.();
            offLoot = null;
            offTurn?.();
            offTurn = null;
        });
        
        offTurn = game.emitter.on("on:turn:end", () => {
            data.issuer.removeTemporaryEffect(temp);
            offLoot?.();
            offLoot = null;
            offTurn?.();
            offTurn = null;
        });
        return true;
    };
}


// REPLACEMENT EFFECT: Uses "instead" - does not use the stack.
// if another player would pay the death penalty, you choose what item they would destroy and you gain any loot cards and ¢ they would lose.
export function replaceDeathPenaltyEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offPenalty: (() => void) | null = null;
        // Listen for the next death penalty event on this player
        const issuer = data.issuer;
        if (!(issuer instanceof Player)) return false;
        const OriginalDeathPenaltyItems = game.deathPenaltyItems.bind(game);
        game.deathPenaltyItems = async (player: Player): Promise<ItemCard[]> => {
            const setOfLosableItems = player.inPlay.filter(
              (c) =>
                (c instanceof TreasureCard || (c instanceof LootCard && c.trinket)) &&
              c.eternal === false
            );
            if (game.gameParameters.deathPenaltyItem.value > 0 && setOfLosableItems.length > 0) {
              const numberOfItemsToLose = Math.min(game.gameParameters.deathPenaltyItem.value, setOfLosableItems.length);
              return (
                await game.select(issuer, numberOfItemsToLose, numberOfItemsToLose, setOfLosableItems, game.gameParameters.deathPenaltyItem.value > 1
                    ? toSerializedTranslation("pending.destroyItems")
                    : toSerializedTranslation("pending.destroyItem"), data.serializedCardAndBox, true)
              ).selected;
            }
            return [];
          }

        offPenalty = game.emitter.on("on:death:penalty", (eventData: OnDeathPenaltyData) => {
            const { eventIssuer, coinsLost, itemsLost, lootCardsLost } = eventData;
            if (issuer === eventIssuer) return;
            if(!(eventIssuer instanceof Player))
                return;
            game.gainCoins(issuer, coinsLost, data.it);
            if(lootCardsLost === undefined)
                console.warn("replaceDeathPenaltyEffect: lootCardsLost is undefined. This should not happen.");
            for (const loot of lootCardsLost)
            {
                game.cardHandler.removeCardFromHand(eventIssuer, loot);
                game.cardHandler.addCardToHand(issuer, loot);
            }
            eventData.lootCardsLost = [];
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            game.deathPenaltyItems = OriginalDeathPenaltyItems;
            offPenalty?.();
            offPenalty = null;
        });
        return true;
    };
}

export function putCounterInsteadOfDestructionEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDestroy: (() => void) | null = null;
        // Listen for the next destroy event on this card
        offDestroy = game.emitter.on("on:item:destroyed", (eventData: OnItemDestroyedData) => {
            if (!eventData.cards.includes(data.it)) return;
            if(!(data.issuer instanceof Player))
                throw new GameError("putCounterInsteadOfDestructionEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "putCounterInsteadOfDestructionEffect can only be applied to Players."}));
            const item = data.it as ItemCard;
            if(item.counters.value("normal") === 0) 
                game.cardHandler.addToCounter(data.issuer, item, "normal", 1);
            else if(item.counters.value("normal") >= 1) return; // Max 1 counters, then the item is destroyed as normal.
            eventData.cards = eventData.cards.filter(c => c !== data.it); // Prevent destruction
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDestroy?.();
            offDestroy = null;
        });
        return true;
    };
}

// [game.entityHandler.addAttackDiceModifier.bind(game.entityHandler)], 1, (player: Player) => player.coins === 0, ["on:coin:gained:after", "on:coin:lost:after"], game);
// HYBRID EFFECT: Can be either a replacement effect or triggered effect depending on useStack parameter.
// Modifies stats based on a condition (e.g., "while you have 0¢").
export function ConditionalStatModifierEffect(
    adders: ((player: Player, value: number, source: Card) => void)[],
    amount: number,
    condition: (player: Player, card: Card) => boolean,
    triggerEvents: TriggerEvent[],
    game: Game,
    useStack: boolean = true
): SyncEffectFunction {
    return (data: EffectData) => {
        if (!(data.issuer instanceof Player)) return false;
        let offEvents: (() => void)[] = [];
        
        let currentlyActive = false;
        let adderStackId: number | null = null;
        let removerStackId: number | null = null;
        const applyModifierIfConditionMet = (player: Player): void => {
            const shouldBeActive = condition(player, data.it);
            
            if (shouldBeActive && !currentlyActive) {
                if (useStack) {
                    // Create the effect that will execute when the stack resolves
                    const effect = (effectData: EffectData): boolean => {
                        if(currentlyActive === true) return true; // Already applied by another trigger
                        currentlyActive = true;
                        for (const adder of adders)
                            adder(player, amount, data.it);
                        return true;
                    };
                    adderStackId = addPassiveEffectToStack(game, effect, data, "Apply conditional stat modifier");
                } else {
                    currentlyActive = true;
                    for (const adder of adders)
                        adder(player, amount, data.it);
                }
            } else if (!shouldBeActive && currentlyActive) {
                if (useStack && removerStackId === null) {
                    // Create the effect that will execute when the stack resolves
                    const effect = (effectData: EffectData): boolean => {
                        removerStackId = null;
                        if(currentlyActive === false) return true; // Already removed by another trigger
                        currentlyActive = false;
                        const index = game.stack.elements.findIndex(element => element.stackId === adderStackId);
                        if(index !== -1)
                        {
                            game.stack.removeAt(index);
                            adderStackId = null;
                        }
                        else
                        {
                            for (const adder of adders)
                                adder(player, -amount, data.it);
                        }
                        return true;
                    };
                    removerStackId = addPassiveEffectToStack(game, effect, data, "Remove conditional stat modifier");
                } else {
                    currentlyActive = false;
                    for (const adder of adders)
                        adder(player, -amount, data.it);
                }
            }
        };
        // Initial check
        applyModifierIfConditionMet(data.issuer);
        // Listen for the trigger events
        for (const triggerEvent of triggerEvents) {
            const offEvent = game.emitter.on(triggerEvent, ({ eventIssuer }) => {
                if (data.issuer !== eventIssuer) return;
                if(!(data.issuer instanceof Player)) 
                    throw new GameError("ConditionalStatModifierEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "ConditionalStatModifierEffect can only be applied to Players."}));
                applyModifierIfConditionMet(data.issuer);
            });
            offEvents.push(offEvent);
        }

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            // Remove modifier if still active
            const index = game.stack.elements.findIndex(element => element.stackId === adderStackId);
            if (currentlyActive || index !== -1) {
                currentlyActive = false; 
                if(index !== -1)
                    {
                        game.stack.removeAt(index);
                        adderStackId = null;
                    }
                else 
                    for (const adder of adders)
                        {
                            if(!(data.issuer instanceof Player)) 
                                throw new GameError("ConditionalStatModifierEffect can only be removed from Players.", toSerializedTranslation("error.behaviorError", {error: "ConditionalStatModifierEffect can only be removed from Players."}));
                            adder(data.issuer, -amount, data.it);
                        }
            }
            // Remove event listeners
            for (const offEvent of offEvents) {
                offEvent();
            }
            offEvents = [];
        });
        return true;
    };
}

// REPLACEMENT EFFECT: Uses "prevent" - does not use the stack.
// Card text: "Prevent the next X damage you would take this turn. When you prevent damage this way, deal Y damage to another player."
// Note: The prevention is a replacement effect, but the damage dealt afterward is a triggered effect.
export function preventDamageAndDealDmgOnPreventEffect(prevent: number, deal: number, game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        for(let i = game.stack.size - 1; i >= 0; i--)
            if(game.stack.elements[i] instanceof DamageOnStack)
            {
                const damageOnStack = game.stack.elements[i] as DamageOnStack;
                if(damageOnStack.damage[0]! <= 0)
                    continue;
                if( damageOnStack.receiver === data.issuer)
                {
                    const current = damageOnStack.damage[0] ?? 0;
                    const prevented = Math.min(current, prevent);
                    damageOnStack.damage[0] = current - prevented;
                    prevent -= prevented;
                    const effect = async (data: EffectData): Promise<boolean> => {
                        if( prevented <= 0) return false;
                        if (!(data.issuer instanceof Player)) return false;
                        
                        // Deal 1 damage to another player
                        const otherPlayers = game.players.filter(p => p !== data.issuer);
                        if (otherPlayers.length === 0) return false;
                        const selection = await data.selectAndRecord(game, data.issuer, 1, 1, otherPlayers, toSerializedTranslation("pending.playerToDealDamageTo"), data.serializedCardAndBox, true, true);
                        if (selection.selected.length > 0) {
                            const chosenPlayer = selection.selected[0]!;
                            game.entityHandler.dealDamage(data.issuer, chosenPlayer, data.cardAndBox, deal);
                            return true;
                        }
                        return false;
                    }
                    addPassiveEffectToStack(game, effect, data, `Prevent ${prevent} damage and deal ${deal} damage to another player.`);
                    return true;
                }
            }
        let offDamage: (() => void) | null = null;
        let offTurn: (() => void) | null = null;
        const temp: TemporaryEffect = getTemporaryEffect(data);
        data.issuer.addTemporaryEffect(temp);

        const cleanup = (): void => {
            data.issuer.removeTemporaryEffect(temp);
            offDamage?.();
            offTurn?.();
            offDamage = null;
            offTurn = null;
        };

        // Listen for the next damage event on this player
        offDamage = game.emitter.on("on:damage:would-take", ({ eventIssuer, damageArray }) => {
            const target = data.issuer;
            if (target !== eventIssuer) return;
            const current = damageArray[0] ?? 0;
            if( current <= 0) return;
            if (!(data.issuer instanceof Player)) return;
            const effect = async (data: EffectData): Promise<boolean> => {
                const current = damageArray[0] ?? 0;
                if( current <= 0) return false;
                damageArray[0] = Math.max(0, damageArray[0]! - prevent);
                if (!(data.issuer instanceof Player)) return false;
                
                // Deal 1 damage to another player
                const otherPlayers = game.players.filter(p => p !== data.issuer);
                if (otherPlayers.length === 0) return false;
                const selection = await data.selectAndRecord(game, data.issuer, 1, 1, otherPlayers, toSerializedTranslation("pending.playerToDealDamageTo"), data.serializedCardAndBox, true, true);
                if (selection.selected.length > 0) {
                    const chosenPlayer = selection.selected[0]!;
                    game.entityHandler.dealDamage(data.issuer, chosenPlayer, data.cardAndBox, deal);
                    return true;
                }
                return false;
            }
            addPassiveEffectToStack(game, effect, data, `Prevent ${prevent} damage and deal ${deal} damage to another player.`);
            cleanup(); // One-shot: remove listeners after first use
        });

        // Expire at end of turn if unused
        offTurn = game.emitter.on("on:turn:end", cleanup);

        return true;
    };
}

export function lootPlusXExceptLootStepEffect(game: Game, x: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offLoot: (() => void) | null = null;
        // Listen for the next loot event on this player
        offLoot = game.emitter.on("on:loot:would", (eventData: OnLootWouldData) => {
            const { eventIssuer } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(eventData.reason === "lootStep") return; // Does not apply during the loot step
            eventData.numberOfCards[0]! += x;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offLoot?.();
            offLoot = null;
        });
        return true;
    };
}


export function changeRollXToYEffect(game: Game, x: number, y: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offRoll: (() => void) | null = null;
        // Listen for the next would roll event on this player
        offRoll = game.emitter.on("on:dice:would-roll", ({eventIssuer, diceRoll}: OnDiceWouldRollData) => {
            if (data.issuer !== diceRoll.issuer) return;
            if (diceRoll.value === x) {
                // Create the effect that will execute when the stack resolves
                const effect = async (effectData: EffectData): Promise<boolean> => {
                    if (!(effectData.issuer instanceof Player)) return false;
                    const value = (await effectData.selectAndRecord(game, effectData.issuer, 0, 1, [y], toSerializedTranslation("pending.resultOfDiceRoll"), data.serializedCardAndBox, true, true)).selected[0]!;
                    if(!value) return false; // Player chose not to change the roll
                    diceRoll.value = value;
                    return true;
                };
                
                // Add to stack instead of executing immediately
                addPassiveEffectToStack(game, effect, data, `You may change roll ${x} to ${y}`);
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

export function giveThisToAnotherPlayerInsteadOfDiscardEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDiscard: (() => void) | null = null;
        offDiscard = game.emitter.on("on:card:discarded:before", (eventData: OnCardDiscardBeforeData) => {
            if(data.it !== eventData.card) return;
            eventData.card = null; // Prevent the card from being discarded for now.
            data.it.cleanup();
            const effect = async (effectData: EffectData): Promise<boolean> => {
                if (!(effectData.issuer instanceof Player)) return false;
                if(data.it instanceof MonsterCard === false) return false;
                const otherPlayers = game.players.filter(p => p !== effectData.issuer);
                if (otherPlayers.length === 0) return true; // No other players to give the card to, so just let it be discarded.
                const selection = await effectData.selectAndRecord(game, effectData.issuer, 1, 1, otherPlayers, toSerializedTranslation("pending.playerToGiveCardTo"), data.serializedCardAndBox, true, true);
                if (selection.selected.length > 0) {
                    const chosenPlayer = selection.selected[0]!;
                    await game.cardHandler.addCurse(chosenPlayer, data.it);
                }
                return true;
            };
            offDiscard?.();
            offDiscard = null;
            addPassiveEffectToStack(game, effect, data, `Give this card to another player instead of discarding it.`);
        });
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
        });
        return true;
    };
}

export function changeRollToXIfItIsXEffect(game: Game, values: number[], x: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offEndTurn: (() => void) | null = null;
        let offRoll: (() => void) | null = null;
        // Listen for the next would roll event on this player
        offRoll = game.emitter.on("on:dice:would-roll", ({eventIssuer, diceRoll}: OnDiceWouldRollData) => {
            if (values.includes(diceRoll.value)) {
                // Create the effect that will execute when the stack resolves
                const effect = (effectData: EffectData): boolean => {
                    diceRoll.value = x;
                    return true;
                };
                
                // Add to stack instead of executing immediately
                addPassiveEffectToStack(game, effect, data, `Change the roll to ${x}`);
            }
        });
        offEndTurn = game.emitter.on("till:turn:end", () => {
            offRoll?.();
            offRoll = null;
            offEndTurn?.();
            offEndTurn = null;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offRoll?.();
            offRoll = null;
            offEndTurn?.();
            offEndTurn = null;
        });
        return true;
    };
}


export function gainPlusTreasureEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offGainTreasure: (() => void) | null = null;
        offGainTreasure = game.emitter.on("on:item:gained", (eventData: OnItemGainedData) => {
            if (data.issuer !== eventData.eventIssuer) return;
            if (data.issuer instanceof Player === false) return false;
            eventData.amount ++;
            return true;
        });
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offGainTreasure?.();
            offGainTreasure = null;
        });
        return true;
    };
}


export function onFirstDamageEachTurnEffect(functions: EffectFunction[], game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        offDamage = game.emitter.on("on:damage:taken:first-time-each-turn", (eventData: OnDamageTakenData) => {
            const { eventIssuer, damage: dmg } = eventData;
            if (data.issuer !== eventIssuer) return;
            
            // Create the effect that will execute when the stack resolves
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of functions)
                    await func(effectData);
                return true;
            };
            
            // Add to stack instead of executing immediately
            addPassiveEffectToStack(game, effect, data, "On first damage each turn effect");
        });
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}


// REPLACEMENT EFFECT: Uses "instead" - does not use the stack.
// Card text: "If this would be destroyed, it becomes a soul instead."
export function becomeSoulInsteadOfDestructionEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDestroy: (() => void) | null = null;
        // Listen for the next damage event on this player
        offDestroy = game.emitter.on("on:item:destroyed", (eventData: OnItemDestroyedData) => {
            const { eventIssuer, cards } = eventData;
            eventData.cards = eventData.cards.filter(c => c !== data.it);
            if (!(data.issuer instanceof Player)) return;
            if (!cards.includes(data.it)) return;
            data.it.soul = 1;
            game.cardHandler.addSoul(data.issuer, data.it);
            if(!(data.it instanceof ItemCard))
                throw new GameError("becomeSoulInsteadOfDestructionEffect can only be applied to ItemCards.", toSerializedTranslation("error.behaviorError", {error: "becomeSoulInsteadOfDestructionEffect can only be applied to ItemCards."}));
            game.cardHandler.removeInPlay(data.issuer, data.it);
        });
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDestroy?.();
            offDestroy = null;
        });
        return true;
    };
}

// REPLACEMENT EFFECT: Modifies purchase cost - does not use the stack.
// Reduces the cost of shop items.
export function shopItemsCostLessEffect(discount: number, game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const issuer = data.issuer;
        if(!(issuer instanceof Player)) 
            throw new GameError("shopItemsCostLessEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "shopItemsCostLessEffect can only be applied to Players."}));
        issuer.priceModifier -= discount;
        data.it.cleaners.push(() => {
            issuer.priceModifier += discount;
        });
        return true;
    };
}


export function monstersYouAttackModifiers(game: Game, modifier: number): SyncEffectFunction{
    return (data: EffectData) => {
        let offDeclareAttack: (() => void) | null = null;
        let offEndTurn: (() => void) | null = null;
        offDeclareAttack = game.emitter.on("on:attack:declared:monster", (eventData: OnAttackDeclaredMonsterData) => {
            const newData = new EffectData(data.it, data.issuerProvider, [eventData.monster[0]]);
            temporaryStatModifierEffect([game.entityHandler.addDC.bind(game)], modifier, game, "next")(newData);
        });
        offEndTurn =  game.emitter.on("on:turn:end", () => {
            offDeclareAttack?.();
            offDeclareAttack = null;
            offEndTurn?.();
            offEndTurn = null;

        });
        return true;
    };
}

export function itemCostLessToActivateEffect(game: Game, discount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offLoseCoin: (() => void) | null = null;
        if(!(data.issuer instanceof Player))
            throw new GameError("itemCostLessToActivateEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "itemCostLessToActivateEffect can only be applied to Players."}));
        offLoseCoin = game.emitter.on("on:coin:lost:before", (eventData: OnCoinsLostBeforeData) => {
                const { eventIssuer, coinToLose, reason } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(reason !== "paiement") return;
            eventData.coinToLose = Math.max(0, coinToLose - discount);
        });
        data.it.cleaners.push(() => {
            offLoseCoin?.();
            offLoseCoin = null;
        });
        return true;
    };
}


export function onMonsterDeathEffect(
    effectFunctions: EffectFunction[],
    game: Game,
    description: string): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
            const { eventIssuer, target } = eventData;
            if (!(eventIssuer instanceof Monster)) return;
            
            // Add all effects as a single stack element
            const effect = async (effectData: EffectData): Promise<boolean> => {
                if(description.includes(" the player who killed it "))
                {
                    data.targets = [];
                    data.clearSelectionRecord();
                    effectData.addTarget(target);
                }
                for (const func of effectFunctions) {
                    await func(effectData);
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, description);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function lootStepEffect(
    effectFunctions: SyncEffectFunction[],
    game: Game,
    anyPlayer: boolean = false
): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;

        offDamage = game.emitter.on("on:loot:step", (eventData: OnLootStepData) => {
            const { eventIssuer } = eventData;
            if (!anyPlayer && data.issuer !== eventIssuer) return;
            if(anyPlayer)
                data.issuerProvider = (): Entity => eventIssuer;
            for (const func of effectFunctions)
                func(data);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

// "Each time a player dies, before paying penalties, loot 1."
export function lootOnPlayerDeathEffect(
    amount: number,
    game: Game
): SyncEffectFunction {
    return (data:EffectData) => {
        let offDeath: (() => void) | null = null;

        const cleanup = (): void => {
            offDeath?.();
            offDeath = null;
        };

        // Listen for damage events on this player
        offDeath = game.emitter.on("on:death:before-penalty", (eventData: OnDeathBeforePenaltyData) => {
            const { eventIssuer, target: from, source } = eventData;
            if (eventIssuer instanceof Player) {
                // Create the effect that will execute when the stack resolves
                const effect = (effectData: EffectData): boolean => {
                    if (!(effectData.issuer instanceof Player)) 
                        throw new GameError("lootOnPlayerDeathEffect can only be applied to Players.", toSerializedTranslation("error.behaviorError", {error: "lootOnPlayerDeathEffect can only be applied to Players."}));
                    game.loot(effectData.issuer, amount);
                    return true;
                };
                
                // Add to stack instead of executing immediately
                addPassiveEffectToStack(game, effect, data, `Loot ${amount} on player death`);
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            cleanup();
        });

        return true;
    };
}
// If you would gain any number of \u00A2, gain that much + amount\u00A2 instead.
// REPLACEMENT EFFECT: Uses "if you would" and "instead" - does not use the stack.
// Card text: "If you would gain any number of ¢, gain that much +X¢ instead."
export function gainPlusCoinsEffect(
    amount: number,
    game: Game
): SyncEffectFunction {
    return (data:EffectData) => {
        let offGainCoin: (() => void) | null = null;

        const cleanup = (): void => {
            offGainCoin?.();
            offGainCoin = null;
        };

        // Listen for the next damage event on this player
        offGainCoin = game.emitter.on("on:coin:gained", (eventData: OnCoinGainedData) => {
            const { eventIssuer, coinGained } = eventData;
            if (data.issuer !== eventIssuer) return;
            const current = coinGained[0] ?? 0;
            coinGained[0] = current + amount;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            cleanup();
        });

        return true;
    };
}

export function lootAfterFlippingEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offFlip: (() => void) | null = null;

        offFlip = game.emitter.on("on:card:flipped", (eventData: OnCardFlippedData) => {
            const { eventIssuer, card } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(card !== data.it) return;

            // Create the effect that will execute when the stack resolves
            const effect = (effectData: EffectData): boolean => {
                if (!(effectData.issuer instanceof Player)) return false;
                game.loot(effectData.issuer, amount);
                return true;
            };
            
            // Add to stack instead of executing immediately
            addPassiveEffectToStack(game, effect, data, `Loot ${amount} after flipping`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offFlip?.();
            offFlip = null;
        });
        return true;
    };
}

// Each time you roll an attack roll, 
export function onAttackRollEffect(
    rollValues: number[],
    effect: EffectFunction,
    game: Game,
    event: "on:attack:roll:modifier" | "on:attack:roll"
): SyncEffectFunction {
    return (data:EffectData) => {
        let offEffect: (() => void) | null = null;
        // Listen for the next damage event on this player
        offEffect = game.emitter.on(event, (eventData: OnRollData) => {
            const { eventIssuer, dice } = eventData;
            if (data.issuer !== eventIssuer) return;
            if (rollValues.includes(dice.value)) {
                // Create the effect that will execute when the stack resolves
                const stackEffect = async (effectData: EffectData): Promise<boolean> => {
                    return effect(effectData);
                };
                
                // Add to stack instead of executing immediately
                addPassiveEffectToStack(game, stackEffect, data, "On attack roll effect");
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offEffect?.();
            offEffect = null;
        });
        return true;
    };
}

// Each time the attacking player rolls an attack roll of X
export function onAttackingPlayerRollEffect(
    rollValues: number[],
    effect: EffectFunction,
    game: Game,
    diceIssuerIssueTheEvent: boolean = false
): SyncEffectFunction {
    return (data: EffectData) => {
        let offEffect: (() => void) | null = null;
        
        offEffect = game.emitter.on("on:dice:resolved", (eventData: OnRollData) => {
            const { dice } = eventData;
            if( !dice.issuer.isEngagedInCombat || !dice.attackRoll || data.it.entity === undefined || !data.it.entity.isEngagedInCombat)
                return;
            // Only trigger for attack rolls with specified values
            if (rollValues.includes(dice.value)) {
                // Create the effect that will execute when the stack resolves
                const copyData = data;
                if(diceIssuerIssueTheEvent && dice.issuer !== undefined)
                    copyData.issuerProvider = (): Entity => dice.issuer;
                const stackEffect = async (effectData: EffectData): Promise<boolean> => {
                    return effect(effectData);
                };
                
                // Add to stack instead of executing immediately
                addPassiveEffectToStack(game, stackEffect, copyData, "On attacking player attack roll effect");
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offEffect?.();
            offEffect = null;
        });
        return true;
    };
}

export function onWouldRollEffect(
    effectFunctions: EffectFunction[],
    values: number[],
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;

        offDamage = game.emitter.on("on:dice:would-roll", ({eventIssuer, diceRoll}: OnDiceWouldRollData) => {
            // if (data.issuer !== eventIssuer) return;
            if (!values.includes(diceRoll.value)) return;
            const newData = new EffectData(data.it, data.issuerProvider, [diceRoll], data.visualEffectBox);
            
            // Create the effect that will execute when the stack resolves
            const effect = async (effectData: EffectData): Promise<boolean> => {
                for (const func of effectFunctions)
                    await func(effectData);
                return true;
            };
            
            // Add to stack instead of executing immediately
            addPassiveEffectToStack(game, effect, newData, "On would roll effect");
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function onRollEffect(
    rollValues: number[],
    effect: EffectFunction,
    game: Game,
    diceIssuerIssueTheEvent: boolean = false
): SyncEffectFunction {
    return (data: EffectData) => {
        let offEffect: (() => void) | null = null;
        // Listen for the next damage event on this player
        offEffect = game.emitter.on("on:dice:resolved", (eventData: OnRollData) => {
            const { dice } = eventData;
            // For monsters, only trigger if the monster is currently engaged in combat
            // if (data.issuer instanceof Monster && !data.issuer.isEngagedInCombat) {
            //     return;
            // }
            if (rollValues.includes(dice.value))
            {
                const newData:EffectData =  new EffectData(data.it, data.issuerProvider, [dice], data.visualEffectBox);
                
                // Create the effect that will execute when the stack resolves
                const stackEffect = async (effectData: EffectData): Promise<boolean> => {
                    return effect(effectData);
                };
                
                if (diceIssuerIssueTheEvent && dice.issuer !== undefined) {
                    newData.issuerProvider = (): Entity => dice.issuer;
                    newData.targets = [];
                }
                // Add to stack instead of executing immediately
                addPassiveEffectToStack(game, stackEffect, newData, "On roll effect");
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offEffect?.();
            offEffect = null;
        });
        return true;
    };
}

// When the active player rolls a specific value
export function onActivePlayerRollEffect(
    rollValues: number[],
    effect: EffectFunction,
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        let offEffect: (() => void) | null = null;
        
        offEffect = game.emitter.on("on:dice:resolved", (eventData: OnRollData) => {
            const { dice } = eventData;
            // Only trigger if the roll issuer is the active player
            if (dice.issuer !== game.currentPlayer) {
                return;
            }
            
            if (rollValues.includes(dice.value)) {
                // Create the effect that will execute when the stack resolves
                const stackEffect = async (effectData: EffectData): Promise<boolean> => {
                    return effect(effectData);
                };
                // Add to stack instead of executing immediately
                addPassiveEffectToStack(game, stackEffect, data, "On active player roll effect");
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offEffect?.();
            offEffect = null;
        });
        return true;
    };
}

// REPLACEMENT EFFECT: Uses "this enters play" - does not use the stack.
export function startWithNCountersEffect(
    n: number,
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        if(!data.it.counters.isDefined("normal"))
            game.cardHandler.addToCounter(data.issuer, data.it, "normal", n);
        return true;
    };
}


export function attackingPlayerDealDamageOnRollOf(
    game: Game,
    n: number,
    s: string
): SyncEffectFunction {
    return onAnyEventEffect("on:dice:resolved", [], game, s,
            (data: EffectData, event: OnRollData) =>
            {
                if(!event.dice.attackRoll) return false;
                const target = event.dice.attackData?.target;
                if(target !== data.issuer) return false;
                if(event.dice.value !== n) return false;
                if(event.eventIssuer.isEngagedInCombat === false || target.isEngagedInCombat === false) return false;
                const effect: SyncEffectFunction = active.dealDamageToTargetEffect(game, game.entityHandler.getAttack(event.eventIssuer),false, [], "current");
                const newData: EffectData = new EffectData(data.it, ()=>event.eventIssuer, [target], data.visualEffectBox);
                addPassiveEffectToStack(game, effect, newData, s, data.visualEffectBox);
                return true;
            },
            false
         );
}

// REPLACEMENT EFFECT: Uses "prevent" - does not use the stack.
// Card text: "If you would take damage while this has counters on it, remove that many counters and prevent that much damage."
export function preventDamageByRemovingCountersEffect(
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        let offEffect: (() => void) | null = null;

        const cleanup = (): void => {
            offEffect?.();
            offEffect = null;
        };

        // Listen for the next damage event on this player
        offEffect = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, damageArray } = eventData;
            if (data.issuer !== eventIssuer) return;
            const counters = data.it.counters.value("normal") ?? 0;
            if(counters < 0) 
                throw new GameError("preventDamageByRemovingCountersEffect: counters cannot be negative.", toSerializedTranslation("error.behaviorError", {error: "preventDamageByRemovingCountersEffect: counters cannot be negative."}));
            const current = damageArray[0] ?? 0;
            const prevented = Math.min(current, counters);
            damageArray[0] = current - prevented;
            game.cardHandler.addToCounter(data.issuer, data.it, "normal", -prevented);
            if(counters <= 0) 
                data.it.cleanup();
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            cleanup();
        });

        return true;
    };
}

export function preventDamageAndDealOnDeathEffect(game: Game, damagePrevented: number, damageAmount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        let offDeath: (() => void) | null = null;

        const cleanup = (): void => {
            offDamage?.();
            offDeath?.();
            offDamage = null;
            offDeath = null;
        };
        if(!(data.issuer instanceof Player)) return false;

        const target = data.next;
        if(!target || !(target instanceof Player)) return false;
        const newData = new EffectData(data.it, () => target, [], data.visualEffectBox);
        preventNextDamageUpToEffect(damagePrevented, game)(newData); // Reuse the preventNextDamageUpToEffect to handle the prevention part
        // Listen for death of the player from this damage
        offDeath = game.emitter.on("on:death:before-penalty", (deathEventData: OnDeathBeforePenaltyData) => {
            const { eventIssuer } = deathEventData;
            if (target !== eventIssuer) return;

            for(const player of game.players) {
                if(player !== data.issuer && !player.isDead && player !== eventIssuer) {
                    game.entityHandler.dealDamage(data.issuer, player, data.cardAndBox, damageAmount);
                }
            }

            cleanup(); // One-shot: remove listeners after triggering
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            cleanup();
        });

        return true;
    };
}
export function eachOtherPlayerRevealsHandEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        for(const player of game.players) {
            if(player !== data.issuer) {
                player.handRevealed = true;
            }
        }
        data.it.cleaners.push(() => {
            for(const player of game.players) {
                if(player !== data.issuer) {
                    player.handRevealed = false;
                }
            }
        });
        return true;
    };
}


export function nextRollModifier(game: Game, type: "any" | "attack", amount: number, issuerType: "any" | "active"): SyncEffectFunction
{
    const event:TriggerEvent = type === "any" ? "on:dice:resolved" : "on:attack:roll";
    return (data: EffectData) => {
        let offTurn: (() => void) | null = null;
        let offRoll: (() => void) | null = null;
        const tempEffect = getTemporaryEffect(data);
        game.currentPlayer.addTemporaryEffect(tempEffect);

        let players = issuerType === "active" ? [game.currentPlayer] : game.players;
        for(const player of players)
            game.entityHandler.addAttackDiceModifier(player, amount, data.it);
        

        offTurn = game.emitter.on("on:turn:end", (eventData: OnTurnStartData) => {
            clean();
        });
        
        offRoll = game.emitter.on(event, (eventData: OnRollData) => {
            if(type === "attack" && !eventData.dice.attackRoll) return;
            if(issuerType === "active" && eventData.eventIssuer !== game.currentPlayer) return;
            clean();
        });

        // Store cleanup function
        const clean = () => {
            game.currentPlayer.removeTemporaryEffect(tempEffect);
            for(const player of players)
                game.entityHandler.addAttackDiceModifier(player, -amount, data.it);
            offTurn();
            offRoll();
        }
        
        return true;
    };
}

// REPLACEMENT EFFECT: Uses "if you would" and "instead" - does not use the stack.
// Card text: "If you would take any amount of damage, take that much damage +X instead."
export function takeDamagePlusEffect(
    amount: number,
    game: Game
): SyncEffectFunction {
    return (data:EffectData) => {
        let offDamage: (() => void) | null = null;

        const cleanup = (): void => {
            offDamage?.();
            offDamage = null;
        };

        // Listen for the next damage event on this player
        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, damageArray } = eventData;
            if (data.issuer !== eventIssuer) return;
            const effect:EffectFunction = () => 
                {
                    const current = damageArray[0] ?? 0;
                    damageArray[0] = current + amount;
                    return true;
                }
            addPassiveEffectToStack(game, effect, data, "", data.visualEffectBox);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            cleanup();
        });

        return true;
    };
}

// REPLACEMENT EFFECT: Uses "if you would" and "instead" - does not use the stack.
// Card text: "If you would loot any number of loot cards, loot double that number instead."
export function lootDoubleThisTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offEffect: (() => void) | null = null;
        let offEndTurn: (() => void) | null = null;
        const temp: TemporaryEffect = getTemporaryEffect(data);
        data.issuer.addTemporaryEffect(temp);
        const target = data.next;
        // Listen for the next damage event on this player
        offEffect = game.emitter.on("on:loot:would", (eventData: OnLootWouldData) => {
            const { eventIssuer, numberOfCards } = eventData;
            if (target !== eventIssuer) return;
            numberOfCards[0]! *= 2;
        });

        offEndTurn = game.emitter.on("till:turn:end", (eventData: OnTurnEndData) => {
            const { eventIssuer } = eventData;
            data.issuer.removeTemporaryEffect(temp);
            offEffect?.();
            offEffect = null;
            offEndTurn?.();
            offEndTurn = null;
        });

        // Store cleanup function on the card for when it's removed/destroyed

        return true;
    };
}
export function killOnDoubleAttackRollEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offEffect: (() => void) | null = null;
        let offTurn: (() => void) | null = null;

        let prevRollThisTurn: number | null = null;
        // Listen for the next damage event on this player
        offEffect = game.emitter.on("on:attack:roll", (eventData: OnRollData) => {
            const { eventIssuer, dice } = eventData;
            const target = dice.attackTarget;
            if(data.issuer !== eventIssuer) return;
            if(prevRollThisTurn === dice.value)
                game.entityHandler.kill(data.issuer, target, data.cardAndBox);
            prevRollThisTurn = dice.value;
        });

        offTurn = game.emitter.on("on:turn:end", () => {
            prevRollThisTurn = null;
        });



        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offEffect?.();
            offEffect = null;
        });
        return true;
    };
}

// REPLACEMENT EFFECT: Uses "instead" - does not use the stack.
// Card text: "The next time a player would loot, they loot from the top of the loot discard instead."
// Replaces the source deck for looting.
export function lootFromDiscardEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offEffect: (() => void) | null = null;
        // Listen for the next damage event on this player
        offEffect = game.emitter.on("on:loot:would", (eventData: OnLootWouldData) => {
            const { eventIssuer, numberOfCards } = eventData;
            while(numberOfCards[0]! > 0)
            {
                const card = 
                    game.decks["loot"]!.drawTopDiscard();
                if(card)
                    game.cardHandler.addCardToHand(eventIssuer, card);
                else break;
                numberOfCards[0]! -= 1;
            }
            offEffect?.();
            offEffect = null;
        });
        return true;
    };
}

export function doubleRewardsTillEndOfTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offEffect: (() => void) | null = null;
        let offEndTurn: (() => void) | null = null;

        offEffect = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
            const effect = (effectData: EffectData): boolean => {
                game.entityHandler.entityRewards(eventData.eventIssuer as Monster);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `Double rewards.`);
        }
        );
        
        offEndTurn = game.emitter.on("on:turn:end", (eventData: OnTurnEndData) => {
            const { eventIssuer } = eventData;
            offEffect?.();
            offEffect = null;
            offEndTurn?.();
            offEndTurn = null;
        });
        return true;
    };
}

// REPLACEMENT EFFECT: Uses "if you would" and "instead" - does not use the stack.
// Card text: "If you would gain any amount of ¢, this levels up by that much instead."
export function gainCoinsLevelUpEffect(
    game: Game
): SyncEffectFunction {
    return (data: EffectData) => {
        let offEffect: (() => void) | null = null;

        const cleanup = (): void => {
            offEffect?.();
            offEffect = null;
        };

        // Listen for the next damage event on this player
        offEffect = game.emitter.on("on:coin:gained", (eventData: OnCoinGainedData) => {
            const { eventIssuer, coinGained } = eventData;
            if (data.issuer !== eventIssuer) return;
            const current = coinGained[0] ?? 0;
            game.cardHandler.addToCounter(data.issuer, data.it, "normal", current);
            coinGained[0] = 0;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            cleanup();
        });

        return true;
    };
}

// Roll dice on trigger
// REPLACEMENT EFFECT: Uses "prevent" - does not use the stack.
// Card text: "Each time you would take damage, roll- X: prevent Y of that damage."
export function preventDamageOnRollEffect(
    diceValues: number[],
    damagePrevented: number,
    game: Game
): SyncEffectFunction {
    return (data:EffectData) => {
        let offEffect: (() => void) | null = null;

        const cleanup = (): void => {
            offEffect?.();
            offEffect = null;
        };
        // Listen for the next damage event on this player
        offEffect = game.emitter.on("on:damage:would-take", ({ eventIssuer, damageArray }) => {
            if (data.issuer !== eventIssuer) return;
            if (!(data.issuer instanceof Player)) return;
            if(damageArray[0]! <= 0) return;
            const roll:DiceRoll = game.rollDice(data.issuer, data.it);
            const effects: EffectFunction[] = new Array<EffectFunction>(6).fill((data:EffectData): boolean => { return true; });
            for (const val of diceValues) {
                effects[val - 1] = (data:EffectData): boolean => { 
                    damageArray[0]! -= damagePrevented; 
                    return true; 
                };
            }
            roll.attachEffect(effects, data.it, []);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            cleanup();
        });
        return true;
    };  
}

// Starts with if: replacement effect.
export function goFirstInTurnOrderEffect(game: Game): SyncEffectFunction {
    return (data:EffectData) => {
        let offEffect: (() => void) | null = game.emitter.on("on:game:start:before", () => {
            if (!(data.issuer instanceof Player)) return;
            game.turnHandler.setFirstPlayer(data.issuer);
            offEffect?.();
            offEffect = null;
        });
        return true;
    };
}

export function startingItemEffect(game: Game, x: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offEffect: (() => void) | null = game.emitter.on("on:game:start", async () => {
            game.addPromise(active.selectEternalAmongX(game, x)(data));
            offEffect?.();
            offEffect = null;
            return true;
        });
        return true;
    };
}