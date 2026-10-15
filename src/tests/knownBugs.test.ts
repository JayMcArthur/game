import type { Card, CharacterCard, ItemCard, LootCard } from "@/models/cards";
import { MonsterCard } from "@/models/cards";
import { beforeEach, describe, expect, it } from "bun:test";
import { Player } from "../models/entities/player";
import { Game } from "../models/game";
import { DamageOnStack, DiceRoll } from "../models/stackElement";
import { setupStandardTestGame, setupTestGame } from "./testHelpers";
import { pl } from "zod/locales";
import { TargetBuilder } from "@/models/targetBuilder";
import { executeActivateWithIdRequest } from "@/utils/gameRequestHelpers";

describe("Known bugs that have be corrected", () => {
    let game: Game;
    let player1: Player;
    let player2: Player;

    beforeEach(async () => {
        const setup = await setupStandardTestGame();
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
    });
    
    // it("", async () => {
    // });
    
    it("The poop can remove damage on stack twice in a row", async () => {
        const c1 = game.obtainCard("b2-the_poop") as ItemCard;
        game.cardHandler.addInPlay(player1, c1);
        game.cardHandler.addToCounter(player1, c1, "normal", 2);
        game.entityHandler.dealDamage(player1,player1, {card: c1, visualEffectBox: undefined}, 1);
        await game.activateItem(player1, c1, [], 0);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        game.entityHandler.dealDamage(player1,player1, {card: c1, visualEffectBox: undefined}, 1);
        await game.activateItem(player1, c1, [], 0);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(2);
    });
    
    it("swap item works with trinket", async () => {
        const c1 = game.obtainCard("b2-decoy") as ItemCard;
        const c2 = game.obtainCard("b2-counterfeit_penny") as LootCard;
        game.cardHandler.addCardToHand(player1, c2);
        game.cardHandler.addInPlay(player2, c1);
        game.actions.playCard(player1, 0);
        await game.actions.resolveStack();
        game.gainCoins(player1,1, "debug");
        expect(player1.coins).toBe(2);
        await game.activateItem(player2, c1, [c2], "tap");
        await game.actions.resolveStack();
        expect(player1.inPlay.includes(c1));
        expect(player2.inPlay.includes(c2));
        game.gainCoins(player1,1, "debug");
        expect(player1.coins).toBe(3);
        game.gainCoins(player2,1, "debug");
        expect(player2.coins).toBe(2);
    });
    
    it("copy trinket works", async () => {
        const c1 = game.obtainCard("b2-modeling_clay") as ItemCard;
        const c2 = game.obtainCard("b2-counterfeit_penny") as LootCard;
        game.cardHandler.addCardToHand(player1, c2);
        game.cardHandler.addInPlay(player2, c1);
        game.actions.playCard(player1, 0);
        await game.actions.resolveStack();
        game.gainCoins(player1,1, "debug");
        expect(player1.coins).toBe(2);
        await game.activateItem(player2, c1, [c2], "tap");
        await game.actions.resolveStack();
        expect(player1.inPlay.includes(c1));
        expect(player2.inPlay.includes(c2));
        game.gainCoins(player2,1, "debug");
        expect(player2.coins).toBe(2);
        game.cardHandler.removeInPlay(player2, c1);
        game.gainCoins(player2,1, "debug");
        expect(player2.coins).toBe(3);
    });
    
    it("steal trinket works", async () => {
        const c1 = game.obtainCard("b2-pay_to_play") as ItemCard;
        const c2 = game.obtainCard("b2-counterfeit_penny") as LootCard;
        game.cardHandler.addCardToHand(player1, c2);
        game.cardHandler.addInPlay(player2, c1);
        game.actions.playCard(player1, 0);
        await game.actions.resolveStack();
        game.gainCoins(player1,1, "debug");
        expect(player1.coins).toBe(2);
        game.gainCoins(player2, 10, "debug");
        await game.activateItem(player2, c1, [c2], 0);
        await game.actions.resolveStack();
        expect(player1.inPlay.includes(c1));
        expect(player2.inPlay.includes(c2));
        game.gainCoins(player2,1, "debug");
        expect(player2.coins).toBe(2);
        game.gainCoins(player1,1, "debug");
        expect(player1.coins).toBe(3);
        game.cardHandler.removeInPlay(player2, c2);
        game.gainCoins(player2,1, "debug");
        expect(player2.coins).toBe(3);
    });
    
    it("serialize choose one options", async () => {
        const c1 = game.obtainCard("fsp2-rainbow_baby") as ItemCard;
        game.cardHandler.addInPlay(player1, c1);
        const res = await executeActivateWithIdRequest(game, 
            {
                type: "inPlay",
                index: 1,
                effectIndex: 0,
                targetChoices: []
            },
            player1
        );
        await game.resolveEntireStack();
        expect(()=>JSON.stringify(game.log, null, 2)).not.toThrow();
    });
    
    it("Poop and dry baby should cancel 2 damages", async () => {
        const c1 = game.obtainCard("b2-the_poop") as ItemCard;
        const c2 = game.obtainCard("b2-dry_baby") as ItemCard;
        game.cardHandler.addInPlay(player1, c1);
        game.entityHandler.dealDamage(player1, player1, {card: c1, visualEffectBox: undefined}, 1);
        await game.resolveEntireStack();
        game.cardHandler.addInPlay(player1, c2);
        await game.activateItem(player1, c1, [], 0);
        await game.resolveEntireStack();
        game.entityHandler.addHealth(player1, 1, "other");
        game.entityHandler.heal(player1);
        game.entityHandler.dealDamage(player1, player1, {card: c1, visualEffectBox: undefined}, 2);
        await game.actions.resolveStack();
        game.insertStackElementBefore(player1, game.stack.elements[1]!.stackId, "start");
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve on damage taken
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(3);
    });
    it("modeling clay jawbone get 25 coins", async () => {
        const item1 = game.obtainCard("b2-jawbone") as ItemCard;
        const clay = game.obtainCard("b2-modeling_clay") as ItemCard;
        game.cardHandler.addInPlay(player1, item1);
        game.cardHandler.addInPlay(player1, clay);
        await game.activateItem(player1, clay, [item1], "tap");
        await game.actions.resolveStack();
        game.cardHandler.recharge(clay);
        game.gainCoins(player1, 22, "debug");
        game.gainCoins(player2, 5, "debug");
        await game.activateItem(player1, clay, [player2], "tap");
        await game.actions.resolveStack();
        expect(player1.coins).toBe(25);
        expect(player2.coins).toBe(2);
        await(Promise.all);
        expect(player1.totalSouls).toBe(1);
    });
    
    it("canceled dice from loot put loot into discard", async () => {
        const card = game.obtainCard("b2-x_wheel_of_fortune") as LootCard;
        game.cardHandler.addCardToHand(player1, card);
        await game.actions.playCard(player1, 0);
        await game.actions.resolveStack();
        
        expect(game.stack.size).toBe(1);
        game.cancelAt(0);
        expect(game.stack.size).toBe(0);
        expect(game.decks.loot.discard.length).toBe(1);
        expect(game.decks.loot.discard.includes(card)).toBe(true);
    });
    
    it("canceled loot goes into discard", async () => {
        const card = game.obtainCard("b2-a_dime") as LootCard;
        game.cardHandler.addCardToHand(player1, card);
        await game.actions.playCard(player1, 0);

        expect(game.stack.size).toBe(1);
        game.cancelAt(0);
        expect(game.stack.size).toBe(0);
        expect(game.decks.loot.discard.length).toBe(1);
        expect(game.decks.loot.discard.includes(card)).toBe(true);
    });
    
    it("canceled curse goes into discard", async () => {
        const card = game.obtainCard("b2-curse_of_amnesia") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card);

        expect(game.stack.size).toBe(1);
        game.cancelAt(0);
        expect(game.stack.size).toBe(0);
        expect(game.decks.monster.discard.length).toBe(1);
        expect(game.decks.monster.discard.includes(card)).toBe(true);
    });
    
    it("canceled event goes into discard", async () => {
        const card = game.obtainCard("b2-ambush") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, card);

        expect(game.stack.size).toBe(1);
        game.cancelAt(0);
        expect(game.stack.size).toBe(0);
        expect(game.decks.monster.discard.length).toBe(1);
        expect(game.decks.monster.discard.includes(card)).toBe(true);
    });
    
    it("reset stack discard event cards", async () => {
        const eventCard = game.obtainCard("b2-curse_of_pain") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, eventCard);
        expect(game.stack.size).toBe(1);
        const loot = game.obtainCard("b2-o_the_fool")! as LootCard;
        game.cardHandler.addCardToHand(player1, loot);
        game.actions.playCard(player1, player1.hand.length - 1, []);
        await game.actions.resolveStack();
        expect(game.encounters.cardsOnTop[0]?.slug).not.toBe("b2-curse_of_pain");
        expect(game.decks.monster.discard.length).toBe(1);
    });
    
    it("taking damages when dead should not softlock", async () => {
        const mob = game.monsters[0]!;
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, mob);
        game.random = () => 0.01;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        game.entityHandler.kill(player1, player1, {card: player1.character!, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.isDead).toBe(true);
        expect(game.stack.size).toBe(1);
        expect(game.stack.elements[0]!.json.type).toBe("endOfTurn");

    });

    it("can not destroy an item in the discard.", async () => {
        const soul = game.decks.loot.draw();
        soul.soul = 1;
        game.cardHandler.addSoul(player1, soul);

        const cc = game.obtainCard("b2-chaos_card") as ItemCard;
        const d20 = game.obtainCard("b2-the_d20") as ItemCard;
        game.cardHandler.addInPlay(player1, cc);
        game.cardHandler.addInPlay(player1, d20);
        await game.activateItem(player1, cc, ["Destroy an item or soul.", soul], "tap");
        await game.activateItem(player1, d20, [cc], "tap");
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.totalSouls).toBe(1);
    });
    it("playing question mark on chaos card should NOT destroy question mark.", async () => {
        const chaosCard = game.obtainCard("b2-chaos_card") as ItemCard;
        game.cardHandler.addInPlay(player1, chaosCard);
        const questionMark = game.obtainCard("fsp2-questionmark_card") as LootCard;
        game.cardHandler.addCardToHand(player1, questionMark);
        game.actions.playCard(player1, player1.hand.length - 1, [chaosCard]);
        await game.actions.resolveStack();
        expect(game.decks.loot.discard.map(c=>c.slug)).toContain(questionMark.slug);
    });
    it("Euthanasia only work for owner.", async () => {
        const card = game.obtainCard("fsp2-euthanasia") as ItemCard;
        game.cardHandler.addInPlay(player2, card);
        const mob = game.monsters[0]!;
        game.entityHandler.addHealth(game.monsters[0]!, 10);
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.random = () => 0.99;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(mob.isDead).toBe(false);
        
        
    });
    it("Roll 6 on pandora's box de not leave it in discard.", async () => {
        const card = game.obtainCard("b2-pandoras_box") as ItemCard;
        game.cardHandler.addInPlay(player1, card);
        game.random = () => 0.99;
        await game.activateItem(player1, card, [], "tap");
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.totalSouls).toBe(1);
        expect(game.decks.treasure.discard.length).toBe(0);

    });
    it("discard 1 loots on death", async () => {
        game.loot(player1, 10);
        const handSize = player1.hand.length;
        game.entityHandler.kill(player1, player1, {card: player1.hand._hand[0] as Card, visualEffectBox: undefined});
        await game.resolveEntireStack();
        expect(game.stack.size).toBe(0);
        expect(player1.hand.length).toBe(handSize - 1);
    });

    it("Swallowed Penny: should give one coin on player takes damage if player is issuer and damage > 0.", async () => {
        const loot = game.decks["loot"]!.getCardFromSlug("b2-swallowed_penny")!;

        player1.addHealthPoints(10);
        const initialHealth = player1.currentHealthPoints;
        const initialCoins = player1.coins;
        const initialCoins2 = player2.coins;
        player1.hand.addToHand(loot);
        game.actions.playCard(player1, 0);
        await game.actions.resolveStack();

        game.entityHandler.dealDamage(player2, player1, {card: loot, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve on damage taken
        expect(player1.coins).toBe(initialCoins + 1);
        expect(player1.currentHealthPoints).toBe(initialHealth - 1);

        game.entityHandler.dealDamage(player2, player1, {card: loot, visualEffectBox: undefined}, 1);
        const dmgOnStck = game.stack.peek()! as DamageOnStack;
        dmgOnStck.damage = [0]; // modify damage to 0
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve on damage taken
        expect(player1.coins).toBe(initialCoins + 1);
        expect(player1.currentHealthPoints).toBe(initialHealth - 1);
    });

    it("stealing does not remove card correctly", async () => {
        const payToPlay = game.shop.obtainCard("b2-pay_to_play") as ItemCard;
        const targetItem = game.shop.obtainCard("b2-brimstone") as ItemCard;
        expect(player1.attackPoints).toBe(1);
        expect(player2.attackPoints).toBe(1);
        game.cardHandler.addInPlay(player2, payToPlay);
        game.cardHandler.addInPlay(player1, targetItem);
        expect(player1.attackPoints).toBe(2);
        expect(player2.attackPoints).toBe(1);

        // Give player2 enough coins
        player2.gainCoins(10);
        const initialCoins = player2.coins;

        // Activate pay_to_play (paid effect with effectId 0)
        await game.activateItem(player2, payToPlay, [targetItem], 0);
        await game.actions.resolveStack();

        expect(player1.attackPoints).toBe(1);
        expect(player2.attackPoints).toBe(2);
        // Item should be stolen and player should lose 10¢
        expect(player2.coins).toBe(initialCoins - 10);
        expect(player1.inPlay).not.toContain(targetItem);
        expect(player2.inPlay).toContain(targetItem);

        expect(player1.inPlay.length).toBe(1);
        expect(player2.inPlay.length).toBe(3);
        expect(player2.inPlay.map((c) => c.slug)).toContain("b2-brimstone");
    });

    it("donation machine can not give itself", async () => {
        const donationMachine = game.obtainCard("b2-donation_machine") as ItemCard;
        game.cardHandler.addInPlay(player1, donationMachine);
        player1.gainCoins(10);
        expect(donationMachine.targetStillValid(player1, 0, [donationMachine])).toBe(false);

        const mc = game.obtainCard("b2-modeling_clay") as ItemCard;
        game.cardHandler.addInPlay(player1, mc);
        game.cardHandler.recharge(mc);
        await game.activateItem(player1, mc, [donationMachine], "tap");
        await game.actions.resolveStack();
        expect(mc.targetStillValid(player1, 0, [donationMachine])).toBe(true);
        expect(mc.targetStillValid(player1, 0, [mc])).toBe(false);
        expect(donationMachine.targetStillValid(player1, 0, [mc])).toBe(true);
    });

    it("stealing bumbo keep counters but not effects", async () => {
        const bumbo = game.obtainCard("b2-bum_bo") as ItemCard;
        game.cardHandler.addInPlay(player1, bumbo);
        game.gainCoins(player1, 40, ("debug"));
        expect(bumbo.counters.value("normal") || 0).toBe(40);
        await game.actions.resolveStack(); // Resolve any stack effects
        await game.actions.resolveStack(); // Resolve any stack effects
        await game.actions.resolveStack(); // Resolve any stack effects
        expect(game.entityHandler.getAttack(player1)).toBe(2);
        expect(game.entityHandler.getAttack(player2)).toBe(1);
        expect(player1.coins).toBe(0);
        game.cardHandler.stealItemAnywhere(player2, bumbo);
        expect(player1.inPlay).not.toContain(bumbo);
        expect(player2.inPlay).toContain(bumbo);
        expect(bumbo.counters.value("normal") || 0).toBe(40);
        expect(game.entityHandler.getAttack(player1)).toBe(1);
        expect(game.entityHandler.getAttack(player2)).toBe(2);
    });


    it("curse removed on death", async () => {
        const pain = game.obtainCard("b2-curse_of_pain") as MonsterCard;
        const blank = game.obtainCard("b2-blank_card") as ItemCard;
        game.cardHandler.addInPlay(player1, blank); // to discard on death
        game.decks["monster"]?.addTopPosition(pain);

        game.encounters.draw(0);
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve the event addition

        expect(player1.curses.length).toBe(1);
        expect(player1.curses[0]!.slug).toBe("b2-curse_of_pain");
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();

        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // end turn effect d6
        await game.actions.resolveStack(); // on turn start
        await game.actions.resolveStack(); // damage
        expect(game.currentPlayer).toBe(player1);
        expect(game.stack.size).toBe(0);
        expect(player1.currentHealthPoints).toBe(1);

        game.entityHandler.kill(player1, player1, {card: pain, visualEffectBox: undefined});
        await game.actions.resolveStack(); // death on stack
        expect(player1.curses.length).toBe(0);

        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();

        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // end turn effect d6
        expect(game.stack.size).toBe(0);
        expect(player1.currentHealthPoints).toBe(2);
    });

    it("curse removed on destruction (dagaz)", async () => {
        const pain = game.obtainCard("b2-curse_of_pain") as MonsterCard;
        const blank = game.obtainCard("b2-blank_card") as ItemCard;
        const dagaz = game.obtainCard("b2-dagaz") as LootCard;
        game.cardHandler.addInPlay(player1, blank); // to discard on death
        game.decks["monster"]?.addTopPosition(pain);

        game.encounters.draw(0);
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve the event addition

        expect(player1.curses.length).toBe(1);
        expect(player1.curses[0]!.slug).toBe("b2-curse_of_pain");
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();

        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // end turn effect d6
        await game.actions.resolveStack(); // on turn start
        await game.actions.resolveStack(); // damage
        expect(game.currentPlayer.id).toBe(player1.id);
        expect(game.stack.size).toBe(0);
        expect(player1.currentHealthPoints).toBe(1);

        game.cardHandler.addCardToHand(player1, dagaz);
        game.actions.playCard(player1, player1.hand.length - 1, ["Destroy a curse.", pain]);
        await game.actions.resolveStack(); // death on stack
        expect(player1.curses.length).toBe(0);

        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();

        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // end turn effect d6
        expect(game.stack.size).toBe(0);
        expect(player1.currentHealthPoints).toBe(2);
    });
    
    it("remove something on top of a monster work", async () => {
        game.actions.declareAttack(player1);
        game.drawMonster(player1, 0);
        const monster = game.monsters[0]!;
        game.entityHandler.kill(player1, monster, {card: player1.character!, visualEffectBox: undefined});
        await game.resolveEntireStack();
        expect(game.monsters[0]).not.toBe(monster);
        expect(game.encounters.visible[0]?.slug).not.toBe(monster.card.slug);
    });
    
    it("start of the turn resolve after loot", async () => {

        const loot = game.obtainCard("b2-cains_eye") as LootCard;
        game.cardHandler.addCardToHand(player1, loot);
        game.actions.playCard(player1, player1.hand.length - 1, []);
        await game.actions.resolveStack();
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.resolveEntireStack();
        const initcard = player1.hand.length;
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(initcard);
        const card = game.decks.loot.cards[0] as LootCard;
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            await new Promise(resolve => setTimeout(resolve, 0));
            return {selected: [], remaining: []};
        };
        expect(player1.hand._hand.map((c) => c.slug)).not.toContain(card.slug);
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(initcard + 1);
        expect(player1.hand._hand.map((c) => c.slug)).toContain(card.slug);
    });

    it("Psy horf dies into gold chest order in stack", async () => {
        const psy = game.obtainCard("b2-psy_horf") as MonsterCard;
        const chest = game.obtainCard("b2-gold_chest") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, psy);
        game.decks.monster.addTopPosition(chest);

        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.entityHandler.kill(player1, game.monsters[0]!, {card: player1.character!, visualEffectBox: undefined});
        await game.actions.resolveStack(); // when this dies 
        expect(game.stack.size).toBe(1);
        await game.actions.resolveStack(); // gold chest top deck
        expect(game.stack.size).toBe(1);
        await game.actions.resolveStack(); // gold chest dice
        expect(game.stack.size).toBe(1);
        expect(game.stack.peek()).toBeInstanceOf(DiceRoll);
    });

    it("b2-keeper_head - Prevented damage should not steal coins.", async () => {
        const card = game.obtainCard("b2-keeper_head") as MonsterCard;
        expect(card).toBeInstanceOf(MonsterCard);
        game.entityHandler.addHealth(player1, 10); // Prevent death by damage

        game.encounters.forceSetMonsterAtSlot(0, card);
        const monster = game.monsters[0]!;

        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, monster);
        const loot = game.obtainCard("b2-soul_heart") as LootCard;
        game.cardHandler.addCardToHand(player1, loot);
        game.actions.playCard(player1, player1.hand.length - 1, [player1]);
        await game.actions.resolveStack(); // damage
        game.actions.attackRoll(player1);
        const dice = game.stack._stack[0] as DiceRoll;
        expect(dice).toBeInstanceOf(DiceRoll);
        dice.value = 1;

        game.gainCoins(player1, 10, ("debug")); // Give some coins to lose
        const init = player1.coins;
        await game.actions.resolveStack(); // dice
        await game.actions.resolveStack(); // dice
        await game.actions.resolveStack(); // damage
        expect(game.stack.size).toBe(0);
        
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.coins).toBe(init);

    });
});


