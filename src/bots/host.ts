import type { Card } from "@/models/cards";
import type { Game } from "@/models/game";
import { TargetBuilder } from "@/models/targetBuilder";
import type { Player } from "@/models/entities/player";
import type { BotLevel, Requests, SelectionItem } from "@/shared/api";
import * as requests from "@/utils/gameRequestHelpers";
import type { BotActionOption, BotCommand, BotDecision, BotInput, BotPolicy } from "./types";

export interface BotInputOptions {
  level: BotLevel;
  randomState: number;
  turnActions?: number;
}

function rewards(card: Card): BotActionOption["rewards"] {
  const printed = "rewards" in card.json ? card.json.rewards : undefined;
  const amount = (key: "soul" | "coin" | "loot" | "treasure") =>
    typeof printed?.[key] === "number" ? printed[key] : 0;
  return { soul: amount("soul"), coin: amount("coin"), loot: amount("loot"), treasure: amount("treasure") };
}

export function createBotInput(game: Game, playerId: string, options: BotInputOptions): BotInput {
  const player = game.entityHandler.getPlayerById(playerId);
  const state = game.detailedStateJSON(player);
  const input: BotInput = {
    version: 1,
    state,
    soulsToWin: game.gameParameters.nbSoulsToWin.value,
    level: options.level,
    randomState: options.randomState,
    turnActions: options.turnActions ?? 0,
    actions: [],
  };
  const pending = state.me.pendingSelection;
  if (pending) {
    input.selection = {
      options: pending.options,
      min: pending.min,
      max: pending.max,
      purpose: "mandatory",
      sourceSlug: typeof pending.reason === "object" ? pending.reason.card.slug : undefined,
      reason: pending.reason === "death" || pending.reason === "maxHandSize" ? pending.reason : "other",
    };
    return input;
  }
  if (game.isGameOver || game.reachedEnd || game.pendingMultipleSelections.size > 0) return input;
  const actions = input.actions;
  const add = (command: BotCommand, extra: Omit<BotActionOption, "command"> = {}) => actions.push({ command, ...extra });
  const capabilities = state.me.capabilities;
  if (player === game.currentPlayer) {
    if (capabilities.endTurn === true) add({ type: "endTurn" });
    if (capabilities.declareAttack === true) add({ type: "declareAttack" });
    if (capabilities.declarePurchase === true) add({ type: "declarePurchase" });
    if (capabilities.rollDice === true) add({ type: "attackRoll" });
    if (capabilities.resolve === true && game.assert.canResolveNow(false) === true) add({ type: "resolve" });
    for (const entity of game.attackableEntities) {
      if (game.actions.canDeclareAttackOnEntity(player, entity, false) !== true) continue;
      const visible = [state.me.character, ...state.players.map(p => p.character),
        ...state.monsters.inPlay.map(slot => slot.top), ...state.me.inPlay,
        ...state.players.flatMap(p => p.inPlay)].find(card => card?.globalId === entity.card.globalId);
      if (!visible) continue;
      const stats = visible.stats;
      const myStats = state.me.character?.stats;
      add({ type: "attackMonster", payload: { card: entity.card.jsonAPI } }, {
        source: visible,
        rewards: rewards(entity.card),
        ...(stats && myStats ? { combat: {
          playerHp: myStats.healthPoints,
          playerDamage: myStats.attackPoints,
          monsterHp: stats.healthPoints,
          monsterDamage: stats.attackPoints,
          hitFaces: Math.max(0, Math.min(6, 7 - (stats.evasionPoints ?? 7) + player.diceModifier + player.attackDiceModifier)),
        } } : {}),
      });
    }
    if (game.actions.canDeclareAttackOnEntity(player, "topDeck", false) === true && state.monsters.deckSize + state.monsters.discard.length > 0) {
      // Every cover slot is an ordinary native target; never inspect the hidden top card.
      game.encounters._slots.forEach((slot, toCoverIndex) => {
        if (!slot.at(-1)?.indomitable) add({ type: "attackMonster", payload: { card: "top", toCoverIndex } });
      });
    }
    if (state.me.isEngagedInPurchase && game.stack.isEmpty()) {
      const shop = state.treasure;
      shop.inPlay.forEach(card => {
        const index = game.shop.itemsInShop.findIndex(item => item?.globalId === card.globalId);
        if (index < 0) return;
        if (game.actions.canPurchase(player, index, false) === true)
          add({ type: "purchase", payload: { index } }, { source: card, cost: Math.max(0, card.price) });
      });
      if (shop.deckSize + shop.discard.length > 0 && game.actions.canPurchase(player, "top", false) === true)
        add({ type: "purchase", payload: { index: "top" } }, { source: shop.firstCardTreasureDeck, cost: Math.max(0, shop.topDeckPrice) });
      // TS exposes cancellation precisely when the declared purchase cannot be paid.
      if (!actions.some(option => option.command.type === "purchase") && game.actions.canPurchase(player) !== true)
        add({ type: "cancelPurchase" });
    }
  }
  if (input.turnActions >= 32) return input;
  if (capabilities.useLoot === true) {
    state.me.hand.forEach((card, index) => {
      if (card.canBePlayed === true)
        add({ type: "activate", payload: { type: "hand", index, effectIndex: "tap" } }, { source: card });
    });
  }
  const activationSets = [
    { type: "inPlay" as const, cards: state.me.inPlay },
    { type: "character" as const, cards: state.me.character ? [state.me.character] : [] },
    { type: "room" as const, cards: state.room?.inPlay ?? [] },
  ];
  for (const set of activationSets) {
    set.cards.forEach((card, serializedIndex) => {
      // Serialized in-play also contains curses; they have no native inPlay address.
      const index = set.type === "inPlay" ? player.inPlay.findIndex(item => item.globalId === card.globalId) : serializedIndex;
      if (index < 0) return;
      if (card.capabilities.activate !== true) return;
      for (const effect of card.effects ?? []) {
        if (effect.index === "tap" && card.charged !== true) continue;
        add({ type: "activate", payload: { type: set.type, index, effectIndex: effect.index } }, { source: card });
      }
    });
  }
  return input;
}

