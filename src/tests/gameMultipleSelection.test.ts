import { describe, test, expect, beforeEach } from "bun:test";
import { Game } from "@/models/game";
import { Player } from "@/models/entities/player";
import { setTimeout } from "timers/promises";
import { Team } from "@/shared/api";

describe("Game.selectMultiple", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;
  let player3: Player;

  beforeEach(async () => {
    game = new Game();
    await game.start([{ issuer: "Alice", character: "b2-isaac", team: Team.Team1 }, { issuer: "Bob", character: "b2-samson", team: Team.Team2 }, { issuer: "Charlie", character: "b2-eve", team: Team.Team3 }], false);
    player1 = game.entityHandler.getPlayerById("Alice")!;
    player2 = game.entityHandler.getPlayerById("Bob")!;
    player3 = game.entityHandler.getPlayerById("Charlie")!;

    // Clear any pending selections to ensure clean state
    game["pendingMultipleSelections"].clear();
  });

  test("should handle multiple players selecting in parallel", async () => {
    // Use fresh cards from deck draws instead of obtainCard to avoid test interference
    const card1 = game.decks["loot"]!.draw() as any;
    const card2 = game.decks["loot"]!.draw() as any;
    const card3 = game.decks["loot"]!.draw() as any;
    const card4 = game.decks["loot"]!.draw() as any;
    const card5 = game.decks["loot"]!.draw() as any;
    const card6 = game.decks["loot"]!.draw() as any;

    const options1 = [card1, card2];
    const options2 = [card3, card4];
    const options3 = [card5, card6];

    // Start multiple selections
    const selectionPromise = game.selectMultiple([
      { player: player1, min: 1, max: 1, options: options1 , description: {key:""}, reason: "death", canUseOnBoardSelection: true,},
      { player: player2, min: 1, max: 1, options: options2 , description: {key:""}, reason: "death", canUseOnBoardSelection: true,},
      { player: player3, min: 1, max: 1, options: options3 , description: {key:""}, reason: "death", canUseOnBoardSelection: true,},
    ]);

    // Get state for each player
    const state1 = game.detailedStateJSON(player1);
    const state2 = game.detailedStateJSON(player2);
    const state3 = game.detailedStateJSON(player3);

    // Each player should see their own pending selection
    expect(state1.me.pendingSelection).toBeDefined();
    expect(state2.me.pendingSelection).toBeDefined();
    expect(state3.me.pendingSelection).toBeDefined();

    // Verify each player has the correct number of options (2 each)
    expect(options1.length).toBe(2);
    expect(options2.length).toBe(2);
    expect(options3.length).toBe(2);

    // Each player submits their selection using identifiers from the options array
    const requestId1 = state1.me.pendingSelection!.requestId;
    const requestId2 = state2.me.pendingSelection!.requestId;
    const requestId3 = state3.me.pendingSelection!.requestId;

    game.submitSelection(player1, requestId1, [state1.me.pendingSelection!.options[0]!]);
    game.submitSelection(player2, requestId2, [state2.me.pendingSelection!.options[1]!]);
    game.submitSelection(player3, requestId3, [state3.me.pendingSelection!.options[0]!]);

    // Wait for all selections to resolve
    const results = await selectionPromise;

    expect(results).toHaveLength(3);
    expect(results[0]!.playerId).toBe("Alice");
    expect(results[0]!.selected).toEqual([card1]);
    expect(results[0]!.remaining).toEqual([card2]);

    expect(results[1]!.playerId).toBe("Bob");
    expect(results[1]!.selected).toEqual([card4]);
    expect(results[1]!.remaining).toEqual([card3]);

    expect(results[2]!.playerId).toBe("Charlie");
    expect(results[2]!.selected).toEqual([card5]);
    expect(results[2]!.remaining).toEqual([card6]);
  });

  test("should handle asMany=true for multiple selections", async () => {
    const card1 = game.decks["loot"]!.draw()!;
    const card2 = game.decks["loot"]!.draw()!;
    const card3 = game.decks["loot"]!.draw()!;

    expect(card1).toBeDefined();
    expect(card2).toBeDefined();
    expect(card3).toBeDefined();

    const options1 = [card1, card2];
    const options2 = [card3];

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 0, max: 2, options: options1, description: {key:""}, reason: "death", canUseOnBoardSelection: true,},
      { player: player2, min: 0, max: 1, options: options2, description: {key:""}, reason: "death", canUseOnBoardSelection: true,},
    ]);

    const state1 = game.detailedStateJSON(player1);
    const state2 = game.detailedStateJSON(player2);

    expect(state1.me.pendingSelection).toBeDefined();
    expect(state2.me.pendingSelection).toBeDefined();
    expect(state1.me.pendingSelection!.min).toBe(0);
    expect(state1.me.pendingSelection!.max).toBe(2);
    expect(state2.me.pendingSelection!.min).toBe(0);
    expect(state2.me.pendingSelection!.max).toBe(1);

    const requestId1 = state1.me.pendingSelection!.requestId;
    const requestId2 = state2.me.pendingSelection!.requestId;

    // Player 1 selects only 1 (allowed with asMany)
    game.submitSelection(player1, requestId1, [state1.me.pendingSelection!.options[0]!]);
    // Player 2 selects 0 (allowed with asMany)
    game.submitSelection(player2, requestId2, []);

    const results = await selectionPromise;

    expect(results[0]!.selected).toEqual([card1]);
    expect(results[1]!.selected).toEqual([]);
  });

  test("should validate exact count when asMany=false", async () => {
    const card1 = game.decks["loot"]!.draw()!;
    const card2 = game.decks["loot"]!.draw()!;

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 2, max: 2, options: [card1, card2], description: {key:""}, reason: "death", canUseOnBoardSelection: true,},
    ]);

    const state1 = game.detailedStateJSON(player1);
    const requestId1 = state1.me.pendingSelection!.requestId;

    // Try to select only 1 when 2 required
    expect(() => {
      game.submitSelection(player1, requestId1, [state1.me.pendingSelection!.options[0]!]);
    }).toThrow("Must select exactly 2 option(s)");
    
    // Complete with correct count
    game.submitSelection(player1, requestId1, [state1.me.pendingSelection!.options[0]!, state1.me.pendingSelection!.options[1]!]);
    await selectionPromise;
  });

  test("should validate maximum count when asMany=true", async () => {
    const card1 = game.decks["loot"]!.draw()!;
    const card2 = game.decks["loot"]!.draw()!;
    const card3 = game.decks["loot"]!.draw()!;

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 0, max: 2, options: [card1, card2, card3], description: {key:""}, reason: "death", canUseOnBoardSelection: true,},
    ]);

    const state1 = game.detailedStateJSON(player1);
    const requestId1 = state1.me.pendingSelection!.requestId;

    // Try to select 3 when max is 2
    expect(() => {
      game.submitSelection(player1, requestId1, [state1.me.pendingSelection!.options[0]!, state1.me.pendingSelection!.options[1]!, state1.me.pendingSelection!.options[2]!]);
    }).toThrow("Must select at most 2 option(s)");
    
    // Complete with valid count
    game.submitSelection(player1, requestId1, [state1.me.pendingSelection!.options[0]!, state1.me.pendingSelection!.options[1]!]);
    await selectionPromise;
  });

  test("should reject submission with invalid requestId", async () => {
    const card1 = game.decks["loot"]!.draw()!;

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 1, max: 1, options: [card1] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
    ]);

    expect(() => {
      game.submitSelection(player1, -12, []);
    }).toThrow("No pending selection found for this request ID");
    
    // Complete properly
    const state1 = game.detailedStateJSON(player1);
    game.submitSelection(player1, state1.me.pendingSelection!.requestId, [state1.me.pendingSelection!.options[0]!]);
    await selectionPromise;
  });

  test("should reject submission from wrong player", async () => {
    const card1 = game.decks["loot"]!.draw()!;

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 1, max: 1, options: [card1] , description: {key:""}, reason: "death", canUseOnBoardSelection: true}
    ]);

    const state1 = game.detailedStateJSON(player1);
    const requestId1 = state1.me.pendingSelection!.requestId;

    // Player 2 tries to submit Player 1's selection
    expect(() => {
      game.submitSelection(player2, requestId1, []);
    }).toThrow("No pending selection found for this request ID");
    
    // Complete properly
    game.submitSelection(player1, requestId1, [state1.me.pendingSelection!.options[0]!]);
    await selectionPromise;
  });

  test("should generate unique requestIds for each selection", async () => {
    const card1 = game.decks["loot"]!.draw()!;
    const card2 = game.decks["loot"]!.draw()!;
    const card3 = game.decks["loot"]!.draw()!;

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 1, max: 1, options: [card1] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
      { player: player2, min: 1, max: 1, options: [card2] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
      { player: player3, min: 1, max: 1, options: [card3] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
    ]);

    const state1 = game.detailedStateJSON(player1);
    const state2 = game.detailedStateJSON(player2);
    const state3 = game.detailedStateJSON(player3);

    const requestId1 = state1.me.pendingSelection!.requestId;
    const requestId2 = state2.me.pendingSelection!.requestId;
    const requestId3 = state3.me.pendingSelection!.requestId;

    // All request IDs should be unique
    expect(requestId1).not.toBe(requestId2);
    expect(requestId1).not.toBe(requestId3);
    expect(requestId2).not.toBe(requestId3);
    
    // Complete the selections to avoid hanging promises
    game.submitSelection(player1, requestId1, [state1.me.pendingSelection!.options[0]!]);
    game.submitSelection(player2, requestId2, [state2.me.pendingSelection!.options[0]!]);
    game.submitSelection(player3, requestId3, [state3.me.pendingSelection!.options[0]!]);
    await selectionPromise;
  });

  test("should clear pending selection after submission", async () => {
    const card1 = game.decks["loot"]!.draw()!;

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 1, max: 1, options: [card1] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
    ]);

    const state1Before = game.detailedStateJSON(player1);
    expect(state1Before.me.pendingSelection).toBeDefined();

    const requestId1 = state1Before.me.pendingSelection!.requestId;
    game.submitSelection(player1, requestId1, [state1Before.me.pendingSelection!.options[0]!]);

    await selectionPromise;

    const state1After = game.detailedStateJSON(player1);
    expect(state1After.me.pendingSelection).toBeUndefined();
  });

  // test("should handle object options (not just cards)", async () => {
  //   const options1 = [
  //     { name: "Option A", value: 1 },
  //     { name: "Option B", value: 2 },
  //   ];
  //   const options2 = [
  //     { name: "Option C", value: 3 },
  //     { name: "Option D", value: 4 },
  //   ];

  //   const selectionPromise = game.selectMultiple([
  //     { player: player1, count: 1, options: options1 , description: "Select an option"},
  //     { player: player2, count: 1, options: options2 , description: "Select an option"},
  //   ]);

  //   const state1 = game.detailedStateJSON(player1);
  //   const state2 = game.detailedStateJSON(player2);

  //   game.submitSelection(player1, state1.me.pendingSelection!.requestId, [state1.me.pendingSelection!.options[1]!]);
  //   game.submitSelection(player2, state2.me.pendingSelection!.requestId, [state2.me.pendingSelection!.options[0]!]);

  //   const results = await selectionPromise;

  //   expect(results[0]!.selected).toEqual([{ name: "Option B", value: 2 }]);
  //   expect(results[1]!.selected).toEqual([{ name: "Option C", value: 3 }]);
  // });

  test("should not show other players' multiple selections in state", async () => {
    const card1 = game.decks["loot"]!.draw()!;
    const card2 = game.decks["loot"]!.draw()!;

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 1, max: 1, options: [card1] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
      { player: player2, min: 1, max: 1, options: [card2] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
    ]);

    const state1 = game.detailedStateJSON(player1);
    const state2 = game.detailedStateJSON(player2);
    const state3 = game.detailedStateJSON(player3);

    // Player 1 should only see their own selection
    expect(state1.me.pendingSelection).toBeDefined();
    expect(state1.me.pendingSelection!.options).toEqual([{type: "card", payload: {nameKey: card1.nameKey, slug: card1.slug, effectTextNumbers: [], globalId: card1.globalId, orientation: "portrait"}}]);

    // Player 2 should only see their own selection
    expect(state2.me.pendingSelection).toBeDefined();
    expect(state2.me.pendingSelection!.options).toEqual([{type: "card", payload: {nameKey: card2.nameKey, slug: card2.slug, effectTextNumbers: [], globalId: card2.globalId, orientation: "portrait"}}]);
    // Player 3 should not see any selections
    expect(state3.me.pendingSelection).toBeUndefined();
    
    // Complete the selections to avoid hanging promises
    game.submitSelection(player1, state1.me.pendingSelection!.requestId, [state1.me.pendingSelection!.options[0]!]);
    game.submitSelection(player2, state2.me.pendingSelection!.requestId, [state2.me.pendingSelection!.options[0]!]);
    await selectionPromise;
  });

  test("should handle mixed selection counts", async () => {
    const card1 = game.decks["loot"]!.draw()!;
    const card2 = game.decks["loot"]!.draw()!;
    const card3 = game.decks["loot"]!.draw()!;
    const card4 = game.decks["loot"]!.draw()!;
    const card5 = game.decks["loot"]!.draw()!;

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 1, max: 1, options: [card1, card2, card3] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
      { player: player2, min: 2, max: 2, options: [card4, card5] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
    ]);

    const state1 = game.detailedStateJSON(player1);
    const state2 = game.detailedStateJSON(player2);

    expect(state1.me.pendingSelection!.max).toBe(1);
    expect(state2.me.pendingSelection!.max).toBe(2);

    game.submitSelection(player1, state1.me.pendingSelection!.requestId, [state1.me.pendingSelection!.options[1]!]);
    game.submitSelection(player2, state2.me.pendingSelection!.requestId, [state2.me.pendingSelection!.options[0]!, state2.me.pendingSelection!.options[1]!]);

    const results = await selectionPromise;

    expect(results[0]!.selected).toEqual([card2]);
    expect(results[1]!.selected).toEqual([card4, card5]);
  });

  test("should handle empty options array", async () => {
    const selectionPromise = game.selectMultiple([
      { player: player1, min: 0, max: 0, options: [], description: {key:""}, reason: "death", canUseOnBoardSelection: true},
    ]);

    const state1 = game.detailedStateJSON(player1);
    game.submitSelection(player1, state1.me.pendingSelection!.requestId, []);

    const results = await selectionPromise;
    expect(results[0]!.selected).toEqual([]);
    expect(results[0]!.remaining).toEqual([]);
  });

  test("should handle selection with all options being selected", async () => {
    const card1 = game.decks["loot"]!.draw()!;
    const card2 = game.decks["loot"]!.draw()!;

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 2, max: 2, options: [card1, card2] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
    ]);

    const state1 = game.detailedStateJSON(player1);
    game.submitSelection(player1, state1.me.pendingSelection!.requestId, [state1.me.pendingSelection!.options[0]!, state1.me.pendingSelection!.options[1]!]);

    const results = await selectionPromise;

    expect(results[0]!.selected).toEqual([card1, card2]);
    expect(results[0]!.remaining).toEqual([]);
  });

  test("should trigger state change when multiple selections are created", async () => {
    const card1 = game.decks["loot"]!.draw()!;
    const card2 = game.decks["loot"]!.draw()!;

    let stateChangeTriggered = false;
    game.onStateChange.add(() => {
      stateChangeTriggered = true;
    });

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 1, max: 1, options: [card1] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
      { player: player2, min: 1, max: 1, options: [card2] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
    ]);
    await setTimeout(10); // slight delay to ensure state is updated before clients fetch it
    expect(stateChangeTriggered).toBe(true);
    
    // Complete the selections to avoid hanging promises
    const state1 = game.detailedStateJSON(player1);
    const state2 = game.detailedStateJSON(player2);
    game.submitSelection(player1, state1.me.pendingSelection!.requestId, [state1.me.pendingSelection!.options[0]!]);
    game.submitSelection(player2, state2.me.pendingSelection!.requestId, [state2.me.pendingSelection!.options[0]!]);
    await selectionPromise;
  });

  test("should handle players submitting in different order than request order", async () => {
    const card1 = game.decks["loot"]!.draw()!;
    const card2 = game.decks["loot"]!.draw()!;
    const card3 = game.decks["loot"]!.draw()!;

    const selectionPromise = game.selectMultiple([
      { player: player1, min: 1, max: 1, options: [card1] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
      { player: player2, min: 1, max: 1, options: [card2] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
      { player: player3, min: 1, max: 1, options: [card3] , description: {key:""}, reason: "death", canUseOnBoardSelection: true},
    ]);

    const state1 = game.detailedStateJSON(player1);
    const state2 = game.detailedStateJSON(player2);
    const state3 = game.detailedStateJSON(player3);

    // Submit in reverse order
    game.submitSelection(player3, state3.me.pendingSelection!.requestId, [state3.me.pendingSelection!.options[0]!]);
    game.submitSelection(player1, state1.me.pendingSelection!.requestId, [state1.me.pendingSelection!.options[0]!]);
    game.submitSelection(player2, state2.me.pendingSelection!.requestId, [state2.me.pendingSelection!.options[0]!]);

    const results = await selectionPromise;

    // Results should still be in original request order
    expect(results[0]!.playerId).toBe("Alice");
    expect(results[1]!.playerId).toBe("Bob");
    expect(results[2]!.playerId).toBe("Charlie");
  });
});
