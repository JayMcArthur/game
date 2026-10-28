import type { ItemCard, MonsterCard, TreasureCard } from "@/models/cards";
import { beforeEach, describe, expect, it } from "bun:test";
import { setTimeout } from "timers/promises";
import { Game } from "../../models/game";
import { Player } from "../../models/entities/player";
import { setupTestGame } from "../testHelpers";
import { AttackRollData, DiceWillRoll } from "@/models/stackElement";

async function characterAdd1LootPlay(player1: Player, game: Game) {
    // verify character card works.
    const lootPlay = player1.remainingLootPlay;
    game.cardHandler.recharge(player1.character as ItemCard);
    await game.activateItem(player1, player1.character!, [], "tap");
    await game.actions.resolveStack();
    await game.actions.resolveStack();
    expect(player1.remainingLootPlay).toBe(lootPlay + 1);
}

describe("Four Souls+2 Eternal Items", () => {
    let game: Game;
    let player1: Player;
    let player2: Player;

    beforeEach(() => {
    });
    
    it("r-the_deserter", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_deserter", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_deserter");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-anima_sola");

        game.cardHandler.recharge(eternal);
        await game.activateItem(player1, eternal, [], "tap");
        await game.actions.resolveStack();
        expect(eternal.flipped).toBe(true);
        expect(eternal.entity !== undefined).toBe(true);
        expect(game.animatedList.all.length).toBe(1);  
        expect(eternal.entity!.attackable).toBe(true);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        game.actions.declareAttack(player2);
        game.actions.declareAttackOnEntity(player2, eternal.entity!);
        game.random = () => 0.99; // Roll only 6
        game.actions.attackRoll(player2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        game.actions.attackRoll(player2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        const hand1 = player1.hand.length;
        const hand2 = player2.hand.length;
        await game.actions.resolveStack();// death
        await game.actions.resolveStack();// effect when this reaches 0 hp
        await game.actions.resolveStack();// effect flip
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.hand.length).toBe(hand2 + 2);
        expect(player1.hand.length).toBe(hand1 + 1);
        expect(eternal.flipped).toBe(false);
        expect(eternal.entity).toBeUndefined();
        expect(game.animatedList.all.length).toBe(0);
        expect(player2.attackThisTurn).toBe(1);
    });

  it("can flip Anima Sola twice without adding monster DC to a player", async () => {
    const setup = await setupTestGame({
                    characters: ["r-the_deserter", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
    game = setup.game;
    player1 = setup.player1;
    player2 = setup.player2!;
    
    expect(player1.character!.slug).toBe("r-the_deserter");
    const eternal = player1.inPlay[0]!;
    expect(eternal.slug).toBe("r-anima_sola");


    expect(() => game.cardHandler.flip(player1, eternal)).not.toThrow();
    expect(eternal.flipped).toBe(true);
    expect(() => game.cardHandler.flip(player1, eternal)).not.toThrow();
    expect(eternal.flipped).toBe(false);
  });

    it("r-the_enigma", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_enigma", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_enigma");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-flip");
        expect(player1.healthPoints).toBe(2);
        expect(player1.attackPoints).toBe(1);
        game.cardHandler.recharge(player1.character);
        await game.activateItem(player1, player1.character, [], "tap");
        await game.actions.resolveStack();
        expect(player1.remainingLootPlay).toBe(11);
        game.entityHandler.kill(player1, player1, {card: eternal, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(3);
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.healthPoints).toBe(1);
        expect(player1.attackPoints).toBe(2);
        const json = player1.character.jsonAPI;
        expect(player1.character.flipped).toBe(true);
        expect(json.nameKey.key).toBe("cardNames.r-amgine_eht");
        expect(json.slug).toBe("r-amgine_eht");
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();

        game.entityHandler.kill(player1, player1, {card: eternal, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(3);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.healthPoints).toBe(2);
        expect(player1.attackPoints).toBe(1);
        const json2 = player1.character.jsonAPI;
        expect(player1.character.flipped).toBe(false);
        expect(json2.nameKey.key).toBe("cardNames.r-the_enigma");
        expect(json2.slug).toBe("r-the_enigma");

    });
    it("r-the_capricious (eternal)", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_capricious", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card", "b2-flush"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        game.obtainCard(game.shop.itemsInShop[0]!.slug);
        
        expect(player1.character!.slug).toBe("r-the_capricious");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-glitch");
        await game.actions.resolveStack();
        expect((eternal.tags.copiedCards as ItemCard[]).map((c) => c.slug).includes("b2-flush")).toBe(true);
        game.cardHandler.recharge(eternal);
        await game.activateItem(player1, eternal, [eternal.tags.copiedCards[0]!], "tap");
        const mobs = game.monsters.map(m => m.card.slug);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        for(const mob of mobs) 
            expect(game.monsters.map(m => m.card.slug).includes(mob)).toBe(false);
    });

    it("r-the_capricious (eternal) red candle before roll", async () => {
        const setup = await setupTestGame({
            characters: ["r-the_capricious", "b2-isaac"],
            monsters: ["b2-fly", "b2-fatty"],
            randomSeed: "glitch-red-candle",
        });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        const candle = game.obtainCard("fsp2-red_candle") as TreasureCard;
        game.shop._slots = [[candle]];
        await game.resolveEntireStack();
        const eternal = player1.inPlay[0]!;
        const copied = (eternal.tags.copiedCards as ItemCard[])[0]!;
        expect(copied.slug).toBe(candle.slug);
        expect(eternal.tags.copiedCards.length).toBe(1);

        game.random = () => 0; // roll a 1, the first number selected by the test helper
        game.rollDice(player1, eternal);
        expect(game.stack.peek() instanceof DiceWillRoll).toBe(true);
        game.cardHandler.recharge(eternal);
        const hp = player1.currentHealthPoints;
        await game.activateItem(player1, eternal, [copied], "tap");
        await game.resolveEntireStack();
        expect(player1.currentHealthPoints).toBe(hp - 1);
        expect(eternal.eternal).toBe(true);
        expect(game.shop.itemsInShop).toContain(candle);

        const breakfast = game.obtainCard("b2-breakfast") as TreasureCard;
        game.shop._slots = [[breakfast]];
        await game.endTurn();
        await game.resolveEntireStack();
        expect(eternal.tags.copiedCards.length).toBe(1);
        expect(eternal.requiresDiceWillRoll).toBe(false);
        game.rollDice(player2, eternal);
        expect(game.stack.peek() instanceof DiceWillRoll).toBe(false);
        await game.resolveEntireStack();
    });

    it("r-the_capricious (eternal) remove previous passive", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_capricious", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-flush", "fsp2-abaddon"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        game.obtainCard(game.shop.itemsInShop[0]!.slug);
        game.select = async (_issuer, _min, _max, _opts, _optional) => ({
            selected: [_opts[0]!],
            remaining: []
        });
        expect(player1.character!.slug).toBe("r-the_capricious");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-glitch");
        await game.actions.resolveStack();
        expect((eternal.tags.copiedCards as ItemCard[]).map((c) => c.slug).includes("fsp2-abaddon")).toBe(true);
        expect(game.entityHandler.getAttack(player1)).toBe(4);
        await game.endTurn();
        await game.resolveEntireStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.entityHandler.getAttack(player1)).toBe(4);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.entityHandler.getAttack(player1)).toBe(4);
    });

    it("r-the_capricious (character)", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_capricious", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card", "b2-flush"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_capricious");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-glitch");
        expect(player1.remainingLootPlay).toBe(0);
        game.cardHandler.recharge(player1.character);
        await game.activateItem(player1, player1.character, ["Play an additional loot card this turn."], "tap");
        await game.actions.resolveStack();
        expect(player1.remainingLootPlay).toBe(1);

        const shopItem = game.shop.itemsInShop[0]!;
        game.cardHandler.recharge(player1.character);
        await game.activateItem(player1, player1.character, ["Put a shop item into discard.", shopItem], "tap");
        await game.actions.resolveStack();
        expect(game.shop.itemsInShop[0]!.slug).not.toBe(shopItem.slug);
    });
    it("r-jacob_and_esau (DOES NOT gain treasure)", async () => {
        const setup = await setupTestGame({
                    characters: ["r-jacob_and_esau", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-jacob_and_esau");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-sibling_rivalry");

        game.cardHandler.recharge(eternal);
        await game.activateItem(player1, eternal, [player2], "tap");
        await game.actions.resolveStack();
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[1]!);
        game.random = () => 0.99; // Roll only 6
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        game.entityHandler.addAttack(player1, 10);
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(2);
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // dice 1
        await game.actions.resolveStack(); // dmg 1
        await game.actions.resolveStack(); // dice 2
        await game.actions.resolveStack(); // dmg 2
        await game.actions.resolveStack(); // death
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand._hand.length).toBe(1);
        expect(player2.hand._hand.length).toBe(0);
    });

    it("r-jacob_and_esau (gain treasure)", async () => {
        const setup = await setupTestGame({
                    characters: ["r-jacob_and_esau", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-jacob_and_esau");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-sibling_rivalry");

        game.cardHandler.recharge(eternal);
        await game.activateItem(player1, eternal, [player2], "tap");
        await game.actions.resolveStack();
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[1]!);
        game.entityHandler.addAttack(player2, 10);
        game.random = () => 0.99; // Roll only 6
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand._hand.length).toBe(1);
        expect(player2.hand._hand.length).toBe(1);
    });
    it("r-the_baleful (eternal)", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_baleful", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card", "b2-flush"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_baleful");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-soulbond");

        game.loot(player1, 3);
        game.loot(player2, 3);
        game.gainCoins(player1, 5, ("debug"));
        game.gainCoins(player2, 5, ("debug"));
        game.gainTreasure(player1, 1);
        game.gainTreasure(player2, 1);

        game.entityHandler.kill(player1, player1, {card: eternal, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        
        expect(player1.hand.length).toBe(3);
        expect(player2.hand.length).toBe(2);
        
        expect(player1.coins).toBe(5);
        expect(player2.coins).toBe(4);
        
        expect(player1.inPlay.length).toBe(1);
        expect(player2.inPlay.length).toBe(1);
    });

    it("r-the_baleful (character)", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_baleful", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_baleful");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-soulbond");
        expect(player1.healthPoints).toBe(1);
        expect(player1.attackPoints).toBe(1);
        let loot = game.decks.loot.draw();
        loot.soul = 1;
        game.cardHandler.addSoul(player1, loot);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.attackPoints).toBe(2);

        loot = game.decks.loot.draw();
        loot.soul = 1;
        game.cardHandler.addSoul(player1, loot);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.attackPoints).toBe(2);

        loot = game.decks.loot.draw();
        loot.soul = 1;
        game.cardHandler.addSoul(player1, loot);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.attackPoints).toBe(3);

        game.cardHandler.removeSoul(player1, loot);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.attackPoints).toBe(2);
    });
    it("r-the_broken", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_broken", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        for(let i = 0; i < 10; i++) 
            game.cardHandler.addTopPosition("treasure", game.cardHandler.copyCard(game.decks.treasure.cards[0]!)!);
        game.shop.removeTop(0);
        expect(player1.character!.slug).toBe("r-the_broken");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-spindown_dice");
        const willGet = game.shop.itemsInShop[0]!;
        game.gainTreasure(player2, 1);
        game.cardHandler.recharge(eternal);
        await game.activateItem(player1, eternal, [player2.inPlay[1]!], "tap");
        await game.actions.resolveStack();
        expect(player2.inPlay[1]!).toBe(willGet);
        game.random = () => 0.99;
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // dice
        expect(eternal.charged).toBe(true);
        game.select = async (_issuer, _min, _max, _opts, _optional) => ({
            selected: [],
            remaining: []
        });
        await game.activateItem(player1, eternal, [player2.inPlay[1]!], "tap");
        await game.actions.resolveStack();
        expect(player2.inPlay.length).toBe(1);

    });
    it("r-the_benighted", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_benighted", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_benighted");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-hemoptysis");

        const mob = game.obtainCard("b2-red_host")! as MonsterCard;
        game.encounters.forceSetMonsterAtSlot(0, mob);
        game.cardHandler.recharge(eternal);
        await game.activateItem(player1, eternal, [], "tap");
        await game.actions.resolveStack();
        await game.activateItem(player1, eternal, [game.monsters[0]!], 0);
        await game.actions.resolveStack();
        expect(game.monsters[0]!.attackPoints).toBe(1);
        expect(eternal.counters.value("normal")).toBe(0);
        game.cardHandler.addToCounter(player1, eternal, "normal", 3);
        await game.activateItem(player1, eternal, [game.monsters[1]!], 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.monsters[1]!.currentHealthPoints).toBe(game.monsters[1]!.healthPoints - 1);
        expect(eternal.counters.value("normal")).toBe(1);

        game.cardHandler.addToCounter(player1, eternal, "normal", 1);
        await game.activateItem(player1, eternal, [game.monsters[1]!, player2], 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.monsters[1]!.currentHealthPoints).toBe(game.monsters[1]!.healthPoints - 2);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints - 1);
        expect(eternal.counters.value("normal")).toBe(0);
    });
    it("r-the_dauntless", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_dauntless", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_dauntless");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-hypercoagulation");
        expect(player1.healthPoints).toBe(1);
        await game.actions.resolveStack();
        expect(player1.healthPoints).toBe(2);
        expect(eternal.counters.value("normal")).toBe(1);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // blood lusst recharge
        await game.actions.resolveStack(); // hypercoagulation trigger
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(eternal.counters.value("normal")).toBe(2);
        expect(player1.healthPoints).toBe(3);

        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // blood lusst recharge
        await game.actions.resolveStack(); // hypercoagulation trigger
        await game.actions.resolveStack(); // hypercoagulation trigger
        await game.actions.resolveStack(); // hypercoagulation trigger
        expect(game.stack.isEmpty()).toBe(true);
        expect(eternal.counters.value("normal")).toBe(3);
        expect(player1.healthPoints).toBe(4);
        
        const initialHandSize = player1.hand.length;
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); 
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(initialHandSize + 3);
        expect(eternal.counters.value("normal")).toBe(0);
        expect(player1.healthPoints).toBe(1);
    });

    it("r-the_curdled", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_curdled", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_curdled");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-sumptorium");

        game.entityHandler.dealDamage(player1, player1, {card: eternal, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(eternal.counters.value("normal")).toBe(1);

        game.cardHandler.addToCounter(player1, eternal, "normal", 1);
        await game.activateItem(player1, eternal, [game.monsters[0]!], 0);
        expect(eternal.counters.value("normal")).toBe(0);
        expect(game.monsters[0]!.evasion).toBe(2);
        await game.actions.resolveStack();
        expect(game.monsters[0]!.evasion).toBe(1);
        await game.endTurn();
        await game.actions.resolveStack();
        expect(game.monsters[0]!.evasion).toBe(2);
    });

    it("r-the_fettered (no damage on roll of 1)", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_fettered", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_fettered");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-dead_weight");
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[1]!);
        game.random = () => 0.01; // Roll only 6
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints);

        game.random = () => 2/6-0.001; // Roll only 6
        game.entityHandler.addDC(game.monsters[1]!, 10);
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints-1);

    });
    it("r-the_harlot", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_harlot", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_harlot");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-gello");

        const monster = game.monsters[1]!;
        expect(monster.card.slug).toBe("b2-fatty");
        const initialHp = monster.currentHealthPoints;
        game.entityHandler.addHealth(game.monsters[0]!, 10);
        game.entityHandler.dealDamage(player1, monster, {card: eternal, visualEffectBox: undefined}, initialHp - 1);
        await game.actions.resolveStack();
        expect(monster.currentHealthPoints).toBe( 1);
        game.cardHandler.recharge(eternal);
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, monster);
        await game.activateItem(player1, eternal, [monster], "tap");
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.monsters[0]!.currentHealthPoints).toBe(game.monsters[0]!.healthPoints - initialHp + 1);
    });
    it("r-the_miser", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_miser", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_miser");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-keepers_bargain");
        game.gainCoins(player1, 6, ("debug"));
        game.actions.declarePurchase(player1);
        expect(game.actions.canPurchase(player1, 0, false)).not.toBe(true);
        expect(game.actions.canPurchase(player1, "top", false)).not.toBe(true);
        game.gainCoins(player1, 1, ("debug"));
        expect(game.actions.canPurchase(player1, 0, false)).toBe(true);
        expect(game.actions.canPurchase(player1, "top", false)).not.toBe(true);

        game.cardHandler.recharge(eternal);
        await game.activateItem(player1, eternal, [], "tap");
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.coins).toBe(9);
        expect(player2.coins).toBe(1);
    });


    it("r-the_soiled", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_soiled", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;

        expect(player1.character!.slug).toBe("r-the_soiled");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-ibs");
        game.loot(player1, 3);
        const lootCard = player1.hand.cards[0]!;
        const initialCoins = player1.coins;
        const initialHandSize = player1.hand.length;
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        
        await game.activateItem(player1, eternal, [ "Gain 3¢."], 0);
        await game.actions.resolveStack();
            
        expect(player1.coins).toBe(initialCoins + 3);
        expect(player1.hand.length).toBe(initialHandSize - 1);
        expect(player1.hand.cards).not.toContain(lootCard);
        expect(player1.isEngagedInCombat).toBe(true);

        const lootCard2 = player1.hand.cards[0]!;
        await game.activateItem(player1, eternal, [ "cancel your attack on a monster."], 0);
        await game.actions.resolveStack();
            
        expect(player1.coins).toBe(initialCoins + 3);
        expect(player1.hand.length).toBe(initialHandSize - 2);
        expect(player1.isEngagedInCombat).toBe(false);
    });
    
    it("r-the_zealot", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_zealot", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        for(let i = 0; i < 10; i++) 
            game.cardHandler.addTopPosition("treasure", game.cardHandler.copyCard(game.decks.treasure.cards[0]!)!);
        await game.endTurn();
        await game.actions.resolveStack();
        expect(game.currentPlayer).toBe(player2);

        expect(player1.character!.slug).toBe("r-the_zealot");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-lemegeton");
        game.gainTreasure(player1, 3);
        game.cardHandler.recharge(eternal);
        await game.activateItem(player1, eternal, [], "tap");
        await game.actions.resolveStack();
        game.cardHandler.recharge(eternal);
        await game.activateItem(player1, eternal, [], "tap");
        await game.actions.resolveStack();
        expect(player1.inPlay.length).toBe(6);
        await game.actions.resolveStack(); // resolve effect
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.inPlay.length).toBe(6);
        expect(game.currentPlayer).toBe(player1);
        await game.activateItem(player1, eternal, [], "tap");
        await game.actions.resolveStack();
        expect(player1.inPlay.length).toBe(7);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.inPlay.length).toBe(4);
    });
    
    it("r-flash_isaac", async () => {
        const setup = await setupTestGame({
                    characters: ["r-flash_isaac", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-flash_isaac");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-classic_roller");
        
        game.random = () => 0.99; // Roll only 6
        const dice = game.rollDice(player1, new AttackRollData(0, 1, 0, 1, 1, player1));
        game.cardHandler.recharge(eternal);
        game.random = () => 0.01; // Roll only 1
        await game.activateItem(player1, eternal, [dice], "tap");
        await game.actions.resolveStack();
        expect(dice.value).toBe(1);
    });
    it("r-the_deceiver", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_deceiver", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_deceiver");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-ceremonial_blade");
        expect(player1.remainingLootPlay).toBe(10);
        game.cardHandler.recharge(eternal);
        await game.activateItem(player1, eternal, [], "tap");
        await game.actions.resolveStack();
        expect(player1.remainingLootPlay).toBe(11);
        game.entityHandler.kill(player1, game.monsters[0]!, {card: eternal, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(1);
        const cardInHand = player1.hand._hand[0]!;
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(1);
        expect(player1.hand._hand[0]!.slug!).not.toBe(cardInHand.slug);
    });


    it("r-bethany", async () => {
        const setup = await setupTestGame({
                    characters: ["r-bethany", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-bethany");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-book_of_virtues");

        const lootsInHands = game.players.map(p => p.hand.length);
        game.entityHandler.kill(player1, game.monsters[0]!, {card: eternal, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.players.map(p => p.hand.length - 1)).toEqual(lootsInHands);

        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.random = () => 0.99; // Roll only 6
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.currentHealthPoints).toBe(player1.healthPoints - 1);

    });

    it("r-the_savage", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_savage", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_savage");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-berserk");
        expect(player1.attackThisTurn).toBe(2);
        expect(player1.attackPoints).toBe(1);
        expect(player1.healthPoints).toBe(2);
        game.entityHandler.kill(player1, game.monsters[0]!, {card: eternal, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.healthPoints).toBe(3);
        game.entityHandler.kill(player2, game.monsters[0]!, {card: eternal, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.healthPoints).toBe(3);
        game.entityHandler.kill(player1, player2, {card: eternal, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.healthPoints).toBe(3);
        
    });

    it("r-the_hoarder", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_hoarder", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        
        expect(player1.character!.slug).toBe("r-the_hoarder");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-bag_of_crafting");
        
        game.loot(player1, 5);
        expect(player1.inPlay.length).toBe(1);
        for(let i = 0; i < 5; i++) {
            await game.activateItem(player1, eternal, [player1.hand._hand[0]], 0);
            await game.actions.resolveStack();
            expect(player1.inPlay.length).toBe(1);
            expect(eternal.counters.value("normal")).toBe(i + 1);
        }
        await game.activateItem(player1, eternal, [], 1);
        expect(eternal.counters.value("normal")).toBe(1);
        await game.actions.resolveStack();
        expect(player1.inPlay.length).toBe(2);

    });
    
    it("r-the_empty", async () => {
        const setup = await setupTestGame({
                    characters: ["r-the_empty", "b2-samson"],
                    monsters: ["b2-fly", "b2-fatty"],
                    monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
                    treasureDeck: ["b2-blank_card"],
                    playerCount: 2
                });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        for(let i = 0; i < 10; i++) 
            game.cardHandler.addTopPosition("treasure", game.cardHandler.copyCard(game.decks.treasure.cards[0]!)!);
        expect(player1.character!.slug).toBe("r-the_empty");
        const eternal = player1.inPlay[0]!;
        expect(eternal.slug).toBe("r-abyss");
        expect(player1.healthPoints).toBe(2);
        expect(player1.attackPoints).toBe(1);
        eternal.counters.addToCounter(1, "normal");
        game.cardHandler.recharge(player1.inPlay[0] as ItemCard);
        game.gainTreasure(player1, 1);
        await game.activateItem(player1, eternal, [player1.inPlay[1]], 0);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.inPlay.length).toBe(1);
        expect(eternal.counters.value("normal")).toBe(2);
        expect(player1.attackPoints).toBe(2);
        game.cardHandler.recharge(player1.inPlay[0] as ItemCard);
        game.gainTreasure(player1, 1);
        await game.activateItem(player1, eternal, [player1.inPlay[1]], 0);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.attackPoints).toBe(2);
        await characterAdd1LootPlay(player1, game);

        game.cardHandler.recharge(player1.inPlay[0] as ItemCard);
        game.gainTreasure(player1, 1);
        await game.activateItem(player1, eternal, [player1.inPlay[1]], 0);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.attackPoints).toBe(3);
        await characterAdd1LootPlay(player1, game);
    });

});

