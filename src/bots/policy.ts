import type { SelectionItem } from "@/shared/api";
import type { BotActionOption, BotDecision, BotInput, BotPolicy } from "./types";
import { combatOdds } from "./combat";
import {
  applyBotPlaybooks,
  cardValue,
  coinLootValue,
  DEFAULT_BOT_PLAYBOOKS,
  loadBotPlaybooks,
  playbookActionValue,
  type BotPlaybookDocument,
} from "./playbooks";

/** A separate pure policy seed; never consumes Game.random or Math.random. */
export function createBotPolicy(configuration: unknown = DEFAULT_BOT_PLAYBOOKS): BotPolicy {
  const document = loadBotPlaybooks(configuration);
  return input => decide(input, document);
}

export const decideBot: BotPolicy = createBotPolicy();

function decide(input: BotInput, document: BotPlaybookDocument): BotDecision {
  if (input.version !== 1) throw new Error("Unsupported bot input version");
  let randomState = input.randomState >>> 0;
  // Mulberry32 transition from four_souls/packages/quality/src/policy.ts.
  // Copyright 2026 Jay McArthur.
  function pick(length: number): number {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let value = Math.imul(randomState ^ randomState >>> 15, randomState | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return Math.floor(((value ^ value >>> 14) >>> 0) / 0x1_0000_0000 * length);
  }
  function best(indexes: number[], score: (index: number) => number): number {
    const scores = indexes.map(index => ({ index, value: score(index) }));
    const highest = Math.max(...scores.map(candidate => candidate.value));
    const tied = scores.filter(candidate => candidate.value === highest);
    return tied[pick(tied.length)]!.index;
  }

  let baseline: BotDecision;
  let eligible: number[] = [];
  if (input.selection) {
    const selection = input.selection;
    if (!Number.isSafeInteger(selection.min) || !Number.isSafeInteger(selection.max)
      || selection.min < 0 || selection.max < selection.min || selection.min > selection.options.length)
      throw new Error("Bot selection has no admitted response");
    const available = selection.options.map((_, index) => index);
    const upper = Math.min(selection.max, available.length);
    const count = input.level === "easy" ? selection.min + pick(upper - selection.min + 1) : selection.min;
    const indexes: number[] = [];
    for (let index = 0; index < count; index++) {
      const chosen = input.level === "easy" ? available[pick(available.length)]!
        : best(available, candidate => selectionValue(input, selection.options[candidate]!));
      indexes.push(chosen);
      available.splice(available.indexOf(chosen), 1);
    }
    baseline = { kind: "selection", indexes, randomState, reason: `${input.level}-selection` };
  } else if (input.actions.length) {
    eligible = eligibleActions(input);
    const index = input.level === "easy" ? eligible[pick(eligible.length)]!
      : best(eligible, candidate => actionValue(input, input.actions[candidate]!, document));
    baseline = { kind: "action", index, randomState, reason: `${input.level}-policy` };
  } else return { kind: "wait", randomState, reason: "no-offered-decision" };

  const corrected = applyBotPlaybooks(input, baseline, document, pick);
  // Playbooks cannot bypass the pending-source or activation-budget guard.
  const decision = corrected.kind === "action" && !eligible.includes(corrected.index) ? baseline : corrected;
  return { ...decision, randomState };
}

function eligibleActions(input: BotInput): number[] {
  const allowed = input.actions.flatMap((option, index) => {
    if (option.command.type !== "activate") return [index];
    const source = option.source;
    const pending = source && input.state.stack.some(entry => "card" in entry && entry.card?.globalId === source.globalId);
    return input.turnActions >= (input.level === "easy" ? 12 : 16) || pending ? [] : [index];
  });
  // Required actions still need an offered response when there is no alternative.
  return allowed.length ? allowed : input.actions.map((_, index) => index);
}

function soulValue(input: BotInput, amount: number): number {
  const actor = input.state.me;
  const teamSouls = actor.souls + input.state.players
    .filter(player => player.name !== actor.name && player.team === actor.team)
    .reduce((sum, player) => sum + player.souls, 0);
  return amount * 24 + (amount > 0 && teamSouls + amount >= input.soulsToWin ? 160 : 0);
}

function rewardValue(input: BotInput, option: BotActionOption): number {
  const rewards = option.rewards;
  return rewards ? soulValue(input, rewards.soul) + rewards.coin + rewards.loot * 2.5 + rewards.treasure * 8 : 4;
}

function deathCost(input: BotInput): number {
  const me = input.state.me;
  return 3 + Math.min(me.coins, 1) + (me.hand.length ? 2 : 0)
    + (me.inPlay.some(card => !card.eternal) ? 8 : 0);
}

function actionValue(input: BotInput, option: BotActionOption, document: BotPlaybookDocument): number {
  switch (option.command.type) {
    case "endTurn": return 0;
    case "cancelPurchase": return 0.1;
    case "resolve": return 0.5;
    case "attackRoll": return 1;
    case "declareAttack": return input.state.stack.length ? -1 : attackDeclarationValue(input);
    case "declarePurchase": {
      const shop = input.state.treasure;
      const prices = [...(shop.deckSize > 0 ? [shop.topDeckPrice] : []), ...shop.inPlay.map(card => card.price)];
      return prices.some(price => price <= input.state.me.coins && 8 - price * 0.6 > 0) ? 0.4 : -1;
    }
    case "purchase": return 8 - (option.cost ?? input.state.treasure.topDeckPrice) * 0.6;
    case "attackMonster": {
      if (!option.combat) {
        const hp = input.state.me.character?.stats.healthPoints ?? 0;
        return input.level === "hard" && hp < 2 ? -0.5 : 0.2;
      }
      // Board effects can invalidate IID assumptions: this is a marginal estimate.
      const odds = combatOdds(option.combat, false);
      return rewardValue(input, option) * odds.winProbability - deathCost(input) * (1 - odds.winProbability)
        - (input.level === "hard" ? odds.expectedDamage * 0.75 : 0);
    }
    case "activate": {
      const correction = playbookActionValue(input, option, document);
      if (correction !== undefined) return correction;
      const card = option.source;
      const command = option.command.payload;
      if (command.type === "hand") {
        const coins = card && !card.parent ? coinLootValue(card.slug) : 0;
        if (coins) return coins;
        return option.rewards ? rewardValue(input, option) : 0.6;
      }
      if (card?.slug === "b2-blank_card" && !card.parent && command.effectIndex === "tap") return -0.1;
      // Numbered effects can charge arbitrary native payments that this view
      // cannot price. Required progress remains possible when no alternative is offered.
      if (command.effectIndex !== "tap" && !option.rewards) return -0.5;
      return (option.rewards ? rewardValue(input, option) : 0.25) - (option.cost ?? 0);
    }
  }
}

function attackDeclarationValue(input: BotInput): number {
  const actor = input.state.me.character?.stats;
  if (!actor || actor.healthPoints <= 0) return -1;
  // A visible-board approximation: native target admission still owns restrictions,
  // and this view has no public printed reward or arbitrary roll-layer projection.
  const visible = input.state.monsters.inPlay.flatMap(({ top }) => {
    const monster = top.stats;
    if (!monster || monster.capabilities.targetable !== true) return [];
    const odds = combatOdds({
      playerHp: actor.healthPoints, playerDamage: actor.attackPoints,
      monsterHp: monster.healthPoints, monsterDamage: monster.attackPoints,
      hitFaces: Math.max(0, Math.min(6, 7 - (monster.evasionPoints ?? 4))),
    }, false);
    return [4 * odds.winProbability - deathCost(input) * (1 - odds.winProbability)];
  });
  const explore = input.state.monsters.deckSize > 0
    ? input.level === "hard" && actor.healthPoints < 2 ? -0.5 : 0.2 : -1;
  return Math.max(explore, ...visible);
}

function selectionValue(input: BotInput, option: SelectionItem): number {
  const selection = input.selection!;
  if (selection.reason === "death" || selection.reason === "maxHandSize") {
    return option.type === "card" ? -cardValue(option.payload) : 0;
  }
  return 0;
}
