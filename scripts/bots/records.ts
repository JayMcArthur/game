import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const LIMIT = 64 * 1024 * 1024;
class IntakeError extends Error {
  constructor(readonly stage: string) { super(`Invalid bot-record request (${stage}).`); }
}
function argumentsFor(argv: string[]) {
  const command = argv[0];
  if (command !== "capture" && command !== "check") throw new IntakeError("arguments");
  const required = command === "capture" ? ["log", "entry", "actor", "level", "random-state", "producing-commit", "expect", "out"] : ["log", "case", "out"];
  const allowed = new Set([...required, "playbooks", ...(command === "capture" ? ["turn-actions"] : [])]);
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (!argv[i]?.startsWith("--") || !key || !allowed.has(key) || flags[key] !== undefined || !value || value.startsWith("--")) throw new IntakeError("arguments");
    flags[key] = value;
  }
  if (required.some(key => !flags[key])) throw new IntakeError("arguments");
  return { command, flags };
}
function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new IntakeError("build");
  return result.stdout.toString().trim();
}
function outsideCheckout(file: string, root: string): string {
  const resolved = path.resolve(file);
  const relative = path.relative(root, resolved);
  if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) throw new IntakeError("input");
  return resolved;
}
function readPrivate(file: string, root: string): string {
  const resolved = outsideCheckout(file, root);
  const real = fs.realpathSync(resolved);
  outsideCheckout(real, root);
  if ((fs.statSync(path.dirname(real)).mode & 0o077) !== 0) throw new IntakeError("input");
  const fd = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > LIMIT) throw new IntakeError("input");
    return fs.readFileSync(fd, "utf8");
  } finally { fs.closeSync(fd); }
}
function writePrivate(file: string, value: unknown, root: string): void {
  const resolved = outsideCheckout(file, root);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  outsideCheckout(fs.realpathSync(path.dirname(resolved)), root);
  if ((fs.statSync(path.dirname(resolved)).mode & 0o077) !== 0) throw new IntakeError("output");
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}
function inventory(commit: string, paths: string[]): string {
  const result = Bun.spawnSync(["git", "ls-tree", "-r", "-z", commit, "--", ...paths], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0 || result.stdout.length === 0) throw new IntakeError("build");
  return createHash("sha256").update(result.stdout).digest("hex");
}
function buildIdentity(root: string, producingCommit: string) {
  if (!/^[a-f0-9]{40}$/.test(producingCommit) || git("status", "--porcelain", "--untracked-files=no") || git("ls-files", "--others", "--exclude-standard", "--", "src", "scripts/bots")) throw new IntakeError("build");
  const commit = git("rev-parse", "HEAD");
  const mechanics = ["src/models", "src/shared", "src/types", "src/utils", "package.json", "bun.lock", "tsconfig.json"];
  const mechanicsSha256 = inventory(commit, mechanics);
  if (inventory(producingCommit, mechanics) !== mechanicsSha256) throw new IntakeError("build");
  const hash = createHash("sha256").update(`FORBIDDEN_PREFIXES=${process.env.FORBIDDEN_PREFIXES ?? ""}\0`);
  let count = 0;
  function walk(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new IntakeError("build");
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) { hash.update(path.relative(root, file)); hash.update("\0"); hash.update(fs.readFileSync(file)); count++; }
    }
  }
  walk(path.join(root, "data"));
  if (!count) throw new IntakeError("build");
  return {
    source: { commit, tree: git("rev-parse", "HEAD^{tree}") },
    build: { mechanicsSha256, adapterSha256: inventory(commit, ["src/bots/host.ts", "src/bots/types.ts"]), contentSha256: hash.digest("hex") },
  };
}
function integer(value: string | undefined, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) throw new IntakeError("arguments");
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new IntakeError("arguments");
  return result;
}

/** Standalone process boundary: native replay diagnostics never print private inputs. */
export async function runRecordCli(argv: string[]): Promise<{ exitCode: 0 | 1; message: string }> {
  const { command, flags } = argumentsFor(argv);
  if (command === "capture" && (!["easy", "normal", "hard"].includes(flags.level!) || integer(flags["random-state"]) > 0xffffffff || !/^[a-f0-9]{40}$/.test(flags["producing-commit"]!))) throw new IntakeError("arguments");
  if (command === "capture") { integer(flags.entry); integer(flags["turn-actions"], 0); }
  let stage = "input";
  const original = { log: console.log, warn: console.warn, error: console.error };
  try {
    const root = git("rev-parse", "--show-toplevel");
    const logText = readPrivate(flags.log!, root);
    const stored = command === "check" ? JSON.parse(readPrivate(flags.case!, root)) : undefined;
    const expectation = command === "capture" ? JSON.parse(readPrivate(flags.expect!, root)) : undefined;
    const playbookText = flags.playbooks ? readPrivate(flags.playbooks, root) : undefined;
    stage = "build";
    const identity = buildIdentity(root, command === "capture" ? flags["producing-commit"]! : stored?.producingCommit);
    // Game loading has legacy console diagnostics. This dedicated CLI owns its
    // process; suppress them while importing/replaying, and restore in finally.
    console.log = console.warn = console.error = () => {};
    stage = "replay";
    const records = await import("../../src/bots/records");
    const configuration = playbookText === undefined ? undefined : (await import("../../src/bots/playbooks")).parseBotPlaybooksJson(playbookText);
    const value = command === "capture" ? await records.captureBotRecordCase({
      logText, entry: integer(flags.entry), actor: flags.actor!, producingCommit: flags["producing-commit"]!,
      ...identity, level: flags.level as "easy" | "normal" | "hard", randomState: integer(flags["random-state"]), turnActions: integer(flags["turn-actions"], 0), expectation, configuration,
    }) : await records.checkBotRecordCase({ logText, decisionCase: stored, ...identity, configuration });
    stage = "output";
    writePrivate(flags.out!, value, root);
    const failed = "passed" in value && !value.passed;
    return { exitCode: failed ? 1 : 0, message: `${command === "capture" ? "CAPTURED" : failed ? "FAIL" : "PASS"} case=${records.sha256(records.canonicalJson(command === "capture" ? value : stored))}` };
  } catch { throw new IntakeError(stage); }
  finally { Object.assign(console, original); }
}
if (import.meta.main) {
  try {
    const result = await runRecordCli(Bun.argv.slice(2));
    console.log(result.message);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof IntakeError ? error.message : "Invalid bot-record request.");
    process.exitCode = 2;
  }
}
