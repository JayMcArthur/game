import type { ItemCard, LootCard, MonsterCard, RoomCard, TreasureCard } from "@/models/cards";
import { beforeEach, describe, expect, it } from "bun:test";
import { Player } from "../../models/entities/player";
import { Game } from "../../models/game";
import { setupTestGame } from "../testHelpers";
import { DamageOnStack, DiceRoll } from "../../models/stackElement";


describe("Requiem Loots ", () => {
    let game: Game;
    let player1: Player;
    let player2: Player;
    
    beforeEach(async () => {
        const setup = await setupTestGame({
                        characters: ["fsp2-guppy", "b2-lilith"],
                        monsters: ["b2-fly", "b2-fatty"],
                        monsterDeck: ["b2-red_host", "b2-pooter","b2-cod_worm","b2-spider","b2-conjoined_fatty", "b2-dip","b2-leech","b2-gurdy"],
                        treasureDeck: ["b2-boomerang", "b2-guppys_head", "b2-blank_card", "b2-tech_x", "b2-the_battery", "b2-lucky_foot", "b2-mini_mush", "b2-spoon_bender"],
                        bonusSouls: [],
                        playerCount: 2,
                        rooms: true,
                    });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        game.resetStack();
        game.resetCallbacks();
    });
    
        // it("abel", async () => {
        //     let item = game.obtainCard("r-abel") as ItemCard;
        //     expect(item).toBeDefined();
        //     game.cardHandler.addInPlay(player1, item);
        // });
    
        it("the_clicker (Eden)", async () => {
            let item = game.obtainCard("r-the_clicker") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            const initChara = player1.character;
            const initEt = player1.inPlay[0]!;
            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [game.decks.character.cards.find((c) => c.slug === "r-eden")], "tap");

            await game.actions.resolveStack();
            expect(player1.character.slug).not.toBe(initChara.slug);
            expect(player1.inPlay[0]).toBeDefined();
            expect(player1.inPlay[0]?.slug).not.toBe(initEt.slug);
            expect(player1.inPlay.length).toBe(1);
        });
    
     it("Modifying values of a flipped card should not cause errors", async () => {
        const clicker = game.obtainCard("r-the_clicker") as ItemCard;
        game.cardHandler.addInPlay(player1, clicker);
        game.cardHandler.recharge(clicker);
        const deserter = game.decks.character.cards.find(c => c.slug === "r-the_deserter");
        await game.activateItem(player1, clicker, [deserter], "tap");
        await game.actions.resolveStack();
        const sola = player1.inPlay[0]!;
        expect(player1.character.slug).toBe("r-the_deserter");
        expect(sola.slug).toBe("r-anima_sola");

        game.cardHandler.recharge(sola);
        await game.activateItem(player1, sola, [], "tap");
        await game.actions.resolveStack();
        expect(sola.flipped).toBe(true);
        const marker = game.obtainCard("r-magic_marker") as LootCard;
        game.cardHandler.addCardToHand(player1, marker);
        game.actions.playCard(player1, player1.hand.length - 1, [sola]);
        await game.actions.resolveStack();
        expect(sola.flipped).toBe(true);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(sola.flipped).toBe(true);
    });


        it("the_clicker", async () => {
            let item = game.obtainCard("r-the_clicker") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            const initChara = player1.character;
            const initEt = player1.inPlay[0]!;
            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [game.decks.character.cards.find(c => c.slug === "r-the_deserter")], "tap");

            await game.actions.resolveStack();
            expect(player1.character.slug).not.toBe(initChara.slug);
            expect(player1.inPlay[0]).toBeDefined();
            expect(player1.inPlay[0]?.slug).not.toBe(initEt.slug);
            expect(player1.inPlay.length).toBe(1);
        }); // Repeat to check for consistency 
    
        it("undefined", async () => {
            let item = game.obtainCard("r-undefined") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            const spoon = game.obtainCard("b2-spoon_bender") as TreasureCard;
            game.shop._deck.addTopPosition(spoon);
            game.shop.discardTop(0);
            
            game.cardHandler.recharge(item);
            expect(game.shop.itemsInShop[0]?.name.includes("Spoon Bender")).toBe(true);
            await game.activateItem(player1, item, [game.shop.itemsInShop[0]], "tap");
            await game.actions.resolveStack();

            expect(item.name).toBe(game.shop.itemsInShop[0]!.name);
            expect(item.charged).toBe(true);
            game.random = () => 0.1;
            const dice = game.rollDice(player1, item);
            expect(dice.value).toBe(1);
            await game.activateItem(player1, item, [dice, 1], "tap");
            await game.actions.resolveStack();
            expect(dice.value).toBe(2);
            expect(item.charged).toBe(false);
            await game.actions.resolveStack();
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(item.name).toBe(game.shop.itemsInShop[0]!.name);
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(item.name).not.toBe(game.shop.itemsInShop[0]!.name);
        });
    
        it("trick_penny: pay less expensive", async () => {
            let item = game.obtainCard("r-trick_penny") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            const treas = game.obtainCard("r-car_battery") as LootCard;
            game.cardHandler.addInPlay(player1, treas);
            treas.charged = false;
            game.gainCoins(player1, 6, ("debug"));
            expect(game.actions.canActivate(treas, player1)).toBe(true);
            await game.activateItem(player1, treas, [], 0);
            expect(player1.coins).toBe(0);
        });
        
        it("trick_penny", async () => {
            let item = game.obtainCard("r-trick_penny") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            game.actions.declarePurchase(player1);
            game.gainCoins(player1, 8, ("debug"));
            expect(game.actions.canPurchase(player1, 0, false)).not.toBe(true);
            game.gainCoins(player1, 1, ("debug"));
            expect(game.actions.canPurchase(player1, 0, false)).toBe(true);        
            game.gainCoins(player1, 1, ("debug"));
            expect(player1.coins).toBe(10);
            game.actions.purchase(player1, "top");
            await game.actions.resolveStack();
            expect(player1.coins).toBe(1);
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.coins).toBe(2);
        });
    
        it("rock_bottom", async () => {
            let item = game.obtainCard("r-rock_bottom") as ItemCard;
            expect(item).toBeDefined();
            game.loot(player1, 2);
            game.cardHandler.addInPlay(player1, item);
            await game.actions.resolveStack();
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.hand.length).toBe(3);

            game.cardHandler.discardFromHandAtIndex(player1, 0, "other");
            game.cardHandler.discardFromHandAtIndex(player1, 0, "other");
            await game.actions.resolveStack();
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(player1.hand.length).toBe(3);
        });
    
        it("red_key during combat", async () => {
            let item = game.obtainCard("r-red_key") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.actions.declareAttack(player1);
            game.cardHandler.recharge(item);
            const room = game.decks.room.cards[0] as RoomCard;
            await game.activateItem(player1, item, [game.decks.room], "tap");
            await game.actions.resolveStack();
            expect(game.rooms?.activeRooms[0]!.slug).not.toBe(room.slug);

        });

        it("red_key (monster)", async () => {
            let item = game.obtainCard("r-red_key") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.cardHandler.recharge(item);
            const mob = game.decks.monster.cards[0] as MonsterCard;
            await game.activateItem(player1, item, [game.decks.monster], "tap");
            await game.actions.resolveStack();
            expect(game.monsters[0]!.card.slug).toBe(mob.slug);

        });
    
        it("red_key (room)", async () => {
            let item = game.obtainCard("r-red_key") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.cardHandler.recharge(item);
            const room = game.decks.room.cards[0] as RoomCard;
            await game.activateItem(player1, item, [game.decks.room], "tap");
            await game.actions.resolveStack();
            expect(game.rooms?.activeRooms[0]!.slug).toBe(room.slug);

        });
    
        it("ultra_flesh_kid", async () => {
            let item = game.obtainCard("r-ultra_flesh_kid") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            game.entityHandler.kill(player1, player2, {card: item, visualEffectBox: undefined});
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(item.counters.value("normal")).toBe(1);
            game.entityHandler.kill(player1, game.monsters[0]!, {card: item, visualEffectBox: undefined});
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(item.counters.value("normal")).toBe(2);
            game.cardHandler.addToCounter(player1, item, "normal", 9);
            await game.endTurn();
            await game.actions.resolveStack();
            await game.resolveEntireStack();
            expect(player1.totalSouls).toBe(0);
            expect(game.stack.isEmpty()).toBe(true);
            game.cardHandler.addToCounter(player1, item, "normal", 1);
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(false);
            await game.actions.resolveStack();
            expect(player1.inPlay.length).toBe(1);
            expect(player1.totalSouls).toBe(1);
        });
    
        it("spelunker_hat", async () => {
            let item = game.obtainCard("r-spelunker_hat") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player2, item);
            const card = game.decks.room.cards[2] as LootCard;
            game.select = async (player: Player, min: number, max: number, Options: any[]) => {
                return {selected: Options.toReversed(), remaining: []};
            }
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(card.slug).toBe(game.decks.room.cards[0]!.slug);
        });
    
        it("sacrificial_dagger", async () => {
            let item = game.obtainCard("r-sacrificial_dagger") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 0.01;
            game.rollDice(player2, item);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(item.counters.value("normal")).toBe(1);
            game.cardHandler.addToCounter(player1, item, "normal", 2);
            await game.activateItem(player1, item, [player2], 0);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player2.currentHealthPoints).toBe(1);
        });
    
        it("punching_bag", async () => {
            let item = game.obtainCard("r-punching_bag") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            expect(player1.healthPoints).toBe(4);
            game.actions.declareAttack(player1);
            await game.actions.declareAttackOnEntity(player1, item.entity!);
            game.random = () => 0.99;
            game.actions.attackRoll(player1);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(item.entity!.currentHealthPoints).toBe(1);
            game.actions.attackRoll(player1);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.coins).toBe(5);
            expect(player1.inPlay.includes(item)).toBe(false);
            
        });
    
        it("playdough_cookie (select item)", async () => {
            let item = game.obtainCard("r-playdough_cookie") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player2, item);
            await game.endTurn();
            await game.actions.resolveStack();
            game.select = async (player: Player, min: number, max: number, Options: any[]) => {
                return {selected: [Options.includes(1) ? 1 :Options[0]], remaining: Options.slice(1)};
            };
            await game.actions.resolveStack();
            expect(player2.coins).toBe(0);
            expect(item.counters.value("normal")).toBe(1);
        });

        it("playdough_cookie (do not select item)", async () => {
            let item = game.obtainCard("r-playdough_cookie") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player2, item);
            await game.endTurn();
            await game.actions.resolveStack();
            game.select = async (player: Player, min: number, max: number, Options: any[]) => {
                return {selected: [], remaining: Options};
            };
            await game.actions.resolveStack();
            expect(player2.coins).toBe(1);
        });
    
        it("pageant_boy (eternal: does not work)", async () => {
            let item = game.obtainCard("r-pageant_boy") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 0.99;
            game.cardHandler.recharge(item);
            item.setEternal(true);
            expect(async () =>
            await game.activateItem(player1, item, [], 0)).toThrow();
        });

        it("pageant_boy (roll 6)", async () => {
            let item = game.obtainCard("r-pageant_boy") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 0.99;
            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [], 0);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.inPlay.length).toBe(1);
            expect(player1.coins).toBe(24);
        });
    
        it("pageant_boy (roll 1)", async () => {
            let item = game.obtainCard("r-pageant_boy") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 0.01;
            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [], 0);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(player1.inPlay.length).toBe(1);
            expect(player1.coins).toBe(4);
        });
    
        it("moms_bottle_of_pills", async () => {
            let item = game.obtainCard("r-moms_bottle_of_pills") as ItemCard;
            expect(item).toBeDefined();

            const pill = game.obtainCard("b2-pills") as LootCard;
            game.decks.loot.addTopPosition(pill);
            const nbPillsTopTen = game.decks.loot.cards.slice(0, 10).filter(c => c.name === "Pills!").length;
            await game.actions.resolveStack();
            game.cardHandler.addInPlay(player1, item);
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(player1.hand.length).toBe(nbPillsTopTen);
            const handSize = player1.hand.length;
            game.cardHandler.discardFromHandAtIndex(player1, 0, "other");
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack(); // resolve effect
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack(); // resolve effect
            await game.actions.resolveStack();
            expect(player1.hand.length).toBe(handSize);
        });

        it("marbles on gold counter", async () => {
            let item = game.obtainCard("r-marbles") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            const treas = game.obtainCard("r-golden_trinket") as LootCard;
            game.cardHandler.addCardToHand(player1, treas);
            game.actions.playCard(player1, 0, [item]);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(item.counters.value("golden")).toBe(1);
            expect(treas.tags.copiedCards[0]!.slug).toBe("r-marbles");
            game.cardHandler.recharge(treas);
            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [item], "tap");
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(item.counters.value("golden")).toBe(0);
            expect(treas.tags.copiedCards.length).toBe(0);
        });
    
        it("marbles", async () => {
            let item = game.obtainCard("r-marbles") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            const treas = game.obtainCard("b2-tech_x") as LootCard;
            game.cardHandler.addInPlay(player1, treas);
            game.cardHandler.recharge(treas);
            await game.activateItem(player1, treas, [], "tap");
            await game.actions.resolveStack();
            expect(treas.counters.value("normal")).toBe(1);
            game.cardHandler.recharge(item);
            game.select = async (player: Player, min: number, max: number, Options: any[]) => {
                return {selected: [Options[Options.length - 1]], remaining: Options};
            };
            await game.activateItem(player1, item, [treas], "tap");
            await game.actions.resolveStack();
            expect(treas.counters.value("normal")).toBe(2);
        });
    
        it("magic_skin", async () => {
            let item = game.obtainCard("r-magic_skin") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 3/6-0.01;
            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [], "tap");
            await game.actions.resolveStack();
            expect(player1.inPlay.includes(item)).toBe(false);
            expect(player2.inPlay.includes(item)).toBe(true);
            expect(player1.inPlay.length).toBe(2);
            expect(player2.inPlay.length).toBe(2);
            expect(item.counters.value("normal")).toBe(1);

            game.cardHandler.recharge(item);
            await game.activateItem(player2, item, [], "tap");
            await game.actions.resolveStack();
            expect(player1.inPlay.includes(item)).toBe(true);
            expect(player2.inPlay.includes(item)).toBe(false);
            expect(player1.inPlay.length).toBe(3);
            expect(player2.inPlay.length).toBe(2);
            expect(item.counters.value("normal")).toBe(2);

            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [], "tap");
            await game.actions.resolveStack();
            expect(player1.inPlay.includes(item)).toBe(false);
            expect(player2.inPlay.includes(item)).toBe(true);
            expect(player1.inPlay.length).toBe(3);
            expect(player2.inPlay.length).toBe(3);
            expect(item.counters.value("normal")).toBe(3);

            game.cardHandler.addToCounter(player1, item, "normal", 1);
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack(); // resolve effect
            expect(game.stack.isEmpty()).toBe(true);
            expect(player2.inPlay.length).toBe(1);
        });
    
        it("lodestone", async () => {
            let item = game.obtainCard("r-lodestone") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            game.entityHandler.addDC(game.monsters[0]!, 1, item);
            const initDC = game.entityHandler.getDC(game.monsters[0]!);
            game.random = () => 2/6 -0.01;
            game.rollDice(player1, item);
            await game.resolveEntireStack();
            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(3);
            game.random = () => 3/6 -0.01;
            game.rollDice(player1, item);
            await game.resolveEntireStack();
            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(2);
            game.random = () => 3/6 -0.01;
            game.rollDice(player2, item);
            await game.resolveEntireStack();
            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(1);
            game.random = () => 3/6 -0.01;
            game.rollDice(player2, item);
            await game.resolveEntireStack();
            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(1);
            await game.endTurn();
            await game.actions.resolveStack();
            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(initDC);
        });
    
        it("lil_chest 5-6", async () => {
            let item = game.obtainCard("r-lil_chest") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player2, item);
            game.gainTreasure(player2, 3);
            for(const card of player2.inPlay) {
                if(card.hasTapEffect())
                    card.charged = false;
            }
            const loot = player2.hand.cards[0] as LootCard;
            game.entityHandler.kill(player2, game.monsters[0]!, {card: item, visualEffectBox: undefined});
            game.random = () => 0.9;
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(player2.inPlay.every((c) => !c.hasTapEffect() || c.charged )).toBe(true);
        });
    
        it("lil_chest 3-4", async () => {
            let item = game.obtainCard("r-lil_chest") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player2, item);
            game.loot(player2, 1);
            const loot = player2.hand.cards[0] as LootCard;
            game.entityHandler.kill(player2, game.monsters[0]!, {card: item, visualEffectBox: undefined});
            game.random = () => 0.4;
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(player2.hand.length).toBe(2);
            expect(game.decks.loot.cards[0]?.slug).toBe(loot.slug);
        });
    
        it("lil_chest 1-2", async () => {
            let item = game.obtainCard("r-lil_chest") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player2, item);

            game.entityHandler.kill(player2, game.monsters[0]!, {card: item, visualEffectBox: undefined});
            game.random = () => 0.01;
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(player2.coins).toBe(2);
        });
    
        it("keepers_sack", async () => {
            let item = game.obtainCard("r-keepers_sack") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            game.entityHandler.addHealth(player1, 5, item);
            await game.actions.resolveStack();

            expect(player1.coins).toBe(14);
            await game.endTurn();
            await game.actions.resolveStack();
            expect(game.stack.peek()! instanceof DamageOnStack).toBe(true);
            expect((game.stack.peek()! as DamageOnStack).receiver).toBe(player1);
            await game.actions.resolveStack();
            await game.activateItem(player1, item, [player2], 0);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack(); // resolve effect
            expect(player1.inPlay.includes(item)).toBe(false);
            expect(player2.inPlay.includes(item)).toBe(true);
            expect(player1.coins).toBe(10);
            expect(player2.coins).toBe(14);
            game.loot(player2, 1);
            await game.actions.resolveStack();
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player2.hand.length).toBe(1); // drew at the begining of their turn.
        });
    
        it("keepers_box", async () => {
            let item = game.obtainCard("r-keepers_box") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player2, item);
            await game.actions.resolveStack(); // resolve the event addition
            expect(game.shop.itemsInShop.length).toBe(4);
            game.actions.declarePurchase(player1);
            game.gainCoins(player1, 10, ("debug"));
            game.obtainCard(game.shop.itemsInShop[0]!.slug)
            game.actions.purchase(player1, 0);
            await game.actions.resolveStack();
            if(!game.stack.isEmpty())
                console.log("fdfas");
            expect(game.stack.isEmpty()).toBe(true);
            expect(player2.coins).toBe(2);
            expect(player2.hand.length).toBe(1);
        });
    
        it("keepers_penny", async () => {
            let item = game.obtainCard("r-keepers_penny") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            await game.actions.resolveStack();
            expect(player1.coins).toBe(9);
            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [], "tap");
            await game.actions.resolveStack();
            expect(player1.coins).toBe(10);
            expect(player1.inPlay.includes(item)).toBe(false);
            expect(player2.inPlay.includes(item)).toBe(true);
            await game.actions.resolveStack();
            expect(player2.coins).toBe(9);
            game.cardHandler.recharge(item);
            await game.activateItem(player2, item, [], "tap");
            await game.actions.resolveStack();
            expect(player2.coins).toBe(11);
        });
    
        it("judas_shadow", async () => {
            let item = game.obtainCard("r-judas_shadow") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.entityHandler.kill(player1, player1, {card: item, visualEffectBox: undefined});
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.inPlay.includes(item)).toBe(false);
            expect(player1.hand.length).toBe(2);
            expect(player1.coins).toBe(2);
        });
    
        it("jar_of_flies", async () => {
            let item = game.obtainCard("r-jar_of_flies") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.entityHandler.kill(player1, game.monsters[0]!, {card: item, visualEffectBox: undefined});
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(item.counters.value("normal")).toBe(1);
            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [], "tap");
            await game.actions.resolveStack();
            expect(player1.hand.length).toBe(1);
            expect(game.stack.isEmpty()).toBe(true);
            game.cardHandler.addToCounter(player1, item, "normal", 3);
            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [], "tap");
            game.select = async (player: Player, min: number, max: number, Options: any[]) => {
                return {selected: [Options[Options.length-1]], remaining: Options};
            };
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.monsters[1]!.currentHealthPoints).toBe(game.monsters[1]!.healthPoints - 1);
        });
    
        it("handicapped_placard", async () => {
            game.gameParameters.nbSoulsToWin.value = 10;
            const gurdy = game.obtainCard("b2-gurdy") as MonsterCard;
            game.encounters.forceSetMonsterAtSlot(0, gurdy);
            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(4);
            const soul1 = game.decks.treasure.draw();
            soul1.soul = 1;
            game.cardHandler.addSoul(player2, soul1);
            let item = game.obtainCard("r-handicapped_placard") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(3);
            const soul2 = game.decks.treasure.draw();
            soul2.soul = 1;
            game.cardHandler.addSoul(player2, soul2);
            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(2);
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack(); // resolve effect
            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(4);
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack(); // resolve effect

            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(2);
            const soul3 = game.decks.treasure.draw();
            soul3.soul = 4;
            game.cardHandler.addSoul(player1, soul3);
            expect(game.entityHandler.getDC(game.monsters[0]!)).toBe(4);
        });
    
        it("gnawed_leaf", async () => {
            let item = game.obtainCard("r-gnawed_leaf") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player2, item);

            game.entityHandler.dealDamage(player1, player2, {card: item, visualEffectBox: undefined}, 2);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(player2.currentHealthPoints).toBe(player2.healthPoints);

            const card = game.obtainCard("b2-xiii_death") as LootCard;
            game.cardHandler.addCardToHand(player1, card);
            game.actions.playCard(player1, 0, [player2]);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(player2.isDead).toBe(false);
        });
    
            it("friendly_ball", async () => {
                let item = game.obtainCard("r-friendly_ball") as ItemCard;
                expect(item).toBeDefined();
                game.cardHandler.addInPlay(player1, item);

                const mobCard = game.monsters[0]!.card;
                game.cardHandler.recharge(item);
                await game.activateItem(player1, item, ["Put a monster not being attacked under this if there are no cards under this.", game.monsters[0]], "tap");
                await game.actions.resolveStack();
                expect(item.tags.underThis.includes(mobCard)).toBe(true);
                expect(game.monsters[0]!.card.slug).not.toBe(mobCard.slug);

                game.cardHandler.recharge(item);
                await game.activateItem(player1, item, ["Put a monster from under this in a monster slot not being attacked. The active player must make an additional attack on it this turn."], "tap");
                await game.actions.resolveStack();
                expect(item.tags.underThis.includes(mobCard)).toBe(false);
                expect(item.tags.underThis.length).toBe(0);
                expect(game.monsters[0]!.card.slug).toBe(mobCard.slug);
                expect(player1.mustAttackEntity.length).toBe(1);
            });
        
        it("member_card", async () => {
            let item = game.obtainCard("r-member_card") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            game.actions.declarePurchase(player1);
            game.gainCoins(player1, 5, ("debug"));
            expect(game.actions.canPurchase(player1, 0, false)).not.toBe(true);
            game.gainCoins(player1, 1, ("debug"));
            expect(game.actions.canPurchase(player1, 0, false)).toBe(true);

            const buy = game.shop.itemsInShop[0]!;
            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [buy], "tap");
            await game.actions.resolveStack();
            expect(buy.slug).not.toBe(game.shop.itemsInShop[0]!.slug);
        });
    
        it("friendly_sack", async () => {
            let item = game.obtainCard("r-friendly_sack") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.cardHandler.recharge(item);
            await game.activateItem(player1, item, [], "tap");
            await game.actions.resolveStack();
            expect(player1.hand.length).toBe(1);
            expect(player2.hand.length).toBe(2);
        });
    
        it("hallowed_ground", async () => {
            let item = game.obtainCard("r-hallowed_ground") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 2/6-0.01;
            game.rollDice(player1, item);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(item.counters.value("normal")).toBe(1);

            game.rollDice(player2, item);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(item.counters.value("normal")).toBe(2);
            game.cardHandler.addToCounter(player1, item, "normal", 3);

            const loot = game.decks.loot.draw();
            game.cardHandler.discard(loot);
            await game.activateItem(player1, item, [], 0);
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(player1.hand.cards.map((c) => c.slug)).toContain(loot.slug);
            expect(game.decks.loot.discard.map((c) => c.slug)).not.toContain(loot.slug);
        });
    
        it("fire_mind", async () => {
            let item = game.obtainCard("r-fire_mind") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.actions.declareAttack(player1);
            const mob = game.monsters[0]!;
            await game.actions.declareAttackOnEntity(player1, mob);
            game.entityHandler.addHealth(player1, 10, item);
            game.entityHandler.addHealth(mob, 10, item);
            game.entityHandler.addAttack(player1, 2, item);
            game.entityHandler.addAttack(mob, 2, item);

            game.random = () => 0.01;
            game.actions.attackRoll(player1);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(player1.currentHealthPoints).toBe(player1.healthPoints - 2 * mob.attackPoints);

            game.random = () => 0.99;
            game.actions.attackRoll(player1);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(mob.currentHealthPoints).toBe(mob.healthPoints - 2 * player1.attackPoints);
        });
    
        it("fetal_haunt", async () => {
            let item = game.obtainCard("r-fetal_haunt") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);
            game.loot(player1, 1);
            await game.endTurn();
            await game.actions.resolveStack();

            await game.actions.resolveStack(); // resolve effect
            await game.actions.resolveStack();
            expect(player1.hand.length).toBe(0);
            expect(player2.hand.length).toBe(2);
            game.entityHandler.kill(player1, player1, {card: item, visualEffectBox: undefined});
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player2.inPlay.includes(item)).toBe(true);
        });
    
        it("experimental_treatment 6", async () => {
            let item = game.obtainCard("r-experimental_treatment") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 0.99;
            await game.activateItem(player1, item, [], 0);
            expect(player1.inPlay.includes(item)).toBe(false);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.totalSouls).toBe(1);
        });

        it("experimental_treatment 5", async () => {
            let item = game.obtainCard("r-experimental_treatment") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 5/6-0.01;
            await game.activateItem(player1, item, [], 0);
            expect(player1.inPlay.includes(item)).toBe(false);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.inPlay.length).toBe(3);

        });

        it("experimental_treatment 4", async () => {
            let item = game.obtainCard("r-experimental_treatment") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 4/6-0.01;
            await game.activateItem(player1, item, [], 0);
            expect(player1.inPlay.includes(item)).toBe(false);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.inPlay.length).toBe(2);
        });

        it("experimental_treatment 3", async () => {
            let item = game.obtainCard("r-experimental_treatment") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 3/6-0.01;
            await game.activateItem(player1, item, [], 0);
            expect(player1.inPlay.includes(item)).toBe(false);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.coins).toBe(9);
        });

        it("experimental_treatment 2", async () => {
            let item = game.obtainCard("r-experimental_treatment") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 2/6-0.01;
            await game.activateItem(player1, item, [], 0);
            expect(player1.inPlay.includes(item)).toBe(false);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.hand.length).toBe(3);
        });
        it("experimental_treatment 1", async () => {
            let item = game.obtainCard("r-experimental_treatment") as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player1, item);

            game.random = () => 0.1;
            await game.activateItem(player1, item, [], 0);
            expect(player1.inPlay.includes(item)).toBe(false);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(player1.isDead).toBe(true);
        });

    
    it("eternal_d6", async () => {
        let item = game.obtainCard("r-eternal_d6") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);

        game.cardHandler.addToCounter(player1, item, "normal", 2);
        await game.activateItem(player1, item, [], 0);
        await game.actions.resolveStack();
        
        const effect = new DiceRoll(() => 0.4, player1, item);
        game.addToStack(effect);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(effect.value).toBe(1);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);

         await game.endTurn();
         await game.actions.resolveStack();
         const effect2 = new DiceRoll(() => 0.4, player1, item);
        game.addToStack(effect2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(effect2.value).toBe(3);
        expect(game.stack.isEmpty()).toBe(true);
    });

    it("damocles", async () => {
        let item = game.obtainCard("r-damocles") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.gainTreasure(player1, 1);
        await game.actions.resolveStack();
        expect(player1.inPlay.length).toBe(4);
        game.gainTreasure(player1, 2);
        await game.actions.resolveStack();
        expect(player1.inPlay.length).toBe(7);
        game.gainTreasure(player2, 1);
        expect(player1.inPlay.length).toBe(7);
        expect(player2.inPlay.length).toBe(2);
        game.entityHandler.kill(player1, player1, {card: item, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.inPlay.length).toBe(5);
    });

    it("cursed_soul", async () => {
        let item = game.obtainCard("r-cursed_soul") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.cardHandler.addToCounter(player1, item, "normal", 5);
        expect(player1.inPlay.includes(item)).toBe(true);        
        expect(player2.inPlay.includes(item)).toBe(false);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.inPlay.includes(item)).toBe(false);
        expect(player2.inPlay.includes(item)).toBe(true);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player2.totalSouls).toBe(1);
        expect(player2.inPlay.includes(item)).toBe(false);
        expect(player1.inPlay.includes(item)).toBe(false);

    });

    it("chocolate_milk", async () => {
        let item = game.obtainCard("r-chocolate_milk") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.cardHandler.addToCounter(player1, item, "normal", 2);
        expect(player1.attackPoints).toBe(2);
        game.cardHandler.addToCounter(player1, item, "normal", 2);
        expect(game.stack.isEmpty()).toBe(true);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.endTurn();
        await game.actions.resolveStack();
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            return {selected: [Options.includes(player2) ? player2 : Options[0]], remaining: Options};
        }
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.attackPoints).toBe(1);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints - 1);
        expect(item.counters.value("normal")).toBe(0);
    });

    it("car_battery recharge other items.", async () => {
        let item = game.obtainCard("r-car_battery") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        for (const cardSlug of ["b2-blank_card", "b2-tech_x", "b2-boomerang"]) {
            const item = game.obtainCard(cardSlug) as ItemCard;
            game.cardHandler.addInPlay(player1, item);
            item.charged = false;
        }
        expect(player1.inPlay.slice(2).every(card => card.charged)).toBe(false);
        await game.activateItem(player1, item, player1.inPlay.slice(3), "tap");
        await game.actions.resolveStack();
        expect(item.charged).toBe(false);
        expect(player1.inPlay.slice(2).length).toBe(3);
        expect(player1.inPlay.slice(3).every(card => card.charged)).toBe(true);
        game.gainCoins(player1, 10, ("debug"));
        await game.activateItem(player1, item, [], 0);
        await game.actions.resolveStack();
        expect(item.charged).toBe(true);
    });

    it("car_battery only recharge by own effect.", async () => {
        let item = game.obtainCard("r-car_battery") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        item.charged = false;
        game.cardHandler.recharge(item, "other");
        expect(item.charged).toBe(false);
        game.cardHandler.recharge(item, "rechargeStep");
        expect(item.charged).toBe(false);
        game.cardHandler.recharge(item, player1.character);
        expect(item.charged).toBe(false);
        game.cardHandler.recharge(item, item);
        expect(item.charged).toBe(true);
    });

    it("book_of_the_dead", async () => {
        let item = game.obtainCard("r-book_of_the_dead") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.cardHandler.recharge(item);
        const mob = game.monsters[0]!;
        game.encounters.flushMonster(mob, "discard");
        await game.activateItem(player1, item, [mob.card], "tap");
        await game.actions.resolveStack();
        expect(game.encounters.monsterIn(0)?.card).toBe(mob.card);
        
    });

    it("bobby_bomb", async () => {
        let item = game.obtainCard("r-bobby_bomb") as ItemCard;
        expect(item).toBeDefined();
        const bomb = game.obtainCard("b2-bomb") as LootCard;
        game.decks.loot.addTopPosition(bomb);
        const nbBombTopTen = game.decks.loot.cards.slice(0, 10).filter(c => c.name.toLowerCase().includes("bomb")).length;
        game.cardHandler.addInPlay(player1, item);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(nbBombTopTen);
        const handSize = player1.hand.length;
        game.cardHandler.discardFromHandAtIndex(player1, 0, "other");
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(handSize + 1);
    });

    it("blood_puppy deal damage", async () => {
        let item = game.obtainCard("r-blood_puppy") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.random = () => 0.9;
        game.cardHandler.addToCounter(player1, item, "normal", 8);
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack(); // resolve effect
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            return {selected: [Options.includes(player2) ? player2 : Options[0]], remaining: Options};
        }
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // dice
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // damage
        expect(player2.currentHealthPoints).toBe(player2.healthPoints - 1);
    });

    it("blood_puppy die", async () => {
        let item = game.obtainCard("r-blood_puppy") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.gainCoins(player1, 1, ("debug"));
        game.cardHandler.addToCounter(player1, item, "normal", 10);
        game.random = () => 0.9;
        await game.actions.resolveStack(); // Resolve any stack effects
        await game.actions.resolveStack(); // Resolve any stack effects
        await game.actions.resolveStack(); // Resolve any stack effects
        expect(game.currentPlayer.id).toBe(player1.id);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.currentPlayer.id).toBe(player2.id);
        await game.endTurn();
        await game.actions.resolveStack();
        game.cancelStack();
        game.random = () => 0.01;
        await game.actions.resolveStack();
        expect(game.currentPlayer.id).toBe(player1.id);
        expect(game.stack.isEmpty()).toBe(false);
        expect(game.stack.peek()!).toBeInstanceOf(DiceRoll);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.coins).toBe(0);
        expect(player1.isDead).toBe(true);
    });
    
    it("blood_puppy", async () => {
        let item = game.obtainCard("r-blood_puppy") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.entityHandler.kill(player1, player2, {card: item, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(item.counters.value("normal")).toBe(1);
        game.cardHandler.addToCounter(player1, item, "normal", 2);
        expect(item.counters.value("normal")).toBe(3);
        expect(player1.attackPoints).toBe(1);
        game.cardHandler.addToCounter(player1, item, "normal", 2);
        await game.actions.resolveStack(); // Resolve any stack effects
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.attackPoints).toBe(2);
    });

    it("x_ray_vision", async () => {
        let item = game.obtainCard("r-x_ray_vision") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.cardHandler.recharge(item);
        const all:ItemCard[] = [];
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            all.push(...Options);
            return {selected: [Options[Options.length - 1]], remaining: Options};
        }
        await game.activateItem(player1, item, [player2, game.decks.treasure], "tap");
        await game.actions.resolveStack();
        expect(all.map(c => c.name)).toEqual([...player2.hand.cards.map(c => c.name), game.decks.treasure.cards[0]!.name]);
        expect(game.decks.room.discard.length).toBe(1);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(item.charged).toBe(true);
    });

    it("auction_gavel", async () => {
        let item = game.obtainCard("r-auction_gavel") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
    });

    it("hand_me_downs false", async () => {
        let item = game.obtainCard("r-hand_me_downs") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.cardHandler.recharge(item);
        await game.activateItem(player1, item, [], "tap");
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            return {selected: [Options[1]], remaining: Options};
        }
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(0);
        expect(player2.hand.length).toBe(0);
    });

    it("hand_me_downs", async () => {
        let item = game.obtainCard("r-hand_me_downs") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.cardHandler.recharge(item);
        await game.activateItem(player1, item, [], "tap");
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(1);
        expect(player2.hand.length).toBe(0);
    });

    it("r_key", async () => {
        let item = game.obtainCard("r-r_key") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);

        // "This enters play deactivated."
        expect(item.charged).toBe(false);

        // Give each player some cards in hand (so we can assert the discard actually happened)
        game.loot(player1, 2);
        game.loot(player2, 4);
        const p1HandBefore = [...player1.hand.cards];
        const p2HandBefore = [...player2.hand.cards];
        expect(p1HandBefore.length).toBe(2);
        expect(p2HandBefore.length).toBe(4);

        // Give both players souls (R Key destroys all souls)
        const soul1 = game.decks.treasure.draw();
        soul1.soul = 1;
        game.cardHandler.addSoul(player1, soul1);
        const soul2 = game.decks.treasure.draw();
        soul2.soul = 1;
        game.cardHandler.addSoul(player2, soul2);
        expect(game.cardHandler.targetableSoulsOwned.length).toBe(2);

        const initialLootDiscard = game.decks.loot.discard.length;

        // Activate (tap) effect: "Destroy this. If you do, destroy all souls. Each player discards their hand and loots 3."
        game.cardHandler.recharge(item);
        await game.activateItem(player1, item, [], "tap");
        await game.resolveEntireStack();

        // Item destroyed
        expect(game.decks.treasure.discard).toContain(item);
        expect(player1.inPlay).not.toContain(item);

        // All souls destroyed
        expect(game.cardHandler.targetableSoulsOwned.length).toBe(0);
        expect(player1.totalSouls).toBe(0);
        expect(player2.totalSouls).toBe(0);

        // Everyone discarded their hand and looted 3
        expect(player1.hand.length).toBe(3);
        expect(player2.hand.length).toBe(3);

        // The original hand cards should have been discarded to the loot discard pile
        expect(game.decks.loot.discard.length).toBe(initialLootDiscard + p1HandBefore.length + p2HandBefore.length);
        for (const c of p1HandBefore) expect(game.decks.loot.discard).toContain(c);
        for (const c of p2HandBefore) expect(game.decks.loot.discard).toContain(c);
    });

    it("halo_of_flies attack roll of 6", async () => {
        let item = game.obtainCard("r-halo_of_flies") as ItemCard;
        let room = game.obtainCard("r-battle_royale_2") as RoomCard;
        game.rooms?.forceRoomAtSlot(0, room);
        game.cardHandler.addInPlay(player1, item);
        
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        game.actions.declareAttack(player2);
        game.actions.declareAttackOnEntity(player2, player1);
        game.random = () => 0.99;
        await game.actions.attackRoll(player2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints);

        game.random = () => 0.8;
        await game.actions.attackRoll(player2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints - 1);
    });

    it("halo_of_flies attack roll of 1", async () => {
        let item = game.obtainCard("r-halo_of_flies") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);

        game.entityHandler.addHealth(player1, 10, item);
        game.entityHandler.addHealth(game.monsters[0]!, 10, item);
        let curr = player1.currentHealthPoints;
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[0]!);
        game.random = () => 0.01;
        await game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(curr);


         game.random = () => 0.3;
        await game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(curr);
    });

    it("consolation_prize", async () => {
        let item = game.obtainCard("r-consolation_prize") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        const s1 = game.decks.treasure.draw();
        s1.soul = 1;
        game.cardHandler.addSoul(player1, s1);
        const s2 = game.decks.treasure.draw();
        s2.soul = 3;
        game.cardHandler.addSoul(player2, s2);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(3);

        game.cardHandler.stealItemAnywhere(player2, item);
        game.cardHandler.recharge(item);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(3);
        expect(player2.hand.length).toBe(2);
    });

    it("birthright", async () => {
        let item = game.obtainCard("r-birthright") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.cardHandler.recharge(item);
        await game.activateItem(player1, item, [player1.inPlay[0]], "tap");
        await game.actions.resolveStack();
        expect(player1.inPlay[1]!.name).toBe(player1.inPlay[0]!.name);
    });
    
    it("mama_mega", async () => {
        let item = game.obtainCard("r-mama_mega") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        for(const entity of [...game.players, ...game.monsters])
            game.entityHandler.addHealth(entity, 3, item);
        await game.activateItem(player1, item, [], "tap");
        await game.actions.resolveStack();
        await game.resolveEntireStack();
        for(const entity of [...game.players, ...game.monsters])
            expect(entity.currentHealthPoints + 3).toBe(entity.healthPoints);
        expect(player1.inPlay.length).toBe(1);
    });

    it("the_jar", async () => {
        let item = game.obtainCard("r-the_jar") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);

        game.gainCoins(player1, 5, ("debug"));
        await game.activateItem(player1, item, [player1], 0);
        await game.actions.resolveStack();
        expect(player1.coins).toBe(1);
        
        game.entityHandler.dealDamage(player1, player1, {card: item, visualEffectBox: undefined}, 2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(1);

        game.gainCoins(player1, 5, ("debug"));
        const mob = game.monsters[0]!;
        await game.activateItem(player1, item, [mob], 0);
        await game.actions.resolveStack();
        expect(player1.coins).toBe(2);
        
        game.entityHandler.dealDamage(player1, mob, {card: item, visualEffectBox: undefined}, 2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve on damage taken
        expect(game.stack.isEmpty()).toBe(true);
        expect(mob.currentHealthPoints).toBe(mob.healthPoints - 1);

    });

    it("battery_pack", async () => {
        let item = game.obtainCard("r-battery_pack") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);

        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack();
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect

        expect(item.counters.value("normal")).toBe(1);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        await game.actions.resolveStack();
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        expect(item.counters.value("normal")).toBe(2);

        for (const cardSlug of ["b2-blank_card", "b2-tech_x", "b2-boomerang"]) {
            const item = game.obtainCard(cardSlug) as ItemCard;
            expect(item).toBeDefined();
            game.cardHandler.addInPlay(player2, item);
            item.deactivate();
        }
        expect(player2.inPlay.splice(2).every(card => !card.charged)).toBe(true);

        await game.activateItem(player1, item, [player2], 0);
        await game.actions.resolveStack();
        expect(player2.inPlay.splice(2).every(card => card.charged)).toBe(true);
    });

    it("alabaster_box", async () => {
        let item = game.obtainCard("r-alabaster_box") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        for(let i = 1; i < 7; i++) {
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack(); // resolve effect
            await game.endTurn();
            await game.actions.resolveStack();
            await game.actions.resolveStack(); // resolve effect
            await game.actions.resolveStack();
            if(i === 2)
            {
                await game.actions.resolveStack();
                expect(player1.coins).toBe(10);
                expect(player1.inPlay.length).toBe(2);
                expect(player1.hand.length).toBe(2);
            }
            if(i === 4)
            {
                await game.actions.resolveStack();
                expect(player1.inPlay.length).toBe(2);
                expect(player1.hand.length).toBe(8);
            }
            if(i === 6)
            {
                await game.actions.resolveStack();
                expect(player1.hand.length).toBe(10);
                expect(player1.inPlay.length).toBe(4);
            }
        }
    });

    it("abel", async () => {
        let item = game.obtainCard("r-abel") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, game.monsters[1]!);
        game.random = () => 0.9;
        game.actions.attackRoll(player1);
        game.select = async (player: Player, min: number, max: number, Options: any[]) => { //monster 0
            if(Options.includes(game.monsters[0]))
                return {selected: [game.monsters[0]], remaining: []};
            return {selected: Options.toReversed().slice(0, max), remaining: []};
        }
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.monsters[0]?.card.slug).not.toBe("b2-fly");
        game.actions.attackRoll(player1);
        game.random = () => 0.1;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
    });
});

