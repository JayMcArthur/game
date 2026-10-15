// A monster effect is an effect that is applied by a monster card.


import { type TriggerEvent } from '@/models/types/eventTypes';
import { Card, MonsterCard } from "../cards";
import { Entity } from "../entities/entity";
import { Game } from "../game";
import { GameError } from "@/models/GameError";
import { Monster } from "../entities/monster";
import { Player } from "../entities/player";
import { DamageOnStack, DiceRoll } from "../stackElement";
import { EffectData, type EffectFunction, type SyncEffectFunction, type AsyncEffectFunction, type TargetsSelector } from "../types/cardTypes";
import type {
    OnAttackDeclaredData,
    OnAttackDeclaredMonsterData,
    OnDamageTakenData,
    OnDamageWouldTakeData,
    OnDeathMonsterData,
    OnDeathWouldDeathData,
    OnDiceBeingRolledData,
    OnGetMonsterAttackPointsData,
    OnGetMonsterEvasionData,
    OnItemActivatedData,
    OnSoulGainedOrRemovedData,
    OnTurnEndData,
    OnCardFlippedData,
    OnAttackDeclaredAnimatedData,
    OnRollData,
} from "../types/eventTypes";
import * as active from "./activeEffect";
import { addInPlayEffect } from "./activeEffect";
import { effectParser } from "./parsing/effectParser";
import { addPassiveEffectToStack } from "./passiveEffect";
import { makeAnAttackRollAfterEachAttackRollEffect } from './roomEffects';
import { Animated } from '../entities/animated';
import { toSerializedTranslation } from '@/utils/translation';

export function thisHealsEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        let target = data.issuer;
        if(!(data.issuer instanceof Monster))
            target = game.monsters.find((m) => m.json.globalId === data.it.globalId)!;
        if(!target)
            throw new GameError("thisHealsEffect effect could not find the monster to heal.",
                toSerializedTranslation("error.behaviorError", { error: "thisHealsEffect effect could not find the monster to heal." })
            );
        game.entityHandler.heal(target, amount);
        return true;
    };
}

export function activePlayerMayAttackMonsterDeckEffect(game: Game, numberOfTimes: number): SyncEffectFunction {
    return (data: EffectData) => {
        const player = game.currentPlayer as Player;
        player.mayAttackForFreeThis("topDeck", numberOfTimes);
        return true;
    };
}

export function activePlayerMustMakeAdditionalAttackEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const player = game.currentPlayer as Player;
        game.entityHandler.playerMustAttack(player, "any", data.it, false);
        return true;
    };
}

export function attackRollsAgainstEachOtherPlayerEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offAttackDeclared: (() => void) | null = null;
        offAttackDeclared = game.emitter.on("on:attack:declared:monster", (eventData: OnAttackDeclaredMonsterData) => {
            const { eventIssuer, monster } = eventData;
            if (data.issuer !== monster[0]) return;
                const otherPlayers = game.players.filter(p => p !== eventIssuer);
                for(const player of otherPlayers) {
                    makeAnAttackRollAfterEachAttackRollEffect(game)(new EffectData(data.it, () => player, [], data.visualEffectBox));
                }
                return true;
        });
        data.it.cleaners.push(() => {
            offAttackDeclared?.();
            offAttackDeclared = null;
        });
        return true;
    };
}

export function killerGainsRewardsEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDeath: (() => void) | null = null;

        offDeath = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
            const { eventIssuer, target, source } = eventData;
            if (data.issuer !== eventIssuer) return;
            const player = target instanceof Player ? target : eventIssuer;
            if(player instanceof Player === false)
                return false;
            eventData.rewardGainer = player;
        });
        data.it.cleaners.push(() => {
            offDeath?.();
            offDeath = null;
        });
        return true;
    };
}

export function discardEachOtherMonsterEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        for(const monster of game.monsters)
            if(monster !== data.it.entity)
                game.encounters.flushMonster(monster, "discard");
        return true;
    };
}

export function putHarbingersIntoMonsterSlotEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const card = game.obtainCardFromOutsideGame("r-the_harbingers");
        if(!card || !(card instanceof MonsterCard))
            return false;
        const index:number = 0; // does not matter, it is indomitable, so it move to an expended slot anyway.
        game.encounters._deck.addTopPosition(card);
        game.encounters.draw(index);
        return true;
    };
}

export function flipIfXCountersEffect(game: Game, x: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offCounterAdded: (() => void) | null = null;
        offCounterAdded = game.emitter.on("on:counter:modified", (eventData) => {
            if (data.it !== eventData.card) return;
            if (eventData.newValue < x) return;
            game.cardHandler.flip(data.it.owner as Player, data.it);
        });
        data.it.cleaners.push(() => {
            offCounterAdded?.();
            offCounterAdded = null;
        });
        return true;
    };
}

export function preventDeathGainTreasureCancelAttackAndHealEffect(game: Game, x: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offWouldDeath: (() => void) | null = null;
        offWouldDeath = game.emitter.on("on:death:would-death", (eventData: OnDeathWouldDeathData) => {
            if(eventData.eventIssuer.card !== data.it) return;
            game.entityHandler.preventDeath(eventData.eventIssuer);
            game.cardHandler.addToCounter(data.issuer, data.it, "normal", 1);
            game.entityHandler.heal(data.issuer, 9999);
            game.gainTreasure(game.currentPlayer, x);
            game.entityHandler.endCombat();
        });

        data.it.cleaners.push(() => {
            offWouldDeath?.();
            offWouldDeath = null;
        });
        return true;
    };
}

