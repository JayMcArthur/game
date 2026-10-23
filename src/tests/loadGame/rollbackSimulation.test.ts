import { ActionType, Bot } from "@/models/bots";
import type { Player } from "@/models/entities/player";
import { Game } from "@/models/game";
import { GameParameters } from "@/models/gameParameters";
import { TargetBuilder } from "@/models/targetBuilder";
import * as helper from "@/utils/gameRequestHelpers";
import { loadGameFromLogs } from "@/utils/loadGameFromLogs";
import { afterEach, describe, expect, it } from "bun:test";

/**
 * Plays random games the way the server does: every action goes through the logged request helpers,
 * selections are answered as separate requests, and the event loop goes idle between requests.
 * Rollbacks are performed along the way, saves taken while a selection is pending must load,
 * and the saved log must load at the end.
 * A replay that diverges from the live game shows up as a failed rollback or load.
 */

const seedrandom = require("seedrandom");

const SEEDS = ["rollback-0", "rollback-1", "rollback-2", "rollback-3"];
const STEPS = 300;
const ROLLBACK_PROBABILITY = 0.03;
const SAVE_DURING_PROMPT_PROBABILITY = 0.1;

const originalMathRandom = Math.random;
const originalRandomUUID = crypto.randomUUID;
const originalConsole = { log: console.log, warn: console.warn, error: console.error };

// Let chained timers (e.g. the loot step's setTimeout) drain, as when players take time between requests.
const idle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function silenceConsole(): void {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}

function restoreConsole(): void {
  Object.assign(console, originalConsole);
}

async function simulate(seed: string, sharedUser: boolean): Promise<{ rollbacks: number; savesDuringPrompt: number }> {
  const rng: () => number = seedrandom(seed);
  const uuidRng: () => number = seedrandom(`${seed}-uuid`);
  // Rollbacks reseed the game with a random UUID: make it reproducible.
  crypto.randomUUID = (() => `uuid-${Math.floor(uuidRng() * 1e12).toString(36)}`) as typeof crypto.randomUUID;
  // TargetBuilder.buildRandomValidTargets draws from Math.random.
  Math.random = rng;
  const pick = <T>(array: T[]): T => array[Math.floor(rng() * array.length)]!;

  const params = new GameParameters(() => {});
  params.setParameterByKey("playWithRooms", true);
  let game = new Game("", params);
  const players = ["A", "B", "C"].map((id, index) => ({
    issuer: id,
    character: "random",
    // Two players on the same user, as with local copies of a player.
    user: sharedUser && index < 2 ? "shared-user" : `user-${id}`,
    team: index + 1,
  }));
  game.startOfGameSetup(players);
  game.addToHistory({ type: "Start", players, params: params.toJson() });
  const ignoreRejection = (promise: Promise<unknown>) => void promise.catch(() => {});
  ignoreRejection(game.atGameStartDecisions());
  await idle();

  let rollbacks = 0;
  let savesDuringPrompt = 0;
  for (let step = 0; step < STEPS && !game.reachedEnd; step++) {
    if (step > 5 && rng() < ROLLBACK_PROBABILITY) {
      const logs = game["_historicHandler"].rollbackLog;
      try {
        game = await loadGameFromLogs(logs);
      } catch (error) {
        throw new Error(`Rollback failed at step ${step} (seed ${seed}): ${(error as Error).message}`);
      }
      rollbacks++;
      await idle();
      continue;
    }

    const pending = [...game.pendingMultipleSelections.values()];
    if (pending.length > 0) {
      if (rng() < SAVE_DURING_PROMPT_PROBABILITY) {
        try {
          await loadGameFromLogs(game.saveLog);
        } catch (error) {
          throw new Error(`Game saved during a prompt failed to load at step ${step} (seed ${seed}): ${(error as Error).message}`);
        }
        savesDuringPrompt++;
      }
      const selection = pick(pending);
      const count = selection.min + Math.floor(rng() * (Math.min(selection.max, selection.options.length) - selection.min + 1));
      const chosen = [...selection.options].sort(() => rng() - 0.5).slice(0, Math.max(0, count));
      try {
        helper.executeSubmitSelectionRequest(
          game,
          { requestId: selection.requestId, selections: TargetBuilder.convertToSelectionItems(chosen) },
          game.entityHandler.getPlayerById(selection.playerId),
        );
      } catch {}
      await idle();
      continue;
    }

    const me: Player = rng() < 0.85 ? game.currentPlayer : pick(game.players);
    let actions: any[] = [];
    try {
      actions = new Bot(game, me).playableActions;
    } catch {}
    if (actions.length === 0) {
      await idle();
      continue;
    }
    try {
      await sendRandomRequest(game, me, pick(actions), rng, pick, sharedUser, ignoreRejection);
    } catch {}
    await idle();
  }

  try {
    await loadGameFromLogs(game.saveLog);
  } catch (error) {
    throw new Error(`Saved game failed to load (seed ${seed}): ${(error as Error).message}`);
  }
  return { rollbacks, savesDuringPrompt };
}