export function validateBotDecision(input: BotInput, decision: BotDecision): void {
  if (!Number.isInteger(decision.randomState) || decision.randomState < 0 || decision.randomState > 0xffffffff)
    throw new Error("Invalid bot random state");
  if (input.selection) {
    if (decision.kind !== "selection") throw new Error("Bot must answer the current selection");
    const { indexes } = decision;
    const { min, max, options } = input.selection;
    if (indexes.length < min || indexes.length > max || new Set(indexes).size !== indexes.length ||
      indexes.some(index => !Number.isInteger(index) || index < 0 || index >= options.length))
      throw new Error("Bot selection is outside the current offer");
  } else if (decision.kind === "action") {
    if (!Number.isInteger(decision.index) || !input.actions[decision.index]) throw new Error("Bot action is outside the current offer");
  } else if (decision.kind !== "wait" || input.actions.length > 0) {
    throw new Error("Bot omitted an available action");
  }
}

/** Deterministic independent recovery; it never calls the failed strategy again. */
export function fallbackBotDecision(input: BotInput): BotDecision {
  const common = { randomState: input.randomState >>> 0, reason: "legal-error-recovery" };
  if (input.selection) return {
    ...common, kind: "selection", indexes: Array.from({ length: input.selection.min }, (_value, index) => index),
  };
  for (const type of ["endTurn", "resolve", "attackRoll", "cancelPurchase", "purchase", "attackMonster", "declareAttack", "declarePurchase", "activate"] as const) {
    const index = input.actions.findIndex(option => option.command.type === type);
    if (index >= 0) return { ...common, kind: "action", index };
  }
  return { ...common, kind: "wait" };
}

/** Fill native progressive selectors before execution. No preview executes a card. */
export function completeBotActivation(
  game: Game, player: Player, command: Extract<BotCommand, { type: "activate" }>,
  input: BotInput, policy: BotPolicy,
): { command: BotCommand; randomState: number } {
  const payload: Requests.Activate = { ...command.payload, targetChoices: [...(command.payload.targetChoices ?? [])] };
  const card = TargetBuilder.getCard(game, player, payload.index, payload.type);
  let randomState = input.randomState;
  for (let step = 0; step < 128; step++) {
    const selector = TargetBuilder.getNextSelector(game, player, card, payload.targetChoices, payload.effectIndex);
    if (selector.complete) return { command: { type: "activate", payload }, randomState };
    // The native flat-choice protocol advances a regular selector at its maximum.
    // Fill one complete selector group, without duplicate options, each iteration.
    const count = Math.min(selector.max, selector.options.length);
    if (count < selector.min || count === 0) throw new Error(`Bot activation has no completing target group: ${card.slug}/${payload.effectIndex} min=${selector.min} max=${selector.max} options=${selector.options.length} choices=${payload.targetChoices?.length}`);
    const choiceInput: BotInput = { ...input, randomState, actions: [], selection: {
      options: selector.options, min: count, max: count, purpose: "activation", sourceSlug: card.slug,
      sourceEffectIndex: card.jsonAPI.parent ? undefined : payload.effectIndex,
    } };
    const decision = policy(choiceInput);
    validateBotDecision(choiceInput, decision);
    if (decision.kind !== "selection") throw new Error("Bot omitted activation targets");
    payload.targetChoices!.push(...decision.indexes.map(index => selector.options[index]!));
    randomState = decision.randomState;
  }
  throw new Error("Bot activation exceeded the selector budget");
}

/** Native request failures can follow mutations. The runner must never retry them. */
export async function executeBotCommand(game: Game, player: Player, command: BotCommand): Promise<void> {
  switch (command.type) {
    case "declareAttack": return requests.executeDeclareAttackRequest(game, player);
    case "declarePurchase": return requests.executeDeclarePurchaseRequest(game, player);
    case "cancelPurchase": return requests.executeCancelPurchaseRequest(game, player);
    case "attackRoll": return requests.executeAttackRollRequest(game, player);
    case "endTurn": return requests.executeEndTurnRequest(game, player);
    case "attackMonster": return requests.executeAttackMonsterRequest(game, command.payload, player);
    case "purchase": return requests.executePurchaseRequest(game, command.payload, player);
    case "activate": {
      const result = await requests.executeActivateRequest(game, command.payload, player);
      if (!result.complete) throw new Error("Bot submitted an incomplete activation");
      return;
    }
    case "resolve": {
      game.assert.canResolveNow();
      await requests.executeResolveRequest(game, player);
      if (!game.stack.isEmpty()) game.assert.updateLastTimedAction();
      return;
    }
  }
}

export function submitBotSelection(game: Game, player: Player, requestId: number, selections: SelectionItem[]): void {
  requests.executeSubmitSelectionRequest(game, { requestId, selections }, player);
}
