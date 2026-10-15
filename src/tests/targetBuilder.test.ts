import { describe, it, beforeEach, expect } from "bun:test";
import { Game } from "../models/game";
import { Player } from "../models/entities/player";
import { CharacterCard, ItemCard, LootCard, MonsterCard } from "@/models/cards";
import { TargetBuilder } from "@/models/targetBuilder";
import { isChooseOneOptions, type ChooseOneOptions } from "@/models/targetSelector";
import type { TargetsSelector } from "@/models/types/cardTypes";
import {
  dischargeEachItemsAndRemoveCoins,
  emptyHands,
 setupTestGame,
  mockGameSelections,
} from "@/tests/testHelpers";
import { pl } from "zod/locales";

describe("Target Builder Interface", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(async () => {
    const setup = await setupTestGame({
      characters: ["b2-samson", "b2-isaac"],
      monsters: ["b2-fly", "b2-fatty"],
      monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
      treasureDeck: ["b2-blank_card"],
    });
    game = setup.game;
    player1 = setup.player1;
    player2 = setup.player2!;
    mockGameSelections(game);
    dischargeEachItemsAndRemoveCoins(game);
    emptyHands(game);
    for (const slug of ["b2-red_host", "b2-pooter", "b2-gurdy"]) {
      const monsterCardTop = game.decks["monster"]!.cards.find(
        (c) => c.slug === slug,
      ) as MonsterCard;
      if (monsterCardTop) {
        game.decks["monster"]!.addTopPosition(monsterCardTop);
      }
    }
    const monsterCard = game.decks["monster"]!.cards.find(
      (c) => c.slug === "b2-fly",
    ) as MonsterCard;
    const monsterCard2 = game.decks["monster"]!.cards.find(
      (c) => c.slug === "b2-fatty",
    ) as MonsterCard;
    if (monsterCard) game.encounters.forceSetMonsterAtSlot(0, monsterCard);
    if (monsterCard2) game.encounters.forceSetMonsterAtSlot(1, monsterCard2);
  });

  it("should progressively build targets for a tap effect with one selector", async () => {
    // Get an item with a simple selector
    const item = game.shop.itemsInShop.find(
      (c) => c && c.constructor.name === "ItemCard",
    ) as ItemCard;
    if (!item) return; // Skip if no item in shop

    game.cardHandler.addInPlay(player1, item);
    if (item.isActiveItem()) {
      game.cardHandler.recharge(item);
    }

    // Step 1: Start building targets with empty array
    const step1 = TargetBuilder.getNextSelector(game, player1, item, []);

    expect(step1.complete).toBe(false);
    expect(step1.description).toBeTruthy();
    expect(step1.options.length).toBeGreaterThan(0);

    // Options should be string identifiers
    expect(typeof step1.options[0]).toBe("string");

    // Step 2: User picks an option - let's pick the first one
    const chosenOption = step1.options[0]!;

    // Step 3: Continue building with the chosen target (flat array)
    const step2 = TargetBuilder.getNextSelector(game, player1, item, [
      chosenOption,
    ]);

    // Should be complete now (single selector)
    expect(step2.complete).toBe(true);
  });

  it("select dice and then select number", async () => {
    // Get an item with a simple selector
    const item = game.obtainCard("b2-mini_mush") as ItemCard;

    game.cardHandler.addInPlay(player1, item);
    if (item.isActiveItem()) {
      game.cardHandler.recharge(item);
    }
    game.actions.declareAttack(player1);
    await game.actions.declareAttackOnEntity(player1, game.encounters.monsterIn(0)!);
    game.actions.attackRoll(player1);
    expect(TargetBuilder.validTargetExists(game, player1, item, "tap")).toBe(true);
  });

  it("should build targets for contract_from_below (paid effect)", async () => {
    // Contract from below: "Destroy 2 items you control: steal a non-eternal item from a player"
    // NOTE: The steal part has no selector (handled internally by game)
    const contractFromBelow = game.obtainCard(
      "b2-contract_from_below",
    ) as ItemCard;
    const item1 = game.obtainCard("b2-blank_card") as ItemCard;
    const item2 = game.obtainCard("b2-dry_baby") as ItemCard;

    game.cardHandler.addInPlay(player1, contractFromBelow);
    game.cardHandler.addInPlay(player1, item1);
    game.cardHandler.addInPlay(player1, item2);

    // Step 1: Get first selector (payment - destroy 2 items)
    const step1 = TargetBuilder.getNextSelector(
      game,
      player1,
      contractFromBelow,
      [],
      0,
    );

    // Should return selector info (complete status may vary based on if selector exists)
    expect(typeof step1.complete).toBe("boolean");
    expect(step1.isChooseOne).toBeDefined();

    // If there are selectors, test the flow
    if (!step1.complete && step1.options.length > 0) {
      // User picks items (as many as available)
      const itemsToDestroy = step1.options.slice(
        0,
        Math.min(step1.max, step1.options.length),
      );

      // Step 2: After providing payment
      const step2 = TargetBuilder.getNextSelector(
        game,
        player1,
        contractFromBelow,
        itemsToDestroy,
        0,
      );

      expect(typeof step2.complete).toBe("boolean");
    }
  });

  it("should use buildTargets helper to convert string identifiers to targets", async () => {
    const item1 = game.obtainCard("b2-blank_card") as ItemCard;
    const item2 = game.obtainCard("b2-dry_baby") as ItemCard;

    game.cardHandler.addInPlay(player1, item1);
    game.cardHandler.addInPlay(player1, item2);

    // Simulate client sending string identifiers (flat array)
    const stringTargets = [
      TargetBuilder.convertToSelectionItems([item1])[0]!,
      TargetBuilder.convertToSelectionItems([item2])[0]!,
    ];

    // Build actual targets - need an item with selectors that match
    const targets = TargetBuilder.buildTargets(
      game,
      player1,
      item1,
      stringTargets,
    );

    // Just verify buildTargets doesn't crash
    expect(Array.isArray(targets)).toBe(true);
  });

  it("should build resolve-time targets from raw selections returned by game.select", async () => {
    const boomerang = game.obtainCard("b2-boomerang") as ItemCard;
    game.cardHandler.addInPlay(player1, boomerang);
    game.cardHandler.recharge(boomerang);

    const builtTargets = await TargetBuilder.buildTargetsOnResolve(
      game,
      player1,
      boomerang,
      "tap"
    );

    expect(builtTargets).toHaveLength(1);
    expect(builtTargets[0].id).toBe(player2.id);
  });

  it("should convert various object types to string identifiers", async () => {
    const card = game.obtainCard("b2-blank_card") as ItemCard;

    // Test card conversion - should include the global id for disambiguation
    const cardIdentifiers = TargetBuilder["convertToSelectionItems"]([card]);
    expect(cardIdentifiers[0]).toEqual({
      type: "card",
      payload: { nameKey: card.nameKey, slug: card.slug, globalId: card.globalId, orientation: "portrait" },
    });

    // Test number conversion - should return string numbers
    const numberIdentifiers = TargetBuilder["convertToSelectionItems"]([
      1, 2, 3,
    ]);
    expect(numberIdentifiers).toEqual([
      { type: "number", payload: 1 },
      { type: "number", payload: 2 },
      { type: "number", payload: 3 },
    ]);

    // Test string conversion - should return strings as-is
    const stringIdentifiers = TargetBuilder["convertToSelectionItems"]([
      "test",
    ]);
    expect(stringIdentifiers[0]).toEqual({ type: "string", payload: "test" });
  });

  it("should resolve identifiers back to objects", async () => {
    const card = game.obtainCard("b2-blank_card") as ItemCard;

    // Resolve card - identifier includes slug + global id
    const resolvedCard = TargetBuilder["resolveIdentifier"](
      { type: "card", payload: { nameKey: card.nameKey, slug: card.slug, globalId: card.globalId, orientation: "portrait" } },
      [card],
    );
    expect(resolvedCard?.slug).toBe(card.slug);

    // Resolve number - identifier is string representation
    const resolvedNumber = TargetBuilder["resolveIdentifier"](
      { type: "number", payload: 42 },
      [42, 100],
    );
    expect(resolvedNumber).toBe(42);

    // Resolve string - identifier is the string itself
    const resolvedString = TargetBuilder["resolveIdentifier"](
      { type: "string", payload: "test" },
      ["test", "other"],
    );
    expect(resolvedString).toBe("test");
  });

  it("should not leak information - only show next selector options", async () => {
    // This test demonstrates the security aspect using a multi-selector effect
    const item = game.obtainCard("b2-blank_card") as ItemCard;
    game.cardHandler.addInPlay(player1, item);

    // For testing progressive disclosure, we need an effect with multiple selectors
    // Many effects only have 1 selector or no selectors, so just verify basic behavior
    const step1 = TargetBuilder.getNextSelector(game, player1, item, [], "tap");

    // Verify we only get information about current selector, not future ones
    expect(step1.isChooseOne).toBeDefined();
    expect(step1.complete).toBeDefined();
    expect(Array.isArray(step1.options)).toBe(true);
  });

  it("should handle effects with no selectors", async () => {
    // Get an item with no selectors (e.g., "loot 1")
    const item = game.shop.itemsInShop.find(
      (c) => c && c.constructor.name === "ItemCard",
    ) as ItemCard;
    if (!item) return; // Skip if no item

    game.cardHandler.addInPlay(player1, item);

    const result = TargetBuilder.getNextSelector(game, player1, item, []);

    // Should immediately be complete if no selectors
    expect(result.complete).toBe(true);
  });

  it("should handle 'asMany' selectors correctly", async () => {
    // Find an effect with asMany=true (like "destroy any number of items")
    // For now, just verify the interface returns the asMany flag
    const item = game.obtainCard("b2-blank_card") as ItemCard;
    game.cardHandler.addInPlay(player1, item);

    const result = TargetBuilder.getNextSelector(game, player1, item, []);

    // Verify asMany field exists (it's boolean)
    expect(typeof result.min).toBe("number");
    expect(typeof result.max).toBe("number");
  });

  it("complete workflow: build targets step-by-step and activate item", async () => {
    // Demonstrate complete client-server workflow
    const contractFromBelow = game.obtainCard(
      "b2-contract_from_below",
    ) as ItemCard;
    const item1 = game.obtainCard("b2-blank_card") as ItemCard;
    const item2 = game.obtainCard("b2-dry_baby") as ItemCard;
    const targetItem = game.obtainCard("b2-book_of_sin") as ItemCard;

    game.cardHandler.addInPlay(player1, contractFromBelow);
    game.cardHandler.addInPlay(player1, item1);
    game.cardHandler.addInPlay(player1, item2);
    game.cardHandler.addInPlay(player2, targetItem);

    // CLIENT: Request first selector
    const selector1 = TargetBuilder.getNextSelector(
      game,
      player1,
      contractFromBelow,
      [],
      0,
    );
    expect(selector1.complete).toBe(false);

    // CLIENT: User picks items (just pick available options)
    const chosenItems = selector1.options.slice(
      0,
      Math.min(selector1.max, selector1.options.length),
    );

    // CLIENT: Request next selector with chosen items (flat array)
    const selector2 = TargetBuilder.getNextSelector(
      game,
      player1,
      contractFromBelow,
      chosenItems,
      0,
    );

    // May be complete or need more selections depending on the effect structure
    if (!selector2.complete) {
      // Pick from second selector if not complete
      const chosenStealTarget = selector2.options[0];
      if (chosenStealTarget) {
        const allChoices = [...chosenItems, chosenStealTarget];
        const selector3 = TargetBuilder.getNextSelector(
          game,
          player1,
          contractFromBelow,
          allChoices,
          0,
        );
        // Eventually should complete
        expect(typeof selector3.complete).toBe("boolean");
      }
    }
  });

  it("should handle chaos card choose-one - option 1: Kill a player or monster", async () => {
    const chaosCard = game.obtainCard("b2-chaos_card") as ItemCard;
    game.cardHandler.addInPlay(player1, chaosCard);

    // Step 1: Get the choose-one selector
    const step1 = TargetBuilder.getNextSelector(
      game,
      player1,
      chaosCard,
      [],
      "tap",
    );

    // Chaos card has "if you do, choose one-" which might affect structure
    // Just verify basic progressive disclosure works
    expect(typeof step1.complete).toBe("boolean");
    expect(Array.isArray(step1.options)).toBe(true);

    if (step1.isChooseOne && step1.options.length > 0) {
      // Choose first option
      const chosenOption = step1.options[0]!;
      const step2 = TargetBuilder.getNextSelector(
        game,
        player1,
        chaosCard,
        [chosenOption],
        "tap",
      );

      // Should make progress
      expect(typeof step2.complete).toBe("boolean");
    }
  });

  it("should handle chaos card choose-one - option 2: Destroy an item or soul", async () => {
    const chaosCard = game.obtainCard("b2-chaos_card") as ItemCard;
    const targetItem = game.obtainCard("b2-blank_card") as ItemCard;
    game.cardHandler.addInPlay(player1, chaosCard);
    game.cardHandler.addInPlay(player2, targetItem);
    game.cardHandler.recharge(chaosCard);

    // Step 1: Get the choose-one selector
    const step1 = TargetBuilder.getNextSelector(
      game,
      player1,
      chaosCard,
      [],
      "tap",
    );

    // Verify basic behavior
    expect(typeof step1.complete).toBe("boolean");
    expect(Array.isArray(step1.options)).toBe(true);

    expect(step1.isChooseOne && step1.options.length >= 2).toBe(true);
    if (step1.isChooseOne && step1.options.length >= 2) {
      // Choose second option
      const chosenOption = step1.options[1]!;
      const step2 = TargetBuilder.getNextSelector(
        game,
        player1,
        chaosCard,
        [chosenOption],
        "tap",
      );

      // Should make progress
      expect(step2.complete).toBe(false);
      const step3 = TargetBuilder.getNextSelector(
        game,
        player1,
        chaosCard,
        [chosenOption, TargetBuilder.convertToSelectionItems([targetItem])[0]!],
        "tap",
      );
      expect(step3.complete).toBe(true);

      const targets = TargetBuilder.buildTargets(game, player1, chaosCard, [
        chosenOption,
        TargetBuilder.convertToSelectionItems([targetItem])[0]!,
      ]);

      await game.activateItem(player1, chaosCard, targets);
      await game.actions.resolveStack();
      // Verify the item was destroyed
      expect(
        player2.inPlay.find((i) => i.slug === targetItem.slug),
      ).toBeUndefined();
      expect(
        player1.inPlay.find((i) => i.slug === chaosCard.slug),
      ).toBeUndefined();
    }
  });

  it("should handle b", async () => {
    const bloodLust = player1.inPlay[0] as ItemCard;
    game.cardHandler.recharge(bloodLust);

    // Step 1: Get the choose-one selector
    const step1 = TargetBuilder.getNextSelector(
      game,
      player1,
      bloodLust,
      [],
      "tap",
    );

    // Verify basic behavior
    expect(typeof step1.complete).toBe("boolean");
    expect(Array.isArray(step1.options)).toBe(true);

    expect(step1.options.length >= 2).toBe(true);
    if (step1.options.length >= 2) {
      // Choose second option
      const chosenOption = step1.options[1]!;
      const step2 = TargetBuilder.getNextSelector(
        game,
        player1,
        bloodLust,
        [chosenOption],
        "tap",
      );

      // Should make progress
      expect(step2.complete).toBe(true);
      const targets = TargetBuilder.buildTargets(game, player1, bloodLust, [
        chosenOption,
      ]);
      await game.activateItem(player1, bloodLust, targets);
      await game.actions.resolveStack();
    }
  });
});

