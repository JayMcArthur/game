import type { LootCard, TreasureCard } from "@/models/cards";
import { Deck, MonsterCard } from "@/models/cards";
import { beforeEach, describe, expect, it } from "bun:test";
import { Game } from "../../models/game";
import { Player } from "../../models/entities/player";
import { setupTestGame } from "../testHelpers";

describe("Four Souls+2 Monsters", () => {
    let game: Game;
    let player1: Player;
    let player2: Player;

    beforeEach(async () => {
        const setup = await setupTestGame({
                    characters: ["fsp2-guppy", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter","b2-cod_worm","b2-spider","b2-conjoined_fatty", "b2-dip","b2-leech","b2-gurdy"],
                    treasureDeck: ["b2-boomerang", "b2-guppys_head", "b2-no", "b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
    });



/*
fsp2-boss_rush - Reveal cards from the top of the monster deck till you reveal 2 boss cards. Put them in one or more monster slots not being attacked and the rest into discard. The active player must make an additional attack on one of them this turn.
*/

    it("fsp2-boss_rush - Reveal cards from the top of the monster deck till you reveal 2 boss cards. Put them in one or more monster slots not being attacked and the rest into discard. The active player must make an additional attack on one of them this turn.", async () => {
        const card1 = game.obtainCard("fsp2-boss_rush") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const bosses = [];
        for(const c of game.decks.monster.cards)
        {
            if(bosses.length === 2)
                break;
            if(c instanceof MonsterCard && c.subtype === "boss")
                bosses.push(c);
        }
        await game.actions.resolveStack(); // effect
        expect(game.monsters[0]!.card.slug).toBe(bosses[0]!.slug);
        expect(game.monsters[1]!.card.slug).toBe(bosses[1]!.slug);
        expect(game.actions.canEndTurn(player1, false)).not.toBe(true);
        game.actions.declareAttack(player1)
        expect(game.actions.canDeclareAttackOnEntity(player1, game.monsters[0]!)).toBe(true);
        expect(game.actions.canDeclareAttackOnEntity(player1, game.monsters[1]!)).toBe(true);
        expect(game.actions.canDeclareAttackOnEntity(player1, "topDeck")).not.toBe(true);
    });

    it("fsp2-boss_rush - (One slot) Reveal cards from the top of the monster deck till you reveal 2 boss cards. Put them in one or more monster slots not being attacked and the rest into discard. The active player must make an additional attack on one of them this turn.", async () => {
        const card1 = game.obtainCard("fsp2-boss_rush") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 1);
        const bosses = [];
        for(const c of game.decks.monster.cards)
        {
            if(bosses.length === 2)
                break;
            if(c instanceof MonsterCard && c.subtype === "boss")
                bosses.push(c);
        }
        game.select = (_issuer, _min, _max, opts, _optional) => {
            return { selected: [opts[0]], remaining: [] } as any;
        };
        await game.actions.resolveStack(); // effect
        expect(game.monsters[0]!.card.slug).toBe(bosses[0]!.slug);
        expect(game.actions.canEndTurn(player1, false)).not.toBe(true);
        game.actions.declareAttack(player1)
        expect(game.actions.canDeclareAttackOnEntity(player1, game.monsters[0]!)).toBe(true);
        expect(game.actions.canDeclareAttackOnEntity(player1, game.monsters[1]!)).not.toBe(true);
        expect(game.actions.canDeclareAttackOnEntity(player1, "topDeck")).not.toBe(true);
    });


    it("fsp2-dingle - Each time the active player deals damage to this, they roll-5-6: This takes 1 damage.", async () => {
        const card1 = game.obtainCard("fsp2-dingle") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const mob = game.monsters[0]!;
        game.entityHandler.dealDamage(player1, mob, {card: card1, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack(); // damage
        game.random = () => 5/6-.00001;
        const hp = mob.currentHealthPoints;
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // roll
        await game.actions.resolveStack(); // damage
        expect(game.stack.isEmpty()).toBe(true);
        expect(mob.currentHealthPoints).toBe(hp - 1);
    });

    it("fsp2-dingle - Each time the active player deals damage to this, they roll-1-2: They take 1 damage.", async () => {
        const card1 = game.obtainCard("fsp2-dingle") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const mob = game.monsters[0]!;
        game.entityHandler.dealDamage(player1, mob, {card: card1, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack(); // damage
        game.random = () => 1/6-.00001;
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // roll
        await game.actions.resolveStack(); // damage
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(1);
    });

    it("fsp2-dingle - Each time the active player deals damage to this, they roll-3-4: Each player takes 1 damage.", async () => {
        const card1 = game.obtainCard("fsp2-dingle") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const mob = game.monsters[0]!;
        game.entityHandler.dealDamage(player1, mob, {card: card1, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack(); // damage
        game.random = () => 3/6-.00001;
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // roll
        await game.actions.resolveStack(); // damage
        await game.actions.resolveStack(); // damage
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(1);
        expect(player2.currentHealthPoints).toBe(1);
    });

    it("fsp2-globin - When this reaches 1 [HP] , the active player rolls-1-4: This takes 1 damage.", async () => {
        const card1 = game.obtainCard("fsp2-globin") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const mob = game.monsters[0]!;
        game.entityHandler.dealDamage(player1, mob, {card: card1, visualEffectBox: undefined}, mob.currentHealthPoints - 1);
        await game.actions.resolveStack(); // damage
        game.random = () => 1/6-.00001;
        await game.actions.resolveStack(); // roll
        await game.actions.resolveStack(); // roll
        await game.actions.resolveStack(); // roll
        expect(mob.currentHealthPoints).toBe(0);
        await game.actions.resolveStack(); // roll
        expect(mob.isDead).toBe(true);
    });
    
    it("fsp2-globin - When this reaches 1 [HP] , the active player rolls-5-6: This heals 2 [HP] .", async () => {
        const card1 = game.obtainCard("fsp2-globin") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const mob = game.monsters[0]!;
        game.entityHandler.dealDamage(player1, mob, {card: card1, visualEffectBox: undefined}, mob.currentHealthPoints - 1);
        await game.actions.resolveStack(); // damage
        game.random = () => 5/6-.00001;
        await game.actions.resolveStack(); // roll
        await game.actions.resolveStack(); // roll
        await game.actions.resolveStack(); // roll
        expect(mob.currentHealthPoints).toBe(3);
        expect(mob.isDead).toBe(false);
    });

    it("fsp2-moms_heart - When a player gains this soul, choose a player who controls the most souls or tied for the most. That player wins.", async () => {
        const card1 = game.obtainCard("fsp2-moms_heart") as MonsterCard;
        const card2 = game.obtainCard("b2-boomerang") as TreasureCard;
        card2.soul = 2;
        game.cardHandler.addSoul(player2, card2);
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        let winner = "";
        game.win = (player: Player) => {
            winner = player.id;
        };

        game.entityHandler.kill(player1, game.monsters[0]!, {card: card1, visualEffectBox: undefined});
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        expect(winner).toBe(player1.id);
    });

   it("fsp2-moms_heart - When a player gains this soul, choose a player who controls the most souls or tied for the most. That player wins.", async () => {
        const card1 = game.obtainCard("fsp2-moms_heart") as MonsterCard;
        const card2 = game.obtainCard("b2-boomerang") as TreasureCard;
        card2.soul = 2;
        game.cardHandler.addSoul(player2, card2);
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        let winner = "";
        game.win = (player: Player) => {
            winner = player.id;
        };

        game.entityHandler.kill(player1, game.monsters[0]!, {card: card1, visualEffectBox: undefined});
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        expect(winner).toBe(player1.id);
    });

    it("fsp2-moms_heart - (other player has most souls) When a player gains this soul, choose a player who controls the most souls or tied for the most. That player wins.", async () => {
        const card1 = game.obtainCard("fsp2-moms_heart") as MonsterCard;
        const card2 = game.obtainCard("b2-boomerang") as TreasureCard;
        card2.soul = 3;
        game.cardHandler.addSoul(player2, card2);
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        let winner = "";
        game.win = (player: Player) => {
            winner = player.id;
        };

        game.entityHandler.kill(player1, game.monsters[0]!, {card: card1, visualEffectBox: undefined});
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        expect(winner).toBe(player2.id);
    });

    it("fsp2-curse_of_blood_lust - [Curse Effect] You must attack on your turn if able.", async () => {
        const card1 = game.obtainCard("fsp2-curse_of_blood_lust") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        await game.actions.resolveStack(); 
        await game.actions.resolveStack(); // resolve the event addition
        await game.actions.resolveStack(); // resolve the event addition
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack(); // turn end
        expect(game.actions.canEndTurn(player1, false)).not.toBe(true);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.entityHandler.endCombat();
        expect(game.actions.canEndTurn(player1, false)).toBe(true);
    });

    it("fsp2-curse_of_blood_lust - (attack board) [Curse Effect] You must attack on your turn if able.", async () => {
        const card1 = game.obtainCard("fsp2-curse_of_blood_lust") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        await game.actions.resolveStack(); 
        await game.actions.resolveStack(); // resolve the event addition
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack(); // turn end
        expect(player1.hasAttackRequirement).toBe(true);
        expect(game.actions.canEndTurn(player1, false)).not.toBe(true);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.entityHandler.endCombat();
        expect(game.actions.canEndTurn(player1, false)).toBe(true);
    });

    it("fsp2-curse_of_impulse - [Curse Effect] At the end of your turn, deactivate each item you control and your character.", async () => {
        const card1 = game.obtainCard("fsp2-curse_of_impulse") as MonsterCard;
        const c = game.obtainCard("b2-boomerang") as TreasureCard;
        const c2 = game.obtainCard("b2-blank_card") as TreasureCard;
        game.cardHandler.addInPlay(player1, c);
        game.cardHandler.addInPlay(player1, c2);
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        await game.actions.resolveStack(); // resolve the event addition
        game.cardHandler.rechargeMultiple(player1);
        expect(player1.inPlay.every(i => i.charged || !i.isActiveItem)).toBe(true);
        expect(player1.character.charged).toBe(true);
        await game.actions.resolveStack(); // give curse to themselves
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // turn end
        expect(player1.inPlay.every(i => i.charged)).toBe(false);
        expect(player1.character.charged).toBe(false);
    });

    it("fsp2-bony - Each time the attacking player rolls an attack roll of 1, this gains +2 [ATK] till end of turn.", async () => {
        const card1 = game.obtainCard("fsp2-bony") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card1);
        const mob = game.monsters[0]!;
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, mob);
        game.random = () => 1/6-.00001;
        game.actions.attackRoll(player1);
        const atk = game.entityHandler.getAttack(mob);
        await game.actions.resolveStack(); // dice
        await game.actions.resolveStack(); // effect
        expect(game.entityHandler.getAttack(mob)).toBe(atk + 2);
    });

    it("fsp2-headless_horseman - The first time this would die each turn, prevent death. This heals 2 [HP] and gains +1 [DC] and -1 [ATK] till end of turn.", async () => {
        const card1 = game.obtainCard("fsp2-headless_horseman") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card1);
        const mob = game.monsters[0]!;
        expect(mob.currentHealthPoints).toBe(3);
        expect(game.entityHandler.getAttack(mob)).toBe(2);
        expect(game.entityHandler.getDC(mob)).toBe(3);
        game.entityHandler.dealDamage(player1, mob, {card: mob.card, visualEffectBox: undefined}, 3);
        await game.actions.resolveStack(); // damage
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        expect(mob.currentHealthPoints).toBe(2);
        expect(game.entityHandler.getAttack(mob)).toBe(1);
        expect(game.entityHandler.getDC(mob)).toBe(4);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // turn end
        expect(mob.currentHealthPoints).toBe(3);
        expect(game.entityHandler.getAttack(mob)).toBe(2);
        expect(game.entityHandler.getDC(mob)).toBe(3);
    });

    it("fsp2-headless_horseman - (die the second time) The first time this would die each turn, prevent death. This heals 2 [HP] and gains +1 [DC] and -1 [ATK] till end of turn.", async () => {
        const card1 = game.obtainCard("fsp2-headless_horseman") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card1);
        const mob = game.monsters[0]!;
        expect(mob.currentHealthPoints).toBe(3);
        expect(game.entityHandler.getAttack(mob)).toBe(2);
        expect(game.entityHandler.getDC(mob)).toBe(3);
        game.entityHandler.dealDamage(player1, mob, {card: mob.card, visualEffectBox: undefined}, 3);
        await game.actions.resolveStack(); // damage
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        expect(mob.currentHealthPoints).toBe(2);
        expect(game.entityHandler.getAttack(mob)).toBe(1);
        expect(game.entityHandler.getDC(mob)).toBe(4);
        game.entityHandler.dealDamage(player1, mob, {card: mob.card, visualEffectBox: undefined}, 3);
        await game.actions.resolveStack(); // damage
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // effect
        expect(mob.currentHealthPoints).toBe(0);
    });

    it("fsp2-holy_bony - Each time a player rolls a ❻, they may look at the top 3 cards of a deck and put them back in any order.", async () => {
        const card1 = game.obtainCard("fsp2-holy_bony") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card1);
        const slugs = game.decks.loot.cards.slice(0, 3).map(c => c.slug);
        game.random = () => 6/6-.00001;
        game.select = (_issuer, _min, _max, opts, _optional) => {
            if(opts[0] instanceof Deck && (opts[0] as any)._type === "loot")
                return { selected: [opts[0]], remaining: [] } as any;
            if(opts.length !== 1)
                expect(opts.map(o => (o as LootCard).slug!)).toEqual(slugs);
            return { selected: opts.toReversed(), remaining: [] } as any;
        };
        game.rollDice(player2, card1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.decks.loot.cards.slice(0, 3).map(c => c.slug)).toEqual(slugs.toReversed());
    });

    it("fsp2-isaac - Each time this takes damage, the active player chooses a living player. This deals 1 damage to that player.", async () => {
        const card1 = game.obtainCard("fsp2-isaac") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card1);
        game.entityHandler.dealDamage(player1, game.monsters[0]!, {card: card1, visualEffectBox: undefined}, 1);
        game.select = (_issuer, _min, _max, opts, _optional) => {
            return { selected: [opts[1]], remaining: [] } as any;
        };
        await game.actions.resolveStack(); // damage
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // damage player2
        expect(player2.currentHealthPoints).toBe(player2.healthPoints - 1);
        game.entityHandler.kill(player2, player2, {card: card1, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        game.entityHandler.dealDamage(player1, game.monsters[0]!, {card: card1, visualEffectBox: undefined}, 1);
        game.select = (_issuer, _min, _max, opts, _optional) => {
            expect(opts.length).toBe(1);
            return { selected: [opts[0]], remaining: [] } as any;
        };
        await game.actions.resolveStack(); // damage
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // damage player2
        expect(player1.currentHealthPoints).toBe(player1.healthPoints - 1);
    });

    it("fsp2-krampus - The active player must attack this once each turn if able.", async () => {
        const card1 = game.obtainCard("fsp2-krampus") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card1);
        expect(player1.canAttackThisEntity("topDeck")).not.toBe(true);
        expect(player1.canAttackThisEntity(game.monsters[0]!)).toBe(true);
        expect(player1.canAttackThisEntity(game.monsters[1]!)).not.toBe(true);
    });

    it("fsp2-krampus - The active player must attack this once each turn if able. + holly mulligan", async () => {

        const card = game.obtainCard("fsp2-holy_mulligan") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card);
        const card1 = game.obtainCard("fsp2-krampus") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.random = () => 6/6-.00001;
        await game.actions.attackRoll(player1);
        await game.actions.resolveStack(); // roll
        await game.actions.resolveStack(); // damage
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // effect
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.actions.canEndTurn(player1, false)).not.toBe(true);
    });
    it("fsp2-holy_chest - Roll- 6: This becomes a soul. Gain it.", async () => {
       const card1 = game.obtainCard("fsp2-holy_chest") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.random = () => 6/6-.00001;
        await game.actions.resolveStack(); // effect    
        await game.actions.resolveStack(); // roll
        expect(player1.totalSouls).toBe(1);
        expect(player1.targetableSouls.includes(card1)).toBe(true);
    });
    it("fsp2-holy_chest - Roll- 3-5: Gain 7¢.", async () => {
       const card1 = game.obtainCard("fsp2-holy_chest") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.random = () => 4/6-.00001;
        await game.actions.resolveStack(); // effect    
        await game.actions.resolveStack(); // roll
        expect(player1.coins).toBe(7);
    });
    it("fsp2-holy_chest - Roll-1-2: Prevent the next 2 damage you would take this turn. You may attack an additional time this turn.", async () => {
       const card1 = game.obtainCard("fsp2-holy_chest") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.random = () => 1/6-.00001;
        await game.actions.resolveStack(); // effect    
        await game.actions.resolveStack(); // roll    
        game.entityHandler.dealDamage(player1, player1, {card: card1, visualEffectBox: undefined}, 3);
        await game.actions.resolveStack(); // damage    
        expect(player1.attackThisTurn).toBe(1);   
        await game.actions.resolveStack(); // resolve on damage taken
        expect(player1.currentHealthPoints).toBe(player1.healthPoints - 1); 
    });

    it("fsp2-roundy - Each time this deals combat damage, it deals 1 damage to each other monster.", async () => {
       const card1 = game.obtainCard("fsp2-roundy") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.encounters.expand(2);
        game.random = () => 1/6-.00001;
        game.actions.attackRoll(player1);
        for(const e of game.playersAndMonsters)
            game.entityHandler.addHealth(e,10);
        const hp = game.monsters.map(m => m.currentHealthPoints);
        await game.actions.resolveStack(); // roll
        await game.actions.resolveStack(); // damage p1
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // dmg 1
        await game.actions.resolveStack(); // dmg 2
        await game.actions.resolveStack(); // dmg 3
        expect(game.monsters.map(m => (m.currentHealthPoints + (m.card.slug === "fsp2-roundy" ? 0 : 1)))).toEqual(hp);
    });
    
   it("fsp2-blastocyst - When this dies, expand monster slots by 2. The active player may attack the monster deck an additional time.", async () => {
       const card1 = game.obtainCard("fsp2-blastocyst") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.entityHandler.dealDamage(player1, game.encounters.monsterIn(0)!, {card: card1, visualEffectBox: undefined}, 10);
        game.select = (_issuer, _min, _max, opts, _optional) => {
            return { selected: opts.toReversed(), remaining: [] } as any;
        };
        expect(player1.attackThisTurn).toBe(0);
        await game.actions.resolveStack(); // damage monster
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        expect(game.encounters.slots.length).toBe(4);
        expect(player1.canAttackThisEntity("topDeck")).toBe(true);
        expect(player1.canAttackThisEntity(game.monsters[1]!)).not.toBe(true);
    });
    it("fsp2-holy_mulligan - When this dies, expand monster slots by 2. The active player may attack an additional time this turn.", async () => {
       const card1 = game.obtainCard("fsp2-holy_mulligan") as MonsterCard;
       
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.entityHandler.dealDamage(player1, game.encounters.monsterIn(0)!, {card: card1, visualEffectBox: undefined}, 10);
        game.select = (_issuer, _min, _max, opts, _optional) => {
            return { selected: opts.toReversed(), remaining: [] } as any;
        };
        expect(player1.attackThisTurn).toBe(0);
        await game.actions.resolveStack(); // damage monster
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        expect(game.encounters.slots.length).toBe(4);
        expect(player1.attackThisTurn).toBe(1);
    });

    it("fsp2-sucker - When this dies, it deals 1 damage to each player.", async () => {
        const card1 = game.obtainCard("fsp2-sucker") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.entityHandler.dealDamage(player1, game.encounters.monsterIn(0)!, {card: card1, visualEffectBox: undefined}, 10);
        game.select = (_issuer, _min, _max, opts, _optional) => {
            return { selected: opts.toReversed(), remaining: [] } as any;
        };
        await game.actions.resolveStack(); // damage monster
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // dmg1
        await game.actions.resolveStack(); // dmg2
        expect(player1.currentHealthPoints).toBe(player1.healthPoints - 1);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints - 1);
    });

    it("fsp2-swarmer - When this dies, expand monster slots by 2.", async () => {
        const card1 = game.obtainCard("fsp2-swarmer") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.entityHandler.dealDamage(player1, game.encounters.monsterIn(0)!, {card: card1, visualEffectBox: undefined}, 10);
        game.select = (_issuer, _min, _max, opts, _optional) => {
            return { selected: opts.toReversed(), remaining: [] } as any;
        };
        const slugs = game.decks.monster.cards.slice(0, 5).map(c => c.slug);
        await game.actions.resolveStack(); // damage monster
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        expect(game.encounters.slots.length).toBe(4);
    });
    

    it("fsp2-the_fallen - When this dies, look at the top 5 cards of the monster deck and put them back in any order.", async () => {
        const card1 = game.obtainCard("fsp2-the_fallen") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.entityHandler.dealDamage(player1, game.encounters.monsterIn(0)!, {card: card1, visualEffectBox: undefined}, 10);
        game.select = (_issuer, _min, _max, opts, _optional) => {
            return { selected: opts.toReversed(), remaining: [] } as any;
        };
        const slugs = game.decks.monster.cards.slice(0, 5).map(c => c.slug);
        await game.actions.resolveStack(); // damage monster
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // effect
        expect(game.decks.monster.cards.slice(0, 5).map(c => c.slug)).toEqual(slugs.reverse()); 
    });

    it("fsp2-tumor - Each time this takes damage, it deals 1 damage to each non-active player.", async () => {
        const card1 = game.obtainCard("fsp2-tumor") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.entityHandler.dealDamage(player1, game.encounters.monsterIn(0)!, {card: card1, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack(); // damage monster
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // damage p2
        expect(player2.currentHealthPoints).toBe(player2.healthPoints - 1);
        game.entityHandler.dealDamage(player1, game.encounters.monsterIn(0)!, {card: card1, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack(); // damage monster
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // damage p2
        await game.actions.resolveStack(); // damage p2
        await game.actions.resolveStack(); // damage p2
        expect(player2.currentHealthPoints).toBe(player2.healthPoints - 2);
    });
    it("fsp2-brain - Each time the attacking player rolls an attack roll of 6, they take 1 damage.", async () => {
        const card1 = game.obtainCard("fsp2-brain") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.random = () => 6/6-.00001;
        const init = player1.currentHealthPoints;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack(); // dice
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // damage
        await game.actions.resolveStack(); // damage monster
        expect(player1.currentHealthPoints).toBe(init - 1);
        game.rollDice(player1, card1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.currentHealthPoints).toBe(init - 1);
    });

    it("fsp2-cursed_globin - [Curse Effect] Each time a player rolls a ➂, each monster heals 2 [HP] .", async () => {
        const card1 = game.obtainCard("fsp2-cursed_globin") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card1);
        const init = player1.currentHealthPoints;
        const init2 = player2.currentHealthPoints;
        game.entityHandler.addHealth(game.monsters[0]!, 10);
        game.entityHandler.addHealth(game.monsters[1]!, 10);
        game.entityHandler.dealDamage(player1, game.monsters[0]!, {card: card1, visualEffectBox: undefined}, 3);
        await game.actions.resolveStack();
        game.entityHandler.dealDamage(player1, game.monsters[1]!, {card: card1, visualEffectBox: undefined}, 3);
        await game.actions.resolveStack();
        const health = game.monsters.map(m => m.currentHealthPoints);

        game.random = () => 3/6-.00001;
        game.rollDice(player2, card1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.monsters.map(m => m.currentHealthPoints -2)).toEqual(health);
    });

    it("fsp2-cursed_tumor - [Curse Effect] Each time a player rolls a ➃, each player takes 1 damage.", async () => {
        const card1 = game.obtainCard("fsp2-cursed_tumor") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card1);
        const init = player1.currentHealthPoints;
        const init2 = player2.currentHealthPoints;
        game.random = () => 4/6-.00001;
        game.rollDice(player2, card1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.currentHealthPoints).toBe(init - 1);
        expect(player2.currentHealthPoints).toBe(init2 - 1);
    });

    it("fsp2-cursed_tumor - [Curse Effect] Each time a player rolls a ➃, each player takes 1 damage.", async () => {
        const card1 = game.obtainCard("fsp2-cursed_tumor") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card1);
        const init = player1.currentHealthPoints;
        const init2 = player2.currentHealthPoints;
        game.random = () => 4/6-.00001;
        game.rollDice(player2, card1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.currentHealthPoints).toBe(init - 1);
        expect(player2.currentHealthPoints).toBe(init2 - 1);
    });

    it("fsp2-head_trauma - Discard 2 loot cards.", async () => {
        const card1 = game.obtainCard("fsp2-head_trauma") as MonsterCard;
        game.loot(player1, 5);
        const init = player1.hand.length;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(init - 2);
    });

    it("fsp2-spiked_chest - Roll-1-2: Take 1 damage.", async () => {
        const card1 = game.obtainCard("fsp2-spiked_chest") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const init = player1.currentHealthPoints;
        game.random = () => 1/6-.00001;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.currentHealthPoints).toBe(init - 1);
    });

     it("fsp2-spiked_chest - 3-4: Take 1 damage. Loot 1.", async () => {
        const card1 = game.obtainCard("fsp2-spiked_chest") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const init = player1.currentHealthPoints;
        const loot = player1.hand.length;
        game.random = () => 3/6-.00001;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.currentHealthPoints).toBe(init - 1);
        expect(player1.hand.length).toBe(loot + 1);
    });

    it("fsp2-spiked_chest - 5-6: Take 1 damage. Gain +1 treasure.", async () => {
        const card1 = game.obtainCard("fsp2-spiked_chest") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const init = player1.currentHealthPoints;
        const treas = player1.inPlay.length;
        game.random = () => 5/6-.00001;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.currentHealthPoints).toBe(init - 1);
        expect(player1.inPlay.length).toBe(treas + 1);
    });

    it("fsp2-angel_room 1: Gain +2 treasure.", async () => {
        const card1 = game.obtainCard("fsp2-angel_room") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const init = player1.inPlay.length;
        game.random = () => 1/6-.00001;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.inPlay.length).toBe(init + 2);
    });

    it("fsp2-angel_room 1: 2-3: Gain +1 treasure.", async () => {
        const card1 = game.obtainCard("fsp2-angel_room") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const init = player1.inPlay.length;
        game.random = () => 3/6-.00001;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.inPlay.length).toBe(init + 1);
    });

    it("fsp2-angel_room 1: 4-6: Loot 2.", async () => {
        const card1 = game.obtainCard("fsp2-angel_room") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const init = player1.hand.length;
        game.random = () => 5/6-.00001;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(init + 2);
    });
});