export function eachPlayerRollLowestOrTiedForLowestDiesEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const targets = game.players.filter(p => !p.isDead);
        const dices:DiceRoll[] = [];
        if(data.issuer instanceof Monster === false)
            throw new GameError("eachPlayerRollLowestOrTiedForLowestDiesEffect can only be applied when the issuer is a monster.",
        toSerializedTranslation("error.behaviorError", { error: "eachPlayerRollLowestOrTiedForLowestDiesEffect can only be applied when the issuer is a monster." }));
        const effect:EffectFunction = (effectData: EffectData) => {
            const lowestValue = Math.min(...dices.map(d => d.value));
            const playersToDie = dices.filter((dice) => dice.value === lowestValue).map(d => d.issuer);
            for(const player of playersToDie) {
                game.entityHandler.kill(data.issuer, player, data.cardAndBox);
            }
            return true;
        }
        addPassiveEffectToStack(game, effect, data, `Each player who rolls the lowest or tied for the lowest dies.`);
        for(const target of targets) {
            dices.push(game.rollDice(target, data.it));
        }
        return true;
    };
}

export function onFlipOrAttackedRollLowestDieEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offFlip: (() => void) | null = null;
        let offAttacked: (() => void) | null = null;

        offAttacked = game.emitter.on("on:attack:declared:monster", (eventData: OnAttackDeclaredMonsterData) => {
            if (data.issuer !== eventData.monster[0]) return;
            eachPlayerRollLowestOrTiedForLowestDiesEffect(game)(data);
        });

        
        offFlip = game.emitter.on("on:card:flipped", (eventData: OnCardFlippedData) => {
            const { eventIssuer, card } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(card !== data.it) return;
            eachPlayerRollLowestOrTiedForLowestDiesEffect(game)(data);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offFlip?.();
            offFlip = null;
            offAttacked?.();
            offAttacked = null;
        });
        return true;
    };
}

export function activePlayerSelectAndCallEffect(game: Game, effectFunction: EffectFunction, currentPlayerIsTarget: boolean=false, anotherPlayer: boolean=false, may: boolean=false): AsyncEffectFunction {
    return async (data: EffectData) => {
        const player = game.currentPlayer as Player;
        
        const targetSelection = await data.selectAndRecord(game, player, (may ? 0 : 1), 1, game.players.filter(p => !anotherPlayer || p !== player), toSerializedTranslation("selector.player"), data.serializedCardAndBox, true, true);
        const targetPlayer = targetSelection.selected[0] as Player;
        if(!targetPlayer){
            return false;
        }
        await effectFunction(new EffectData(data.it, () => targetPlayer, (currentPlayerIsTarget ? [player] : []), data.visualEffectBox));
        return true;
    };
}

export function activePlayerIsTargetedByEffect(game: Game, effectFunction: EffectFunction): AsyncEffectFunction {
    return async (data: EffectData) => {
        const player = game.currentPlayer as Player;
        await effectFunction(new EffectData(data.it, () => data.issuer, [player], data.visualEffectBox));
        return true;
    };
}

export function activePlayerSelectTargetEffect(game: Game, effectFunction: EffectFunction, ts: TargetsSelector, record: boolean = true): AsyncEffectFunction {
    return async (data: EffectData) => {
        const issuer = game.currentPlayer as Player;
        const target = (await data.selectAndRecord(game, issuer as Player, ts.min, ts.max, ts.selector(issuer as Player, data.it), ts.description, data.serializedCardAndBox, true, record)).selected;
        if(target.length > 0)
            await effectFunction(new EffectData(data.it, () => issuer, target, data.visualEffectBox));
        return true;
    };
}

export function whenThisReachesXHP(game: Game, x: number, effectFunctions: EffectFunction[], description: string): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target, source, damage } = eventData;
            if (data.issuer !== eventIssuer && data.it.entity !== eventIssuer) return;
            const currentHP = eventIssuer.currentHealthPoints;
            if (currentHP === x) {

               const effect = async (effectData: EffectData): Promise<boolean> => {
                    for (const func of effectFunctions) {
                        await func(effectData);
                    }
                    return true;
                };
                addPassiveEffectToStack(game, effect, data, description);
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };   
}

export function targetTakeDamageEffect(game: Game, damage: number): SyncEffectFunction {
    return (data: EffectData) => {
        const target = data.next;
        if(!(target instanceof Entity))
            throw new GameError("targetTakeDamageEffect can only be applied to entity targets.",
                toSerializedTranslation("error.behaviorError", { error: "targetTakeDamageEffect can only be applied to entity targets." }));
        game.entityHandler.dealDamage(data.issuer as Entity, data.targets[0] as Entity, data.cardAndBox, damage);
        return true;
    };
}
/**
 * each time the active player deals damage to this, they roll-\n1-2: they take 1 damage.\n3-4: each player takes 1 damage.\n5-6: this takes 1 damage.
 */