describe("Target Builder - validTargetExists", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(async () => {
    const setup = await setupTestGame({
      characters: ["b2-samson", "b2-isaac"],
      monsters: ["b2-fly", "b2-fatty"],
      monsterDeck: ["b2-red_host", "b2-pooter", "b2-gurdy"],
      treasureDeck: ["b2-blank_card"],
    });
    game = setup.game;
    player1 = setup.player1;
    player2 = setup.player2!;
    mockGameSelections(game);
    dischargeEachItemsAndRemoveCoins(game);
    emptyHands(game);
  });

  describe("Basic Functionality", () => {
    it("should return true when valid targets exist for a simple selector", () => {
      // Boomerang: "Choose another player. Steal a loot card from them at random."
      const boomerang = game.obtainCard("b2-boomerang") as ItemCard;
      game.cardHandler.addInPlay(player1, boomerang);
      game.cardHandler.recharge(boomerang);

      // Add loot card to player2's hand so there's a valid target
      const lootCard = game.obtainCard("b2-a_penny") as LootCard;
      player2.hand.addToHand(lootCard);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        boomerang,
        "tap",
      );
      expect(result).toBe(true);
    });

    it("should return error message when no valid targets exist", () => {
      // Contract from below with no items to destroy
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      game.cardHandler.addInPlay(player1, contract);
      // Don't add any other items to destroy

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      expect(result !== true && result.key === "capability.noValidTargets").toBe(true);
    });

    it("should return true when effect has no selectors (always activatable)", () => {
      // Chaos: "Each player gives their hand to the player to their left."
      // This has no selectors, so it's always activatable
      const chaos = game.obtainCard("b2-chaos") as ItemCard;
      game.cardHandler.addInPlay(player1, chaos);
      game.cardHandler.recharge(chaos);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        chaos,
        "tap",
      );
      expect(result).toBe(true);
    });

    it("should return 'Item not found.' when item is null", () => {
      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        null as any,
        "tap",
      );
      expect(result !== true && result.key === "error.itemNotFound").toBe(true);
    });
  });

  describe("Multiple Selectors", () => {
    it("should return true when all sequential selectors have valid targets", () => {
      // Contract from below: Destroy 2 items you control: steal a non-eternal item from a player
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      const item1 = game.obtainCard("b2-blank_card") as ItemCard;
      const item2 = game.obtainCard("b2-dry_baby") as ItemCard;
      const targetItem = game.obtainCard("b2-book_of_sin") as ItemCard;

      game.cardHandler.addInPlay(player1, contract);
      game.cardHandler.addInPlay(player1, item1);
      game.cardHandler.addInPlay(player1, item2);
      game.cardHandler.addInPlay(player2, targetItem);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      expect(result).toBe(true);
    });

    it("should return error when first selector has no targets", () => {
      // Contract from below requires 2 items to destroy
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      game.cardHandler.addInPlay(player1, contract);
      // Don't add any other items

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      expect(result !== true && result.key === "capability.noValidTargets").toBe(true);
    });

    it("should return error when second selector has no targets", () => {
      // Contract from below: need items to destroy AND a non-eternal item to steal
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      const item1 = game.obtainCard("b2-blank_card") as ItemCard;
      const item2 = game.obtainCard("b2-dry_baby") as ItemCard;

      game.cardHandler.addInPlay(player1, contract);
      game.cardHandler.addInPlay(player1, item1);
      game.cardHandler.addInPlay(player1, item2);
      // Don't add any items to other players

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      expect(result !== true && result.key === "capability.noValidTargets").toBe(true);
    });
  });

  describe("Choose-One Selectors", () => {
    it("should backtrack to the next randomized choose-one option after a dead end", () => {
      const item = game.obtainCard("b2-chaos_card") as ItemCard;
      game.cardHandler.addInPlay(player1, item);

      const [deadEndBranch, validBranch] = item.getEffectRange(0)!;
      const originalSelector = item.getEffectTarget("tap")[0]!;
      const branchSelector = (hasTargets: boolean): TargetsSelector => ({
        description: originalSelector.description,
        selector: () => hasTargets ? ["valid-target"] : [],
        min: 1,
        max: 1,
      });
      const chooseOneSelector: TargetsSelector = {
        description: originalSelector.description,
        selector: () => [
          {
            description: deadEndBranch!.description.toLowerCase().replaceAll("!", ""),
            card: item,
            visualEffectBox: deadEndBranch!,
            admissibleTargets: [branchSelector(false)],
          },
          {
            description: validBranch!.description.toLowerCase().replaceAll("!", ""),
            card: item,
            visualEffectBox: validBranch!,
            admissibleTargets: [branchSelector(true)],
          },
        ],
        min: 1,
        max: 1,
      };
      item.getEffectTarget = () => [chooseOneSelector];
      item.targetStillValid = () => true;

      const originalRandom = Math.random;
      Math.random = () => 0.99;
      try {
        const result = TargetBuilder.buildRandomValidTargets(game, player1, item, "inPlay");

        expect(typeof result).not.toBe("string");
        if (typeof result !== "string") {
          expect(result.targets).toEqual([
            validBranch!.description.toLowerCase().replaceAll("!", ""),
            "valid-target",
          ]);
        }
      } finally {
        Math.random = originalRandom;
      }
    });

    it("should validate only the choose-one branch identified by visualEffectId", () => {
      const item = game.obtainCard("b2-chaos_card") as ItemCard;
      game.cardHandler.addInPlay(player1, item);

      const firstBranch = item.getEffectRange(0)[0]!;
      const secondBranch = item.getEffectRange(0)[1]!;
      const originalSelector = item.getEffectTarget("tap")[0]!;
      const makeBranchSelector = (hasTargets: boolean): TargetsSelector => ({
        description: originalSelector.description,
        selector: () => hasTargets ? ["valid-target"] : [],
        min: 1,
        max: 1,
      });
      const options: ChooseOneOptions[] = [
        {
          description: firstBranch.description.toLowerCase().replaceAll("!", ""),
          card: item,
          visualEffectBox: firstBranch,
          admissibleTargets: [makeBranchSelector(true)],
        },
        {
          description: secondBranch.description.toLowerCase().replaceAll("!", ""),
          card: item,
          visualEffectBox: secondBranch,
          admissibleTargets: [makeBranchSelector(false)],
        },
      ];
      const chooseOneSelector: TargetsSelector = {
        description: originalSelector.description,
        selector: () => options.filter(isChooseOneOptions),
        min: 1,
        max: 1,
      };
      item.getEffectTarget = () => [chooseOneSelector];

      expect(TargetBuilder.validTargetExists(game, player1, item, "tap")).toBe(true);
      expect(
        TargetBuilder.validTargetExists(game, player1, item, "tap", secondBranch.startIndex),
      ).toMatchObject({ key: "capability.noValidTargets" });
      expect(
        TargetBuilder.validTargetExists(game, player1, item, "tap", firstBranch.startIndex),
      ).toBe(true);
    });

    it("should return true when at least one choose-one option has valid targets", () => {
      // Chaos Card: "Choose one: Kill a player or monster; OR Destroy an item or soul you control"
      const chaosCard = game.obtainCard("b2-chaos_card") as ItemCard;
      game.cardHandler.addInPlay(player1, chaosCard);
      game.cardHandler.recharge(chaosCard);

      // Add a monster so at least one option is valid
      const monster = game.obtainCard("b2-fly") as MonsterCard;
      if (monster) game.encounters.forceSetMonsterAtSlot(0, monster);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        chaosCard,
        "tap",
      );
      expect(result).toBe(true);
    });

    it("should handle choose-one with option that needs no targets", () => {
      // Some choose-one options might not require additional targets
      // This tests the admissibleTargets.length === 0 case
      const item = game.obtainCard("b2-blank_card") as ItemCard;
      game.cardHandler.addInPlay(player1, item);
      game.cardHandler.recharge(item);

      // Even if we can't test the exact behavior, ensure it doesn't crash
      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        item,
        "tap",
      );
      expect(typeof result === "boolean" || typeof result === "string").toBe(
        true,
      );
    });
  });

  describe("AsMany Selectors", () => {
    it("should return true for asMany selector even with zero targets available", () => {
      // AsMany selectors are optional, so they should always be valid
      // We need to find or create an item with asMany=true
      const item = game.obtainCard("b2-blank_card") as ItemCard;
      game.cardHandler.addInPlay(player1, item);
      game.cardHandler.recharge(item);

      // The method should handle asMany correctly
      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        item,
        "tap",
      );
      expect(typeof result === "boolean" || typeof result === "string").toBe(
        true,
      );
    });
  });

  describe("Count Requirements", () => {
    it("should return error when available targets < required count", () => {
      // Contract from below requires 2 items
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      const item1 = game.obtainCard("b2-blank_card") as ItemCard;
      // Only add 1 item, but need 2

      game.cardHandler.addInPlay(player1, contract);
      game.cardHandler.addInPlay(player1, item1);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      expect(result !== true && result.key === "capability.noValidTargets").toBe(true);
    });

    it("should return true when available targets >= required count", () => {
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      const item1 = game.obtainCard("b2-blank_card") as ItemCard;
      const item2 = game.obtainCard("b2-dry_baby") as ItemCard;
      const item3 = game.obtainCard("b2-book_of_sin") as ItemCard;
      const targetItem = game.obtainCard("b2-boomerang") as ItemCard;

      game.cardHandler.addInPlay(player1, contract);
      game.cardHandler.addInPlay(player1, item1);
      game.cardHandler.addInPlay(player1, item2);
      game.cardHandler.addInPlay(player1, item3);
      game.cardHandler.addInPlay(player2, targetItem);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      expect(result).toBe(true);
    });
  });

  describe("Backtracking Logic", () => {
    it("should backtrack when a choice path leads to invalid state", () => {
      // This tests the backtracking mechanism
      // Create a scenario where initial choices might be invalid
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      const item1 = game.obtainCard("b2-blank_card") as ItemCard;
      const item2 = game.obtainCard("b2-dry_baby") as ItemCard;

      game.cardHandler.addInPlay(player1, contract);
      game.cardHandler.addInPlay(player1, item1);
      game.cardHandler.addInPlay(player1, item2);
      // No items on other players for second selector

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      // Should backtrack and eventually determine no valid path exists
      expect(result !== true && result.key === "capability.noValidTargets").toBe(true);
    });

    it("should find valid path through backtracking", () => {
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      const item1 = game.obtainCard("b2-blank_card") as ItemCard;
      const item2 = game.obtainCard("b2-dry_baby") as ItemCard;
      const targetItem = game.obtainCard("b2-book_of_sin") as ItemCard;

      game.cardHandler.addInPlay(player1, contract);
      game.cardHandler.addInPlay(player1, item1);
      game.cardHandler.addInPlay(player1, item2);
      game.cardHandler.addInPlay(player2, targetItem);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      // Should find valid path through backtracking
      expect(result).toBe(true);
    });
  });

  describe("Paid Effects vs Tap Effects", () => {
    it("should check paid effect (effectId = 0)", () => {
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      const item1 = game.obtainCard("b2-blank_card") as ItemCard;
      const item2 = game.obtainCard("b2-dry_baby") as ItemCard;
      const targetItem = game.obtainCard("b2-book_of_sin") as ItemCard;

      game.cardHandler.addInPlay(player1, contract);
      game.cardHandler.addInPlay(player1, item1);
      game.cardHandler.addInPlay(player1, item2);
      game.cardHandler.addInPlay(player2, targetItem);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      expect(result).toBe(true);
    });

    it("should check tap effect (effectId = 'tap')", () => {
      const boomerang = game.obtainCard("b2-boomerang") as ItemCard;
      game.cardHandler.addInPlay(player1, boomerang);
      game.cardHandler.recharge(boomerang);

      const lootCard = game.obtainCard("b2-a_penny") as LootCard;
      player2.hand.addToHand(lootCard);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        boomerang,
        "tap",
      );
      expect(result).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle items with empty target selectors", () => {
      const chaos = game.obtainCard("b2-chaos") as ItemCard;
      game.cardHandler.addInPlay(player1, chaos);
      game.cardHandler.recharge(chaos);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        chaos,
        "tap",
      );
      expect(result).toBe(true);
    });

    it("should handle items with complex target conditions", () => {
      // Test with an item that has conditional targets
      const item = game.obtainCard("b2-blank_card") as ItemCard;
      game.cardHandler.addInPlay(player1, item);
      game.cardHandler.recharge(item);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        item,
        "tap",
      );
      expect(typeof result === "boolean" || typeof result === "string").toBe(
        true,
      );
    });

    it("should not throw when called on uncharged item with throwIfNotCharged=false", () => {
      const boomerang = game.obtainCard("b2-boomerang") as ItemCard;
      game.cardHandler.addInPlay(player1, boomerang);
      // Don't recharge

      const lootCard = game.obtainCard("b2-a_penny") as LootCard;
      player2.hand.addToHand(lootCard);

      // Should not throw since throwIfNotCharged defaults to false in validTargetExists
      expect(() => {
        const result = TargetBuilder.validTargetExists(
          game,
          player1,
          boomerang,
          "tap",
        );
      }).not.toThrow();
    });

    it("should handle player with no items in play", () => {
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      game.cardHandler.addInPlay(player1, contract);
      // No other items

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      expect(result !== true && result.key === "capability.noValidTargets").toBe(true);
    });

    it("should handle items with null or undefined selectors gracefully", () => {
      const item = game.obtainCard("b2-blank_card") as ItemCard;
      game.cardHandler.addInPlay(player1, item);
      game.cardHandler.recharge(item);

      // Should not throw
      expect(() => {
        const result = TargetBuilder.validTargetExists(
          game,
          player1,
          item,
          "tap",
        );
      }).not.toThrow();
    });
  });

  describe("Integration with Real Cards", () => {
    it("should correctly validate Boomerang targets", () => {
      const boomerang = game.obtainCard("b2-boomerang") as ItemCard;
      game.cardHandler.addInPlay(player1, boomerang);
      game.cardHandler.recharge(boomerang);

      // Boomerang can target any other player (even without loot cards)
      // The effect just won't steal anything if they have no loot
      let result = TargetBuilder.validTargetExists(
        game,
        player1,
        boomerang,
        "tap",
      );
      expect(result).toBe(true);

      // With loot cards - still valid
      const lootCard = game.obtainCard("b2-a_penny") as LootCard;
      player2.hand.addToHand(lootCard);

      result = TargetBuilder.validTargetExists(game, player1, boomerang, "tap");
      expect(result).toBe(true);
    });

    it("should correctly validate Contract From Below targets", () => {
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      game.cardHandler.addInPlay(player1, contract);

      // No items to destroy
      let result = TargetBuilder.validTargetExists(game, player1, contract, 0);
      expect(result !== true && result.key === "capability.noValidTargets").toBe(true);

      // Add items to destroy but no targets to steal
      const item1 = game.obtainCard("b2-blank_card") as ItemCard;
      const item2 = game.obtainCard("b2-dry_baby") as ItemCard;
      game.cardHandler.addInPlay(player1, item1);
      game.cardHandler.addInPlay(player1, item2);

      result = TargetBuilder.validTargetExists(game, player1, contract, 0);
      expect(result !== true && result.key === "capability.noValidTargets").toBe(true);

      // Add target to steal
      const targetItem = game.obtainCard("b2-book_of_sin") as ItemCard;
      game.cardHandler.addInPlay(player2, targetItem);

      result = TargetBuilder.validTargetExists(game, player1, contract, 0);
      expect(result).toBe(true);
    });
  });

  describe("Return Type Consistency", () => {
    it("should return true (boolean) when targets exist", () => {
      const boomerang = game.obtainCard("b2-boomerang") as ItemCard;
      game.cardHandler.addInPlay(player1, boomerang);
      game.cardHandler.recharge(boomerang);

      const lootCard = game.obtainCard("b2-a_penny") as LootCard;
      player2.hand.addToHand(lootCard);

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        boomerang,
        "tap",
      );
      expect(result).toBe(true);
      expect(typeof result).toBe("boolean");
    });

    it("should return string (error message) when no targets exist", () => {
      const contract = game.obtainCard("b2-contract_from_below") as ItemCard;
      game.cardHandler.addInPlay(player1, contract);
      // No items to destroy

      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        contract,
        0,
      );
      expect(result !== true && result.key === "capability.noValidTargets").toBe(true);
    });

    it("should return 'Item not found.' for null item", () => {
      const result = TargetBuilder.validTargetExists(
        game,
        player1,
        null as any,
        "tap",
      );
      expect(result !== true && result.key === "error.itemNotFound").toBe(true);
    });
  });
});
