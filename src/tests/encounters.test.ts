import { MonsterCard, MonsterType } from "@/models/cards";
import { GameError } from "@/models/GameError";
import { beforeEach, describe, expect, it } from "bun:test";
import { Player } from "../models/entities/player";
import { Game } from "../models/game";
import { setupStandardTestGame } from "./testHelpers";
import { toSerializedTranslation } from "@/utils/translation";

describe("Encounters", () => {
    let game: Game;
    let player1: Player;
    let player2: Player;

    function getAndAddTopMonsterCard(game: Game, slug: string): void {
        const monsterCard = game.obtainCard(slug) as MonsterCard;
        if (!monsterCard) throw new GameError(`Monster card with slug ${slug} not found.`, toSerializedTranslation("error.parsingError", {error: `Monster card with slug ${slug} not found.`}));
        game.encounters._deck.addTopPosition(monsterCard);
    };

    function verifyMonsters(game: Game): void {
        game.encounters.visible.map((c, index) => {
            expect(c).toBeInstanceOf(MonsterCard);
            if(c?.encounterType === MonsterType.EVENT)
                expect(game.encounters.monsterIn(index)).toBeUndefined();
            else
                expect(game.encounters.monsterIn(index)?.id).toBe(c.slug);
        });
    }

    beforeEach(async () => {
        const setup = await setupStandardTestGame();
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
    });

    it("Monster are created", async () => {
        verifyMonsters(game);
    });

    it("Killing monsters replaces them correctly", async () => {
        verifyMonsters(game);
        getAndAddTopMonsterCard(game, "b2-mom");
        game.entityHandler.kill(player1, game.encounters.monsterIn(0)!, {card: game.encounters.monsterIn(0)!.card, visualEffectBox: undefined});
        await game.actions.resolveStack();
        verifyMonsters(game);
        expect(game.encounters.monsterIn(0)?.id).toBe("b2-mom");
        expect(game.encounters.visible[0]?.slug).toBe("b2-mom");
    });

    it("Discarding monsters replaces them correctly", async () => {
        verifyMonsters(game);
        getAndAddTopMonsterCard(game, "b2-holy_moms_eye");
        getAndAddTopMonsterCard(game, "b2-mom");
        game.encounters.flush();
        await game.actions.resolveStack();
        verifyMonsters(game);
        expect(game.encounters.monsterIn(0)?.id).toBe("b2-mom");
        expect(game.encounters.visible[0]?.slug).toBe("b2-mom");
        expect(game.encounters.monsterIn(1)?.id).toBe("b2-holy_moms_eye");
        expect(game.encounters.visible[1]?.slug).toBe("b2-holy_moms_eye");
    });

    it("Discarding single monster replaces it correctly", async () => {
        verifyMonsters(game);
        getAndAddTopMonsterCard(game, "b2-mom");
        game.encounters.flushMonster(game.encounters.monsterIn(0)!, "discard");
        await game.actions.resolveStack();
        verifyMonsters(game);
        expect(game.encounters.monsterIn(0)?.id).toBe("b2-mom");
        expect(game.encounters.visible[0]?.slug).toBe("b2-mom");
    });

    it("Drawing monster replaces it correctly", async () => {
        verifyMonsters(game);
        const monster = game.encounters.monsterIn(0)!;
        getAndAddTopMonsterCard(game, "b2-mom");
        game.encounters.draw(0);
        verifyMonsters(game);
        expect(game.encounters.monsterIn(0)?.id).toBe("b2-mom");
        expect(game.encounters.visible[0]?.slug).toBe("b2-mom");

        game.encounters.flushMonster(game.encounters.monsterIn(0)!, "discard");
        verifyMonsters(game);
        expect(game.encounters.monsterIn(0)?.id).toBe(monster.id);
        expect(game.encounters.visible[0]?.slug).toBe(monster.card.slug);
    });

    it("Obtaining a covered monster reveals it and refreshes the active entity", async () => {
        const coveredMonster = game.encounters.monsterIn(0)!;
        getAndAddTopMonsterCard(game, "b2-mom");
        game.encounters.draw(0);
        const topCard = game.encounters.visible[0]!;
        const topMonster = game.encounters.monsterIn(0)!;

        expect(topMonster.card).toBe(topCard);

        const obtainedCard = game.encounters.obtainCard(topCard.slug, topCard.globalId);

        expect(obtainedCard).toBe(topCard);
        expect(game.encounters.visible[0]).toBe(coveredMonster.card);
        expect(game.encounters.monsterIn(0)?.card).toBe(coveredMonster.card);
        expect(game.encounters.monsterIn(0)).not.toBe(topMonster);
        verifyMonsters(game);
    });

     it("Drawing event replaces it correctly", async () => {
        verifyMonsters(game);
        const monster = game.encounters.monsterIn(0)!;
        getAndAddTopMonsterCard(game, "b2-mom");
        getAndAddTopMonsterCard(game, "b2-troll_bombs");
        game.encounters.draw(0);
        verifyMonsters(game);
        expect(game.encounters.monsterIn(0)?.id).toBeUndefined();
        expect(game.encounters.visible[0]?.slug).toBe("b2-troll_bombs");

        await game.resolveEntireStack();
        verifyMonsters(game);
        expect(game.encounters.monsterIn(0)?.id).toBe(monster.id);
        expect(game.encounters.visible[0]?.slug).toBe(monster.card.slug);
    });
    
});

