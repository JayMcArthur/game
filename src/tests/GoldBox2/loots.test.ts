import type { ItemCard, LootCard } from "@/models/cards";
import { beforeEach, describe, expect, it } from "bun:test";
import { Game } from "../../models/game";
import { Player } from "../../models/entities/player";
import { setupTestGame } from "../testHelpers";
import { AttackRollData, DiceRoll } from "@/models/stackElement";

describe("Gold Box 2 Loot Cards", () => {
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

it("g2-pills +2 DC", async () => {
        const card1 = game.obtainCard("g2-pills") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        const initDC = game.monsters[0]!.evasion;
        game.random = () => 0.9;
        await game.actions.playCard(player1, player1.hand.length - 1, []);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        expect(game.monsters[0]!.evasion).toBe(initDC+2);
    });

it("g2-pills -1 DC", async () => {
        const card1 = game.obtainCard("g2-pills") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        const initDC = game.monsters[0]!.evasion;
        game.random = () => 0.5;
        await game.actions.playCard(player1, player1.hand.length - 1, []);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        expect(game.monsters[0]!.evasion).toBe(initDC-1);
        game.entityHandler.endCombat();
        game.entityHandler.addAttackThisTurn(player1, 1, "other");
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        expect(game.monsters[0]!.evasion).toBe(initDC-2);
        game.entityHandler.endCombat();
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.monsters[0]!.evasion).toBe(initDC);
    });

it("g2-pills recharge items", async () => {
        const card1 = game.obtainCard("g2-pills") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        game.gainTreasure(player1, 2);
        for(const item of player1.inPlay)
            game.cardHandler.deactivateItem(item);
        game.random = () => 0.01;
        await game.actions.playCard(player1, player1.hand.length - 1, []);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        for(const item of player1.inPlay)
            expect(item.charged).toBe(true);
    });

it("g2-pink_eye", async () => {
        const card1 = game.obtainCard("g2-pink_eye") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        expect(player1.inPlay[0]!.charged).toBe(false);
        await game.actions.playCard(player1, player1.hand.length - 1, []);
        await game.actions.resolveStack();
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.random = () => 0.01
        const old = game.monsters[0]!.currentHealthPoints;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.currentHealthPoints).toBe(1);
        expect(game.monsters[0]!.currentHealthPoints).toBe(old-1);
    });
    
it("g2-holy_card", async () => {
    const card1 = game.obtainCard("g2-holy_card") as LootCard;
    game.cardHandler.addCardToHand(player1, card1);
    expect(player1.inPlay[0]!.charged).toBe(false);
    await game.actions.playCard(player1, player1.hand.length - 1, [player1]);
    await game.actions.resolveStack();
    game.entityHandler.kill(player1, player1, {card: card1, visualEffectBox: undefined});
    await game.actions.resolveStack();
    expect(game.stack.size).toBe(1);
    expect(player1.isDead).toBe(false);
    expect(game.currentPlayer === player1).toBe(true);
    await game.actions.resolveStack();
    await game.actions.resolveStack();
    await game.actions.resolveStack();
    expect(game.currentPlayer === player1).toBe(false);
});

it("g2-cancer", async () => {
        const card1 = game.obtainCard("g2-cancer") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        expect(player1.inPlay[0]!.charged).toBe(false);
        await game.actions.playCard(player1, player1.hand.length - 1, []);
        await game.actions.resolveStack();
        game.random = () => 2/6-0.01;
        let dice = game.rollDice(player1, card1);
        await game.actions.resolveStack();
        expect(dice.value).toBe(3);
        dice = game.rollDice(player1, card1);
        await game.actions.resolveStack();
        expect(dice.value).toBe(2);
    });

it("g2-credit_card no purchase this turn", async () => {
        const card1 = game.obtainCard("g2-credit_card") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        expect(player1.inPlay[0]!.charged).toBe(false);
        await game.actions.playCard(player1, player1.hand.length - 1, [player2]);
        await game.actions.resolveStack();
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        game.actions.declarePurchase(player2);
        expect(()=>game.actions.purchase(player2, "top")).toThrow();
        expect(()=>game.actions.purchase(player2, 1)).toThrow();
    });

it("g2-credit_card", async () => {
        const card1 = game.obtainCard("g2-credit_card") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        expect(player1.inPlay[0]!.charged).toBe(false);
        await game.actions.playCard(player1, player1.hand.length - 1, [player2]);
        await game.actions.resolveStack();
        game.actions.declarePurchase(player1);
        expect(()=>game.actions.purchase(player1, "top")).toThrow();
        game.actions.purchase(player1, 0);
        game.stack.cancel();
        game.entityHandler.addPurchaseThisTurn(player1, 1, "other");
        game.actions.declarePurchase(player1);
        expect(()=>game.actions.purchase(player1, "top")).toThrow();
        expect(()=>game.actions.purchase(player1, 1)).toThrow();
    });
 
it("g2-joker", async () => {
        const card1 = game.obtainCard("g2-joker") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        expect(player1.inPlay[0]!.charged).toBe(false);
        await game.actions.playCard(player1, player1.hand.length - 1, [player2]);
        game.loot(player2, 1);
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(1);
        expect(player2.hand.length).toBe(0);
    });
 
it("g2-charged_penny", async () => {
        const card1 = game.obtainCard("g2-charged_penny") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        expect(player1.inPlay[0]!.charged).toBe(false);
        await game.actions.playCard(player1, player1.hand.length - 1, [player1.inPlay[0]!]);
        await game.actions.resolveStack();
        expect(player1.coins).toBe(1);
        expect(player1.inPlay[0]!.charged).toBe(true);
    });
 
it("g2-jera", async () => {
        const card1 = game.obtainCard("g2-jera") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        await game.actions.playCard(player1, 0, []);
        game.loot(player1, 7);
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(14);
    });
 
it("g2-two_of_diamonds", async () => {
        const card1 = game.obtainCard("g2-two_of_diamonds") as LootCard;
        game.cardHandler.addCardToHand(player1, card1);
        await game.actions.playCard(player1, 0, [player1]);
        game.gainCoins(player1, 12, "debug");
        await game.actions.resolveStack();
        expect(player1.coins).toBe(24);
    });
});

