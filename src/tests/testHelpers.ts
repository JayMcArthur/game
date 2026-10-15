import { GameParameters } from "@/models/gameParameters";
import { Team, type DeckConfigPatch, type PendingSelectionReason, type SerializedTranslation } from "@/shared/api";
import { shuffle } from "@/utils/auxiliary";
import type { BsoulCard, MonsterCard, RoomCard, TreasureCard } from "../models/cards";
import { Player } from "../models/entities/player";
import { Game } from "../models/game";


export function emptyHands(game: Game): void {
    for (const player of game.players) {
        while (player.hand.length > 0) {
            const card = player.hand.removeFromHandByPos(0);
            game.decks["loot"]?.addRandomPosition(card);
        }
    }
}

export function dischargeEachItemsAndRemoveCoins(game: Game): void {
    for (const player of game.players) {
        for (const item of player.inPlay) {
            item.charged = false;
        }
        player.loseCoins(player.coins, true);
    }
}

export async function randomSelect<T>(
        player: Player,
        min: number,
        max: number,
        Options: T[],
        description: SerializedTranslation,
        reason: PendingSelectionReason,
        skippable: boolean = true,
        canUseOnBoardSelection: boolean = true,
    ): Promise<{ selected: T[]; remaining: T[] }> {
    if (min < 0 || min > max) {
        throw new Error(`Invalid selection bounds: min (${min}) must be between 0 and max (${max}).`);
    }

    if ((min === max && Options.length === max && skippable) || Options.length < min) {
        return {
        selected: Options,
        remaining: [],
        };
    }
    if (Options.length === 0) return { selected: [], remaining: [] };

    const nbToSelect = Math.floor(Math.random() * ((Math.min(max, Options.length) - min + 1)) + min);
    const shuffledOptions = [...Options];
    shuffle(Math.random, shuffledOptions);
    const selected = shuffledOptions.slice(0, nbToSelect);
    const remaining = shuffledOptions.slice(nbToSelect);
    return { selected: selected, remaining: remaining };
} 

export async function randomSelectMultiple<T>(
        selections: 
        {
          player: Player;
          min: number;
          max: number;
          options: T[];
          description: SerializedTranslation;
          reason: PendingSelectionReason,
          skippable?: boolean;
          canUseOnBoardSelection: boolean;
        }[]
      ): Promise<{ playerId: string; selected: T[]; remaining: T[] }[]> {
        return Promise.all(selections.map(async s => {
            const res = await randomSelect(s.player, s.min, s.max, s.options, s.description, s.reason, s.skippable, s.canUseOnBoardSelection);
            return {playerId: s.player.id, selected: res.selected, remaining: res.remaining};}));
      };

/**
 * Configuration options for setting up a test game.
 */
export interface GameSetupConfig {
    /**
     * Array of character slugs to assign to players.
     * If provided, must match the number of players.
     * First character goes to first player, second to second player, etc.
     * @example ["b2-isaac", "b2-judas"]
     */
    characters?: string[];

    /**
     * Array of monster slugs to place in encounter slots.
     * Monsters are placed starting from slot 0.
     * @example ["b2-fly", "b2-fatty"]
     */
    monsters?: string[];

    /**
     * Array of monster slugs to add to the top of the monster deck.
     * Useful for controlling what gets drawn next.
     * Last item in array will be on top of deck.
     * @example ["b2-red_host", "b2-pooter", "b2-gurdy"]
     */
    monsterDeck?: string[];

    /**
     * Array of treasure slugs to add to the top of the treasure deck.
     * Useful for controlling shop draws and treasure gains.
     * Last item in array will be on top of deck.
     * @example ["b2-blank_card", "b2-boomerang", "b2-decoy"]
     */
    treasureDeck?: string[];

    /**
     * Number of players to create.
     * @default 2
     */
    playerCount?: number;

    /**
     * Array of bonus soul slugs to add to the game.
     * @example ["r-soul_of_envy", "r-soul_of_lust"]
     */
    bonusSouls?: string[] | "random";

    /**
     * Whether to use rooms in the game.
     */
    rooms?: boolean | "random";

    /**
     * Optional random seed for deterministic setups.
     * If provided, will be used to seed the game's random number generator.
     */
    randomSeed?: string;

    /**
     * Array of card slugs that should be removed from the game entirely.
     */
    forbiddenCards?: string[];


    /**
     * Game Parameters and values
     */
    parameters?: Map<string, any>;
}

/**
 * Result of setting up a test game.
 */
export interface GameSetupResult {
    game: Game;
    players: Player[];
    player1: Player;
    player2?: Player;
    player3?: Player;
    player4?: Player;
}