export function OnDamageByActivePlayerRollDealDamageEffect(game: Game, numbers: number[]): SyncEffectFunction {
    if(numbers.length < 9)
        throw new GameError("OnDamageByActivePlayerRollDealDamageEffect requires an array of 9 numbers as parameter, representing the roll thresholds for each outcome.",
            toSerializedTranslation("error.behaviorError", { error: "OnDamageByActivePlayerRollDealDamageEffect requires an array of 9 numbers as parameter, representing the roll thresholds for each outcome." })
        );
    const ranges = [[numbers[0], numbers[1]], [numbers[3], numbers[4]], [numbers[6], numbers[7]]];
    const dmgs = [numbers[2], numbers[5], numbers[8]];
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target, source, damage } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(eventIssuer instanceof Monster)) return;
            if(!(target instanceof Player)) return;
            if(game.currentPlayer !== target) return;
            if(damage === undefined || damage < 1) return;
            const groups = [[target], game.players, [data.issuer as Entity]];
            
            const effect = (effectData: EffectData): boolean => {
                const roll = game.rollDice(target, data.it);
                roll.attachEffect(
                    [1,2,3,4,5,6].map(n => (rollData: EffectData): boolean => {
                        for(let i=0; i < ranges.length; i++) {
                            if(n >= ranges[i]![0]! && n <= ranges[i]![1]!) {
                                for (const t of groups[i]!) {
                                    game.entityHandler.dealDamage(data.issuer as Entity, t as Entity, data.cardAndBox, dmgs[i]!);
                                }
                            }
                        }
                        return true;
                    }), data.it, []);
                return true;
            }
            addPassiveEffectToStack(game, effect, data, `Each time the active player deals damage to ${data.it.name}, they roll a die. If they roll ${ranges[0]![0]}-${ranges[0]![1]}, they take ${dmgs[0]} damage. If they roll ${ranges[1]![0]}-${ranges[1]![1]}, each player takes ${dmgs[1]} damage. If they roll ${ranges[2]![0]}-${ranges[2]![1]}, ${data.it.name} takes ${dmgs[2]} damage.`);

        }
        );
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function dealDamageToKillerOnDeathEffect(game: Game, damage: number = 1): SyncEffectFunction {
return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
            const { eventIssuer, target, source } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(target instanceof Player)) return;
            
            // Add all effects as a single stack element
            const effect = (effectData: EffectData): boolean => {
                game.entityHandler.dealDamage(eventIssuer as Entity, target as Entity, data.cardAndBox, damage);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `When ${data.it.name} dies, it deals ${damage} damage to the player who killed it.`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function dealDamageOnAttackDeclarationEffect(game: Game, minRoll: number, maxRoll: number, damage: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offAttackDeclared: (() => void) | null = null;
        offAttackDeclared = game.emitter.on("on:attack:declared", (eventData: OnAttackDeclaredData) => {
            const { eventIssuer } = eventData;
            const effect = (effectData: EffectData): boolean => {
                const roll = game.rollDice(game.currentPlayer, data.it);
                roll.attachEffect([1,2,3,4,5,6].map(n => (rollData: EffectData): boolean => {
                    if(roll.value >= minRoll && roll.value <= maxRoll) {
                        game.entityHandler.dealDamage(data.issuer, eventIssuer, data.cardAndBox, damage);
                    }
                    return true;
                }), data.it, []);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, "Each time a player declares an attack, the active player rolls-\n1-2: This deals 1 damage to that player.");
        });
        data.it.cleaners.push(() => {
            offAttackDeclared?.();
            offAttackDeclared = null;
        });
        return true;
    };
}

export function putInMonsterDeckNFromTopEffect(game: Game, n: number): SyncEffectFunction {
    return (data: EffectData) => {
        const monsterDeck = game.decks.monster;
        if (!(data.it instanceof MonsterCard)) {
            throw new GameError("putInMonsterDeckNFromTopEffect can only be applied to monster cards.",
                toSerializedTranslation("error.behaviorError", { error: "putInMonsterDeckNFromTopEffect can only be applied to monster cards." })
            );
        }
        if (!Number.isFinite(n) || n < 1) {
            throw new GameError(`Invalid n for putInMonsterDeckNFromTopEffect: ${n}`,
                toSerializedTranslation("error.behaviorError", { error: `Invalid n for putInMonsterDeckNFromTopEffect: ${n}` })
            );
        }
        data.it.afterEffect = "handled"; // Card placement is handled by this effect
        game.encounters.removeFromSlot(data.it);
        monsterDeck.addCardAtPosFromTop(data.it, n-1);
        return true;
    };
}

export function searchForBloatEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        const player = game.currentPlayer as Player;
        const indexBloat = game.decks["monster"]!.cards.findIndex(c => c.slug === "b2-the_bloat") ;
        if(indexBloat === -1)
            return false;
        const theBloat = game.decks["monster"]!.drawCardAt(indexBloat);
        if(!theBloat)
            return false;
        game.encounters._deck.addTopPosition(theBloat);
        await game.encounters.selectValidIndexAndDraw(game, player, data);
        return true;
    };
}

export function killerDiscardsHandOnDeathEffect(game: Game, damage: number = 1): SyncEffectFunction {
return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
            const { eventIssuer, target, ability } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(target instanceof Player)) return;
            
            // Add all effects as a single stack element
            const effect = (effectData: EffectData): boolean => {
                const handSize = (target as Player).hand.length;
                for(let i=0; i < handSize; i++)
                {

                    game.cardHandler.discardFromHandAtIndex(target as Player, 0, "effect");
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `When ${data.it.name} dies, the player who killed it discards their hand.`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function doubleRewardsOnDeathRollEffect(game: Game): SyncEffectFunction {
    return (data: EffectData): boolean => {
        game.entityHandler.entityRewards(data.issuer as Monster);
        return true;
    }
}

export function noCombatDamageOnAttackRollEffect(game: Game, rollValues: number[]): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;

        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, target, source, damageArray } = eventData;
            if(source instanceof Card) return;
            if (data.issuer !== eventIssuer) return;
            const roll = source as DiceRoll;
            if(!rollValues.includes(roll.value)) return;
            const player = target instanceof Player ? target : eventIssuer;
            if(player instanceof Player === false)
                throw new GameError("noCombatDamageOnAttackRollEffect can only be applied when the target or event issuer is a player.",
                    toSerializedTranslation("error.behaviorError", { error: "noCombatDamageOnAttackRollEffect can only be applied when the target or event issuer is a player." }));
            const minDiceValue  = player.diceModifier + player.attackDiceModifier + 1;
            const maxValidValue = Math.max(...[1,2,3,4,5,6].filter(v => !rollValues.includes(v)));
            if(rollValues.includes(6) && minDiceValue > maxValidValue) 
                {
                    const effect = (effectData: EffectData): boolean => {
                        game.entityHandler.endCombat();
                        return true;
                    };
                    addPassiveEffectToStack(game, effect, data, `${data.it.name} and ${target.card.name} cannot damage each other. They opted for a truce.`);
                    return false;
                }
            // Add all effects as a single stack element
            const effect = (effectData: EffectData): boolean => {
                damageArray[0] = 0; // remove all damage
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `When ${data.it.name} is attacked, if the attack roll is ${rollValues.join(" or ")}, it takes no combat damage ${roll.value} ${minDiceValue} ${maxValidValue}.`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function monstersGainDCEffect(game: Game, amount: number, includeSelf: boolean): SyncEffectFunction {
    return (data: EffectData) => {
        game.entityHandler.addDCToEachMonster(data.issuer as Entity, amount, data.it);
        if(!includeSelf) {
            (data.issuer as Monster).addEvasion(-amount);
        }
        data.it.cleaners.push(() => {
            game.entityHandler.addDCToEachMonster(data.issuer as Entity, -amount, data.it);
            if(!includeSelf) {
                (data.issuer as Monster).addEvasion(amount);
            }
        });
        return true;
    };
}

export function monstersGainHPEffect(game: Game, amount: number): SyncEffectFunction {
    return (data: EffectData) => {
        game.encounters.addHealthModifier(amount);
        data.it.cleaners.push(() => {
            game.encounters.addHealthModifier(-amount);
        });
        return true;
    };
}

export function dieWhenAnotherMonsterDiesEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDeath: (() => void) | null = null;
        
        offDeath = game.emitter.on("on:death:monster", (eventData: OnDeathMonsterData) => {
            const { eventIssuer, target, source } = eventData;
            if (data.issuer === eventIssuer) return;
            
            // Add all effects as a single stack element
            const effect = (effectData: EffectData): boolean => {
                game.entityHandler.kill(eventIssuer, data.issuer as Monster, source);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `When another monster dies, ${data.it.name} dies.`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDeath?.();
            offDeath = null;
        });
        return true;
    };
}

export function cantBeAttackedEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const monster = data.issuer as Entity;
        monster.attackable = false;
        return true;
    };
}

