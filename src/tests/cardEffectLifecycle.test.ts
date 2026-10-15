import { describe, expect, it } from "bun:test";
import { setupTestGame } from "@/tests/testHelpers";

describe("lazy card effect attachment", () => {
    it("does not parse cards while they remain in a deck", async () => {
        const { game } = await setupTestGame({
            characters: ["b2-isaac", "b2-judas"],
            monsters: ["b2-fly", "b2-fatty"],
            treasureDeck: ["b2-tech_x", "b2-blank_card"],
            randomSeed: "lazy-card-effects",
        });

        const card = game.decks.treasure.cards.find(candidate =>
            candidate.activeEffectList.length === 0 &&
            candidate.effectOutcomes.some(outcome => /^\[(tap|paid) effect\]/i.test(outcome)),
        );
        expect(card).toBeDefined();
        expect(card!.activeEffectList).toHaveLength(0);

        const extracted = game.decks.treasure.getCard(candidate => candidate === card);
        expect(extracted).toBe(card);
        expect(card!.activeEffectList.length).toBeGreaterThan(0);

        const effectCount = card!.activeEffectList.length;
        game.decks.treasure.addTopPosition(card!);
        expect(game.decks.treasure.draw()).toBe(card!);
        expect(card!.activeEffectList).toHaveLength(effectCount);
    });
});
