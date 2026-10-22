import { z } from "zod";
import type { Card, Player, SelectionItem } from "@/shared/api";
import type { BotActionOption, BotDecision, BotInput } from "./types";
import defaults from "./default-playbooks.json";

const common = {
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/),
  version: z.number().int().min(1).max(1_000_000),
  enabled: z.boolean(),
  levels: z.array(z.enum(["normal", "hard"])).min(1).max(2)
    .refine(levels => new Set(levels).size === levels.length, "Duplicate level"),
  minimumBenefit: z.number().min(0).max(1000),
};

export const BotPlaybookDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  rules: z.array(z.discriminatedUnion("pattern", [
    z.object({ ...common, pattern: z.literal("self-strength"), sourceSlug: z.literal("b2-xi_strength") }).strict(),
    z.object({ ...common, pattern: z.literal("hostile-death"), sourceSlug: z.literal("b2-xiii_death") }).strict(),
    z.object({ ...common, pattern: z.literal("hostile-steal"), sourceSlug: z.literal("b2-pay_to_play") }).strict(),
    z.object({ ...common, pattern: z.literal("beneficial-bomb"), sourceSlug: z.enum(["b2-bomb", "b2-bomb-2", "b2-bomb-3", "b2-bomb-4"]) }).strict(),
    z.object({ ...common, pattern: z.literal("copy-coin-loot"), sourceSlug: z.literal("b2-blank_card") }).strict(),
  ])).max(64),
}).strict().refine(document => new Set(document.rules.map(rule => rule.id)).size === document.rules.length, "Duplicate rule ID");

export type BotPlaybookDocument = z.infer<typeof BotPlaybookDocumentSchema>;
type Rule = BotPlaybookDocument["rules"][number];

export function loadBotPlaybooks(value: unknown): BotPlaybookDocument {
  return BotPlaybookDocumentSchema.parse(value);
}

export function parseBotPlaybooksJson(text: string): BotPlaybookDocument {
  if (text.length > 65_536) throw new Error("Bot playbooks exceed 65536 characters");
  return loadBotPlaybooks(JSON.parse(text));
}

export const DEFAULT_BOT_PLAYBOOKS = loadBotPlaybooks(defaults);

export function coinLootValue(slug: string): number {
  if (["b2-a_penny", "b2-a_penny_2", "b2-a_penny_3", "b2-a_penny_4", "b2-a_penny_5", "b2-a_penny_6"].includes(slug)) return 1;
  if (["b2-a_nickel", "b2-a_nickel-2", "b2-a_nickel-3", "b2-a_nickel-4", "b2-a_nickel-5"].includes(slug)) return 5;
  return slug === "b2-a_dime" ? 10 : 0;
}

export function cardValue(card: Card): number {
  return coinLootValue(card.slug) || 8;
}

function playerForSelection(input: BotInput, option: SelectionItem): Player | undefined {
  if (option.type !== "player" && option.type !== "card") return undefined;
  const globalId = option.payload.globalId;
  return [input.state.me, ...input.state.players].find(player =>
    option.type === "player"
      ? player.character?.globalId === globalId
      : player.inPlay.some(card => card.globalId === globalId)
  );
}

function isAlly(input: BotInput, player: Player): boolean {
  return player.name === input.state.me.name || player.team === input.state.me.team;
}

function deathBenefit(player: Player): number {
  if ((player.character?.stats.healthPoints ?? 0) <= 0) return 0;
  return Math.min(player.coins, 1) + (player.handSize > 0 ? 2 : 0)
    + (player.inPlay.some(card => !card.eternal) ? 5 : 0);
}

function targetBenefit(input: BotInput, rule: Rule, option: SelectionItem): number {
  const player = playerForSelection(input, option);
  switch (rule.pattern) {
    case "self-strength":
      return player?.name === input.state.me.name && input.state.turn === player.name ? 3 : -1;
    case "hostile-death":
      return player && !isAlly(input, player) ? deathBenefit(player) : -1;
    case "hostile-steal":
      return option.type === "card" && player && !isAlly(input, player)
        && player.inPlay.some(card => card.globalId === option.payload.globalId && !card.eternal)
        ? 2 * cardValue(option.payload) - 10 : -1;
    case "beneficial-bomb": {
      if (option.type === "monster" && input.state.turn === input.state.me.name) {
        const monster = input.state.monsters.inPlay.find(slot => slot.top.globalId === option.payload.globalId)?.top;
        const hp = monster?.stats?.healthPoints;
        return hp === undefined || hp <= 0 ? 0 : hp <= 1 ? 12 : 0.75;
      }
      return option.type === "player" && player && !isAlly(input, player)
        ? (player.character?.stats.healthPoints ?? 0) === 1 ? deathBenefit(player) : 0.5 : -1;
    }
    case "copy-coin-loot":
      return 0;
  }
}

function matchesEffect(rule: Rule, index: number | "tap" | undefined): boolean {
  return index === (rule.pattern === "hostile-steal" ? 0 : "tap");
}