export function damageAlsoPlayerToTheEffect(game: Game, direction: "left" | "right"): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target, source, damage } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(eventIssuer !== data.issuer) return;
            if(damage === undefined)
                throw new GameError("damageAlsoPlayerToTheEffect: damage is undefined.",
                    toSerializedTranslation("error.behaviorError", { error: "damageAlsoPlayerToTheEffect: damage is undefined." })
            );
            // Add all effects as a single stack element
            const effect = (effectData: EffectData): boolean => {
                const player = game.getPlayerToThe(direction);
                game.entityHandler.dealDamage(eventIssuer as Entity, player as Entity, source, damage);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `Damage dealt to ${data.it.name} is also dealt to the player to their ${direction}.`);
        });
        
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });

        return true;
    };
}

export function damageDealtToActivePlayerAlsoToTheEffect(game: Game, direction: "left" | "right"): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target, source, damage } = eventData;
            if (data.issuer !== target) return;
            if(game.currentPlayer !== eventIssuer) return;
            if(damage === undefined)
                throw new GameError("damageAlsoPlayerToTheEffect: damage is undefined.",
                    toSerializedTranslation("error.behaviorError", { error: "damageAlsoPlayerToTheEffect: damage is undefined." }));
            // Add all effects as a single stack element
            const effect = (effectData: EffectData): boolean => {
                const player = game.getPlayerToThe(direction);
                game.entityHandler.dealDamage(eventIssuer as Entity, player as Entity, data.cardAndBox, damage);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `Damage dealt to ${data.it.name} is also dealt to the player to the active player's ${direction}.`);
        });
        
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });

        return true;
    };
}

export function statModifierWhileAtHealthEffect(game: Game, s: string): SyncEffectFunction
{
    const numbers = s.match(/\d+/g)?.map(numStr => parseInt(numStr, 10)) || [];
    if(numbers.length != 2)
        throw new GameError("statModifierWhileAtHealthEffect could not parse numbers from string: " + s,
            toSerializedTranslation("error.behaviorError", { error: "statModifierWhileAtHealthEffect could not parse numbers from string: " + s }));
    const healthThreshold = numbers[0]!;
    const statAmount = s.includes("-") ? -numbers[1]! : numbers[1]!;
    const orLess = s.includes("or less");
    const event: TriggerEvent | null = s.includes("[dc]") 
        ? "on:get:monster:evasion" 
            : s.includes("[atk]") 
            ? "on:get:monster:attackPoints" 
        : null;
    if(!event || (s.includes("[dc]") && s.includes("[atk]")))
        throw new GameError("statModifierWhileAtHealthEffect could not determine stat to modify from string: " + s,
            toSerializedTranslation("error.behaviorError", { error: "statModifierWhileAtHealthEffect could not determine stat to modify from string: " + s }));

    return (data: EffectData) => {
        let offGetStat: (() => void) | null = null;
        const statApplied = false;

        offGetStat = game.emitter.on(event, (eventData: OnGetMonsterAttackPointsData | OnGetMonsterEvasionData) => {
            const { eventIssuer, stat } = eventData;
            if (data.issuer !== eventIssuer) return;
            const currentHP = (data.issuer as Entity).currentHealthPoints;
            if((orLess && currentHP <= healthThreshold) || (currentHP === healthThreshold)) {
                if (stat) {
                    stat[0]! += statAmount;
                }
            }
        });
        return true;
    };
}

