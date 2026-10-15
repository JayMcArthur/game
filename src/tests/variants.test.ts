import { describe, expect, it } from "bun:test";
import { Game } from "@/models/game";
import { GameParameters } from "@/models/gameParameters";
import { Team } from "@/shared/api";
import type { DeckConfigPatch } from "@/shared/api";
import { mockGameSelections } from "./testHelpers";

describe("Game variants", () => {
    it("does not put the random-character placeholder into the character deck", () => {
        const game = new Game("mulligan-placeholder-not-in-deck");
        mockGameSelections(game);

        game.startOfGameSetup([
            { issuer: "Random", character: "random", team: Team.Team1 },
            { issuer: "Explicit", character: "b2-samson", team: Team.Team2 },
        ], false);

        const randomCharacter = game.players[0]!.character;
        expect(game.decks.character.cards).not.toContain(randomCharacter);
    });

    it("does not mulligan explicitly assigned characters", async () => {
        const game = new Game("mulligan-explicit-character");
        mockGameSelections(game);

        await game.start([
            { issuer: "Random", character: "random", team: Team.Team1 },
            { issuer: "Explicit", character: "b2-samson", team: Team.Team2 },
        ], false);

        expect(game.players[0]!.character.slug).not.toBe("b2-samson");
        expect(game.players[1]!.character.slug).toBe("b2-samson");
    });

    it("keeps the game playable when the character deck is smaller than the player count", async () => {
        const parameters = new GameParameters(() => {});
        parameters.setParameterByKey("decksConfig", {
            character: [{ slug: "b2-isaac", count: 1 }],
        } as DeckConfigPatch);
        parameters.setParameterByKey("mulliganCharacterNbOptions", 2);

        const game = new Game("mulligan-small-character-deck", parameters);
        mockGameSelections(game);

        await game.start([
            { issuer: "Random 1", character: "random", team: Team.Team1 },
            { issuer: "Random 2", character: "random", team: Team.Team2 },
        ], false);

        expect(game.players).toHaveLength(2);
        expect(game.players.every((player) => player.character !== undefined)).toBe(true);
    });

    it("does not require Isaac when B2 characters are disabled", async () => {
        const parameters = new GameParameters(() => {});
        parameters.setParameterByKey("decksConfig", {
            useB2Cards: { text: "", value: false },
        } as DeckConfigPatch);

        const game = new Game("mulligan-without-b2", parameters);
        mockGameSelections(game);

        await game.start([
            { issuer: "Random", character: "random", team: Team.Team1 },
            { issuer: "Explicit", character: "r-the_capricious", team: Team.Team2 },
        ], false);

        expect(game.players[0]!.character.slug).not.toBe("b2-isaac");
        expect(game.players[1]!.character.slug).toBe("r-the_capricious");
    });

    it("does not throw when options exceed the remaining character pool", async () => {
        const parameters = new GameParameters(() => {});
        parameters.setParameterByKey("mulliganCharacterNbOptions", 5);
        parameters.setParameterByKey("decksConfig", {
            character: [{ slug: "b2-isaac", count: 1 }],
        } as DeckConfigPatch);

        const game = new Game("mulligan-options-exceed-pool", parameters);
        mockGameSelections(game);

        await expect(game.start([
            { issuer: "Random 1", character: "random", team: Team.Team1 },
            { issuer: "Random 2", character: "random", team: Team.Team2 },
        ], false)).resolves.toBeUndefined();
    });
});
