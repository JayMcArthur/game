import { describe, expect, it } from "bun:test";
import { setupTestGame } from "./testHelpers";

describe("Game history - trailing randomSeed cleanup", () => {
    it("removeTrailingRandomSeed mutates real history, not a throwaway array", async () => {
        const { game } = await setupTestGame();
        game.addToHistory({ type: "Rejoin" });
        game.addToHistory({ private: true, type: "randomSeed", seed: "stray-seed" });

        expect(game.log.at(-2)?.type).toBe("randomSeed");

        game.removeTrailingRandomSeed();

        // A fresh call to the `log` getter must reflect the removal, proving the
        // real underlying history was mutated (not a disposable array copy).
        expect(game.log.at(-2)?.type).toBe("Rejoin");
    });

    it("does nothing when the last history entry is not a randomSeed", async () => {
        const { game } = await setupTestGame();
        game.addToHistory({ type: "Rejoin" });
        const beforeCount = game.log.length;

        game.removeTrailingRandomSeed();

        expect(game.log.length).toBe(beforeCount);
        expect(game.log.at(-2)?.type).toBe("Rejoin");
    });
});