export function OnDealsCombatDamageEffect(game: Game, s: string): SyncEffectFunction {
    const rest = s.substring("each time this deals combat damage to a player, they ".length).trim();
    const effect = effectParser(rest, game, true);
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target, source, damage } = eventData;
            if (data.issuer !== target) return;
            if (!(eventIssuer instanceof Player)) return;
            const newData = new EffectData(data.it, () => eventIssuer as Player, [], data.visualEffectBox);
            addPassiveEffectToStack(game, effect.effectFunction, newData, `Each time ${data.it.name} deals combat damage to a player, they ${rest}`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function OnDealsDamageEffect(game: Game, s: string): SyncEffectFunction {
    const rest = s.substring(s.indexOf(",")+1).trim();
    const effect = effectParser(rest, game, false);
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target, source, damage } = eventData;
            if (data.issuer !== target) return;
            if(!(eventIssuer instanceof Player)) return;
            if(!(source instanceof DiceRoll)) return;
            const newData = new EffectData(data.it, () => target as Player, [], data.visualEffectBox);
            addPassiveEffectToStack(game, effect.effectFunction, newData, `Each time ${data.it.name} deals combat damage to a player, they ${rest}`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function combatDamageIsEffect(game: Game, s: string): SyncEffectFunction {
    const numbers =  s.match(/\d+/g)?.map(numStr => parseInt(numStr, 10)) || [];
    const effectOnDamage = s.includes("doubled") ? "double" : numbers.shift();
    if(numbers.length === 0)
        throw new GameError("combatDamageIsEffect could not parse number from string: " + s,
            toSerializedTranslation("error.behaviorError", { error: "combatDamageIsEffect could not parse number from string: " + s }));
    if(numbers.length > 1)
        throw new GameError("combatDamageIsEffect found too many numbers in string: " + s + " it is unexpected so far.",
            toSerializedTranslation("error.behaviorError", { error: "combatDamageIsEffect found too many numbers in string: " + s + " it is unexpected so far." }));
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, target, source, damageArray } = eventData;
            if (data.issuer !== target) return;
            if(!(source instanceof DiceRoll)) return;
            if(numbers.includes((source as DiceRoll).value) === false) return;
            // Add all effects as a single stack element
            const effect = (effectData: EffectData): boolean => {
                if(effectOnDamage === "double") {
                    damageArray[0]! *= 2;
                } else {
                    damageArray[0]! += effectOnDamage!;
                }
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `Combat damage ${data.it.name} deals is ${effectOnDamage === "double" ? "doubled" : "increased by " + effectOnDamage}`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function onAttackingPlayerActivatesItemEffect(game: Game, s: string): SyncEffectFunction {
    const rest = s.substring("each time the attacking player activates an item, they ".length).trim();
    const effect = effectParser(rest, game, true);
    return (data: EffectData) => {
        let offActivate: (() => void) | null = null;
        
        offActivate = game.emitter.on("on:item:activated", (eventData: OnItemActivatedData) => {
            const { eventIssuer, item } = eventData;
            if (!(eventIssuer instanceof Player)) return;
            if (!(eventIssuer.isEngagedInCombat)) return;
            const newData = new EffectData(data.it, () => eventIssuer as Player, [], data.visualEffectBox);
            addPassiveEffectToStack(game, effect.effectFunction, newData, `Each time the attacking player activates an item, they ${rest}`);
        });
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offActivate?.();
            offActivate = null;
        });
        return true;
    };
}

export function playerWithMostCoinsLosesAllEffect(game: Game): AsyncEffectFunction {
    return async (data: EffectData) => {
        let maxCoins = -1;
        game.players.forEach(p => {
            if(p.coins > maxCoins)
                maxCoins = p.coins;
        });
        const playersToLoseCoins = game.players.filter(p => p.coins === maxCoins);
        const selection = (await data.selectAndRecord(game, game.currentPlayer as Player, 1, 1, playersToLoseCoins, toSerializedTranslation("pending.playerWhoWillLoseAllTheirCoins"), data.serializedCardAndBox, true, true)).selected[0]!;
        game.loseCoins(selection as Player, selection.coins, true, "effect");
        return true;
    };
}

export function onAttackingPlayerRollsEffect(game: Game, s: string): SyncEffectFunction {
    const roll = s.match(/\d+/g)?.map(numStr => parseInt(numStr, 10))[0];
    const rest = s.substring("when the attacking player rolls an attack roll of ".length +2).trim();
    const effect = effectParser(rest, game, true);
    return (data: EffectData) => {
        let offRoll: (() => void) | null = null;
        
        offRoll = game.emitter.on("on:dice:resolved", (eventData: OnRollData) => {
            const { eventIssuer, dice: attackRoll } = eventData;
            if (!(eventIssuer instanceof Player)) return;
            if (!(eventIssuer.isEngagedInCombat)) return;
            if(attackRoll.attackRoll !== true) return;
            if(data.issuer.isEngagedInCombat === false) return;
            if(attackRoll?.value !== roll) return;
            const newData = new EffectData(data.it, () => eventIssuer as Player, [], data.visualEffectBox);
            addPassiveEffectToStack(game, effect.effectFunction, newData, `When the attacking player rolls an attack roll of ${roll} ${rest}`);
        });
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offRoll?.();
            offRoll = null;
        });
        return true;
    };
}

export function onlyTakesCombatDamageOnAttackRollEffect(game: Game, values: number[]): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, target, source, damageArray } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(source instanceof DiceRoll)) return;
            if(source.attackRoll !== true) return;
            if(target.attackDiceModifier + ((target as Player).diceModifier || 0 ) + 1 > Math.max(...values)) 
            {
                const effect = (effectData: EffectData): boolean => {
                    game.entityHandler.endCombat();
                    return true;
                };
                addPassiveEffectToStack(game, effect, data, `${data.it.name} and ${target.card.name} cannot damage each other. They opted for a truce.`);
                return false;
            }
            if(!values.includes(source.value)) {
                const effect = (effectData: EffectData): boolean => {
                    damageArray[0] = 0; // remove all damage
                    return true;
                };
                addPassiveEffectToStack(game, effect, data, `${data.it.name} only takes combat damage on an attack roll of ${values.join(" or ")} (current roll: ${source.value}).`);
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function cancelAttackAfterSecondAttackRollEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        let offTurnEnd: (() => void) | null = null;
        let atkCount = 0;
        offDamage = game.emitter.on("on:dice:resolved", (eventData: OnRollData) => {
            const { dice, eventIssuer } = eventData;
            if (data.issuer.isEngagedInCombat !== true) return;
            if(dice.attackRoll !== true) return;
            atkCount++;
            if(atkCount === 2) {
                const effect = async (effectData: EffectData): Promise<boolean> => {
                    const elems = [];
                    for(let i = game.stack.elements.length - 1; i >= 0; i--) {
                        const stackElement = game.stack.elements[i];
                        if(stackElement instanceof DamageOnStack && stackElement._source === dice
                            || stackElement === undefined
                        ) {
                            continue;
                        }
                        elems.push(stackElement.stackId);
                    }
                    await game.executeWhenStackSubset(elems, () => {
                        game.entityHandler.endCombat();
                    });
                    return true;
                };
                addPassiveEffectToStack(game, effect, data, "When the attacking player makes their second attack roll this turn, after combat damage, cancel the attack.");
            }
        });

        offTurnEnd = game.emitter.on("on:turn:end", (eventData: OnTurnEndData) => {
            atkCount = 0;
        });
        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
            offTurnEnd?.();
            offTurnEnd = null;
        });
        return true;
    };
}