/**
 * Sets up a game instance with common test configuration.
 * 
 * This helper eliminates boilerplate in test files by providing a single function
 * to handle game creation, player setup, character assignment, monster placement,
 * and deck configuration.
 * 
 * @param config - Configuration options for the game setup
 * @returns An object containing the game instance and player references
 * 
 * @example
 * // Minimal setup with defaults
 * const { game, player1, player2 } = setupTestGame();
 * 
 * @example
 * // Full setup with custom characters and monsters
 * const { game, player1, player2 } = setupTestGame({
 *     characters: ["b2-isaac", "b2-judas"],
 *     monsters: ["b2-fly", "b2-fatty"],
 *     monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
 *     treasureDeck: ["b2-blank_card", "b2-boomerang"]
 * });
 * 
 * @example
 * // Three players with custom names
 * const { game, players } = setupTestGame({
 *     playerCount: 3,
 *     playerNames: ["Alice", "Bob", "Charlie"],
 *     characters: ["b2-isaac", "b2-judas", "b2-samson"]
 * });
 */
export async function setupTestGame(config: GameSetupConfig = {}): Promise<GameSetupResult> {
    const {
        characters,
        monsters = [],
        monsterDeck = [],
        treasureDeck = [],
        playerCount = 2,
        bonusSouls = [],
        rooms = false,
        randomSeed = "",
        forbiddenCards = [],
        parameters = [],
    } = config;

    // Create game instance
    const params = new GameParameters(() => {});
    params.setParameterByKey("decksConfig", {nbPlayerCardRestriction: {text: "", value: false}} as DeckConfigPatch);
    params.setParameterByKey("lootPlayPerTurn", 10);
    params.setParameterByKey("decksConfig", {useRCards: {text: "", value: true}} as DeckConfigPatch);
    if(rooms !== false)
        params.setParameterByKey("decksConfig", {useRooms: {text: "", value: true}} as DeckConfigPatch);
    else
        params.setParameterByKey("decksConfig", {useRooms: {text: "", value: false}} as DeckConfigPatch);
    for(const [param, val] of parameters.entries())
    {
        params.setParameterByKey(String(param), val);
    }

    const game = new Game(randomSeed, params);
    mockGameSelections(game);
    game.waitForNextTick = async () => {};
    
    // Setup game
    game.cardHandler.setupDecks();
    for(const slug of forbiddenCards) {
        const card = game.obtainCard(slug);
        if(card === undefined) {
            console.warn(`Card with slug ${slug} not found in game, cannot forbid it.`);
        }
    }
    if(rooms === true)
    {
        for(const slug of ["r-bomb_bum", "r-devil_beggar", "r-blood_donation", "r-beggar"]) {
            const roomCard = game.obtainCard(slug) ! as RoomCard;// default room.
            game.decks.room.addTopPosition(roomCard);
        }    
    }
    if(bonusSouls !== "random"){

        if(bonusSouls.length === 0) {
            bonusSouls.push("b2-soul_of_guppy"); // Add a default bonus soul if none provided, to test bonus soul mechanics in most tests
            bonusSouls.push("b2-soul_of_gluttony"); // Add a default bonus soul if none provided, to test bonus soul mechanics in most tests
            bonusSouls.push("b2-soul_of_greed"); // Add a default bonus soul if none provided, to test bonus soul mechanics in most tests
        }
        for(const soulSlug of bonusSouls) {
            const soulCard = game.decks.bsoul.getCardFromSlug(soulSlug) as BsoulCard;
            if(!soulCard) {
                throw new Error(`Bonus soul card not found: ${soulSlug}`);
            }
            game.decks.bsoul.addTopPosition(soulCard);
        }
    }

    // initialize monster deck with specified cards. Ensuring encounters to be initialized with expected monsters.
    for (const slug of monsterDeck) {
        const monsterCard = game.obtainCard(slug);
        if (!monsterCard) {
            throw new Error(`Monster card not found: ${slug}`);
        }
        game.decks["monster"]!.addTopPosition(monsterCard as MonsterCard);
    }

    // Assign characters
    const charactersFull = characters ? characters :
    game.decks.character.cards.splice(0, playerCount).map(c => c.slug);
    // Start the game
    const charas = charactersFull?.map((slug, index) => ({issuer: `Player ${index + 1}`, character: slug, team: Team[`Team${index + 1}` as keyof typeof Team]}));
    await game.start(charas, false);
    const players = game.players;
    dischargeEachItemsAndRemoveCoins(game);
    const el = game.stack.elements.find(el => el.json.type === "lootStep")!
    if(el)
        await el.onResolve();
    game.stack.cancelElement(el);
    emptyHands(game);
    
    const originalStack = [...game.stack._stack];

    // Force specific monsters into slots
    for (let i = 0; i < monsters.length; i++) {
        const slug = monsters[i]!;
        const monsterCard = game.obtainCard(slug);
        if (!monsterCard) {
            throw new Error(`Monster card not found: ${slug}`);
        }
        game.encounters.forceSetMonsterAtSlot(i, monsterCard as MonsterCard);
    }

    // Add monsters to deck top (reverse order so last becomes top)
    for (const slug of monsterDeck) {
        const monsterCard = game.obtainCard(slug);
        if (!monsterCard) {
            throw new Error(`Monster card not found: ${slug}`);
        }
        game.decks["monster"]!.addTopPosition(monsterCard as MonsterCard);
    }

    game.stack._stack = originalStack;
    // Add treasures to deck top (reverse order so last becomes top)
    for (const slug of treasureDeck) {
        let treasureCard: TreasureCard | undefined;

        try {
            treasureCard = game.shop.obtainCard(slug) as TreasureCard | undefined;
        } catch {
            treasureCard = undefined;
        }

        if (!treasureCard) {
            for (const player of game.players) {
                const inPlayTreasure = player.inPlay.find((card): card is TreasureCard => card.type === "treasure" && card.slug === slug);
                if (inPlayTreasure) {
                    game.cardHandler.removeInPlay(player, inPlayTreasure);
                    treasureCard = inPlayTreasure;
                    break;
                }
            }
        }

        if (!treasureCard) {
            const template = (game.decks["treasure"] as any)?._set?.cards?.find((card: TreasureCard) => card.slug === slug) as TreasureCard | undefined;
            if (template) {
                treasureCard = game.cardHandler.copyCard(template) as TreasureCard;
            }
        }

        if (!treasureCard) {
            throw new Error(`Treasure card not found: ${slug}`);
        }
        game.decks["treasure"]?.addTopPosition(treasureCard);
    }

    // Build result object with convenience references
    const result: GameSetupResult = {
        game,
        players,
        player1: players[0]!,
    };

    if (players.length > 1) result.player2 = players[1];
    if (players.length > 2) result.player3 = players[2];
    if (players.length > 3) result.player4 = players[3];
    game.resetCallbacks();

    return result;
}