describe("Requiem Loots 3 layers ", () => {
    let game: Game;
    let player1: Player;
    let player2: Player;
    let player3: Player;
    
    beforeEach(async () => {
        const setup = await setupTestGame({
                        characters: ["fsp2-guppy", "b2-lilith", "b2-the_forgotten"],
                        monsters: ["b2-fly", "b2-fatty"],
                        monsterDeck: ["b2-red_host", "b2-pooter","b2-cod_worm","b2-spider","b2-conjoined_fatty", "b2-dip","b2-leech","b2-gurdy"],
                        treasureDeck: ["b2-boomerang", "b2-guppys_head", "b2-blank_card", "b2-tech_x", "b2-the_battery", "b2-lucky_foot", "b2-mini_mush", "b2-spoon_bender"],
                        bonusSouls: [],
                        playerCount: 3,
                        rooms: true,
                    });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        player3 = setup.player3!;
        game.resetStack();
        game.resetCallbacks();
    });

    // it("abel", async () => {
    //     let item = game.obtainCard("r-abel") as ItemCard;
    //     expect(item).toBeDefined();
    //     game.cardHandler.addInPlay(player1, item);
    // });

    it("backstabber", async () => {
        let item = game.obtainCard("r-backstabber") as ItemCard;
        expect(item).toBeDefined();
        const soul2 = game.decks.treasure.draw();
        soul2.soul = 1;
        game.cardHandler.addSoul(player3, soul2);
        game.cardHandler.addInPlay(player1, item);
        game.actions.declareAttack(player1);
        expect(game.actions.canDeclareAttackOnEntity(player1, player2, false)).not.toBe(true);
        await game.actions.declareAttackOnEntity(player1, player3);
        game.random = () => 0.9;
        await game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // loot on death
        expect(game.stack.isEmpty()).toBe(true);
        expect(player3.isDead).toBe(true);
        expect(player1.hand.length).toBe(1);

        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve effect
        game.actions.declareAttack(player2);
        expect(game.actions.canDeclareAttackOnEntity(player2, player1, false)).not.toBe(true);
        expect(game.actions.canDeclareAttackOnEntity(player2, player3, false)).not.toBe(true);
        
    });

    it("auction_gavel", async () => {
        let item = game.obtainCard("r-auction_gavel") as ItemCard;
        expect(item).toBeDefined();
        game.cardHandler.addInPlay(player1, item);
        const treas = game.shop.cardsOnTop[0]!;
        expect(treas).toBeDefined();
        game.gainCoins(player3, 9, ("debug"));
        game.gainCoins(player2, 9, ("debug"));
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            return {selected: [Options[Options.length - 1]], remaining: Options};
        }
        await game.activateItem(player1, item, [treas], "tap");
        await game.actions.resolveStack();
        expect(player2.coins).toBe(9);
        expect(player3.coins).toBe(0);
        expect(player1.coins).toBe(9);
        expect(player3.inPlay).toContain(treas);
        expect(player2.inPlay).not.toContain(treas);
        expect(player1.inPlay).not.toContain(treas);
    });

});