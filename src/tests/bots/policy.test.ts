import { describe, expect, it } from "bun:test";
import { detailedStateSchema, type Card, type InPlayCard, type MonsterCard, type SelectionItem } from "@/shared/api";
import { createBotPolicy, decideBot } from "@/bots/policy";
import { DEFAULT_BOT_PLAYBOOKS, loadBotPlaybooks, parseBotPlaybooksJson } from "@/bots/playbooks";
import type { BotActionOption, BotInput } from "@/bots/types";

function card(slug: string, globalId = 10): Card {
  return { slug, globalId, nameKey: { key: "common.content", interpolates: { content: slug } }, orientation: "portrait" };
}

function player(name: string, globalId: number, team: number, souls = 0) {
  return {
    name, color: name, team, souls, coins: 4, handSize: 1, inPlay: [], soulCards: [],
    remainingLootPlay: 1, attackRequirements: [], isEngagedInPurchase: false,
    character: {
      ...card(`character-${name}`, globalId), charged: true, eternal: true,
      capabilities: { activate: true },
      stats: { healthPoints: 2, attackPoints: 1, isEngagedInCombat: false, temporaryEffect: [], capabilities: { targetable: true } },
    },
    capabilities: { canSwitchTo: true, canDonateCoinsTo: true },
  };
}

function fixture(level: BotInput["level"] = "normal"): BotInput {
  return {
    version: 1, level, soulsToWin: 4, randomState: 100, turnActions: 0, actions: [],
    state: detailedStateSchema.parse({
      me: {
        ...player("alice", 1, 1), hand: [], numberOfCardsOverMaxHandSize: 0,
        capabilities: { endTurn: true, declareAttack: true, declarePurchase: true, rollDice: true, buyTreasure: true, useLoot: true, resolve: true, canSwitchTo: true, canDonateCoinsTo: { key: "capability.cannotGiveCoinToSelf" } },
      },
      players: [player("bob", 2, 2), player("carol", 3, 3, 2), player("dave", 4, 4, 2)],
      monsters: { discard: [], deckSize: 10, capabilities: { targetableDeck: true }, inPlay: [] },
      treasure: { discard: [], deckSize: 10, inPlay: [], topDeckPrice: 10 },
      loot: { discard: [], deckSize: 10 }, turn: "alice", round: 1, stack: [], history: [], animations: [],
      lastStackElementTimeStamp: 0, pendingSelections: [],
    }),
  };
}

function activation(slug: string, globalId: number, type: "hand" | "inPlay" = "hand"): BotActionOption {
  return { command: { type: "activate", payload: { type, index: 0, effectIndex: "tap" } }, source: card(slug, globalId) };
}

function playerOption(input: BotInput, name: string): SelectionItem {
  const owner = [input.state.me, ...input.state.players].find(value => value.name === name)!;
  return { type: "player", payload: { ...owner.character!, type: "player", color: owner.color } };
}

function selectionIndex(input: BotInput): number {
  const result = decideBot(input);
  if (result.kind !== "selection") throw new Error("Expected selection");
  return result.indexes[0]!;
}