/**
 * Quick setup for the most common test scenario: 2 players with Isaac and Judas.
 * Includes standard monster deck setup and two monsters in play.
 * 
 * @returns Game setup result with player1 and player2
 * 
 * @example
 * const { game, player1, player2 } = setupStandardTestGame();
 */
export async function setupStandardTestGame(): Promise<GameSetupResult> {
    return setupTestGame({
        characters: ["b2-isaac", "b2-judas"],
        monsters: ["b2-fly", "b2-fatty"],
        monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
        treasureDeck: ["b2-blank_card", "b2-boomerang", "b2-decoy", "b2-crystal_ball"],
    });
}

/**
 * Setup with Samson and Isaac characters (common alternative setup).
 * 
 * @returns Game setup result with player1 and player2
 */
export async function setupSamsonIsaacGame(): Promise<GameSetupResult> {
    return setupTestGame({
        characters: ["b2-samson", "b2-isaac"],
        monsters: ["b2-fly", "b2-fatty"],
        monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
        treasureDeck: ["b2-blank_card", "b2-placebo", "b2-tech_x", "b2-crystal_ball", "b2-boomerang"],
    });
}

/**
 * Mocks the game.select and game.selectMultiple methods for testing.
 * This replaces the multiplayer implementations with synchronous test versions
 * that immediately return mock selections.
 * 
 * Call this in beforeEach() to ensure tests don't wait for client responses.
 * 
 * @param game - The game instance to mock
 * @example
 * beforeEach(() => {
 *   game = new Game();
 *   mockGameSelections(game);
 *   // ... rest of setup
 * });
 */
export function mockGameSelections(game: Game): void {
    // Mock single player selection
    game.select = async (player: Player, min: number, max: number, Options: any[]): Promise<{ selected: any[]; remaining: any[] }> => {
        if (max === 1 && min === max && Options.length === 1) {
            return {
                selected: Options,
                remaining: []
            };
            }
        if(Options.length === 0)
            return {selected: [], remaining: []};
        return { selected: Options.slice(0, max), remaining: Options.slice(max) };
    };

    // Mock multiple player selection
    game.selectMultiple = async (selections: {
        player: Player;
        min: number;
        max: number;
        options: any[];
        asMany?: boolean;
    }[]): Promise<{ playerId: string; selected: any[]; remaining: any[] }[]> => {
        return selections.map(sel => ({
            playerId: sel.player.id,
            selected: sel.options.slice(0, sel.max),
            remaining: sel.options.slice(sel.max)
        }));
    };
}
