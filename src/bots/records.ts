import { createHash } from "node:crypto";
import { z } from "zod";
import { detailedStateSchema, schemas, selectionItemSchema, Team } from "@/shared/api";
import type { HistoricEntry } from "@/models/handlers/historyHandler";
import { isStackElementJson } from "@/models/handlers/historyHandler";
import { loadGameFromLogs } from "@/utils/loadGameFromLogs";
import { completeBotActivation, createBotInput, validateBotDecision } from "@/bots/host";
import { createBotPolicy } from "@/bots/policy";
import { DEFAULT_BOT_PLAYBOOKS, loadBotPlaybooks } from "@/bots/playbooks";
import type { BotCommand, BotInput } from "@/bots/types";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Non-JSON record value");
  return result;
}
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const sourceSchema = z.object({ commit, tree: z.string().regex(/^[a-f0-9]{40}$/) }).strict();
const buildSchema = z.object({ mechanicsSha256: digest, adapterSha256: digest, contentSha256: digest }).strict();
export type RecordBuild = z.infer<typeof buildSchema>;
export type RecordSource = z.infer<typeof sourceSchema>;
const commandType = z.enum(["declareAttack", "declarePurchase", "cancelPurchase", "attackRoll", "resolve", "endTurn", "attackMonster", "purchase", "activate"]);
const patternSchema = z.object({
  type: commandType,
  sourceSlug: z.string().min(1).max(256).optional(),
  target: z.union([z.number().int().nonnegative(), z.literal("top")]).optional(),
  targetChoices: z.array(selectionItemSchema).max(64).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.target !== undefined && value.type !== "attackMonster" && value.type !== "purchase") ctx.addIssue({ code: "custom", message: "Target requires an attackMonster or purchase command" });
  if (value.targetChoices !== undefined && value.type !== "activate") ctx.addIssue({ code: "custom", message: "Target choices require an activate command" });
});
export const RecordExpectationSchema = z.object({
  reason: z.string().trim().min(1).max(2048),
  anyOf: z.array(patternSchema).max(32).default([]),
  noneOf: z.array(patternSchema).max(32).default([]),
}).strict().refine(value => value.anyOf.length + value.noneOf.length > 0, "At least one reviewed expectation is required");
export type RecordExpectation = z.infer<typeof RecordExpectationSchema>;
export const BotRecordCaseSchema = z.object({
  version: z.literal(1),
  format: z.literal("TS-Four-Souls/game.log"),
  logSha256: digest,
  entry: z.number().int().nonnegative(),
  actor: z.string().min(1).max(256),
  producingCommit: commit,
  captureSource: sourceSchema,
  replayBuild: buildSchema,
  policy: z.object({ level: z.enum(["easy", "normal", "hard"]), randomState: z.number().int().min(0).max(0xffffffff), turnActions: z.number().int().nonnegative(), configurationSha256: digest }).strict(),
  input: z.unknown(),
  expectation: RecordExpectationSchema,
}).strict();
export type BotRecordCase = z.infer<typeof BotRecordCaseSchema>;

const requestSchemas: Record<string, z.ZodType> = {
  Activate: schemas.activateRequest,
  AttackMonster: schemas.attackMonsterRequest,
  Purchase: schemas.purchaseRequest,
  GiveCoins: schemas.giveCoinsRequest,
  SubmitSelection: schemas.submitSelectionRequest,
  SetGameParameter: schemas.setGameParameterRequest,
  InsertStackElementBefore: schemas.insertStackElementBeforeRequest,
};
const ordinary = new Set(["DeclareAttack", "DeclarePurchase", "CancelPurchase", "AttackRoll", "Resolve", "EndTurn", "Activate", "AttackMonster", "Purchase", "GiveCoins", "InsertStackElementBefore"]);
const basic = z.object({ type: z.string(), private: z.boolean().optional() }).passthrough();
const issuer = z.object({ issuer: z.string().min(1).max(256) });

