import { describe, expect, it } from "bun:test";
import { BotRunner } from "@/bots/runner";
import { fallbackBotDecision } from "@/bots/host";
import { toSerializedTranslation } from "@/utils/translation";
import type { Game } from "@/models/game";
import { executeBotCommand } from "@/bots/host";
import { LootCard } from "@/models/cards";
import { createNativeBotGame } from "./nativeSetup";

function waitForState(game: Game, predicate: () => boolean, milliseconds = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (!predicate()) return;
      clearTimeout(timer);
      game.onStateChange.remove(finish);
      resolve();
    };
    const timer = setTimeout(() => {
      game.onStateChange.remove(finish);
      reject(new Error("Native bot state did not progress"));
    }, milliseconds);
    game.onStateChange.add(finish);
    finish();
  });
}

describe("TS bot request runner", () => {
  it("recovers from a throwing strategy and answers the discard awaited by its own resolve", async () => {
    const game = createNativeBotGame("runner-error-discard");
    await game.atGameStartDecisions();
    const player = game.currentPlayer;
    player.maxHandSize = 1;
    const decisions: string[] = [];
    const runner = new BotRunner(game, [{ playerId: player.id, level: "hard" }], {
      policy: () => { throw new Error("Injected strategy failure"); },
      onDecision: (input, decision) => decisions.push(decision.kind === "action" ? input.actions[decision.index]!.command.type : decision.kind),
    });
    try {
      const changed = waitForState(game, () => game.currentPlayer !== player);
      runner.start();
      await changed;
      expect(decisions).toContain("endTurn");
      expect(decisions).toContain("selection");
      expect(player.hand.length).toBe(1);
      expect(game.pendingMultipleSelections.size).toBe(0);
      expect(runner.diagnostics.every(diagnostic => diagnostic.phase === "policy")).toBe(true);
    } finally { runner.stop(); }
  });

  it("replies to simultaneous native choices for every bot, including non-active seats", async () => {
    const game = createNativeBotGame("runner-multiple", 4);
    await game.atGameStartDecisions();
    const promise = game.selectMultiple(game.players.map(player => ({
      player, min: 1, max: 1, options: [10, 20], description: toSerializedTranslation("common.empty"),
      reason: "death" as const, skippable: false, canUseOnBoardSelection: false,
    })));
    const runner = new BotRunner(game, game.players.map(player => ({ playerId: player.id, level: "normal" })), { policy: fallbackBotDecision });
    try {
      runner.start();
      const result = await promise;
      expect(result.map(answer => answer.playerId).sort()).toEqual(game.players.map(player => player.id).sort());
      expect(result.every(answer => answer.selected[0] === 10)).toBe(true);
      expect(game.pendingMultipleSelections.size).toBe(0);
      expect(runner.diagnostics).toEqual([]);
    } finally { runner.stop(); }
  });

  it("parks after a native failure following a real mutation, without retrying or ending the turn", async () => {
    const game = createNativeBotGame("runner-native-fault");
    await game.atGameStartDecisions();
    const player = game.currentPlayer;
    const count = player.hand.length;
    const resolve = game.actions.resolveStack.bind(game.actions);
    let calls = 0;
    game.actions.resolveStack = async () => {
      calls++;
      await resolve();
      throw new Error("Injected failure after native loot-step mutation");
    };
    let observed!: () => void;
    const failed = new Promise<void>(resolve => { observed = resolve; });
    const runner = new BotRunner(game, [{ playerId: player.id, level: "easy" }], {
      policy: fallbackBotDecision, onError: observed,
    });
    try {
      runner.start();
      await failed;
      game.dispatch();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(player.hand.length).toBe(count + 1);
      expect(calls).toBe(1);
      expect(game.log.filter(entry => entry.type === "EndTurn")).toHaveLength(0);
      expect(game.currentPlayer).toBe(player);
      expect(runner.diagnostics).toEqual([{ phase: "native", playerId: player.id }]);
    } finally { runner.stop(); game.actions.resolveStack = resolve; }
  });

  it("waits for the real resolve cooldown without polling the strategy", async () => {
    const game = createNativeBotGame("runner-cooldown");
    await game.atGameStartDecisions();
    const player = game.currentPlayer;
    player.character.charged = false;
    player.inPlay.forEach(card => { card.charged = false; });
    game.gameParameters.resolveCooldown.value = 1;
    game.assert.lastTimedAction = Date.now() - 950;
    const count = player.hand.length;
    let calls = 0;
    const runner = new BotRunner(game, [{ playerId: player.id, level: "normal" }], {
      policy: input => { calls++; return fallbackBotDecision(input); },
    });
    try {
      const progressed = waitForState(game, () => player.hand.length > count);
      runner.start();
      await progressed;
      expect(calls).toBeLessThanOrEqual(3);
      expect(runner.diagnostics).toEqual([]);
    } finally { runner.stop(); }
  });

  it("advances the policy RNG between action and targets and honors stop before execution", async () => {
    const game = createNativeBotGame("runner-target-seed");
    await game.atGameStartDecisions();
    while (!game.stack.isEmpty()) await executeBotCommand(game, game.currentPlayer, { type: "resolve" });
    const card = game.obtainCard("b2-xi_strength");
    if (!(card instanceof LootCard)) throw new Error("Missing Strength");
    game.cardHandler.addCardToHand(game.currentPlayer, card);
    let targetState: number | undefined;
    let finish!: () => void;
    const observed = new Promise<void>(resolve => { finish = resolve; });
    const runner = new BotRunner(game, [{ playerId: game.currentPlayer.id, level: "normal", seed: 77 }], {
      policy: input => {
        if (input.selection) {
          targetState = input.randomState;
          return { ...fallbackBotDecision(input), randomState: 200 };
        }
        return { kind: "action", index: input.actions.findIndex(option => option.source?.globalId === card.globalId), randomState: 100, reason: "test-target-rng" };
      },
      onDecision: (_input, decision) => {
        expect(decision.randomState).toBe(200);
        runner.stop();
        finish();
      },
    });
    try {
      runner.start();
      await observed;
      expect(targetState).toBe(100);
      expect(game.currentPlayer.hand.cards.includes(card)).toBe(true);
      expect(runner.actionCount).toBe(0);
      expect(runner.diagnostics).toEqual([]);
    } finally { runner.stop(); }
  });
});