describe("pure TS bot policy", () => {
  it("uses only offered indexes, survives JSON transport and leaves its input untouched", () => {
    const input = fixture("easy");
    input.actions = [{ command: { type: "endTurn" } }, { command: { type: "declareAttack" } }];
    const before = JSON.stringify(input);
    const first = decideBot(input);
    expect(first).toEqual(decideBot(JSON.parse(before)));
    expect(JSON.stringify(input)).toBe(before);
    expect(first.kind === "action" && first.index >= 0 && first.index < input.actions.length).toBe(true);
    expect(first.randomState).not.toBe(input.randomState);
    expect(decideBot({ ...input, actions: [] })).toEqual({ kind: "wait", randomState: input.randomState, reason: "no-offered-decision" });
  });

  it("Easy explores both offers while Normal consistently values the larger known economy", () => {
    const input = fixture("easy");
    input.actions = [activation("b2-a_penny", 11), activation("b2-a_dime", 12)];
    const explored = new Set<number>();
    for (let seed = 0; seed < 100; seed++) {
      const easy = decideBot({ ...input, randomState: seed });
      if (easy.kind === "action") explored.add(easy.index);
      expect(decideBot({ ...input, level: "normal", randomState: seed })).toMatchObject({ kind: "action", index: 1 });
    }
    expect(explored.size).toBe(2);
  });

  it("Normal accounts for fight risk and prefers a final soul over ordinary rewards", () => {
    const input = fixture();
    const fight: BotActionOption = {
      command: { type: "attackMonster", payload: { card: card("boss", 20) } },
      combat: { playerHp: 2, playerDamage: 1, monsterHp: 1, monsterDamage: 1, hitFaces: 6 },
      rewards: { soul: 1, coin: 0, loot: 0, treasure: 0 },
    };
    input.state.me.souls = 3;
    input.actions = [activation("b2-a_dime", 12), fight, { command: { type: "endTurn" } }];
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 1 });
    input.actions[1] = { ...fight, combat: { ...fight.combat!, hitFaces: 0 } };
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 0 });
  });

  it("saves coins instead of repeatedly declaring an unaffordable purchase", () => {
    const input = fixture();
    input.actions = [{ command: { type: "declarePurchase" } }, { command: { type: "endTurn" } }];
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 1 });
    input.state.me.coins = 10;
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 0 });
    input.state.treasure.topDeckPrice = 20;
    input.state.me.coins = 30;
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 1 });
  });

  it("Hard avoids an injured blind attack while retaining full-health exploration", () => {
    const input = fixture("hard");
    input.actions = [{ command: { type: "declareAttack" } }, { command: { type: "endTurn" } }];
    input.state.me.character!.stats.healthPoints = 1;
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 1 });
    input.state.me.character!.stats.healthPoints = 2;
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 0 });
  });

  it("bounds activations and defers a source already pending without inventing an action", () => {
    const input = fixture("hard");
    input.actions = [activation("b2-a_dime", 12), { command: { type: "resolve" } }];
    input.state.stack = [{ type: "LootCardEffect", card: card("b2-a_dime", 12), issuer: { ...card("character-alice", 1), type: "player", color: "alice" }, id: 1, targets: [] }];
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 1 });
    input.state.stack = [];
    expect(decideBot({ ...input, turnActions: 16 })).toMatchObject({ kind: "action", index: 1 });
    expect(decideBot({ ...input, turnActions: 16, actions: [input.actions[0]!] })).toMatchObject({ kind: "action", index: 0 });
  });

  it("saves resources on unknown paid abilities while answering a sole required offer", () => {
    const input = fixture();
    const paid = activation("unknown-paid-item", 12, "inPlay");
    if (paid.command.type === "activate") paid.command.payload.effectIndex = 0;
    input.actions = [paid, { command: { type: "endTurn" } }];
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 1 });
    input.actions = [paid];
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 0 });
    paid.rewards = { soul: 0, coin: 5, loot: 0, treasure: 0 };
    paid.cost = 1;
    input.actions.push({ command: { type: "endTurn" } });
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 0 });
  });

  it("answers mandatory discard with the least valuable offered coin card", () => {
    const input = fixture();
    input.selection = { purpose: "mandatory", reason: "maxHandSize", min: 1, max: 1,
      options: [{ type: "card", payload: card("b2-a_dime") }, { type: "card", payload: card("b2-a_penny", 11) }] };
    expect(selectionIndex(input)).toBe(1);
    expect(() => decideBot({ ...input, selection: { ...input.selection!, min: 3, max: 3 } })).toThrow("no admitted response");
  });

  it("preserves arbitrary required selections and optional declines", () => {
    const input = fixture("easy");
    input.selection = { purpose: "mandatory", min: 2, max: 2, options: [{ type: "deck", payload: "loot" }, { type: "number", payload: 4 }, { type: "boolean", payload: true }] };
    const result = decideBot(input);
    expect(result.kind === "selection" && new Set(result.indexes).size).toBe(2);
    input.level = "normal";
    input.selection.min = 0;
    expect(decideBot(input)).toMatchObject({ kind: "selection", indexes: [] });
    input.selection = { purpose: "mandatory", min: 0, max: 0, options: [] };
    expect(decideBot(input)).toMatchObject({ kind: "selection", indexes: [] });
  });
});

