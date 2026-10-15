import { MonsterCard } from "@/models/cards";
import type { DiceRoll } from "@/models/stackElement";
import { beforeEach, describe, expect, it } from "bun:test";
import { Player } from "../../models/entities/player";
import { Game } from "../../models/game";
import { setupTestGame } from "../testHelpers";


describe("Requiem Monsters ", () => {
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

    it("the_beast", async () => {
        const mob = game.obtainCard("r-dogma") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        const har = game.monsters[2]!;
        game.cardHandler.addToCounter(har, har.card, "normal", 4);
        game.random = () => 0.99;
        expect(game.stack.size).toBe(3);
        game.resetStack(); // otherwise players would die. It is also tested elsewhere.
        const json = har.card.jsonAPI;
        expect(json.nameKey.key).toBe("cardNames.r-the_beast");
        expect(json.slug).toBe("r-the_beast");
        expect(har.healthPoints).toBe(6);
        expect(har.evasion).toBe(4);
        expect(har.attackPoints).toBe(2);
        expect(player1.isDead).toBe(false);
        expect(player2.isDead).toBe(false);
        game.actions.declareAttack(player1);
        let i = 1;
        game.random = () => i++/6;
        game.actions.declareAttackOnEntity(player1, har);
        expect(game.stack.size).toBe(3);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.isDead).toBe(true);
        expect(player2.isDead).toBe(false);
        expect(game.encounters.slots.length).toBe(3);
        game.entityHandler.kill(player2, har, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(6);
        expect(player1.totalSouls).toBe(2);
    });

    it("the_harbingers", async () => {
        expect(game.decks.monster.cards.findIndex(c => c.slug === "r-the_harbingers")).toBe(-1);
        expect(game.outsideGameCards.findIndex(c => c.slug === "r-the_harbingers")).not.toBe(-1);
    });

    it("mega_satan", async () => {
        const mob = game.obtainCard("r-mega_satan") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);

        game.actions.declareAttack(player1);
        expect(game.actions.canDeclareAttackOnEntity(player1, player2, false)).toBe(true);
        expect(mob.indomitable).toBe(true);
        expect(game.encounters._slots.length).toBe(3);
        expect(game.monsters[2]!.id).toBe(mob.slug);
        expect(game.monsters[0]!.id).not.toBe(mob.slug);
    });

    it("dogma and the_harbingers", async () => {
        const mob = game.obtainCard("r-dogma") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.encounters.slots.length).toBe(3);
        expect(game.monsters[2]!.id).toBe("r-the_harbingers");
        const har = game.monsters[2]!;
        expect(har.healthPoints).toBe(4);
        expect(har.evasion).toBe(4);
        expect(har.attackPoints).toBe(1);
        expect(player1.hasAttackRequirement).toBe(true);
        game.entityHandler.dealDamage(player1, har, {card: mob, visualEffectBox: undefined}, 2);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(har.currentHealthPoints).toBe(har.healthPoints-2);
        game.entityHandler.kill(player1, har, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.monsters[2]!.id).toBe("r-the_harbingers");
        expect(har.isDead).toBe(false);
        expect(har.currentHealthPoints).toBe(har.healthPoints);
        expect(har.card.counters.value("normal")).toBe(1);
        game.random = () => 0.01;
        game.cardHandler.addToCounter(har, har.card, "normal", 3);
        expect(game.stack.size).toBe(3);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.isDead).toBe(true);
        expect(player2.isDead).toBe(true);
    });

    it("dogma", async () => {
        const mob = game.obtainCard("r-dogma") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        game.encounters.expand(3);
        expect(game.encounters._slots.length).toBe(5);
        const names = game.encounters.visible.map(card => card.slug);
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, ent);
        expect(game.stack.isEmpty()).toBe(false);
        await game.actions.resolveStack();
        for(const card of game.encounters.visible)
            expect(names.includes(card.slug)).toBe(false);
        expect(game.encounters.visible[0]!.slug).toBe("r-dogma");
    });

    it("ultra_greed 2", async () => {
        const mob = game.obtainCard("r-ultra_greed") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.entityHandler.kill(player2, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.coins).toBe(0);
        expect(player2.coins).toBe(40);
        expect(player1.targetableSouls.includes(mob)).toBe(true);
        expect(player2.targetableSouls.includes(mob)).toBe(false);
    });

    it("ultra_greed", async () => {
        const mob = game.obtainCard("r-ultra_greed") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.random = () => 0.01;
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, ent);
        await game.actions.resolveStack();
        await game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(1);
        expect(player2.currentHealthPoints).toBe(1);
    });

    it("whipper 2", async () => {
        const mob = game.obtainCard("r-whipper") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.random = () => 0.2;
        game.actions.declareAttack(player1);
        expect(game.stack.isEmpty()).toBe(false);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints-1);
    });

    it("whipper", async () => {
        const mob = game.obtainCard("r-whipper") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.random = () => 0.5;
        game.actions.declareAttack(player1);
        expect(game.stack.isEmpty()).toBe(false);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints);
    });

    it("turdlings", async () => {
        const mob = game.obtainCard("r-turdlings") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, ent);
        expect(game.stack.isEmpty()).toBe(true);
        game.random = () => 0.5;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints);

        game.random = () => 0.33;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints-1);
        expect(game.entitiesInCombat.length).toBe(0);
    });

    it("tnt_barrel", async () => {
        const mob = game.obtainCard("r-tnt_barrel") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.random = () => 0.01;
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            return { selected: [Options.includes(player2) ? player2 : Options[0]], remaining: Options.slice(max) };
        };
        game.encounters.forceSetMonsterAtSlot(0, mob);
        await game.actions.resolveStack(); // effect
        await game.actions.resolveStack(); // dice
        await game.actions.resolveStack(); // damage
        await game.actions.resolveStack(); // death
        await game.actions.resolveStack(); // damage
        await game.actions.resolveStack(); // death
        expect(player1.isDead).toBe(true);
        expect(player2.isDead).toBe(true);
    });

    it("the_scourge 2", async () => {
        const mob = game.obtainCard("r-the_scourge") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.selectMultiple = async (selections: Array<{
        player: Player;
        min: number;
        max: number;
        options: any[];
        asMany?: boolean;
            }>) => {
                return selections.map(sel => ({
                    playerId: sel.player.id,
                    selected: sel.options.slice(1, 2),
                    remaining: sel.options.slice(sel.max)
                }));
            };

        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.dealDamage(ent, ent, {card: mob, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(1);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints-1);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints);
    });

    it("the_scourge", async () => {
        const mob = game.obtainCard("r-the_scourge") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.dealDamage(ent, ent, {card: mob, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints-1);
        expect(player1.hand.length).toBe(0);
    });

    it("sisters_vis", async () => {
        const mob = game.obtainCard("r-sisters_vis") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, ent);
        expect(game.stack.isEmpty()).toBe(false);
        await game.actions.resolveStack();
        game.random = () => 0.01;
        game.entityHandler.addHealth(player1, 1, "other");
        game.entityHandler.addHealth(player2, 1, "other");
        game.actions.attackRoll(player1);
        expect((game.stack.elements[0] as DiceRoll).issuer).toBe(player1);
        expect((game.stack.elements[0] as DiceRoll).attackRoll).toBe(true);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.size).toBe(2);
        expect(game.stack.elements[1]!.json.type).toBe("diceRoll");
        expect((game.stack.elements[1] as DiceRoll).issuer).toBe(player2);
        expect((game.stack.elements[1] as DiceRoll).attackRoll).toBe(true);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(1);
        expect(player2.currentHealthPoints).toBe(1);

        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.inPlay.length).toBe(2);
    });

    it("red_ghost", async () => {
        const mob = game.obtainCard("r-red_ghost") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.entityHandler.dealDamage(ent, ent, {card: mob, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints-1);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints-1);
    });

    it("rag_mega", async () => {
        const mob = game.obtainCard("r-rag_mega") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        game.loot(player1, 2);
        game.loot(player2, 2);
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, ent);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(2);
        expect(player2.hand.length).toBe(1);

        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.isDead).toBe(true);
    });

    it("overflow", async () => {
        const mob = game.obtainCard("r-overflow") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        let i = 1;
        game.random = () => (i++/2) % 2/2;
        game.encounters.forceSetMonsterAtSlot(0, mob);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.endTurn();
        await game.actions.resolveStack();
        expect(game.currentPlayer).toBe(player1);
    });

    it("mushroom", async () => {
        const mob = game.obtainCard("r-mushroom") as MonsterCard;
        game.entityHandler.addHealth(player1, 10, "other");
        game.entityHandler.addHealth(player2, 10, "other");
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, ent);
        game.random = () => 0.01;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints-1);
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints-2);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints-2);
    });

    it("mothers_shadow 2", async () => {
        const mob = game.obtainCard("r-mothers_shadow") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        const card = game.decks.monster.draw();
        card.soul = 2;
        game.cardHandler.addSoul(player1, card);

        game.encounters.forceSetMonsterAtSlot(0, mob);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.isDead).toBe(true);
        expect(player2.isDead).toBe(false);
    });

    it("mothers_shadow", async () => {
        const mob = game.obtainCard("r-mothers_shadow") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.isDead).toBe(true);
        expect(player2.isDead).toBe(true);
    });

    it("lust_for_blood", async () => {
        const mob = game.obtainCard("r-lust_for_blood") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hasMandatoryAttackRequirement).toBe(true);
        game.actions.declareAttack(player1);
        expect(game.actions.canDeclareAttackOnEntity(player1, player2, false)).toBe(true);
        expect(game.actions.canDeclareAttackOnEntity(player1, game.monsters[1]!, false)).not.toBe(true);
        game.actions.declareAttackOnEntity(player1, player2);
        game.entityHandler.kill(player1, player2, {card: mob, visualEffectBox: undefined});
        game.gainTreasure(player2, 2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hasMandatoryAttackRequirement).toBe(false);
        expect(player1.inPlay.length).toBe(2);
        expect(player2.inPlay.length).toBe(2);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
    });

    it("hornfel", async () => {
        const mob = game.obtainCard("r-hornfel") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        game.entityHandler.addHealth(player2, 10, "other");

        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, ent);
        game.random = () => 0.01;
        game.actions.attackRoll(player1);
        game.random = () => 0.991;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints-1);

        game.random = () => 0.01;
        game.actions.attackRoll(player1);
        game.random = () => 0.991;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints-2);

    });

    it("hornfel 2", async () => {
        const mob = game.obtainCard("r-hornfel") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        game.entityHandler.addHealth(player1, 10, "other");

        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, ent);
        game.random = () => 0.01;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints-1);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints);

        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints-2);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints);

    });

    it("holy_greedling", async () => {
        const mob = game.obtainCard("r-holy_greedling") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.entityHandler.kill(player1, game.monsters[1]!, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.coins).toBe(3);
    });

    it("null", async () => {
        const mob = game.obtainCard("r-null") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, ent);
        game.random = () => 0.99;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve on damage taken
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints-1);
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve on damage taken
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints-1);
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve on damage taken
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints-2);
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve on damage taken
        expect(game.stack.isEmpty()).toBe(true);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints-2);
    });

    it("the_rainmaker", async () => {
        const mob = game.obtainCard("r-the_rainmaker") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.random = () => 0.01;
        game.rollDice(player2, mob);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player2.hand.length).toBe(1);

        game.rollDice(player1, mob);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(1);
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        // expect(game.stack.isEmpty()).toBe(true); shuffle so can't be sure about this.
        expect(player1.curses.length).toBeGreaterThanOrEqual(1);
    });

    it("mother", async () => {
        const mob = game.obtainCard("r-mother") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        expect(game.entityHandler.getDC(ent)).toBe(1);
        for(let i=0; i<7; i++) {
            game.entityHandler.dealDamage(player1, ent, {card: mob, visualEffectBox: undefined}, 1);
            await game.actions.resolveStack();
            await game.actions.resolveStack();
            expect(game.stack.isEmpty()).toBe(true);
            expect(game.entityHandler.getDC(ent)).toBe(Math.min(6,2+i));
        }

        await game.endTurn();
        await game.actions.resolveStack();
        expect(game.entityHandler.getDC(ent)).toBe(1);
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.encounters._slots.length).toBe(4);
    });

    it("holy_psy_horf", async () => {
        const mob = game.obtainCard("r-holy_psy_horf") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.hand.length).toBe(1);
        expect(player2.hand.length).toBe(1);
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player2.hand.length).toBe(2);
    });

    it("golden_troll_bomb", async () => {
        const mob = game.obtainCard("r-golden_troll_bomb") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            return { selected: [Options[1]], remaining: Options.slice(max) };
        };
        game.encounters.forceSetMonsterAtSlot(0, mob);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.isDead).toBe(true);
        expect(game.decks.monster.cards[3]!.slug).toBe(mob.slug);
    });

    it("cursed_mulliboom", async () => {
        const mob = game.obtainCard("r-cursed_mulliboom") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.random = () => 0.01;
        game.entityHandler.kill(player1, game.monsters[1]!, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.isDead).toBe(true);
    });

    it("cursed_lil_haunt", async () => {
        const mob = game.obtainCard("r-cursed_lil_haunt") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        let i = 1;
        game.random = () => (i++/2) % 6 / 6 - 0.01;
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            return { selected: [Options[1]], remaining: Options.slice(max) };
        };
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        const dice = game.rollDice(player1, mob);
        expect(dice.value).toBe(1);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(false);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(dice.value).toBe(2);
    });

    it("curse_of_the_soulless", async () => {
        const mob = game.obtainCard("r-curse_of_the_soulless") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        await game.actions.resolveStack(); // resolve the event addition
        await game.actions.resolveStack();
        const card = game.decks.monster.draw();
        card.soul = 2;
        game.cardHandler.addSoul(player1, card);
        expect(player1.totalSouls).toBe(0);
        game.entityHandler.kill(player1, player1, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player1.curses.includes(mob)).toBe(false);
        expect(player2.curses.includes(mob)).toBe(true);
        expect(game.decks.monster.discard.includes(mob)).toBe(false);
    });

    it("dressing_table", async () => {
        game.gainTreasure(player1, 3);
        const treasures = [...player1.inPlay];
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
                return {
                    selected: Options.slice(0, 2),
                    remaining: []
                };
            return { selected: Options.slice(0, max), remaining: Options.slice(max) };
        };
        const mob = game.obtainCard("r-dressing_table") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.inPlay.includes(treasures[1]!)).toBe(false);
        expect(player1.inPlay.includes(treasures[2]!)).toBe(false);
        expect(player1.inPlay.includes(treasures[3]!)).toBe(true);
    });

    it("curse_of_the_hollow", async () => {
        const mob = game.obtainCard("r-curse_of_the_hollow") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        await game.actions.resolveStack();
        await game.actions.resolveStack(); // resolve the event addition
        expect(game.stack.isEmpty()).toBe(true);
        const card = game.decks.monster.draw();
        card.soul = 2;
        game.cardHandler.addSoul(player1, card);
        game.loot(player1, 3);
        game.gainCoins(player1, 3, "gift");
        await game.endTurn();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(1);
        expect(player1.coins).toBe(1);
    });

    it("corny", async () => {
        const mob = game.obtainCard("r-corny") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.isDead).toBe(true);
    });

    it("charmed_monstro", async () => {
        const mob = game.obtainCard("r-charmed_monstro") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.totalSouls).toBe(0);
        expect(player2.totalSouls).toBe(1);
    });

    it("charmed_keeper", async () => {
        const mob = game.obtainCard("r-charmed_keeper") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.gainCoins(player1, 5, "gift");
        game.entityHandler.dealCombatDamage(ent, player1, {card: mob, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.coins).toBe(3);

        game.random = () => 0.99;
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.coins).toBe(6);
    });

    it("charmed_globin", async () => {
        const mob = game.obtainCard("r-charmed_globin") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.dealDamage(ent, player1, {card: mob, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        
        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, ent);
        game.random = () => 0.01;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(ent.currentHealthPoints).toBe(ent.healthPoints);

        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(player2.hand.length).toBe(3);
        
    });

    it("charmed_fatty", async () => {
        const mob = game.obtainCard("r-charmed_fatty") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.loot(player1, 2);
        game.entityHandler.dealDamage(ent, player1, {card: mob, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(1);

        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.hand.length).toBe(2);
    });

    it("holy_portal", async () => {
        const mob = game.obtainCard("r-holy_portal") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.kill(player1, game.monsters[1]!, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.attackThisTurn).toBe(2);
    });

    it("charmed_dip", async () => {
        const mob = game.obtainCard("r-charmed_dip") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        expect(player2.inPlay[0]!.charged).toBe(false);
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.inPlay[0]!.charged).toBe(true);
    });

    it("double_treasure", async () => {
        const mob = game.obtainCard("r-double_treasure") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.inPlay.length).toBe(2);
        expect(player2.inPlay.length).toBe(2);
    });

    it("charmed_greedling", async () => {
        const mob = game.obtainCard("r-charmed_greedling") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.coins).toBe(6);
        expect(player2.coins).toBe(10);
    });

    it("charmed_fat_bat", async () => {
        const mob = game.obtainCard("r-charmed_fat_bat") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.inPlay.length).toBe(2);
        expect(player2.inPlay.length).toBe(2);
    });

    it("charmed_clotty", async () => {
        const mob = game.obtainCard("r-charmed_clotty") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.hand.length).toBe(1);
    });

    it("charmed_bony", async () => {
        const mob = game.obtainCard("r-charmed_bony") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.actions.declareAttack(player1);
        game.actions.declareAttackOnEntity(player1, ent);
        game.random = () => 0.99;
        game.actions.attackRoll(player1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(1);

        game.entityHandler.kill(player1, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.coins).toBe(5);
        expect(player2.coins).toBe(5);
    });

    it("brownie", async () => {
        const mob = game.obtainCard("r-brownie") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.entityHandler.dealDamage(player1, ent, {card: mob, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.entityHandler.getDC(ent)).toBe(4);

        game.entityHandler.dealDamage(player1, ent, {card: mob, visualEffectBox: undefined}, 1);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.entityHandler.getDC(ent)).toBe(3);

        await game.endTurn();
        await game.actions.resolveStack();
        expect(game.entityHandler.getDC(ent)).toBe(5);
    });

    it("betrayal 6 - Steal a soul they control.", async () => {
        const mob = game.obtainCard("r-betrayal") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        expect(game.stack.size).toBe(1);
        game.loot(player2, 2);
        game.gainCoins(player2, 6, "gift");
        game.gainTreasure(player2, 3);
        const soulCard = game.decks.monster.draw();
        soulCard.soul = 1;
        game.cardHandler.addSoul(player2, soulCard);
        const soulCard2 = game.decks.monster.draw();
        soulCard2.soul = 1;
        game.cardHandler.addSoul(player2, soulCard2);

        game.random = () => 0.99;
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            if(Options.includes(player2))
                return {
                    selected: [player2],
                    remaining: []
                };
            return { selected: Options.slice(0, max), remaining: Options.slice(max) };
        };
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.coins).toBe(6);
        expect(player1.coins).toBe(0);
        expect(player2.hand.length).toBe(2);
        expect(player2.inPlay.length).toBe(4);
        expect(player2.totalSouls).toBe(1);
        expect(player1.hand.length).toBe(0);
        expect(player1.inPlay.length).toBe(1);
        expect(player1.totalSouls).toBe(1);
    });

    it("betrayal 5 - Steal a non-eternal item they control.", async () => {
        const mob = game.obtainCard("r-betrayal") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        expect(game.stack.size).toBe(1);
        game.loot(player2, 2);
        game.gainCoins(player2, 6, "gift");
        game.gainTreasure(player2, 3);
        const soulCard = game.decks.monster.draw();
        soulCard.soul = 1;
        game.cardHandler.addSoul(player2, soulCard);
        const soulCard2 = game.decks.monster.draw();
        soulCard2.soul = 1;
        game.cardHandler.addSoul(player2, soulCard2);

        game.random = () => 5/6-0.01;
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            if(Options.includes(player2))
                return {
                    selected: [player2],
                    remaining: []
                };
            return { selected: Options.slice(0, max), remaining: Options.slice(max) };
        };
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.coins).toBe(6);
        expect(player1.coins).toBe(0);
        expect(player2.hand.length).toBe(2);
        expect(player2.inPlay.length).toBe(3);
        expect(player2.totalSouls).toBe(2);
        expect(player1.hand.length).toBe(0);
        expect(player1.inPlay.length).toBe(2);
        expect(player1.totalSouls).toBe(0);
    });

    it("betrayal 3 - Steal a loot card from them at random.", async () => {
        const mob = game.obtainCard("r-betrayal") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        expect(game.stack.size).toBe(1);
        game.loot(player2, 2);
        game.gainCoins(player2, 6, "gift");
        game.gainTreasure(player2, 3);
        const soulCard = game.decks.monster.draw();
        soulCard.soul = 1;
        game.cardHandler.addSoul(player2, soulCard);
        const soulCard2 = game.decks.monster.draw();
        soulCard2.soul = 1;
        game.cardHandler.addSoul(player2, soulCard2);

        game.random = () => 0.5;
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            if(Options.includes(player2))
                return {
                    selected: [player2],
                    remaining: []
                };
            return { selected: Options.slice(0, max), remaining: Options.slice(max) };
        };
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.coins).toBe(6);
        expect(player1.coins).toBe(0);
        expect(player2.hand.length).toBe(1);
        expect(player2.inPlay.length).toBe(4);
        expect(player2.totalSouls).toBe(2);
        expect(player1.hand.length).toBe(1);
        expect(player1.inPlay.length).toBe(1);
        expect(player1.totalSouls).toBe(0);
    });

    it("betrayal 1", async () => {
        const mob = game.obtainCard("r-betrayal") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        expect(game.stack.size).toBe(1);
        game.loot(player2, 2);
        game.gainCoins(player2, 6, "gift");
        game.gainTreasure(player2, 3);
        const soulCard = game.decks.monster.draw();
        soulCard.soul = 1;
        game.cardHandler.addSoul(player2, soulCard);
        const soulCard2 = game.decks.monster.draw();
        soulCard2.soul = 1;
        game.cardHandler.addSoul(player2, soulCard2);

        game.random = () => 0.01;
        game.select = async (player: Player, min: number, max: number, Options: any[]) => {
            if(Options.includes(player2))
                return {
                    selected: [player2],
                    remaining: []
                };
            return { selected: Options.slice(0, max), remaining: Options.slice(max) };
        };
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.coins).toBe(1);
        expect(player1.coins).toBe(5);
        expect(player2.hand.length).toBe(2);
        expect(player2.inPlay.length).toBe(4);
        expect(player2.totalSouls).toBe(2);
        expect(player1.hand.length).toBe(0);
        expect(player1.inPlay.length).toBe(1);
        expect(player1.totalSouls).toBe(0);
    });

    it("baby_plum 6", async () => {
        const mob = game.obtainCard("r-baby_plum") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.dealDamage(player1, ent, {card: mob, visualEffectBox: undefined}, 1);
        game.random = () => 0.99;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints-1);
    });

    it("baby_plum 3", async () => {
        const mob = game.obtainCard("r-baby_plum") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.dealDamage(player1, ent, {card: mob, visualEffectBox: undefined}, 1);
        game.random = () => 0.5;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints-1);
    });

    it("baby_plum 1", async () => {
        const mob = game.obtainCard("r-baby_plum") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.dealDamage(player1, ent, {card: mob, visualEffectBox: undefined}, 1);
        game.random = () => 0.1;
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.currentHealthPoints).toBe(player1.healthPoints-1);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints);
    });

    it("r-curse_of_empathy", async () => {
        const card1 = game.obtainCard("r-curse_of_empathy") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        await game.actions.resolveStack(); // resolve the event addition
        await game.actions.resolveStack(); 
        game.entityHandler.kill(player1, game.monsters[0]!, {card: card1, visualEffectBox: undefined});
        game.gainCoins(player1, 5, "gift");
        game.loot(player1, 3);
        expect(player1.hand.length).toBe(3);
        await game.actions.resolveStack(); 
        const initCoins = player1.coins;
        const initHand = player1.hand.length;
        await game.actions.resolveStack(); 
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(initHand-1);
        expect(player1.coins).toBe(initCoins-1);
    });

    it("r-curse_of_the_hunted", async () => {
        const card1 = game.obtainCard("r-curse_of_the_hunted") as MonsterCard;
        game.decks.monster.addTopPosition(card1);
        game.actions.declareAttack(player1);
        const atk = [game.entityHandler.getAttack(game.monsters[0]!), game.entityHandler.getAttack(game.monsters[1]!)];
        await game.actions.declareAttackOnEntity(player1, "topDeck", 0);
        await game.actions.resolveStack(); // resolve the event addition
        await game.actions.resolveStack(); 
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.entityHandler.getAttack(game.monsters[0]!)).toBe(atk[0]! + 1);
        expect(game.entityHandler.getAttack(game.monsters[1]!)).toBe(atk[1]! + 1);
    });
    
    it("cursed_dople", async () => {
        const mob = game.obtainCard("r-cursed_dople") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.entityHandler.dealDamage(player1, ent, {card: mob, visualEffectBox: undefined}, 2);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player2.currentHealthPoints).toBe(player2.healthPoints-1);
        expect(ent.currentHealthPoints).toBe(ent.healthPoints-2);
    });

    it("gutted_fatty", async () => {
        const mob = game.obtainCard("r-gutted_fatty") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.entityHandler.kill(ent, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.encounters._slots.length).toBe(3);
        expect(player1.hasMandatoryAttackRequirement).toBe(true);
    });

    it("holy_brain", async () => {
        const mob = game.obtainCard("r-holy_brain") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        const ent2 = game.monsters[1]!;
        const dc2 = game.entityHandler.getDC(ent2);
        game.random = () => 1/2-0.01;
        game.rollDice(player1, mob);
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(game.entityHandler.getDC(ent)).toBe(2);
        expect(game.entityHandler.getDC(ent2)).toBe(dc2-1);
    });

    it("mama_gurdy", async () => {
        const mob = game.obtainCard("r-mama_gurdy") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;
        game.random = () => 0.99;

        game.entityHandler.kill(ent, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.length).toBe(6);
    });

    it("clog", async () => {
        const mob = game.obtainCard("r-clog") as MonsterCard;
        expect(mob).toBeInstanceOf(MonsterCard);
        
        game.encounters.forceSetMonsterAtSlot(0, mob);
        const ent = game.monsters[0]!;

        game.loot(player1, 1);
        const card = player1.hand.cards[0]!;
        game.loot(player2, 1);
        const card2 = player2.hand.cards[0]!;

        game.entityHandler.kill(ent, ent, {card: mob, visualEffectBox: undefined});
        await game.actions.resolveStack();
        await game.actions.resolveStack();
        expect(game.stack.isEmpty()).toBe(true);
        expect(player1.hand.cards.some(c => c.globalId === card2.globalId)).toBe(true);
        expect(player2.hand.cards.some(c => c.globalId === card.globalId)).toBe(true);
    });
});