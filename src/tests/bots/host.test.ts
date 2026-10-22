import { describe, expect, it } from "bun:test";
import { ItemCard, LootCard } from "@/models/cards";
import { completeBotActivation, createBotInput, executeBotCommand, fallbackBotDecision, submitBotSelection, validateBotDecision } from "@/bots/host";
import { TargetBuilder } from "@/models/targetBuilder";
import { toSerializedTranslation } from "@/utils/translation";
import { createNativeBotGame } from "./nativeSetup";

const options = { level: "normal" as const, randomState: 77 };

describe("TS native bot boundary", () => {
  it("uses JSON actor state without advancing gameplay randomness or revealing another hand", async () => {
    const game = createNativeBotGame("bot-observation");
    const twin = createNativeBotGame("bot-observation");
    await game.atGameStartDecisions();
    await twin.atGameStartDecisions();
    const input = createBotInput(game, game.players[0]!.id, options);
    const json = JSON.parse(JSON.stringify(input));
    expect(json.version).toBe(1);
    expect(json.state.me.hand.length).toBeGreaterThan(0);
    expect(json.state.players.every((player: { hand?: unknown }) => player.hand === undefined)).toBe(true);
    expect(game.random()).toBe(twin.random());
    expect(json.actions.some((action: { command: { type: string } }) => action.command.type === "resolve")).toBe(true);
  });

  it("answers an actual pending selection only for its owner and rejects duplicate/outside answers", async () => {
    const game = createNativeBotGame("bot-selection");
    await game.atGameStartDecisions();
    const player = game.players[1]!;
    const promise = game.select(player, 1, 2, [1, 2, 3], toSerializedTranslation("common.empty"), "death", false);
    const input = createBotInput(game, player.id, options);
    expect(input.selection?.purpose).toBe("mandatory");
    expect(createBotInput(game, game.players[0]!.id, options).selection).toBeUndefined();
    const decision = fallbackBotDecision(input);
    validateBotDecision(input, decision);
    expect(() => validateBotDecision(input, { kind: "selection", indexes: [0, 0], randomState: 77, reason: "invalid" })).toThrow();
    expect(() => validateBotDecision(input, { kind: "selection", indexes: [9], randomState: 77, reason: "invalid" })).toThrow();
    expect(decision.kind).toBe("selection");
    if (decision.kind !== "selection") throw new Error("Missing selection");
    submitBotSelection(game, player, input.state.me.pendingSelection!.requestId, decision.indexes.map(index => input.selection!.options[index]!));
    expect((await promise).selected).toEqual([1]);
    expect(game.pendingMultipleSelections.size).toBe(0);
  });

  it("recovers with an offered end turn and preserves mandatory progress at the activation limit", async () => {
    const game = createNativeBotGame("bot-end-turn");
    await game.atGameStartDecisions();
    for (let count = 0; !game.stack.isEmpty() && count < 20; count++)
      await executeBotCommand(game, game.currentPlayer, { type: "resolve" });
    const input = createBotInput(game, game.currentPlayer.id, { ...options, turnActions: 32 });
    expect(input.actions.some(option => option.command.type === "activate")).toBe(false);
    const decision = fallbackBotDecision(input);
    expect(decision.kind).toBe("action");
    if (decision.kind !== "action") throw new Error("Missing action");
    expect(input.actions[decision.index]!.command.type).toBe("endTurn");
    const previous = game.currentPlayer;
    await executeBotCommand(game, previous, input.actions[decision.index]!.command);
    for (let count = 0; game.currentPlayer === previous && count < 20; count++)
      await executeBotCommand(game, previous, { type: "resolve" });
    expect(game.currentPlayer).not.toBe(previous);
  });

  it("offers the payable effect of uncharged Tech X without offering its unavailable tap", async () => {
    const game = createNativeBotGame("bot-uncharged-paid");
    await game.atGameStartDecisions();
    while (!game.stack.isEmpty()) await executeBotCommand(game, game.currentPlayer, { type: "resolve" });
    const player = game.currentPlayer;
    const tech = game.obtainCard("b2-tech_x");
    if (!(tech instanceof ItemCard)) throw new Error("Missing Tech X");
    game.cardHandler.addInPlay(player, tech);
    tech.charged = false;
    tech.counters.addToCounter(3, "normal");
    const input = createBotInput(game, player.id, options);
    const offers = input.actions.filter(option => option.source?.globalId === tech.globalId);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.some(option => option.command.type === "activate" && option.command.payload.effectIndex === "tap")).toBe(false);
    const option = offers[0]!;
    if (option.command.type !== "activate") throw new Error("Missing paid activation");
    const completed = completeBotActivation(game, player, option.command, input, fallbackBotDecision);
    await executeBotCommand(game, player, completed.command);
    expect(tech.counters.value("normal")).toBe(0);
  });

  it("excludes Dagaz's impossible curse branch and completes its native prevention branch", async () => {
    const game = createNativeBotGame("bot-dagaz-without-curses");
    await game.atGameStartDecisions();
    while (!game.stack.isEmpty()) await executeBotCommand(game, game.currentPlayer, { type: "resolve" });
    const player = game.currentPlayer;
    const dagaz = game.obtainCard("b2-dagaz");
    if (!(dagaz instanceof LootCard)) throw new Error("Missing Dagaz");
    game.cardHandler.addCardToHand(player, dagaz);
    const input = createBotInput(game, player.id, options);
    const option = input.actions.find(option => option.source?.globalId === dagaz.globalId);
    if (option?.command.type !== "activate") throw new Error("Missing Dagaz activation");
    const selector = TargetBuilder.getNextSelector(game, player, dagaz);
    expect(selector.isChooseOne).toBe(true);
    expect(selector.options.length).toBe(1);
    const completed = completeBotActivation(game, player, option.command, input, fallbackBotDecision);
    await executeBotCommand(game, player, completed.command);
    while (!game.stack.isEmpty()) await executeBotCommand(game, player, { type: "resolve" });
    expect(game.players.some(recipient => recipient.temporaryEffects.some(effect => effect.card.slug === "b2-dagaz"))).toBe(true);
  });

  it("fills actual Strength targets through the native selector before executing the card", async () => {
    const game = createNativeBotGame("bot-strength");
    await game.atGameStartDecisions();
    while (!game.stack.isEmpty()) await executeBotCommand(game, game.currentPlayer, { type: "resolve" });
    const player = game.currentPlayer;
    const card = game.obtainCard("b2-xi_strength");
    if (!(card instanceof LootCard)) throw new Error("Missing Strength");
    game.cardHandler.addCardToHand(player, card);
    const input = createBotInput(game, player.id, options);
    const option = input.actions.find(option => option.source?.globalId === card.globalId);
    expect(option?.command.type).toBe("activate");
    if (option?.command.type !== "activate") throw new Error("Strength not offered");
    const before = game.stack.size;
    const completed = completeBotActivation(game, player, option.command, input, fallbackBotDecision);
    expect(game.stack.size).toBe(before);
    expect(completed.command.type).toBe("activate");
    await executeBotCommand(game, player, completed.command);
    expect(player.hand.cards.includes(card)).toBe(false);
    expect(game.log.some(entry => entry.type === "Activate")).toBe(true);
  });

  it("preserves native encounter indexes and never covers an indomitable monster", async () => {
    const game = createNativeBotGame("bot-encounter-gaps");
    await game.atGameStartDecisions();
    while (!game.stack.isEmpty()) await executeBotCommand(game, game.currentPlayer, { type: "resolve" });
    const monster = game.encounters.monsterIn(1)!;
    monster.card.indomitable = true;
    game.encounters._slots[0] = [];
    game.encounters._monstersInPlay[0] = undefined;
    await executeBotCommand(game, game.currentPlayer, { type: "declareAttack" });
    const input = createBotInput(game, game.currentPlayer.id, options);
    expect(input.state.monsters.inPlay[0]!.top.stats?.healthPoints).toBe(monster.currentHealthPoints);
    expect(input.state.monsters.inPlay[0]!.top.globalId).toBe(monster.card.globalId);
    const coverSlots = input.actions.flatMap(option => option.command.type === "attackMonster" && option.command.payload.card === "top" ? [option.command.payload.toCoverIndex] : []);
    expect(coverSlots).toEqual([0]);
  });

  it("purchases the actual native shop slot when an earlier visible slot is empty", async () => {
    const game = createNativeBotGame("bot-shop-gaps");
    await game.atGameStartDecisions();
    while (!game.stack.isEmpty()) await executeBotCommand(game, game.currentPlayer, { type: "resolve" });
    const player = game.currentPlayer;
    game.gainCoins(player, 20, "gift");
    const card = game.shop.itemsInShop[1]!;
    game.shop._slots[0] = [];
    await executeBotCommand(game, player, { type: "declarePurchase" });
    const input = createBotInput(game, player.id, options);
    const option = input.actions.find(option => option.source?.globalId === card.globalId);
    expect(option?.command).toEqual({ type: "purchase", payload: { index: 1 } });
    if (!option) throw new Error("Missing actual shop offer");
    await executeBotCommand(game, player, option.command);
    expect(player.inPlay.some(item => item.globalId === card.globalId)).toBe(true);
    expect(player.isEngagedInPurchase).toBe(false);
  });
});
