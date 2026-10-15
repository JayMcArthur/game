import type { Card, ItemCard, LootCard } from "@/models/cards";
import { MonsterCard } from "@/models/cards";
import { beforeEach, describe, expect, it } from "bun:test";
import { Game } from "../models/game";
import { Player } from "../models/entities/player";
import { setupStandardTestGame } from "./testHelpers";

describe("Discard", () => {
    let game: Game;
    let player1: Player;
    let player2: Player;

    beforeEach(async () => {
        const setup = await setupStandardTestGame();
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
    });

    it("discard is shuffled back when deck is empty", async () => {
        game.decks.loot.addDiscardTop(game.decks.loot.draw());
        const discard = game.decks.loot.discard[0]!;
        const initialLootDeckSize = game.decks.loot.length; 
        game.loot(player1, initialLootDeckSize-1);
        expect(game.decks.loot.length).toBe(1);
        expect(game.decks.loot.cards[0]).not.toBe(discard);
        game.loot(player1, 1);
        expect(game.decks.loot.length).toBe(1);
        expect(game.decks.loot.discard.length).toBe(0);
        expect(game.decks.loot.cards[0]).toBe(discard);
    });

    it("discard 1 loots on death", async () => {
        game.loot(player1, 10);
        const handSize = player1.hand.length;
        game.entityHandler.kill(player1, player1, {card: player1.hand._hand[0] as Card, visualEffectBox: undefined});
        expect(game.decks['loot']!.discard.length).toBe(0);
        await game.resolveEntireStack();
        expect(game.stack.size).toBe(0);
        expect(player1.hand.length).toBe(handSize - 1);
        expect(game.decks['loot']!.discard.length).toBe(1);
    });

    it("discard card on play", async () => {
        game.cardHandler.addCardToHand(player1, game.obtainCard("b2-a_dime")! as LootCard);
        game.cardHandler.addCardToHand(player1, game.obtainCard("b2-a_nickel")! as LootCard);
        game.actions.playCard(player1, 0);
        game.entityHandler.addLootPlay(player1, 1);
        game.actions.playCard(player1, 0);
        expect(game.decks['loot']!.discard.length).toBe(0);
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(1);
        expect(game.decks['loot']!.discard.length).toBe(1);
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(0);
        expect(game.decks['loot']!.discard.length).toBe(2);
    });
    
    it("discard trinket on play", async () => {
        game.cardHandler.addCardToHand(player1, game.obtainCard("b2-swallowed_penny")! as LootCard);
        game.actions.playCard(player1, 0);
        expect(game.decks['loot']!.discard.length).toBe(0);
        await game.resolveEntireStack();
        expect(game.stack.size).toBe(0);
        expect(game.decks['loot']!.discard.length).toBe(0);
        game.entityHandler.kill(player1, player1, {card: player1.character!, visualEffectBox: undefined});
        await game.resolveEntireStack();
        expect(game.decks['loot']!.discard.length).toBe(1);
        expect(game.decks['monster']!.discard.length).toBe(0);
        expect(game.decks['treasure']!.discard.length).toBe(0);
    });

    it("curse discard", async () => {
        const card: MonsterCard = game.obtainCard("b2-curse_of_loss") as MonsterCard;
        game.decks['monster']!.addTopPosition(card);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        await game.resolveEntireStack();
        expect(game.decks['loot']!.discard.length).toBe(0);
        expect(game.decks['monster']!.discard.length).toBe(0);
        expect(game.decks['treasure']!.discard.length).toBe(0);
        expect(player1.curses.map(c => c.slug)).toContain("b2-curse_of_loss");
        game.entityHandler.kill(player1, player1, {card: player1.character!, visualEffectBox: undefined});
        await game.resolveEntireStack();
        expect(player1.curses.map(c => c.slug)).not.toContain("b2-curse_of_loss");

        expect(game.decks['loot']!.discard.length).toBe(0);
        expect(game.decks['treasure']!.discard.length).toBe(0);
        expect(game.decks['monster']!.discard.length).toBe(1);
    });

    it("curse discard 2", async () => {
        const card: MonsterCard = game.obtainCard("b2-curse_of_loss") as MonsterCard;
        const card2: MonsterCard = game.obtainCard("b2-moms_hand") as MonsterCard;
        const ewaz: LootCard = game.obtainCard("b2-ehwaz") as LootCard;
        game.decks['monster']!.addTopPosition(card2);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        const mobster = game.monsters[0]!;
        game.entityHandler.kill(mobster, player1, {card: ewaz, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        game.cardHandler.addCardToHand(player2, ewaz);
        game.entityHandler.addLootPlay(player2, 1);
        game.actions.playCard(player2, player2.hand.length - 1);
        await game.actions.resolveStack();
        expect(game.encounters.visible[0]!.slug).not.toBe("b2-moms_hand");
    });


    it("kill monster with soul becomes player's soul (not discarded)", async () => {
        // Use Gurdy which has a soul in the monster deck
        const gurdy = game.decks['monster']!.getCardFromSlug("b2-gurdy") as MonsterCard;
        game.decks['monster']!.addTopPosition(gurdy);
        
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        
        const monster = game.monsters[0]!;
        const monsterCard = monster.card;
        
        // Verify the monster has a soul reward
        expect(monsterCard.rewards?.soul).toBeGreaterThan(0);
        
        const initialSouls = player1.totalSouls;
        const initialDiscardSize = game.decks['monster']!.discard.length;
        
        // Kill the monster
        game.entityHandler.kill(player1, monster, {card: monsterCard, visualEffectBox: undefined});
        await game.resolveEntireStack();
        
        // Monster should become a soul, not be discarded
        expect(player1.totalSouls).toBe(initialSouls + (monsterCard.rewards!.soul! as number));
        expect(player1.targetableSouls).toContain(monsterCard);
        expect(game.decks['monster']!.discard.length).toBe(initialDiscardSize);
    });

    it("kill monster without soul goes to discard", async () => {
        // Get a monster with no soul reward
        const monsterCard = game.obtainCard("b2-cod_worm") as MonsterCard;
        
        game.decks['monster']!.addTopPosition(monsterCard);
        
        const initialDiscardSize = game.decks['monster']!.discard.length;
        
        // Attack and kill the monster
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        
        const monster = game.monsters[0]!;
        game.entityHandler.kill(player1, monster, {card: monsterCard, visualEffectBox: undefined});
        await game.resolveEntireStack();
        
        // Monster should go to discard pile
        expect(game.decks['monster']!.discard.length).toBe(initialDiscardSize + 1);
        expect(game.decks['monster']!.discard).toContain(monsterCard);
        expect(player1.targetableSouls).not.toContain(monsterCard);
    });

    it("discard monster puts it in monster discard pile", async () => {
        const monster = game.monsters[0]!;
        const monsterCard = monster.card;
        const monsterPosition = 0;
        
        const initialDiscardSize = game.decks['monster']!.discard.length;
        
        // Discard the monster
        game.discardMonster(player1, monsterPosition);
        
        // Monster should be in discard pile
        expect(game.decks['monster']!.discard.length).toBe(initialDiscardSize + 1);
        expect(game.decks['monster']!.discard).toContain(monsterCard);
        expect(game.monsters[monsterPosition]).not.toBe(monster);
    });

    it("shop flush discards all treasure cards", async () => {
        const initialDiscardSize = game.decks['treasure']!.discard.length;
        const shopCards = [...game.shop.itemsInShop].filter(c => c !== undefined);
        const numShopCards = shopCards.length;
        
        expect(numShopCards).toBeGreaterThan(0);
        
        // Flush the shop
        game.shop.flush();
        
        // All shop cards should be in the discard
        expect(game.decks['treasure']!.discard.length).toBe(initialDiscardSize + numShopCards);
        
        for (const card of shopCards) {
            expect(game.decks['treasure']!.discard).toContain(card);
        }
    });

    it("destroy treasure does not put it in discard", async () => {
        const treasureCard = game.shop.obtainCard("b2-bobs_brain") as ItemCard;
        game.cardHandler.addInPlay(player1, treasureCard);
        
        const initialDiscardSize = game.decks['treasure']!.discard.length;
        
        // Destroy the treasure
        game.cardHandler.destroyCardsOrSouls([treasureCard]);
        
        // Card should be destroyed (not in discard)
        expect(game.decks['treasure']!.discard.length).toBe(initialDiscardSize + 1);
        expect(game.decks['treasure']!.discard).toContain(treasureCard);
        expect(player1.inPlay).not.toContain(treasureCard);
    });

    it("destroy soul does not put it in discard", async () => {
        // Give player1 a soul
        const monsterCard = game.obtainCard("b2-fly") as MonsterCard;
        monsterCard.soul = 1;
        player1.addSoul(monsterCard);
        
        const initialDiscardSize = game.decks['monster']!.discard.length;
        const initialSouls = player1.totalSouls;
        
        // Destroy the soul
        game.cardHandler.destroyCardsOrSouls([monsterCard]);
        
        // Card should be destroyed (not in discard)
        expect(game.decks['monster']!.discard.length).toBe(initialDiscardSize+1);
        expect(game.decks['monster']!.discard).toContain(monsterCard);
        expect(player1.targetableSouls).not.toContain(monsterCard);
        expect(player1.totalSouls).toBe(initialSouls - monsterCard.soul);
    });
});