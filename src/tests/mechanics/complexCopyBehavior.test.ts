import { beforeEach, describe, expect, it } from "bun:test";
import { Game } from "../../models/game";
import { Player } from "../../models/entities/player";
import { setupTestGame } from "../testHelpers";
import type { ItemCard, LootCard, TreasureCard } from "@/models/cards";

describe("Four Souls+2 Attack Requirements", () => {
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
        it("modelling clay copy punching bag, magic marker modify numbers.", async () => {
        const mc = game.obtainCard("b2-modeling_clay") as ItemCard;
        const pb = game.obtainCard("r-punching_bag") as ItemCard;
        const mm = game.obtainCard("r-magic_marker") as LootCard;
        game.cardHandler.addInPlay(player1, mc);
        game.cardHandler.addInPlay(player2, pb);
        game.cardHandler.addCardToHand(player1, mm);

        game.cardHandler.recharge(pb);
        await game.activateItem(player1, mc, [pb], "tap");
        await game.actions.resolveStack();
        expect(player1.healthPoints).toBe(4);
        await game.actions.playCard(player1, player1.hand.cards.findIndex(c => c.slug === "r-magic_marker")!, [mc]);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.inPlay.map(c => c.slug)).toContain("r-punching_bag");
        expect(player1.healthPoints).toBe(3);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.healthPoints).toBe(4);
    });
    
    it("magic_marker (loot card)", async () => {
        const bs = game.obtainCard("b2-two_cents") as LootCard;
        game.cardHandler.addCardToHand(player1, bs);
        let loot = game.obtainCard("r-magic_marker") as LootCard;
        game.cardHandler.addCardToHand(player1, loot);
        game.actions.playCard(player1, 0, []);
        game.actions.playCard(player1, 0, [game.stack.peek()!]);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.coins).toBe(1);
        await game.endTurn();
        await game.actions.resolveStack();
        game.obtainCard(bs.slug, bs.globalId);
        game.entityHandler.addLootPlay(player1, 1, loot);
        game.cardHandler.addCardToHand(player1, bs);
        game.actions.playCard(player1, 0, []);
        await game.actions.resolveStack();
        expect(player1.coins).toBe(3);
    });

    it("magic_marker (item card)", async () => {
        let loot = game.obtainCard("r-magic_marker") as LootCard;
        game.cardHandler.addCardToHand(player1, loot);
        const bs = game.obtainCard("b2-brimstone") as ItemCard;
        game.cardHandler.addInPlay(player1, bs);
        game.actions.playCard(player1, 0, [bs]);
        await game.actions.resolveStack();
        expect(game.entityHandler.getAttack(player1)).toBe(3);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.entityHandler.getAttack(player1)).toBe(2);
    });

    it("Diplopia copies, recharge, copies. Should end up only with copy 2 active.", async () => {
        const diplo = game.obtainCard("b2-diplopia") as ItemCard;
        const a = game.obtainCard("b2-dinner") as ItemCard;
        const b = game.obtainCard("b2-brimstone") as ItemCard;
        game.cardHandler.addInPlay(player1, diplo);
        game.cardHandler.addInPlay(player2, a);
        game.cardHandler.addInPlay(player2, b);

        game.cardHandler.recharge(diplo);
        await game.activateItem(player1, diplo, [a], "tap");
        game.cardHandler.recharge(diplo);
        await game.activateItem(player1, diplo, [b], "tap");
        await game.actions.resolveStack();
        expect(player1.attackPoints).toBe(2);
        await game.actions.resolveStack();
        expect(player1.healthPoints).toBe(3);
        expect(player1.attackPoints).toBe(1);
    });


    it("Does not preserve flip data when a card becomes a copy", () => {
        const source = game.decks["eternal"]!.getCardFromSlug("r-anima_sola")!;
        const target = game.shop.obtainCard("b2-battery_bum")!;

        expect(source.flipData).toBeTruthy();
        expect(target.flipData).toBeUndefined();

        target.becomesCopyOf(source);

        expect(target.name).toBe("Anima Sola");
        expect(target.flipData).toBeUndefined();
    });
    
    it("modelling clay copying diplopia, should reverse to diplopia by the end of the turn.", async () => {
        const diplo = game.obtainCard("b2-diplopia") as ItemCard;
        const a = game.obtainCard("b2-modeling_clay") as ItemCard;
        const b = game.obtainCard("b2-brimstone") as ItemCard;
        game.cardHandler.addInPlay(player1, a);
        game.cardHandler.addInPlay(player2, diplo);
        game.cardHandler.addInPlay(player2, b);

        game.cardHandler.recharge(diplo);
        await game.activateItem(player1, a, [diplo], "tap");
        await game.actions.resolveStack();
        game.cardHandler.recharge(a);
        await game.activateItem(player1, a, [b], "tap");
        await game.actions.resolveStack();
        expect(a.slug).toBe("b2-brimstone");
        expect(player1.attackPoints).toBe(2);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(a.slug).toBe("b2-diplopia");
    });
    
    it("undefined listeners do not stack.", async () => {
        const diplo = game.obtainCard("r-undefined") as ItemCard;
        game.cardHandler.addInPlay(player2, diplo);
        game.shop.discardTop(1);
        const item = game.shop.itemsInShop[1]!;
        
        game.cardHandler.recharge(diplo);
        await game.activateItem(player2, diplo, [item], "tap");
        await game.actions.resolveStack();
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();

        game.cardHandler.recharge(diplo);
        await game.actions.resolveStack();
        await game.activateItem(player2, diplo, [item], "tap");
        await game.actions.resolveStack();
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        
        await game.actions.resolveStack();
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(1);
    });

    it("copying an attackable card.", async () => {
        const a = game.obtainCard("b2-modeling_clay") as ItemCard;
        const b = game.obtainCard("r-punching_bag") as ItemCard;
        game.cardHandler.addInPlay(player1, a);
        game.cardHandler.addInPlay(player2, b);

        game.cardHandler.recharge(a);
        await game.activateItem(player1, a, [b], "tap");
        await game.actions.resolveStack();
        expect(a.entity).toBeDefined();
    });

    async function setupGlitchWithShopItem(slug: string) {
        const setup = await setupTestGame({
            characters: ["r-the_capricious", "b2-isaac"],
            monsters: ["b2-fly", "b2-fatty"],
            randomSeed: "glitch-destruction",
        });
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
        const item = game.obtainCard(slug) as TreasureCard;
        game.shop._slots = [[item]];
        await game.resolveEntireStack();
        const glitch = player1.inPlay[0]!;
        game.cardHandler.recharge(glitch);
        return { glitch, item };
    }

    it("glitch can not use chaos card without destroying itself", async () => {
        const { glitch, item } = await setupGlitchWithShopItem("b2-chaos_card");
        game.select = async (_issuer, _min, max, opts) => {
            const target = opts.find(opt => opt instanceof Player && opt === player2);
            return { selected: target === undefined ? opts.slice(0, max) : [target], remaining: [] };
        };
        await game.activateItem(player1, glitch, [glitch.tags.copiedCards[0]!], "tap");
        await game.resolveEntireStack();
        expect(player2.isDead).toBe(false);
        expect(player1.inPlay).toContain(glitch);
        expect(game.shop.itemsInShop).toContain(item);
    });

    it("glitch can not use plan c without destroying itself", async () => {
        const { glitch, item } = await setupGlitchWithShopItem("g2-plan_c");
        const monster = game.monsters[0]!;
        await game.activateItem(player1, glitch, [glitch.tags.copiedCards[0]!], "tap");
        await game.resolveEntireStack();
        expect(game.monsters).toContain(monster);
        expect(player1.inPlay).toContain(glitch);
        expect(game.shop.itemsInShop).toContain(item);
    });

    it("glitch can not use pandoras box without destroying itself", async () => {
        const { glitch, item } = await setupGlitchWithShopItem("b2-pandoras_box");
        game.random = () => 2/6 - 0.0001; // roll a 2
        await game.activateItem(player1, glitch, [glitch.tags.copiedCards[0]!], "tap");
        await game.resolveEntireStack();
        expect(player1.coins).toBe(0);
        expect(player1.inPlay).toContain(glitch);
        expect(game.shop.itemsInShop).toContain(item);
    });

    it("glitch can not pay experimental treatments destruction cost", async () => {
        const { glitch, item } = await setupGlitchWithShopItem("r-experimental_treatment");
        game.random = () => 2/6 - 0.0001; // roll a 2
        await game.activateItem(player1, glitch, [glitch.tags.copiedCards[0]!], "tap");
        await game.resolveEntireStack();
        expect(player1.hand.length).toBe(0);
        expect(player1.inPlay).toContain(glitch);
        expect(game.shop.itemsInShop).toContain(item);
    });

    it("gained pandoras box ability destroys the item using it", async () => {
        await game.resolveEntireStack();
        const item = game.obtainCard("b2-pandoras_box") as TreasureCard;
        game.shop._slots = [[item]];
        const breakfast = game.obtainCard("b2-breakfast") as TreasureCard;
        game.cardHandler.addInPlay(player1, breakfast);
        const copied = game.cardHandler.gainAbilities(player1, breakfast, item);
        game.random = () => 2/6 - 0.0001; // roll a 2
        game.cardHandler.recharge(breakfast);
        await game.activateItem(player1, breakfast, [copied], "tap");
        await game.resolveEntireStack();
        expect(player1.inPlay).not.toContain(breakfast);
        expect(game.decks.treasure.discard).toContain(breakfast);
        expect(game.shop.itemsInShop).toContain(item);
        expect(player1.coins).toBe(6);
    });

    it("gained experimental treatment ability destroys the item paying its cost", async () => {
        await game.resolveEntireStack();
        const item = game.obtainCard("r-experimental_treatment") as TreasureCard;
        game.shop._slots = [[item]];
        const breakfast = game.obtainCard("b2-breakfast") as TreasureCard;
        game.cardHandler.addInPlay(player1, breakfast);
        const copied = game.cardHandler.gainAbilities(player1, breakfast, item);
        game.random = () => 2/6 - 0.0001; // roll a 2
        game.cardHandler.recharge(breakfast);
        await game.activateItem(player1, breakfast, [copied], "tap");
        await game.resolveEntireStack();
        expect(player1.inPlay).not.toContain(breakfast);
        expect(game.decks.treasure.discard).toContain(breakfast);
        expect(game.shop.itemsInShop).toContain(item);
        expect(player1.hand.length).toBe(3);
    });
});