function parseLog(text: string): HistoricEntry[] {
  if (Buffer.byteLength(text) > 64 * 1024 * 1024) throw new Error("Native log exceeds 64 MiB");
  const entries = z.array(basic).min(1).max(100000).parse(JSON.parse(text));
  return entries as HistoricEntry[];
}
function validatePrefix(entries: HistoricEntry[], entry: number, actor: string): void {
  if (!Number.isSafeInteger(entry) || entry <= 0 || entry > entries.length) throw new Error("Unavailable decision entry");
  if (entry < entries.length) {
    const next = entries[entry]!;
    if (!(ordinary.has(next.type)) || !("issuer" in next) || next.issuer !== actor)
      throw new Error("Entry is not an ordinary decision by the selected actor");
  }
  let started = false;
  let completedAction = false;
  for (const item of entries.slice(0, entry)) {
    if (isStackElementJson(item)) continue;
    if ("private" in item && item.private) {
      switch (item.type) {
        case "randomSeed": z.string().min(1).max(4096).parse(item.seed); break;
        case "GameState": detailedStateSchema.parse(item.gameState); break;
        case "GameParameters": z.record(z.string(), z.unknown()).parse(item.gameParameters); break;
        case "character": z.string().min(1).parse(item.playerId); z.string().min(1).parse(item.slug); break;
        default: throw new Error("Unsupported private native entry");
      }
      continue;
    }
    if (item.type === "Start") {
      if (started) throw new Error("Multiple starts are unsupported");
      z.array(z.object({ issuer: z.string().min(1), character: z.string().min(1), team: z.enum(Team) })).min(2).refine(players => new Set(players.map(player => player.issuer)).size === players.length, "Duplicate roster actor").parse(item.players);
      started = true;
    } else if (item.type === "SetGameParameter") {
      if (started) throw new Error("Midgame parameter edits are unsupported");
      schemas.setGameParameterRequest.parse(item.payload);
    } else if (["Join", "Rejoin", "CreateRoom", "JoinRoom", "LeaveRoom", "IsGameOngoing"].includes(item.type)) {
      // Transport history is ignored by the native loader and never becomes policy input.
    } else if (item.type === "SubmitSelection" || ordinary.has(item.type)) {
      if (!started) throw new Error("Gameplay request precedes Start");
      issuer.parse(item);
      const schema = requestSchemas[item.type];
      if (schema) schema.parse("payload" in item ? item.payload : undefined);
      if (ordinary.has(item.type)) completedAction = true;
    } else throw new Error("Unsupported native replay entry");
  }
  // The native loader fire-and-forgets its last Start; this subset deliberately
  // requires a later fully replayed request instead of guessing readiness.
  if (!started || !completedAction) throw new Error("Unsupported prefix: a completed gameplay request after Start is required");
}
function normalizeInput(input: BotInput): BotInput {
  const result = structuredClone(input);
  result.state = detailedStateSchema.parse(result.state);
  // These are the same volatile presentation fields ignored by the native loader's comparison.
  result.state.lastStackElementTimeStamp = 0;
  result.state.animations = [];
  for (const item of [...result.state.history, ...result.state.stack])
    if ("reordering" in item && item.reordering) item.reordering.groupId = "";
  return result;
}
async function reconstruct(text: string, value: Pick<BotRecordCase, "entry" | "actor" | "policy">) {
  const entries = parseLog(text);
  validatePrefix(entries, value.entry, value.actor);
  const game = await loadGameFromLogs(entries.slice(0, value.entry));
  if (!game.isStarted || game.hasPendingSelections) throw new Error("Unsupported prefix: native selection or setup is incomplete");
  const player = game.players.find(player => player.id === value.actor);
  if (!player) throw new Error("Actor is not in the replayed roster");
  const input = normalizeInput(createBotInput(game, player.id, { level: value.policy.level, randomState: value.policy.randomState, turnActions: value.policy.turnActions }));
  if (input.selection || input.actions.length === 0) throw new Error("Unsupported prefix: actor has no quiescent action offer");
  return { game, player, input };
}
function configuration(value?: unknown) {
  return loadBotPlaybooks(value ?? DEFAULT_BOT_PLAYBOOKS);
}

