import { describe, expect, it } from "bun:test";
import { playBotGame } from "@/bots/simulation";
import type { BotLevel } from "@/shared/api";
import { loadGameFromLogs } from "@/utils/loadGameFromLogs";

describe("complete native TS bot games", () => {
  const cases: BotLevel[][] = [["easy", "easy"], ["normal", "normal"], ["hard", "hard"], ["normal", "hard", "easy"], ["normal", "hard", "easy", "normal"]];
  for (const levels of cases) {
    it(`${levels.join("/")} reaches a genuine four-soul victory and replays its saved history`, async () => {
      const result = await playBotGame({ seed: `ts-bot-acceptance-${levels.join("-")}`, levels, maxActions: 10000, timeoutMs: 120000 });
      expect(result.report.diagnostics).toEqual([]);
      expect(result.game.reachedEnd).toBe(true);
      expect(result.report.souls.some(player => player.souls >= 4)).toBe(true);
      expect(result.report.actions).toBeGreaterThan(10);
      const replay = await loadGameFromLogs(JSON.parse(JSON.stringify(result.game.log)));
      expect(replay.reachedEnd).toBe(true);
      expect(replay.players.map(player => ({ player: player.id, souls: player.totalSouls }))).toEqual(result.report.souls);
    }, 180000);
  }
});
