import { Game } from "@/models/game";
import { GameParameters } from "@/models/gameParameters";
import { Team, type BotLevel } from "@/shared/api";
import { BotRunner } from "./runner";
import { decideBot } from "./policy";
import type { BotInput } from "./types";

export interface SimulationOptions {
  seed: string;
  levels: BotLevel[];
  maxActions?: number;
  timeoutMs?: number;
  onProgress?: (progress: { actions: number; turn: number; souls: number[] }) => void;
}

/** Runs a bounded native bot-only game. */
export async function playBotGame(options: SimulationOptions) {
  if (options.levels.length < 2 || options.levels.length > 4) throw new Error("TS supports two to four players");
  const params = new GameParameters(() => {});
  // Freeze the initial evaluation catalogue; expansion-specific strategies are separate work.
  params.useFSP2Cards.value = false;
  params.useG2Cards.value = false;
  params.useRCards.value = false;
  params.playWithBonusSouls.value = false;
  params.playWithRooms.value = false;
  const game = new Game(options.seed, params);
  const characters = ["b2-isaac", "b2-maggy", "b2-cain", "b2-judas"];
  const teams = [Team.Team1, Team.Team2, Team.Team3, Team.Team4];
  const players = options.levels.map((_level, index) => ({
    issuer: `Bot ${index + 1}`, character: characters[index]!, user: `bot:simulation-${index}`, team: teams[index]!,
  }));
  game.startOfGameSetup(players);
  game.addToHistory({ type: "Start", players, params: game.gameParameters.toJson() });
  const policyTimes: number[] = [];
  let attempts = 0;
  let finish!: () => void;
  let fail!: (cause: Error) => void;
  const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const runner = new BotRunner(game, options.levels.map((level, index) => ({ playerId: players[index]!.issuer, level, seed: 12345 + index })), {
    policy: (input: BotInput) => {
      const start = performance.now();
      const decision = decideBot(input);
      policyTimes.push(performance.now() - start);
      return decision;
    },
    onError: error => fail(error),
    onDecision: () => {
      if (++attempts > (options.maxActions ?? 10_000)) {
        runner.stop();
        fail(new Error("Native bot game reached its action cap"));
      } else if (attempts % 25 === 0) {
        options.onProgress?.({ actions: runner.actionCount, turn: game.turnHandler.turnId, souls: players.map(player => game.entityHandler.getPlayerById(player.issuer).totalSouls) });
      }
    },
  });
  let timeout!: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Native bot game reached its time cap")), options.timeoutMs ?? 120_000);
  });
  const started = performance.now();
  game.onEndReached.add(finish);
  try {
    runner.start();
    // Startup can await a bot selection, so start the runner first.
    void game.atGameStartDecisions().catch(fail);
    await Promise.race([done, expired]);
    await Promise.race([runner.whenIdle(), expired]);
    if (runner.diagnostics.length) throw new Error("Native game produced a bot diagnostic");
    const winner = game.players.find(player => player.totalSouls >= game.gameParameters.nbSoulsToWin.value);
    if (!winner) throw new Error("Game ended without a soul victory");
    policyTimes.sort((a, b) => a - b);
    const percentile = (fraction: number) => policyTimes[Math.min(policyTimes.length - 1, Math.floor(policyTimes.length * fraction))] ?? 0;
    return {
      game,
      report: {
        seed: options.seed,
        levels: options.levels,
        catalogue: "base-game-v2",
        winner: winner.id,
        souls: game.players.map(player => ({ player: player.id, souls: player.totalSouls })),
        actions: runner.actionCount,
        elapsedMs: performance.now() - started,
        diagnostics: runner.diagnostics,
        policy: { calls: policyTimes.length, meanMs: policyTimes.reduce((sum, value) => sum + value, 0) / policyTimes.length, p95Ms: percentile(0.95), p99Ms: percentile(0.99) },
      },
    };
  } catch (cause) {
    // Keep the actual failing history available to a private campaign collector.
    const failure = new Error("Native bot game failed", { cause });
    Object.defineProperty(failure, "gameLog", { value: game.log });
    throw failure;
  } finally {
    runner.stop();
    clearTimeout(timeout);
    game.onEndReached.remove(finish);
  }
}