export function activePlayerChoosePlayerDiscardXEffect(game: Game, x: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        const player = game.currentPlayer as Player;
        
        const targetSelection = await data.selectAndRecord(game, player, 1, 1, game.players, toSerializedTranslation("pending.playerWhoDiscardsLootCards", { value: x }), data.serializedCardAndBox, true, true);
        const targetPlayer = targetSelection.selected[0] as Player;
        if(!targetPlayer){
            throw new GameError("No player selected for activePlayerChoosePlayerDiscardXEffect.",
                toSerializedTranslation("error.behaviorError", { error: "No player selected for activePlayerChoosePlayerDiscardXEffect." })
            );
        }
        await active.discardNLootCardsEffect(x, game, true)(new EffectData(data.it, () => targetPlayer, [], data.visualEffectBox));
        return true;
    };
}

export function onAttackDeclaredEffect(game: Game, s: string): SyncEffectFunction {
    const rest = s.substring("when an attack is declared on this, ".length).trim();
    const effect = effectParser(rest, game, true);
    return (data: EffectData) => {
        let offAttackDeclared: (() => void) | null = null;
        offAttackDeclared = data.it.entity instanceof Monster 
        ?   game.emitter.on("on:attack:declared:monster", (eventData: OnAttackDeclaredMonsterData) => {
                const { eventIssuer, monster } = eventData;
                if (data.it.entity !== monster[0]) return;
                if (!(eventIssuer instanceof Player)) return;
                const newData = new EffectData(data.it, () => eventIssuer as Player, [], data.visualEffectBox);
                addPassiveEffectToStack(game, effect.effectFunction, newData, `When an attack is declared on ${data.it.name}, the active player ${rest}`);
            })
        :   game.emitter.on("on:attack:declared:animated", (eventData: OnAttackDeclaredAnimatedData) => {
                const { eventIssuer, animated } = eventData;
                if (data.it.entity !== animated[0]) return;
                if (!(eventIssuer instanceof Player)) return;
                const newData = new EffectData(data.it, () => eventIssuer as Player, [], data.visualEffectBox);
                addPassiveEffectToStack(game, effect.effectFunction, newData, `When an attack is declared on ${data.it.name}, the active player ${rest}`);
            });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offAttackDeclared?.();
            offAttackDeclared = null;
        });
        return true;
    };
}

export function preventDamageOnRollEffect(game: Game, rolls: number[]): SyncEffectFunction {
    return (data: EffectData) => {

        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, target, source, damageArray } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(eventIssuer instanceof Monster)) return;
            // Add all effects as a single stack element
            const effect = (effectData: EffectData): boolean => {
                const dice = game.rollDice(game.currentPlayer as Player, data.it); // to get the roll value
                dice.attachEffect([1,2,3,4,5,6].map(n => (data:EffectData): boolean => {
                    if(rolls.includes(n)) {
                        damageArray[0] = 0; // remove all damage
                        return true;
                    }
                    return false;
                }), data.it, []);
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `Each time ${data.it.name} would take damage, if the active player rolls ${rolls.join(" or ")}, prevent that damage.`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function preventDeathFirstTimeEachTurnHealAndStatModifierEffect(game: Game, heal: number, dc: number, atk: number): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        let offTurnStart: (() => void) | null = null;
        let hasPreventedDeathThisTurn = false;
        
        offDamage = game.emitter.on("on:death:would-death", (eventData: OnDeathWouldDeathData) => {
            const { eventIssuer, target, source } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(eventIssuer instanceof Monster)) return;
            if(hasPreventedDeathThisTurn) return;
            hasPreventedDeathThisTurn = true;
            const effect = (effectData: EffectData): boolean => {
                if(data.issuer instanceof Monster === false)
                    throw new GameError("preventDeathFirstTimeEachTurnHealAndStatModifierEffect can only be applied to monsters.",
                        toSerializedTranslation("error.behaviorError", { error: "preventDeathFirstTimeEachTurnHealAndStatModifierEffect can only be applied to monsters." })
                    );
                game.entityHandler.preventDeath(eventIssuer as Entity);
                game.entityHandler.heal(data.issuer, heal - data.issuer.currentHealthPoints); // heal the specified amount from death prevention.
                game.entityHandler.addDC(data.issuer, dc, data.it); // add the specified + DC
                game.entityHandler.addAttack(data.issuer, atk, data.it); // lose the specified amount of attack
                return true;
            };
            addPassiveEffectToStack(game, effect, data, `The first time each turn ${data.it.name} would be reduced to 0 health, prevent that damage, heal ${heal} HP, and give it +${dc} DC and ${atk} ATK.`);
        });

        offTurnStart = game.emitter.on("on:turn:start", (eventData: OnTurnEndData) => {
            if (!hasPreventedDeathThisTurn) return;
            // reset stats
            game.entityHandler.addDC(data.issuer, -1, data.it);
            game.entityHandler.addAttack(data.issuer, +1, data.it);
            hasPreventedDeathThisTurn = false;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            if(hasPreventedDeathThisTurn) {
                // reset stats if needed
                game.entityHandler.addDC(data.issuer, -1, data.it);
                game.entityHandler.addAttack(data.issuer, +1, data.it);
            }
            offDamage?.();
            offDamage = null;
            offTurnStart?.();
            offTurnStart = null;
        });
        return true;
    };
}

export function forceAttackThisEachTurnEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        if(!data.issuer || !(data.issuer instanceof Monster)) 
            throw new GameError("forceAttackThisEachTurnEffect can only be applied to monsters.",
                toSerializedTranslation("error.behaviorError", { error: "forceAttackThisEachTurnEffect can only be applied to monsters." })
            );
        game.entityHandler.playerMustAttack(game.currentPlayer, [data.issuer], data.it, true);
        
        offTurnStart = game.emitter.on("on:turn:start", (eventData: OnTurnEndData) => {
            const { eventIssuer } = eventData;
            if(!data.issuer || !(data.issuer instanceof Monster)) return;
            if(!eventIssuer || !(eventIssuer instanceof Player)) return;
            if(eventIssuer.mustAttackEntity.some(req => (req.targets instanceof Array) && req.targets.includes(data.issuer as Monster) && req.source === data.it)) return; // if the player already must attack this monster, do not add another requirement
            game.entityHandler.playerMustAttack(eventIssuer, [data.issuer], data.it, true);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
            game.currentPlayer.clearAttackRequirement(data.issuer as Monster);
        });
        return true;
    };
}


export function attackRequirementEachTurnEffect(game: Game, whom: "any" | "topDeck", times: number, type: "total" | "additional"): SyncEffectFunction {
    return (data: EffectData) => {
        let offTurnStart: (() => void) | null = null;
        if(data.issuer instanceof Player === false)
            throw new GameError("attackRequirementEachTurnEffect can only be applied to players.",
                toSerializedTranslation("error.behaviorError", { error: "attackRequirementEachTurnEffect can only be applied to players." })
            );
        if(game.currentPlayer === data.issuer) {
            const additionalTimes = type === "additional" ? times : times - game.currentPlayer.attackedIdsThisTurn.filter((id) => id === "topDeck" || whom === "any").length;
            for (let i = 0; i < additionalTimes; i++) {
                game.entityHandler.playerMustAttack(data.issuer as Player, whom, data.it, true);
            }
        }
        offTurnStart = game.emitter.on("on:turn:start", (eventData: OnTurnEndData) => {
            const { eventIssuer } = eventData;
            if(data.issuer instanceof Player === false) return;
            if(eventIssuer !== data.issuer) return;
            const additionalTimes = type === "additional" ? times : times - data.issuer.attackedIdsThisTurn.filter((id) => id === "topDeck" || whom === "any").length;
            for (let i = 0; i < additionalTimes; i++) {
                game.entityHandler.playerMustAttack(data.issuer as Player, whom, data.it, true);
            }
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offTurnStart?.();
            offTurnStart = null;
        });
            if(data.issuer instanceof Player) {
                data.issuer.clearAttackRequirement("topDeck");
                data.issuer.clearAttackRequirement("any");
            }
        return true;
    };
}

export function activePlayerChooseLivingPlayerTakeDamageEffect(game: Game, damage: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        const player = game.currentPlayer as Player;
        const livingPlayers = game.players.filter(p => p.currentHealthPoints > 0);
        if(livingPlayers.length === 0)
            return false;
        const targetSelection = await data.selectAndRecord(game, player, 1, 1, livingPlayers, toSerializedTranslation("pending.livingPlayerToTakeDamage"), data.serializedCardAndBox, true, true);
        const targetPlayer = targetSelection.selected[0] as Player;
        if(!targetPlayer){
            throw new GameError("No player selected for activePlayerChooseLivingPlayerTakeDamageEffect.",
                toSerializedTranslation("error.behaviorError", { error: "No player selected for activePlayerChooseLivingPlayerTakeDamageEffect." })
            );
        }
        game.entityHandler.dealDamage(data.issuer as Entity, targetPlayer as Entity, data.cardAndBox, damage);
        return true;
    }
};

export function dealDamageToEachOtherMonsterEffect(game: Game, damage: number): SyncEffectFunction {
    return (data: EffectData) => {
        game.monsters.forEach(monster => {
            if(monster !== data.issuer) {
                game.entityHandler.dealDamage(data.issuer as Entity, monster as Entity, data.cardAndBox, damage);
            }
        });
        return true;
    };
}

export function dealDamageToAttackingPlayerEffect(game: Game, damage: number): SyncEffectFunction {
    return (data: EffectData) => {
        game.entityHandler.dealDamage(data.issuer as Entity, game.currentPlayer as Player, data.cardAndBox, damage);
        return true;
    };
}

export function bossRushEffect(game: Game, bossCount: number): AsyncEffectFunction {
    return async (data: EffectData) => {
        const bosses = [];
        if(!(data.it instanceof MonsterCard))
            return false;
        data.it.afterEffect = "handled"; 
        // draw the specified number of boss cards 
        const nbMonsterCards = game.decks.monster.discard.length + game.decks.monster.cards.length;
        for(let i = 0; i < nbMonsterCards; i++) {
            const card = game.decks.monster.draw();
            if(card instanceof MonsterCard && (card.subtype === "boss" )) {
                bosses.push(card);
            } else {
                game.cardHandler.discard(card);
            }
            if(bosses.length == bossCount)
                break;
        }
        for(const card of bosses)
            game.cardHandler.addTopPosition("monster", card);
        
        const options = [...game.encounters.coverableSlots];

        if(game.encounters.visible.includes(data.it))
            options.push(data.it);
        if(options.length === 0)
            return false;
        const indices = new Map<string, number>();
        options.forEach(c => indices.set(c.name, game.encounters.slots.findIndex(s => s.includes(c))));
        const selection = await data.selectAndRecord(game, game.currentPlayer, 1, bossCount, options, toSerializedTranslation("pending.slotsToPlaceBossesIn"), data.serializedCardAndBox, true, true);
        const selectedMonsters = selection.selected;
        const selectedIndices = selectedMonsters.map(c => indices.get(c.name)!);
        
        for(let i=0; i < bosses.length; i++)
        {
            if(selectedIndices[i%selectedIndices.length]! < 0)
                throw new GameError("Selected monster for boss rush effect not found in encounter slots.",
                    toSerializedTranslation("error.behaviorError", { error: "Selected monster for boss rush effect not found in encounter slots." })
                );
            const slotIndex = selectedIndices[i%selectedIndices.length]!;
            game.encounters.draw(slotIndex);
        }
        const monsters = selectedIndices.map(idx => game.encounters.monsters[idx]!);
        game.encounters.removeCard(data.it);
        game.encounters._deck.addDiscardTop(data.it); 
        game.entityHandler.playerMustAttack(game.currentPlayer, monsters, data.it, false);
        return true;
    };
}

export function playerWithMostSoulsWinsEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offGainSoul: (() => void) | null = null;

        offGainSoul = game.emitter.on("on:soul:gained", (eventData: OnSoulGainedOrRemovedData) => {
            const { eventIssuer, soul } = eventData;
            if(soul !== data.it) return;
            const effect = async (effectData: EffectData): Promise<boolean> => {
                let maxSouls = -1;
                game.players.forEach(p => {
                    if(p.totalSouls > maxSouls)
                        maxSouls = p.totalSouls;
                });
                const playersWithMostSouls = game.players.filter(p => p.totalSouls === maxSouls);
                const selectedPlayer = (await data.selectAndRecord(game, eventIssuer as Player, 1, 1, playersWithMostSouls, toSerializedTranslation("pending.playerWithMostSoulsToWinGame"), data.serializedCardAndBox, true, true)).selected[0];
                game.win(selectedPlayer as Player);
                offGainSoul?.();
                offGainSoul = null;
                return true;
            }
            addPassiveEffectToStack(game, effect, data, `When ${data.it.name} is gained, the player with the most souls wins the game.`);
        });
        data.it.cleaners.push(() => {
            if(game.monsters.some(m => m.card === data.it && m.isDead)) // Don't clean if the monster is dead, as the effect is meant to trigger on soul gain which happens after death.
                return
            offGainSoul?.();
            offGainSoul = null;
        });

        return true;
    };
}

export function onYouTakeCombatDamageEffect(game: Game, s: string, rolls: number[] = []): SyncEffectFunction {
    const rest = s.substring(s.indexOf(",")+1).trim();
    const effect = effectParser(rest, game, false);
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target, source, damage } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(source instanceof DiceRoll)) return;
            if(rolls.length > 0 && !rolls.includes(source.value)) return;
            const newData = new EffectData(data.it, () => data.issuer, [target], data.visualEffectBox);
            addPassiveEffectToStack(game, effect.effectFunction, newData, `Each time ${data.it.name} takes combat damage, it ${rest}`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function onThisTakesCombatDamageEffect(game: Game, s: string, rolls: number[] = []): SyncEffectFunction {
    const rest = s.substring(s.indexOf(",")+1).trim();
    const effect = effectParser(rest, game, false);
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        
        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target, source, damage } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(eventIssuer instanceof Monster)) return;
            if(!(source instanceof DiceRoll)) return;
            if(rolls.length > 0 && !rolls.includes((source as DiceRoll).value)) return;
            const newData = new EffectData(data.it, () => data.issuer, [], data.visualEffectBox);
            addPassiveEffectToStack(game, effect.effectFunction, newData, `Each time ${data.it.name} takes combat damage, it ${rest}`);
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function onEveryOtherDamageEffect(game: Game, effect: EffectFunction): SyncEffectFunction {
    return (data: EffectData) => {
        let offDamage: (() => void) | null = null;
        let damageCount = 0;

        offDamage = game.emitter.on("on:damage:taken", (eventData: OnDamageTakenData) => {
            const { eventIssuer, target, source, damage } = eventData;
            if (data.issuer !== eventIssuer) return;
            // Add all effects as a single stack element
            damageCount += 1;
            if(damageCount % 2 === 0) {
                addPassiveEffectToStack(game, effect, data, `Every other time ${data.it.name} takes damage, ${effect.name}`);
            }
            return true;
        });

        // Store cleanup function on the card for when it's removed/destroyed
        data.it.cleaners.push(() => {
            offDamage?.();
            offDamage = null;
        });
        return true;
    };
}

export function dealDamageToPlayerToTheEffect(game: Game, damage: number, direction: "left" | "right"): SyncEffectFunction {
    return (data: EffectData) => {
        const player = game.getPlayerToThe(direction);
        game.entityHandler.dealDamage(data.issuer as Entity, player as Entity, data.cardAndBox, damage);
        return true;
    };
}

export function playersWithMostItemsDieEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        const maxSouls = Math.max(...game.players.map(p => p.totalSouls));
        const playersToDie = game.players.filter(p => p.totalSouls === maxSouls && !p.isDead);
        for (const player of playersToDie) {
            game.entityHandler.kill(player, player, data.cardAndBox);
        }
        return true;
    };
}

export function noCombatDamageEveryOtherAttackRollEffect(game: Game): SyncEffectFunction {
    return (data: EffectData) => {
        let offAttackRoll: (() => void) | null = null;
        let offEndTurn: (() => void) | null = null;
        let prevent = false;
        
        offAttackRoll = game.emitter.on("on:damage:would-take", (eventData: OnDamageWouldTakeData) => {
            const { eventIssuer, source } = eventData;
            if (data.issuer !== eventIssuer) return;
            if(!(source instanceof DiceRoll)) return;
            if((source as DiceRoll).attackRoll !== true) return;
            const effect:EffectFunction = () => {
                if(prevent) {
                    eventData.damageArray[0] = 0; // prevent all damage
                }
                prevent = !prevent; // toggle prevent on each attack roll
                return true;
            }
            addPassiveEffectToStack(game, effect, data, "", data.visualEffectBox);
        });

        offEndTurn = game.emitter.on("on:turn:end", (eventData: OnTurnEndData) => {
            prevent = false; // reset at end of turn
        });

        data.it.cleaners.push(() => {
            offAttackRoll?.();
            offAttackRoll = null;
            offEndTurn?.();
            offEndTurn = null;
        });
        return true;
    };
}