describe("Four Souls+2 Monsters 3 players game", () => {
    let game: Game;
    let player1: Player;
    let player2: Player;
    let player3: Player;

    beforeEach(async () => {
        const setup = await setupTestGame({
                    characters: ["fsp2-guppy", "b2-samson", "b2-lazarus"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter","b2-cod_worm","b2-spider","b2-conjoined_fatty", "b2-dip","b2-leech","b2-gurdy"],
                    treasureDeck: ["b2-boomerang", "b2-guppys_head", "b2-no", "b2-blank_card"],
                    playerCount: 3
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        player3 = setup.player3!;
    });
    it("fsp2-monstro_ii - Each time this deals combat damage, the active player rolls- 1-3: Deal 1 damage to the player to your right.", async () => {
        const card1 = game.obtainCard("fsp2-monstro_ii") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.random = () => 1/6-.00001;
        game.entityHandler.addHealth(player1, 10);
        game.actions.attackRoll(player1);
        await game.actions.resolveStack(); // roll
        await game.actions.resolveStack(); // damage taken
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // roll 1
        await game.actions.resolveStack(); // damage player2
        expect(player3.currentHealthPoints).toBe(player3.healthPoints - 1);
    });

    it("fsp2-monstro_ii - Each time this deals combat damage, the active player rolls- 4-6: Deal 1 damage to the player to your left.", async () => {
        const card1 = game.obtainCard("fsp2-monstro_ii") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        game.random = () => 1/6-.00001;
        game.entityHandler.addHealth(player1, 10);
        game.actions.attackRoll(player1);
        await game.actions.resolveStack(); // roll
        game.random = () => 4/6-.00001; 
        await game.actions.resolveStack(); // damage taken
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // roll 1
        await game.actions.resolveStack(); // damage player2
        expect(player2.currentHealthPoints).toBe(player2.healthPoints - 1);
    });

});