describe("Known bugs that have be corrected", () => {
    let game: Game;
    let player1: Player;
    let player2: Player;

    beforeEach(async () => {
    });
    
    it("mini draft correctness", async () => {
        const setup = await setupTestGame({
            characters: ["b2-samson", "b2-isaac"],
            parameters: new Map<string, any> ([["miniDraft", true]])
        });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        if(player1.inPlay.length !== 3)
            console.log(player1.inPlay.length);
        expect(player1.inPlay.length).toBe(3);
        if(player2.inPlay.length !== 3)
            console.log(player2.inPlay.length);
        expect(player2.inPlay.length).toBe(3);
    });
    
    it("knight bug", async () => {
        const setup = await setupTestGame({
            characters: ["r-the_fettered", "b2-isaac"],
            monsters: ["g2-knight", "b2-fatty"],
            monsterDeck: ["b2-red_host", "b2-pooter"],
            treasureDeck: ["b2-blank_card", "b2-placebo", "b2-tech_x"],
        });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        const m = game.monsters[0]!
        expect(game.monsters[0]!.id).toBe("g2-knight");
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.random = () => 0.01;
        await game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.currentHealthPoints).toBe(2);
        expect(m.currentHealthPoints).toBe(1);
        expect(game.stack.isEmpty()).toBe(true);

        await game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.currentHealthPoints).toBe(2);
        expect(game.stack.isEmpty()).toBe(true);
        expect(m.currentHealthPoints).toBe(0);
    });
});