describe("editable official TS playbooks", () => {
  it("rejects unknown patterns, wrong identities, duplicate IDs and unreviewed fields", () => {
    for (const change of [
      { pattern: "execute-script" }, { sourceSlug: "custom-card" }, { sourceSlug: "b2-bomb" }, { script: "run()" },
    ]) {
      const configuration = structuredClone(DEFAULT_BOT_PLAYBOOKS);
      Object.assign(configuration.rules[0]!, change);
      expect(() => loadBotPlaybooks(configuration)).toThrow();
    }
    const configuration = structuredClone(DEFAULT_BOT_PLAYBOOKS);
    configuration.rules.push(configuration.rules[0]!);
    expect(() => loadBotPlaybooks(configuration)).toThrow("Duplicate rule ID");
    expect(() => parseBotPlaybooksJson(" ".repeat(65537))).toThrow("65536");
    expect(() => parseBotPlaybooksJson("{" )).toThrow();
  });

  it("Strength benefits the acting player in its actual offered grant", () => {
    const input = fixture();
    input.selection = { sourceSlug: "b2-xi_strength", sourceEffectIndex: "tap", purpose: "activation", min: 1, max: 1,
      options: [playerOption(input, "bob"), playerOption(input, "alice")] };
    expect(selectionIndex(input)).toBe(1);
    expect(decideBot(input).reason).toBe("strength-for-actor@1");
    input.selection.options = [playerOption(input, "bob")];
    expect(() => decideBot(input)).toThrow("No beneficial offered target");
  });

  it("Hard selects useful hostile soul leaders, excluding allies and empty death penalties", () => {
    const input = fixture("hard");
    input.state.players[0]!.souls = 3;
    input.state.players[0]!.team = input.state.me.team;
    input.state.players[2]!.souls = 3;
    input.state.players[2]!.coins = 0;
    input.state.players[2]!.handSize = 0;
    input.selection = { sourceSlug: "b2-xiii_death", sourceEffectIndex: "tap", purpose: "activation", min: 1, max: 1,
      options: [playerOption(input, "alice"), ...input.state.players.map(player => playerOption(input, player.name))] };
    expect(selectionIndex(input)).toBe(2);
  });

  it("Normal denies current resources while Hard prioritizes a useful soul leader", () => {
    const input = fixture();
    input.state.players[0]!.inPlay = [{ ...card("valuable-item", 50), capabilities: { activate: true } }];
    input.selection = { sourceSlug: "b2-xiii_death", sourceEffectIndex: "tap", purpose: "activation", min: 1, max: 1,
      options: [playerOption(input, "bob"), playerOption(input, "carol")] };
    expect(selectionIndex(input)).toBe(0);
    expect(selectionIndex({ ...input, level: "hard" })).toBe(1);
  });

  it("gives tied opponents equal lottery weight despite unequal offered item counts", () => {
    const input = fixture("hard");
    const carolItems = Array.from({ length: 7 }, (_, index): InPlayCard => ({ ...card(`item-${index}`, 100 + index), capabilities: { activate: true } }));
    input.state.players[1]!.inPlay = carolItems;
    const daveItem: InPlayCard = { ...card("one-item", 200), capabilities: { activate: true } };
    input.state.players[2]!.inPlay = [daveItem];
    input.selection = { sourceSlug: "b2-pay_to_play", sourceEffectIndex: 0, purpose: "activation", min: 1, max: 1,
      options: [...carolItems, daveItem].map(payload => ({ type: "card", payload })) };
    let carol = 0;
    let dave = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const index = selectionIndex({ ...input, randomState: seed });
      if (index === 7) dave++;
      else carol++;
    }
    expect(carol).toBeGreaterThan(400);
    expect(dave).toBeGreaterThan(400);
    expect(carol + dave).toBe(1000);
  });

  it("does not redirect Pay to Play onto an eternal item even when its owner leads", () => {
    const input = fixture("hard");
    input.state.players[1]!.inPlay = [{ ...card("eternal-item", 100), eternal: true, capabilities: { activate: true } }];
    input.state.players[2]!.souls = 1;
    input.state.players[2]!.inPlay = [{ ...card("valuable-item", 200), capabilities: { activate: true } }];
    input.selection = { sourceSlug: "b2-pay_to_play", sourceEffectIndex: 0, purpose: "activation", min: 1, max: 1,
      options: [input.state.players[1]!.inPlay[0]!, input.state.players[2]!.inPlay[0]!].map(payload => ({ type: "card", payload })) };
    expect(selectionIndex(input)).toBe(1);
  });

  it("uses Bomb on a visible useful monster instead of itself", () => {
    const input = fixture("hard");
    const monster: MonsterCard = { ...card("monster", 20), stats: { healthPoints: 1, attackPoints: 1, evasionPoints: 4, isEngagedInCombat: false, temporaryEffect: [], capabilities: { targetable: true } } };
    input.state.monsters.inPlay = [{ top: monster, covered: [] }];
    input.selection = { sourceSlug: "b2-bomb", sourceEffectIndex: "tap", purpose: "activation", min: 1, max: 1,
      options: [playerOption(input, "alice"), { type: "monster", payload: { ...monster, type: "monster", color: "red" } }] };
    expect(selectionIndex(input)).toBe(1);
  });

  it("Hard directs useful hostile Bomb damage at a soul leader while retaining better monster targets", () => {
    const input = fixture("hard");
    input.state.players[0]!.souls = 3;
    input.state.players[1]!.souls = 0;
    for (const player of input.state.players) player.character!.stats.healthPoints = 1;
    input.selection = { sourceSlug: "b2-bomb", sourceEffectIndex: "tap", purpose: "activation", min: 1, max: 1,
      options: [playerOption(input, "carol"), playerOption(input, "bob")] };
    for (let randomState = 0; randomState < 20; randomState++)
      expect(selectionIndex({ ...input, randomState })).toBe(1);
    const monster: MonsterCard = { ...card("monster", 20), stats: { healthPoints: 1, attackPoints: 1, evasionPoints: 4, isEngagedInCombat: false, temporaryEffect: [], capabilities: { targetable: true } } };
    input.state.monsters.inPlay = [{ top: monster, covered: [] }];
    input.selection.options.push({ type: "monster", payload: { ...monster, type: "monster", color: "red" } });
    expect(selectionIndex(input)).toBe(2);
  });

  it("defers harmful official activations and rejects a narrowed harmful precommit grant", () => {
    const input = fixture("hard");
    input.state.players.forEach(player => { player.team = input.state.me.team; });
    for (const source of ["b2-xiii_death", "b2-bomb", "b2-pay_to_play"]) {
      const option = activation(source, 12, source === "b2-pay_to_play" ? "inPlay" : "hand");
      if (source === "b2-pay_to_play" && option.command.type === "activate") option.command.payload.effectIndex = 0;
      input.actions = [option, { command: { type: "endTurn" } }];
      expect(decideBot(input)).toMatchObject({ kind: "action", index: 1 });
    }
    input.selection = { purpose: "activation", sourceSlug: "b2-xiii_death", sourceEffectIndex: "tap", min: 1, max: 1,
      options: [playerOption(input, "alice")] };
    expect(() => decideBot(input)).toThrow("No beneficial offered target");
    input.selection.purpose = "mandatory";
    expect(selectionIndex(input)).toBe(0);
    input.selection.purpose = "activation";
    input.selection.min = 0;
    expect(decideBot(input)).toMatchObject({ kind: "selection", indexes: [] });
  });

  it("requires exact effect identity and abstains for copied action sources", () => {
    const input = fixture("hard");
    input.selection = { purpose: "activation", sourceSlug: "b2-xi_strength", min: 1, max: 1,
      options: [playerOption(input, "alice")] };
    expect(decideBot(input).reason).toBe("hard-selection");
    input.selection.sourceEffectIndex = 0;
    expect(decideBot(input).reason).toBe("hard-selection");
    input.selection.sourceEffectIndex = "tap";
    expect(decideBot(input).reason).toBe("strength-for-actor@1");
    delete input.selection;
    input.actions = [activation("b2-a_dime", 12), activation("b2-blank_card", 13, "inPlay")];
    input.actions[1]!.source!.parent = "b2-placebo";
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 0 });
  });

  it("Hard prepares Blank Card before known coin loot, then reevaluates its native receipt", () => {
    const input = fixture("hard");
    input.actions = [activation("b2-a_dime", 12), activation("b2-blank_card", 13, "inPlay")];
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 1, reason: "blank-before-coin-loot@1" });
    expect(decideBot({ ...input, level: "normal" })).toMatchObject({ kind: "action", index: 0 });
    input.state.stack = [{ type: "effect", card: card("b2-blank_card", 13),
      issuer: { ...card("character-alice", 1), type: "player", color: "alice" }, id: 2, effect: "", targets: [] }];
    input.actions.push({ command: { type: "resolve" } });
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 2 });
    input.state.stack = [];
    input.actions.pop();
    input.state.me.character!.stats.temporaryEffect = [{ card: card("b2-blank_card", 13), issuer: "alice", targets: [] }];
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 0 });
    input.state.me.character!.stats.temporaryEffect = [];
    const empty = createBotPolicy({ schemaVersion: 1, rules: [] });
    expect(empty(input)).toMatchObject({ kind: "action", index: 0 });
    expect(decideBot({ ...input, turnActions: 16, actions: [...input.actions, { command: { type: "endTurn" } }] })).toMatchObject({ kind: "action", index: 2 });
  });

  it("changed thresholds and disabled rules change only the current correction", () => {
    const input = fixture("hard");
    input.actions = [activation("b2-a_dime", 12), activation("b2-blank_card", 13, "inPlay")];
    const configuration = structuredClone(DEFAULT_BOT_PLAYBOOKS);
    const rule = configuration.rules.find(rule => rule.pattern === "copy-coin-loot")!;
    rule.minimumBenefit = 11;
    expect(createBotPolicy(configuration)(input)).toMatchObject({ kind: "action", index: 0 });
    rule.minimumBenefit = 1;
    rule.enabled = false;
    expect(createBotPolicy(configuration)(input)).toMatchObject({ kind: "action", index: 0 });
    expect(decideBot(input)).toMatchObject({ kind: "action", index: 1 });
    rule.enabled = true;
    rule.minimumBenefit = 0;
    input.actions[0] = activation("unknown-loot", 12);
    expect(createBotPolicy(configuration)(input)).toMatchObject({ kind: "action", index: 0 });
  });
});