export async function captureBotRecordCase(options: {
  logText: string; entry: number; actor: string; producingCommit: string;
  source: RecordSource; build: RecordBuild;
  level: BotInput["level"]; randomState: number; turnActions?: number;
  expectation: RecordExpectation; configuration?: unknown;
}): Promise<BotRecordCase> {
  const base = BotRecordCaseSchema.omit({ input: true }).parse({
    version: 1, format: "TS-Four-Souls/game.log", logSha256: sha256(options.logText),
    entry: options.entry, actor: options.actor, producingCommit: options.producingCommit,
    captureSource: options.source, replayBuild: options.build,
    policy: { level: options.level, randomState: options.randomState, turnActions: options.turnActions ?? 0, configurationSha256: sha256(canonicalJson(configuration(options.configuration))) },
    expectation: options.expectation,
  });
  return { ...base, input: (await reconstruct(options.logText, base)).input };
}
function matches(command: BotCommand, sourceSlug: string | undefined, pattern: z.infer<typeof patternSchema>): boolean {
  if (command.type !== pattern.type || (pattern.sourceSlug !== undefined && pattern.sourceSlug !== sourceSlug)) return false;
  if (pattern.target !== undefined) {
    const target = command.type === "attackMonster" ? (command.payload.card === "top" ? "top" : command.payload.card.globalId) : command.type === "purchase" ? command.payload.index : undefined;
    if (target !== pattern.target) return false;
  }
  return pattern.targetChoices === undefined || (command.type === "activate" && canonicalJson(command.payload.targetChoices ?? []) === canonicalJson(pattern.targetChoices));
}
export async function checkBotRecordCase(options: { logText: string; decisionCase: unknown; source: RecordSource; build: RecordBuild; configuration?: unknown }) {
  const value = BotRecordCaseSchema.parse(options.decisionCase);
  const source = sourceSchema.parse(options.source);
  if (value.logSha256 !== sha256(options.logText)) throw new Error("Native log checksum mismatch");
  if (canonicalJson(value.replayBuild) !== canonicalJson(buildSchema.parse(options.build))) throw new Error("Native mechanics, adapter or content identity mismatch; recapture with the matching build");
  const { game, player, input } = await reconstruct(options.logText, value);
  if (canonicalJson(value.input) !== canonicalJson(input)) throw new Error("Stored actor input differs from native reconstruction");
  const config = configuration(options.configuration);
  const policy = createBotPolicy(config);
  const decision = policy(input);
  validateBotDecision(input, decision);
  if (decision.kind !== "action") throw new Error("Policy did not choose an offered action");
  const selected = input.actions[decision.index]!;
  const completed = selected.command.type === "activate"
    ? completeBotActivation(game, player, selected.command, { ...input, randomState: decision.randomState }, policy)
    : { command: selected.command, randomState: decision.randomState };
  const passed = (value.expectation.anyOf.length === 0 || value.expectation.anyOf.some(pattern => matches(completed.command, selected.source?.slug, pattern))) && !value.expectation.noneOf.some(pattern => matches(completed.command, selected.source?.slug, pattern));
  return {
    version: 1 as const, passed, caseSha256: sha256(canonicalJson(value)), logSha256: value.logSha256,
    entry: value.entry, actor: value.actor, producingCommit: value.producingCommit,
    captureSource: value.captureSource, analysisSource: source, replayBuild: value.replayBuild,
    configurationSha256: sha256(canonicalJson(config)), command: completed.command,
    sourceSlug: selected.source?.slug, randomState: completed.randomState, reason: decision.reason,
    verification: "native-prefix-replayed; current-offer-and-targets-validated" as const,
  };
}
