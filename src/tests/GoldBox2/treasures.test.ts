import { Game } from "../../models/game";
import type { ItemCard, LootCard, TreasureCard } from "@/models/cards";
import { MonsterCard } from "@/models/cards";
import { beforeEach, describe, expect, it } from "bun:test";
import { Player } from "../../models/entities/player";
import { setupTestGame } from "../testHelpers";
import { DamageOnStack, AttackRollData, DiceRoll } from "../../models/stackElement";
import { TargetBuilder } from "@/models/targetBuilder";

describe("Gold Box 2 Treasures", () => {
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


 
    it("g2-lemon_mishap", async () => {
        const card1 = game.obtainCard("g2-lemon_mishap") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        game.random = () => 0.01;
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.entityHandler.addHealth(player1, 10);
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(0);
        await game.activateItem(player1, card1, [], "tap");
        await game.actions.resolveStack();
        game.actions.attackRoll(player1);
        expect(game.stack.size).toBe(1);
        for(const mob of game.monsters)
            game.entityHandler.addHealth(mob, 10, "other");
        let health = game.monsters.map(m => m.currentHealthPoints);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(0);
        game.entityHandler.endCombat();
        await game.endTurn();
        await game.resolveEntireStack();
        game.actions.declareAttack(player2);
        game.actions.declareAttackOnEntity(player2, game.monsters[0]!);
        game.entityHandler.addHealth(player2, 10);
        game.actions.attackRoll(player2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(0);
    });
 
    it("g2-i_cant_believe_its_not_butter_bean cannot target loot that aim a dice from someone else dice", async () => {
        const card1 = game.obtainCard("g2-i_cant_believe_its_not_butter_bean") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);

        const card2 = game.obtainCard("b2-dice_shard") as LootCard;
        game.cardHandler.addCardToHand(player1, card2);
        const el = game.rollDice(player2, card1);
        await game.actions.playCard(player1, 0, [el]);
        expect(async () => await game.activateItem(player1, card1, [game.stack.elements[1]], "tap")).toThrow();
    });
 
    it("g2-i_cant_believe_its_not_butter_bean can target loot that aim your dice", async () => {
        const card1 = game.obtainCard("g2-i_cant_believe_its_not_butter_bean") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);

        const card2 = game.obtainCard("b2-dice_shard") as LootCard;
        game.cardHandler.addCardToHand(player1, card2);
        const el = game.rollDice(player1, card1);
        await game.actions.playCard(player1, 0, [el]);
        await game.activateItem(player1, card1, [game.stack.elements[1]], "tap");
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(1);
    });
 
    it("g2-i_cant_believe_its_not_butter_bean can target effect that aim your item", async () => {
        const card1 = game.obtainCard("g2-i_cant_believe_its_not_butter_bean") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);

        const card2 = game.obtainCard("b2-chaos_card") as ItemCard;
        game.cardHandler.addInPlay(player1, card2);
        await game.activateItem(player1, card2, ["Destroy an item or soul.", card1]);
        await game.activateItem(player1, card1, [game.stack.elements[0]], "tap");
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.inPlay.length).toBe(3);
    });
 
    it("g2-i_cant_believe_its_not_butter_bean cannot target any loot", async () => {
        const card1 = game.obtainCard("g2-i_cant_believe_its_not_butter_bean") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);

        const card2 = game.obtainCard("b2-a_dime") as LootCard;
        game.cardHandler.addCardToHand(player1, card2);
        game.actions.playCard(player1, 0, []);
        expect(game.actions.canActivate(card1, player1)).not.toBe(true);
    });
 
    it("g2-ouija_board", async () => {
        const card1 = game.obtainCard("g2-ouija_board") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        const c1 = game.obtainCard("b2-spider") as MonsterCard;
        const c2 = game.obtainCard("b2-chest") as MonsterCard;
        const c3 = game.obtainCard("b2-chest_2") as MonsterCard;
        const c4 = game.obtainCard("b2-conjoined_fatty") as MonsterCard;

        game.decks.monster.addTopPosition(c4);
        game.decks.monster.addTopPosition(c3);
        game.decks.monster.addTopPosition(c2);
        game.decks.monster.addTopPosition(c1);

        await game.activateItem(player1, card1, [], "tap");
        await game.resolveEntireStack();
        const bottom = game.decks.monster.cards.slice(-2);
        expect(bottom.includes(c1)).toBe(true);
        expect(bottom.includes(c4)).toBe(true);
        expect(game.decks.monster.discard.includes(c2)).toBe(true);
        expect(game.decks.monster.discard.includes(c3)).toBe(true);
    });
 
    it("g2-moms_knife", async () => {
        const card1 = game.obtainCard("g2-moms_knife") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        expect(game.entityHandler.getAttack(player1)).toBe(2);
        const mob = game.monsters[0]!;
        for(const mob of game.monsters)
            game.entityHandler.addHealth(mob, 10, "other");
        const health = game.monsters.map(m=> m.currentHealthPoints);
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.random = () =>0.99;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty())
        expect(game.monsters.map(m=> m.currentHealthPoints+1 + (mob === m ? 1 : 0))).toEqual(health);
    });
 
    it("g2-plan_c", async () => {
        const card1 = game.obtainCard("g2-plan_c") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        const mob = game.monsters[0]!;
        await game.activateItem(player1, card1, [mob], "tap");
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(mob.isDead).toBe(true);
        for(const player of game.players)
            expect(player.isDead).toBe(false);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        for(const player of game.players)
            expect(player.isDead).toBe(true);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.currentPlayer === player2).toBe(true);
        await game.endTurn();
        expect(game.stack.size).toBe(2);

    });
 
    it("g2-more_options", async () => {
        const card1 = game.obtainCard("g2-more_options") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        expect(player1.remainingPurchaseThisTurn).toBe(2);
        await game.endTurn();
        await game.resolveEntireStack();
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        let check = false;
        const names = game.decks.treasure.cards.slice(0,2).map(c=>c.globalId);
        game.select = async (_issuer, _min, _max, _opts, _optional) => {
            if(_opts.length === 1)
                return {
                    selected: [_opts[0]!],
                    remaining: []
                }
            check = true;
            expect(_max).toBe(0);
            expect(_opts.map(c=> (c as TreasureCard).globalId)).toEqual(names);
            return {
            selected: [],
            remaining: []
        }};
        await game.actions.resolveStack();
        expect(check).toBe(true);
        expect(game.stack.size).toBe(1);
    });
 
    it("g2-soy_milk", async () => {
        const evasions = game.monsters.map(m=> game.entityHandler.getDC(m));
        const card1 = game.obtainCard("g2-soy_milk") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        expect(game.monsters.map(m=> game.entityHandler.getDC(m)-1)).toEqual(evasions);
        for(const mob of game.monsters)
            game.entityHandler.addHealth(mob, 10, "other");
        const health = game.monsters.map(m=> m.currentHealthPoints);
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.random = () =>0.99;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty())
        expect(game.monsters.map(m=> m.currentHealthPoints+1)).toEqual(health);
    });
 
    it("g2-succubus", async () => {
        const card1 = game.obtainCard("g2-succubus") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        expect(player1.remainingLootPlay).toBe(10);
        game.gainCoins(player1, 4, "debug");
        await game.activateItem(player1, card1, [], 0);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.remainingLootPlay).toBe(12);
        expect(player1.coins).toBe(1);
    });
 
    it("g2-fruitcake recharge", async () => {
        const card1 = game.obtainCard("g2-fruitcake") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        game.random = () => 0.4;
        card1.charged = false;
        game.rollDice(player1, card1);
        expect(game.stack.isEmpty()).toBe(false);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(card1.charged).toBe(false)
        game.rollDice(player2, card1);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(card1.charged).toBe(false)
        game.rollDice(player2, card1);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(false);
        await game.actions.resolveStack();
        expect(card1.charged).toBe(true)
    });
 
    it("g2-fruitcake 3", async () => {
        const card1 = game.obtainCard("g2-fruitcake") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        game.random = () => 0.4;
        await game.activateItem(player1, card1, [], "tap");
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.coins).toBe(1);
    });
 
    it("g2-fruitcake", async () => {
        const card1 = game.obtainCard("g2-fruitcake") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        game.random = () => 0.01;
        await game.activateItem(player1, card1, [], "tap");
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(1);
    });
 
    it("g2-skeleton_key", async () => {
        const card1 = game.obtainCard("g2-skeleton_key") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.attackThisTurn).toBe(100);
    });
 
    it("g2-the_bible kill mom", async () => {
        const card1 = game.obtainCard("g2-the_bible") as TreasureCard;
        const mom = game.obtainCard("b2-mom") as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, mom);
        const mob = game.monsters[0]!
        game.cardHandler.addInPlay(player1, card1);
        await game.activateItem(player1, card1, ["kill a monster named mom, mom's heart, or it lives", mob]);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(mob.isDead).toBe(true);
    });
 
    it("g2-the_bible cancel attack", async () => {
        const card1 = game.obtainCard("g2-the_bible") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        await game.activateItem(player1, card1, ["Cancel your attack."]);
        await game.resolveEntireStack();
        expect(player1.isEngagedInCombat).toBe(false);
    });
 
    it("g2-the_bible curse", async () => {
        const card1 = game.obtainCard("g2-the_bible") as TreasureCard;
        const curse = game.obtainCard("g2-curse_of_fatigue") as MonsterCard;
        game.cardHandler.addCurse(player1, curse);
        game.cardHandler.addInPlay(player1, card1);
        expect(player1.curses.length).toBe(1);
        await game.activateItem(player1, card1, ["Destroy a curse.", curse]);
        await game.resolveEntireStack();
        expect(player1.curses.length).toBe(0);
    });
 
    it("g2-dads_key", async () => {
        const card1 = game.obtainCard("g2-dads_key") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        game.loot(player1, 1);
        const mob = game.monsters[0]!;
        await game.activateItem(player1, card1, [mob], 0);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(0);
        expect(game.monsters[0]!.id).not.toBe(mob.id);
    });
 
    it("g2-dads_key", async () => {
        const card1 = game.obtainCard("g2-dads_key") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        game.loot(player1, 1);
        const mob = game.monsters[0]!;
        await game.activateItem(player1, card1, [mob], 0);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(0);
        expect(game.monsters[0]!.id).not.toBe(mob.id);
    });
 
    it("g2-crooked_penny", async () => {
        const card1 = game.obtainCard("g2-crooked_penny") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        game.gainCoins(player1, 12, "debug");
        game.random = () => 0.01;
        await game.activateItem(player1, card1, [player1], "tap");
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.coins).toBe(24);

        game.random = () => 0.99;
        game.cardHandler.recharge(card1);
        await game.activateItem(player1, card1, [player1], "tap");
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.coins).toBe(0);
    });
 
    it("g2-9_volt", async () => {
        const card1 = game.obtainCard("g2-9_volt") as TreasureCard;
        game.gainTreasure(player1, 2);
        game.cardHandler.addInPlay(player1, card1);
        for(const item of player1.inPlay)
            game.cardHandler.deactivateItem(item);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.inPlay[0]?.charged).toBe(true);
        expect(player1.inPlay[1]?.charged).toBe(true);
        expect(player1.inPlay[2]?.charged).toBe(false);
    });
 
    it("g2-the_butter_bean", async () => {
        const card1 = game.obtainCard("g2-the_butter_bean") as TreasureCard;
        game.cardHandler.addInPlay(player1, card1);
        game.random = () => 0.99;
        await game.activateItem(player1, card1, [], "tap");
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(card1.charged).toBe(true);
    });

});

