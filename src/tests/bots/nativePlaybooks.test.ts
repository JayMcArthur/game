import { describe, expect, it } from "bun:test";
import { completeBotActivation, createBotInput, executeBotCommand, validateBotDecision } from "@/bots/host";
import { decideBot } from "@/bots/policy";
import type { BotLevel } from "@/shared/api";
import { LootCard, ItemCard } from "@/models/cards";
import type { Game } from "@/models/game";
import { createNativeBotGame } from "./nativeSetup";

async function drain(game: Game) {
  for (let count = 0; !game.stack.isEmpty(); count++) {
    if (count >= 20) throw new Error("Native card resolution exceeded the fixture budget");
    await executeBotCommand(game, game.currentPlayer, { type: "resolve" });
  }
}

async function next(game: Game, level: BotLevel, randomState: number) {
  const input = createBotInput(game, game.currentPlayer.id, { level, randomState });
  const decision = decideBot(input);
  validateBotDecision(input, decision);
  if (decision.kind !== "action") throw new Error("Expected a native action");
  const option = input.actions[decision.index]!;
  const completed = option.command.type === "activate"
    ? completeBotActivation(game, game.currentPlayer, option.command, { ...input, randomState: decision.randomState }, decideBot)
    : { command: option.command, randomState: decision.randomState };
  await executeBotCommand(game, game.currentPlayer, completed.command);
  return { ...completed, source: option.source?.slug, reason: decision.reason };
}

describe("official playbooks execute native TS card effects", () => {
  it("Normal targets itself with Strength and receives the native attack bonus", async () => {
    const game = createNativeBotGame("native-strength-playbook");
    await game.atGameStartDecisions();
    await drain(game);
    const player = game.currentPlayer;
    while (player.hand.length) game.cardHandler.discardFromHandAtIndex(player, 0, "overload");
    const card = game.obtainCard("b2-xi_strength");
    if (!(card instanceof LootCard)) throw new Error("Missing Strength");
    game.cardHandler.addCardToHand(player, card);
    const attack = game.entityHandler.getAttack(player);
    const selected = await next(game, "normal", 19);
    expect(selected.source).toBe("b2-xi_strength");
    if (selected.command.type !== "activate") throw new Error("Strength was not activated");
    expect(selected.command.payload.targetChoices?.some(target => target.type === "player" && target.payload.globalId === player.character.globalId)).toBe(true);
    await drain(game);
    expect(game.entityHandler.getAttack(player)).toBe(attack + 1);
  });

  it("Hard resolves Blank Card before playing Dime and receives twenty native coins", async () => {
    const game = createNativeBotGame("native-blank-playbook");
    await game.atGameStartDecisions();
    await drain(game);
    const player = game.currentPlayer;
    while (player.hand.length) game.cardHandler.discardFromHandAtIndex(player, 0, "overload");
    const dime = game.obtainCard("b2-a_dime");
    const blank = game.obtainCard("b2-blank_card");
    if (!(dime instanceof LootCard) || !(blank instanceof ItemCard)) throw new Error("Missing native cards");
    game.cardHandler.addCardToHand(player, dime);
    game.cardHandler.addInPlay(player, blank);
    game.cardHandler.recharge(blank);
    const before = player.coins;
    let selected = await next(game, "hard", 31);
    expect(selected.source).toBe("b2-blank_card");
    for (let count = 0; !game.stack.isEmpty(); count++) {
      if (count >= 5) throw new Error("Blank Card did not finish preparing");
      selected = await next(game, "hard", selected.randomState);
      expect(selected.command.type).toBe("resolve");
      expect(player.hand.cards.includes(dime)).toBe(true);
    }
    selected = await next(game, "hard", selected.randomState);
    expect(selected.source).toBe("b2-a_dime");
    await drain(game);
    expect(player.coins).toBe(before + 20);
  });
});