/** Estimates placement benefit; native selectors determine legal targets. */
export function playbookActionValue(input: BotInput, option: BotActionOption, document: BotPlaybookDocument): number | undefined {
  if (input.level === "easy" || option.command.type !== "activate" || !option.source || option.source.parent) return undefined;
  const level = input.level;
  const source = option.source;
  const command = option.command.payload;
  const rule = document.rules.find(rule => rule.enabled && rule.levels.includes(level)
    && rule.sourceSlug === source.slug && matchesEffect(rule, command.effectIndex));
  if (!rule || rule.pattern === "copy-coin-loot") return undefined;
  const players = [input.state.me, ...input.state.players];
  let candidates: SelectionItem[];
  if (rule.pattern === "hostile-steal") {
    candidates = players.flatMap(player => player.inPlay.map(payload => ({ type: "card" as const, payload })));
  } else {
    candidates = players.flatMap(player => player.character ? [{
      type: "player" as const, payload: { ...player.character, type: "player" as const, color: player.color },
    }] : []);
    if (rule.pattern === "beneficial-bomb") candidates.push(...input.state.monsters.inPlay.map(({ top }) => ({
      type: "monster" as const, payload: { ...top, type: "monster" as const, color: "" },
    })));
  }
  const benefit = Math.max(0, ...candidates.map(candidate => targetBenefit(input, rule, candidate)));
  if (benefit <= 0 || benefit < rule.minimumBenefit) return -1;
  return benefit - (command.type === "hand" ? 1 : 0);
}

// Adapted from four_souls/packages/bots/src/playbooks.ts and opponentPreference.ts.
export function applyBotPlaybooks(
  input: BotInput,
  baseline: BotDecision,
  document: BotPlaybookDocument,
  pick: (length: number) => number,
): BotDecision {
  if (input.level === "easy") return baseline;
  for (const rule of document.rules) {
    if (!rule.enabled || !rule.levels.includes(input.level)) continue;
    if (rule.pattern === "copy-coin-loot") {
      const index = copyPreparation(input, baseline, rule);
      if (index !== undefined) return { ...baseline, kind: "action", index, reason: `${rule.id}@${rule.version}` };
      continue;
    }
    const selection = input.selection;
    if (!selection || baseline.kind !== "selection" || selection.sourceSlug !== rule.sourceSlug
      || selection.purpose !== "activation" || !matchesEffect(rule, selection.sourceEffectIndex)
      || selection.max !== 1 || selection.min > 1 || selection.options.length === 0) continue;
    let candidates = selection.options.map((option, index) => ({
      index, player: playerForSelection(input, option), value: targetBenefit(input, rule, option),
    })).filter(candidate => candidate.value > 0 && candidate.value >= rule.minimumBenefit);
    if (!candidates.length) {
      if (selection.min === 0) return { ...baseline, indexes: [], reason: `${rule.id}@${rule.version}` };
      // Reject harmful targets before execution so the runner can choose legal progress.
      throw new Error(`No beneficial offered target for ${rule.id}`);
    }
    const hostilePlayers = candidates.filter(candidate => candidate.player);
    const bestOther = Math.max(-Infinity, ...candidates.filter(candidate => !candidate.player).map(candidate => candidate.value));
    const preferLeader = rule.pattern === "hostile-death" || rule.pattern === "hostile-steal"
      || (rule.pattern === "beneficial-bomb" && Math.max(...hostilePlayers.map(candidate => candidate.value)) >= bestOther);
    if (input.level === "hard" && preferLeader && hostilePlayers.length) {
      // One lottery entry per eligible opponent, independent of how many items they own.
      const players = [...new Set(candidates.flatMap(candidate => candidate.player ? [candidate.player] : []))];
      const highest = Math.max(...players.map(player => player.souls));
      const leaders = players.filter(player => player.souls === highest);
      const leader = leaders[pick(leaders.length)]!;
      candidates = candidates.filter(candidate => candidate.player === leader);
    }
    const best = Math.max(...candidates.map(candidate => candidate.value));
    const tied = candidates.filter(candidate => candidate.value === best);
    return { ...baseline, indexes: [tied[pick(tied.length)]!.index], reason: `${rule.id}@${rule.version}` };
  }
  return baseline;
}

function copyPreparation(input: BotInput, baseline: BotDecision, rule: Rule): number | undefined {
  if (baseline.kind !== "action" || input.state.turn !== input.state.me.name) return undefined;
  const action = input.actions[baseline.index];
  if (action?.command.type !== "activate" || action.command.payload.type !== "hand"
    || !action.source || action.source.parent || action.command.payload.effectIndex !== "tap") return undefined;
  const coins = coinLootValue(action.source.slug);
  if (coins <= 0 || coins < rule.minimumBenefit) return undefined;
  if (input.state.me.character?.stats.temporaryEffect.some(effect => effect.card.slug === rule.sourceSlug)) return undefined;
  const pending = input.state.stack.some(entry => entry.type === "effect"
    && entry.card.slug === rule.sourceSlug && !entry.card.parent
    && entry.issuer.globalId === input.state.me.character?.globalId);
  if (pending) {
    const resolve = input.actions.findIndex(option => option.command.type === "resolve");
    return resolve < 0 ? undefined : resolve;
  }
  if (input.state.stack.length) return undefined;
  const index = input.actions.findIndex(option => option.source?.slug === rule.sourceSlug
    && !option.source.parent && option.command.type === "activate"
    && option.command.payload.type === "inPlay" && option.command.payload.effectIndex === "tap");
  return index < 0 ? undefined : index;
}
