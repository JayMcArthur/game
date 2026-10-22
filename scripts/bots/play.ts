import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { playBotGame } from "../../src/bots/simulation";
import type { BotLevel } from "../../src/shared/api";

const args = process.argv.slice(2);
const flags = new Map<string, string>();
try {
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]!;
    if (!["--seed", "--levels", "--output", "--max-actions"].includes(name) || flags.has(name) || !args[index + 1])
      throw new Error("Invalid campaign arguments");
    flags.set(name, args[index + 1]!);
  }
  const seed = flags.get("--seed");
  const outputFlag = flags.get("--output");
  const levels = flags.get("--levels")?.split(",");
  const maxActions = Number(flags.get("--max-actions") ?? 10000);
  if (!seed || !outputFlag || !levels || levels.length < 2 || levels.length > 4 ||
    levels.some(level => !["easy", "normal", "hard"].includes(level)) || !Number.isInteger(maxActions) || maxActions < 1 || maxActions > 100000)
    throw new Error("Invalid campaign arguments");
  const output = resolve(outputFlag);
  // Keep runs separate so previous failure evidence survives.
  await mkdir(output, { mode: 0o700 });
  const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
  try {
    const result = await playBotGame({ seed, levels: levels as BotLevel[], maxActions,
      onProgress: progress => {
        process.stderr.write(`${JSON.stringify(progress)}\n`);
      },
    });
    await writeFile(resolve(output, "game.log.json"), JSON.stringify(result.game.log), { mode: 0o600, flag: "wx" });
    await writeFile(resolve(output, "result.json"), JSON.stringify({ source, dirty, ...result.report }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    process.stdout.write(JSON.stringify({ source, ...result.report }) + "\n");
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error("Campaign failed");
    const log = "gameLog" in error ? error.gameLog : undefined;
    await writeFile(resolve(output, "failure.json"), JSON.stringify({ source, dirty, error, log }, (_key, value: unknown) =>
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause } : value,
    2) + "\n", { mode: 0o600, flag: "wx" });
    process.stderr.write("Bot game failed; private failure.json retains the history.\n");
    process.exitCode = 1;
  }
} catch {
  process.stderr.write("Usage: bun scripts/bots/play.ts --seed SEED --levels normal,hard --output NEW_DIRECTORY [--max-actions 10000]\n");
  process.exitCode = 2;
}
