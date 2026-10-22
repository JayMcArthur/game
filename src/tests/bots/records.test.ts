import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Game } from "@/models/game";
import { Team } from "@/shared/api";
import { executeDeclareAttackRequest, executeResolveRequest } from "@/utils/gameRequestHelpers";
import { BotRecordCaseSchema, canonicalJson, checkBotRecordCase, sha256, type BotRecordCase } from "@/bots/records";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ts-bot-records-"));
fs.chmodSync(directory, 0o700);
const script = path.resolve("scripts/bots/records.ts");
const logFile = path.join(directory, "native.log.json");
const caseFile = path.join(directory, "case.json");
let logText: string;
let decisionCase: BotRecordCase;
let attackLog: string;
let attackCase: BotRecordCase;
function write(name: string, value: unknown) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  return file;
}
async function cli(args: string[]) {
  const process = Bun.spawn([Bun.argv[0]!, script, ...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  return { exitCode, stdout, stderr };
}
const review = { reason: "Any currently offered ordinary command is an acceptable baseline for this native intake witness", anyOf: ["declareAttack", "declarePurchase", "cancelPurchase", "attackRoll", "resolve", "endTurn", "attackMonster", "purchase", "activate"].map(type => ({ type })), noneOf: [] };
beforeAll(async () => {
  const game = new Game("records-native-private-seed");
  game.gameParameters.setParameterByKey("miniDraft", false);
  game.gameParameters.setParameterByKey("resolveCooldown", 0);
  const players = [
    { issuer: "Alice", character: "b2-isaac", team: Team.Team1 },
    { issuer: "Bob", character: "b2-maggy", team: Team.Team2 },
  ];
  await game.start(players);
  game.addToHistory({ type: "Start", players, params: game.gameParameters.toJson() });
  await executeResolveRequest(game, game.currentPlayer);
  logText = JSON.stringify(game.log);
  fs.writeFileSync(logFile, logText, { mode: 0o600 });
  const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
  const captured = await cli(["capture", "--log", logFile, "--entry", String(game.log.length), "--actor", game.currentPlayer.id, "--level", "normal", "--random-state", "1234", "--producing-commit", commit, "--expect", write("expect.json", review), "--out", caseFile]);
  expect(captured.exitCode, captured.stderr).toBe(0);
  expect(captured.stdout).toMatch(/^CAPTURED case=[a-f0-9]{64}\n$/);
  decisionCase = BotRecordCaseSchema.parse(JSON.parse(fs.readFileSync(caseFile, "utf8")));
  executeDeclareAttackRequest(game, game.currentPlayer);
  attackLog = JSON.stringify(game.log);
  const attackFile = write("attack.log.json", JSON.parse(attackLog));
  const attackOutput = path.join(directory, "attack-case.json");
  const attack = await cli(["capture", "--log", attackFile, "--entry", String(game.log.length), "--actor", game.currentPlayer.id, "--level", "normal", "--random-state", "1234", "--turn-actions", "32", "--producing-commit", commit, "--expect", write("attack-expect.json", { reason: "Complete the native declared attack using a real offered target", anyOf: [{ type: "attackMonster" }], noneOf: [] }), "--out", attackOutput]);
  expect(attack.exitCode, attack.stderr).toBe(0);
  attackCase = BotRecordCaseSchema.parse(JSON.parse(fs.readFileSync(attackOutput, "utf8")));
}, 30000);
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
function check(value: unknown = decisionCase) {
  return checkBotRecordCase({ logText, decisionCase: value, source: decisionCase.captureSource, build: decisionCase.replayBuild });
}

describe("TS native log decision intake", () => {
  test("replays a real native log into actor-only input without raw seed or other hands", async () => {
    const input = decisionCase.input as { state: { me: { name: string; hand: unknown[] }; players: object[] }; actions: unknown[] };
    expect(input.state.me.name).toBe(decisionCase.actor);
    expect(input.actions.length).toBeGreaterThan(0);
    expect(input.state.players.every(player => !("hand" in player))).toBe(true);
    expect(JSON.stringify(decisionCase)).not.toContain("records-native-private-seed");
    expect(decisionCase).not.toHaveProperty("logText");
    const result = await check();
    expect(result.passed).toBe(true);
    expect(result.verification).toBe("native-prefix-replayed; current-offer-and-targets-validated");
    expect(fs.statSync(caseFile).mode & 0o777).toBe(0o600);
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(logFile, "utf8")).toBe(logText);
  });
  test("reviewed alternatives and forbidden commands control acceptance, not a human move", async () => {
    const selected = await check();
    const forbidden = structuredClone(decisionCase);
    forbidden.expectation = { reason: "This command is explicitly forbidden in the reviewed position", anyOf: [], noneOf: [{ type: selected.command.type }] };
    expect((await check(forbidden)).passed).toBe(false);
    const alternative = structuredClone(decisionCase);
    alternative.expectation = { reason: "Allow multiple command families", anyOf: [{ type: selected.command.type }, { type: selected.command.type === "endTurn" ? "declareAttack" : "endTurn" }], noneOf: [] };
    expect((await check(alternative)).passed).toBe(true);
    expect((await check(alternative)).caseSha256).not.toBe(selected.caseSha256);
  });
  test("reviews a real native declared attack target, accepting its identity and rejecting a different one", async () => {
    const run = (value: unknown) => checkBotRecordCase({ logText: attackLog, decisionCase: value, source: attackCase.captureSource, build: attackCase.replayBuild });
    const selected = await run(attackCase);
    expect(selected.command.type).toBe("attackMonster");
    if (selected.command.type !== "attackMonster") throw new Error("Expected a native declared attack target");
    const target = selected.command.payload.card === "top" ? "top" : selected.command.payload.card.globalId;
    const exact = structuredClone(attackCase);
    exact.expectation = { reason: "Reviewed real offered native target", anyOf: [{ type: "attackMonster", target }], noneOf: [] };
    expect((await run(exact)).passed).toBe(true);
    const other = structuredClone(exact);
    other.expectation.anyOf[0]!.target = typeof target === "number" ? target + 100000 : 100000;
    expect((await run(other)).passed).toBe(false);
  });
  test("rejects altered log, actor input, mechanical, adapter and content identities", async () => {
    await expect(checkBotRecordCase({ logText: `${logText} `, decisionCase, source: decisionCase.captureSource, build: decisionCase.replayBuild })).rejects.toThrow("checksum");
    const altered = structuredClone(decisionCase);
    altered.input = {};
    await expect(check(altered)).rejects.toThrow("differs from native reconstruction");
    for (const key of ["mechanicsSha256", "adapterSha256", "contentSha256"] as const) {
      await expect(checkBotRecordCase({ logText, decisionCase, source: decisionCase.captureSource, build: { ...decisionCase.replayBuild, [key]: "0".repeat(64) } })).rejects.toThrow("identity mismatch");
    }
  });
  test("rejects unsupported setup/selection positions and wrong actor binding", async () => {
    const setup = structuredClone(decisionCase);
    const entries = JSON.parse(logText) as { type: string }[];
    setup.entry = entries.findIndex(entry => entry.type === "Start") + 1;
    await expect(check(setup)).rejects.toThrow("completed gameplay request");
    const actor = structuredClone(decisionCase);
    actor.actor = "unknown-actor";
    await expect(check(actor)).rejects.toThrow("roster");
    const internal = structuredClone(decisionCase);
    internal.entry = entries.length - 1;
    await expect(check(internal)).rejects.toThrow("ordinary decision");
  });
  test("actual CLI reports pass/failure, refuses overwrites and sanitizes malformed input", async () => {
    const report = path.join(directory, "report.json");
    const ok = await cli(["check", "--log", logFile, "--case", caseFile, "--out", report]);
    expect(ok.exitCode, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/^PASS case=[a-f0-9]{64}\n$/);
    expect((await cli(["check", "--log", logFile, "--case", caseFile, "--out", report])).exitCode).toBe(2);
    const selected = await check();
    const bad = structuredClone(decisionCase);
    bad.expectation = { reason: "Forbid selected baseline", anyOf: [], noneOf: [{ type: selected.command.type }] };
    const wrong = await cli(["check", "--log", logFile, "--case", write("wrong.json", bad), "--out", path.join(directory, "wrong-report.json")]);
    expect(wrong.exitCode).toBe(1);
    expect(wrong.stdout).toMatch(/^FAIL case=[a-f0-9]{64}\n$/);
    const marker = "PRIVATE-PARSER-MARKER";
    const malformed = path.join(directory, `${marker}.json`);
    fs.writeFileSync(malformed, `{${marker}`, { mode: 0o600 });
    const failed = await cli(["check", "--log", logFile, "--case", malformed, "--out", path.join(directory, "unused.json")]);
    expect(failed.exitCode).toBe(2);
    expect(failed.stderr).toBe("Invalid bot-record request (input).\n");
    expect(failed.stdout + failed.stderr).not.toContain(marker);
    const flags = await cli(["check", "--level", "easy"]);
    expect(flags.exitCode).toBe(2);
    expect(flags.stderr).toBe("Invalid bot-record request (arguments).\n");
  });
  test("checks an edited public JSON playbook profile against the unchanged case", async () => {
    const configuration = { schemaVersion: 1, rules: [] };
    const checked = await checkBotRecordCase({ logText, decisionCase, source: decisionCase.captureSource, build: decisionCase.replayBuild, configuration });
    expect(checked.passed).toBe(true);
    expect(checked.configurationSha256).not.toBe(decisionCase.policy.configurationSha256);
    expect(checked.caseSha256).toBe((await check()).caseSha256);
    const output = path.join(directory, "edited-profile-report.json");
    const result = await cli(["check", "--log", logFile, "--case", caseFile, "--playbooks", write("edited-profile.json", configuration), "--out", output]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, "utf8")).configurationSha256).toBe(checked.configurationSha256);
    await expect(checkBotRecordCase({ logText, decisionCase, source: decisionCase.captureSource, build: decisionCase.replayBuild, configuration: { schemaVersion: 99, rules: [] } })).rejects.toThrow();
  });
  test("canonical case hashing does not depend on object key order", async () => {
    const reordered = Object.fromEntries(Object.entries(decisionCase).reverse());
    expect((await check(reordered)).caseSha256).toBe((await check()).caseSha256);
    expect(sha256(canonicalJson(reordered))).toBe(sha256(canonicalJson(decisionCase)));
  });
});