/** Sends one request through the same helpers as the socket endpoints. Requests that may wait for a selection are not awaited. */
async function sendRandomRequest(
  game: Game,
  me: Player,
  action: any,
  rng: () => number,
  pick: <T>(array: T[]) => T,
  sharedUser: boolean,
  ignoreRejection: (promise: Promise<unknown>) => void,
): Promise<void> {
  const extra = rng();
  if (extra < 0.04 && game.stack.elements.length >= 2) {
    const element = pick(game.stack.elements);
    const target = rng() < 0.3 ? "start" : pick(game.stack.elements).stackId;
    helper.executeInsertStackElementBeforeRequest(game, { elementToMoveStackId: element.stackId, targetStackId: target }, me);
    return;
  }
  if (extra < 0.06) {
    const target = pick(game.players.filter((player) => player !== me));
    ignoreRejection(helper.executeGiveCoinsRequest(game, { target: target.id, coins: 1 }, me));
    return;
  }

  switch (action.type) {
    case ActionType.RESOLVE_STACK: {
      const issuer = sharedUser && rng() < 0.5
        ? pick(game.players.filter((player) => player.user === game.currentPlayer.user))
        : me;
      ignoreRejection(helper.executeResolveRequest(game, issuer));
      return;
    }
    case ActionType.END_TURN:
      ignoreRejection(helper.executeEndTurnRequest(game, me));
      return;
    case ActionType.DECLARE_ATTACK:
      helper.executeDeclareAttackRequest(game, me);
      return;
    case ActionType.ROLL:
      helper.executeAttackRollRequest(game, me);
      return;
    case ActionType.DECLARE_PURCHASE:
      helper.executeDeclarePurchaseRequest(game, me);
      return;
    case ActionType.CANCEL_PURCHASE:
      helper.executeCancelPurchaseRequest(game, me);
      return;
    case ActionType.PURCHASE: {
      const index = rng() < 0.3 ? "top" : Math.floor(rng() * game.shop._slots.length);
      helper.executePurchaseRequest(game, { index }, me);
      return;
    }
    case ActionType.ATTACK: {
      const target = action._target;
      const payload = target === "topDeck"
        ? { card: "top" as const, toCoverIndex: Math.floor(rng() * game.encounters.slots.length) }
        : { card: { globalId: target.card.globalId } as any };
      ignoreRejection(helper.executeAttackMonsterRequest(game, payload, me));
      return;
    }
    case ActionType.PLAY_LOOT:
    case ActionType.USE_ITEM: {
      const where = action.type === ActionType.PLAY_LOOT ? "hand" : "inPlay";
      const card = where === "hand" ? me.hand.cards[action._index] : action.item;
      const targets = TargetBuilder.buildRandomValidTargets(game, me, card, where);
      if (typeof targets === "string") return;
      const index = where === "hand" ? action._index : me.inPlay.indexOf(card);
      ignoreRejection(helper.executeActivateRequest(
        game,
        { type: where, index, effectIndex: targets.index, targetChoices: TargetBuilder.convertToSelectionItems(targets.targets) },
        me,
      ));
      return;
    }
  }
}

describe("Rollback and save on simulated games", () => {
  afterEach(() => {
    Math.random = originalMathRandom;
    crypto.randomUUID = originalRandomUUID;
    restoreConsole();
  });

  for (const [index, seed] of SEEDS.entries()) {
    it(`replays every rollback and the final save (${seed})`, async () => {
      silenceConsole();
      const { rollbacks, savesDuringPrompt } = await simulate(seed, index % 2 === 1);
      restoreConsole();
      expect(rollbacks).toBeGreaterThan(0);
      expect(savesDuringPrompt).toBeGreaterThan(0);
    }, 120_000);
  }
});
