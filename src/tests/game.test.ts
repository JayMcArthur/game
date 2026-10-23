import { beforeEach, describe, expect, it } from "bun:test";
import type { LootCard } from "@/models/cards";
import { Player } from "@/models/entities/player";
import { GameEventEmitter } from "@/models/eventEmmitter";
import { Game } from "@/models/game";
import { TurnHandler } from "@/models/handlers/turnHandler";
import { type StackElementJson, Team } from "@/shared/api";
import { dischargeEachItemsAndRemoveCoins, emptyHands, mockGameSelections, setupStandardTestGame, setupTestGame } from "@/tests/testHelpers";
import { AttackRollData, StackElement } from "@/models/stackElement";
import { Stack } from "@/models/stack";

class DummyStackElement extends StackElement {
  constructor(private readonly label: string) {
    super();
  }

  get json(): StackElementJson {
    return {
      type: "effect",
      issuer: { type: "player", color:"#000000", nameKey:{key: "dummy"}, slug: "dummy", globalId: 0 , orientation: "portrait"},
      targets: [],
      card: { nameKey: {key: this.label}, slug: this.label, globalId: 0 , orientation: "portrait"},
      effect: this.label,
      id: this.stackId,
      visualEffectBox: { startIndex: 0, endIndex: 0 },
    };
  }
  get debugLogs(): string {
    return `Dummy Stack Element: ${this.label}`;
  }

  async onResolve(): Promise<boolean> {
    return true;
  }
}

describe("Game", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(async () => {
    game = new Game();
    mockGameSelections(game);
    await game.start([{ issuer: "Alice", character: "random", team: Team.Team1 }, { issuer: "Bob", character: "random", team: Team.Team2 }], false);
    player1 = game.entityHandler.getPlayerById("Alice")!;
    player2 = game.entityHandler.getPlayerById("Bob")!;
  });

  it("should create a new game instance", async () => {
    expect(game).toBeDefined();
  });

  it("should add players to the game", async () => {
    expect(game.players.length).toBe(2);
  });

  it("should throw error when retrieving non-existent player", async () => {
    expect(() => {
      game.entityHandler.getPlayerById("nonexistent");
    }).toThrow(`Player with id nonexistent not found.`);
  });
});

describe("Player", () => {
  let player: Player;

  beforeEach(() => {
    player = new Player("testPlayer", Team.Team1);
    player.addAttackPoints(3); // Start with 3 attack points for testing
    player.addHealthPoints(5); // Start with 5 health points for testing
    player.gainCoins(10); // Start with 10 coins for testing
  });

  it("should create a player with correct attributes", async () => {
    expect(player.id).toBe("testPlayer");
    expect(player.attackPoints).toBe(3);
    expect(player.healthPoints).toBe(5);
    expect(player.coins).toBe(10);
  });

  it("should start with full health", async () => {
    expect(player.currentHealthPoints).toBe(5);
    expect(player.isDead).toBe(false);
  });

  it("should start with empty hand", async () => {
    expect(player.hand.cards.length).toBe(0);
  });

  it("should start with zero souls", async () => {
    expect(player.targetableSouls.length).toBe(0);
    expect(player.totalSouls).toBe(0);
  });

  it("should start with no in-play cards", async () => {
    expect(player.inPlay.length).toBe(0);
  });

  it("should gain coins", async () => {
    player.gainCoins(5);
    expect(player.coins).toBe(15);
    player.gainCoins(10);
    expect(player.coins).toBe(25);
  });

  it("should lose coins successfully", async () => {
    expect(player.loseCoins(5, false)).toBe(5);
    expect(player.coins).toBe(5);
  });

  it("should not lose more coins than available without asMany flag", async () => {
    expect(player.loseCoins(20, false)).toBe(0);
    expect(player.coins).toBe(10);
  });

  it("should lose all coins with asMany flag when not enough coins", async () => {
    expect(player.loseCoins(20, true)).toBe(10);
    expect(player.coins).toBe(0);
  });

  it("should receive damage", async () => {
    player.receiveDamage(2);
    expect(player.currentHealthPoints).toBe(3);
    expect(player.isDead).toBe(false);
  });


  it("should not go below zero health", async () => {
    player.receiveDamage(10);
    expect(player.currentHealthPoints).toBe(0);
  });

  it("should heal to full health", async () => {
    player.receiveDamage(3);
    expect(player.currentHealthPoints).toBe(2);
    player.heal();
    expect(player.currentHealthPoints).toBe(5);
    expect(player.isDead).toBe(false);
  });

  it("should die immediately with die() method", async () => {
    player.die();
    expect(player.currentHealthPoints).toBe(0);
    expect(player.isDead).toBe(true);
  });

  it("should roll a dice between 1 and 6", async () => {
    const dice = player.rollDice(Math.random, new AttackRollData(0, 1, 0, 1, 1, player));
    expect(dice.value >= 1 && dice.value <= 6).toBe(true);
    expect(dice.issuer).toBe(player);
  });
});

describe("Player - In-Play Cards", () => {
  let player: Player;

  beforeEach(() => {
    player = new Player("testPlayer", Team.Team1);
    player.character = {} as any;
    player.addAttackPoints(3); // Start with 3 attack points for testing
    player.addHealthPoints(5); // Start with 5 health points for testing
    player.gainCoins(10); // Start with 10 coins for testing
  });

  it("should have empty in-play cards initially", async () => {
    expect(player.inPlay.length).toBe(0);
  });

  it("should be able to add multiple in-play cards", async () => {
    const card1 = { id: "card1", name: "Card 1", type: "item" } as any;
    const card2 = { id: "card2", name: "Card 2", type: "item" } as any;
    const card3 = { id: "card3", name: "Card 3", type: "item" } as any;
    
    player.addInPlay(card1);
    player.addInPlay(card2);
    player.addInPlay(card3);
    
    expect(player.inPlay.length).toBe(3);
  });

  it("should not remove eternal or character cards by index", async () => {
    const eternalCard = { id: "et1", name: "Eternal", type: "eternal", eternal: true } as any;
    const characterCard = { id: "ch1", name: "Char", type: "character", eternal: true } as any;
    const itemCard = { id: "it1", name: "Item", type: "item" } as any;

    player.addInPlay(eternalCard);
    player.addInPlay(characterCard);
    player.addInPlay(itemCard);

    expect(player.removeInPlayByIndex(0)).toBe(false);
    expect(player.removeInPlayByIndex(1)).toBe(false);
    expect(player.inPlay.length).toBe(3);
    expect(player.removeInPlayByIndex(2)).toBe(true);
    expect(player.inPlay.length).toBe(2);
  });

  it("should return false when removing non-existent in-play card", async () => {
    const card = { id: "c1", name: "Card", type: "item" } as any;
    player.addInPlay(card);
    expect(player.removeInPlay({ id: "other" } as any)).toBe(false);
    expect(player.inPlay.length).toBe(1);
  });

  it("should ignore negative index removal", async () => {
    const card = { id: "cardX", name: "CardX", type: "item" } as any;
    player.addInPlay(card);

    const removed = player.removeInPlayByIndex(-1);
    expect(removed).toBe(false);
    expect(player.inPlay.length).toBe(1);
  });

  it("should return true but keep size when removing out-of-range index", async () => {
    const card = { id: "cardY", name: "CardY", type: "item" } as any;
    player.addInPlay(card);

    const removed = player.removeInPlayByIndex(5);
    expect(removed).toBe(true);
    expect(player.inPlay.length).toBe(1);
  });
});

describe("Player - Removal", () => {
  let player: Player;

  beforeEach(() => {
    player = new Player("testPlayer", Team.Team1);
    player.addAttackPoints(3); // Start with 3 attack points for testing
    player.addHealthPoints(5); // Start with 5 health points for testing
    player.gainCoins(10); // Start with 10 coins for testing
  });

  it("should remove card from in-play when present", async () => {
    const card = { id: "cardA", name: "A", type: "item" } as any;
    player.addInPlay(card);

    const removed = player.removeCard(card);
    expect(removed).toBe(true);
    expect(player.inPlay.length).toBe(0);
  });

  it("should remove card from hand when present there", async () => {
    const loot = { id: "loot1", name: "Loot", type: "loot" } as any;
    player.hand.addToHand(loot as any);

    const removed = player.removeCard(loot as any);
    expect(removed).toBe(true);
    expect(player.hand.length).toBe(0);
    expect(player.inPlay.length).toBe(0);
  });
});

describe("Player - Souls", () => {
  let player: Player;

  beforeEach(() => {
    player = new Player("testPlayer", Team.Team1);
    player.addAttackPoints(3); // Start with 3 attack points for testing
    player.addHealthPoints(5); // Start with 5 health points for testing
    player.gainCoins(10); // Start with 10 coins for testing
  });

  it("should start with zero souls", async () => {
    expect(player.targetableSouls.length).toBe(0);
    expect(player.totalSouls).toBe(0);
  });

  it("should be able to add a soul card", async () => {
    const soulCard = { id: "soul1", name: "Soul", soul: 1 } as any;
    player.addSoul(soulCard);
    
    expect(player.targetableSouls.length).toBe(1);
    expect(player.targetableSouls[0]).toBe(soulCard);
  });

  it("should calculate total souls correctly", async () => {
    const soul1 = { id: "soul1", name: "Soul 1", soul: 1 } as any;
    const soul2 = { id: "soul2", name: "Soul 2", soul: 2 } as any;
    const soul3 = { id: "soul3", name: "Soul 3", soul: 1 } as any;
    
    player.addSoul(soul1);
    player.addSoul(soul2);
    player.addSoul(soul3);
    
    expect(player.totalSouls).toBe(4);
  });

  it("should throw error when adding card with no soul", async () => {
    const badCard = { id: "card1", name: "Bad Card", soul: -1 } as any;
    
    expect(() => {
      player.addSoul(badCard);
    }).toThrow("Cannot add a card with no soul as a soul card.");
  });

  it("should be able to remove a soul card", async () => {
    const soul1 = { id: "soul1", name: "Soul 1", soul: 1 } as any;
    const soul2 = { id: "soul2", name: "Soul 2", soul: 2 } as any;
    
    player.addSoul(soul1);
    player.addSoul(soul2);
    expect(player.targetableSouls.length).toBe(2);
    
    const removed = player.removeSoul(soul1);
    expect(removed).toBe(true);
  });

  it("should return false when removing non-existent soul", async () => {
    const soul1 = { id: "soul1", name: "Soul 1", soul: 1 } as any;
    const soul2 = { id: "soul2", name: "Soul 2", soul: 2 } as any;
    
    player.addSoul(soul1);
    const removed = player.removeSoul(soul2);
    
    expect(removed).toBe(false);
    expect(player.targetableSouls.length).toBe(1);
  });
});

describe("Player - Damage & Health", () => {
  let player: Player;

  beforeEach(() => {
    player = new Player("testPlayer", Team.Team1);
    player.addAttackPoints(3); // Start with 3 attack points for testing
    player.addHealthPoints(10); // Start with 10 health points for testing
    player.gainCoins(10); // Start with 10 coins for testing
  });

  it("should take multiple damage hits", async () => {
    player.receiveDamage(2);
    expect(player.currentHealthPoints).toBe(8);
    
    player.receiveDamage(3);
    expect(player.currentHealthPoints).toBe(5);
    
    player.receiveDamage(1);
    expect(player.currentHealthPoints).toBe(4);
  });

  it("should survive partial damage and be alive", async () => {
    player.receiveDamage(5);
    expect(player.isDead).toBe(false);
    expect(player.currentHealthPoints).toBe(5);
  });

  it("should be dead after exactly reaching zero health", async () => {
    player.receiveDamage(10);
    expect(player.currentHealthPoints).toBe(0);
  });

  it("should recover to full health after heal", async () => {
    player.receiveDamage(7);
    expect(player.currentHealthPoints).toBe(3);
    
    player.heal();
    expect(player.currentHealthPoints).toBe(10);
    expect(player.isDead).toBe(false);
  });
});

describe("Player - Coins", () => {
  let player: Player;

  beforeEach(() => {
    player = new Player("testPlayer", Team.Team1);
    player.addAttackPoints(3); // Start with 3 attack points for testing
    player.addHealthPoints(5); // Start with 5 health points for testing
    player.gainCoins(100); // Start with 100 coins for testing
  });

  it("should start with correct coin amount", async () => {
    expect(player.coins).toBe(100);
  });

  it("should gain multiple coin transactions", async () => {
    player.gainCoins(10);
    expect(player.coins).toBe(110);
    
    player.gainCoins(25);
    expect(player.coins).toBe(135);
    
    player.gainCoins(5);
    expect(player.coins).toBe(140);
  });

  it("should lose exact amount of coins when available", async () => {
    const lost = player.loseCoins(25, false);
    
    expect(lost).toBe(25);
    expect(player.coins).toBe(75);
  });

  it("should lose multiple times", async () => {
    player.loseCoins(20, false);
    expect(player.coins).toBe(80);
    
    player.loseCoins(30, false);
    expect(player.coins).toBe(50);
    
    player.loseCoins(50, false);
    expect(player.coins).toBe(0);
  });

  it("should handle edge case of zero coins", async () => {
    const lost = player.loseCoins(100, false);
    expect(lost).toBe(100);
    expect(player.coins).toBe(0);
    
    const lostMore = player.loseCoins(1, false);
    expect(lostMore).toBe(0);
  });

  it("should use asMany flag correctly", async () => {
    const lost = player.loseCoins(150, true);
    expect(lost).toBe(100);
    expect(player.coins).toBe(0);
  });
});

describe("Multi death things", () => {
  let game: Game;
    let player1: Player;
    let player2: Player;

    beforeEach(async () => {
        const setup = await setupStandardTestGame();
        game = setup.game;
        player1 = setup.player1;
        player2 = setup.player2!;
    });

    it("should handle multiple deaths in a row", async () => {
      const card = game.obtainCard("b2-gold_bomb") as LootCard;
      const card2 = game.obtainCard("b2-bomb-2") as LootCard;

      game.cardHandler.addCardToHand(player1, card);
      game.cardHandler.addCardToHand(player1, card2);

      game.actions.playCard(player1, 1, [player2]); // play bomb
      game.actions.playCard(player1, 0, [player2]); // play gold bomb

      await game.actions.resolveStack(); // resolve card
      await game.actions.resolveStack(); // resolve damage
      await game.actions.resolveStack(); // resolve death
      await game.actions.resolveStack(); // resolve effect

      expect(player2.isDead).toBe(true);
      await game.actions.resolveStack(); // resolve card
      expect(game.stack.size).toBe(0);
    });
});

describe("DiceRoll", () => {
  let player: Player;

  beforeEach(() => {
    player = new Player("testPlayer", Team.Team1);
    player.addAttackPoints(3);
    player.addHealthPoints(5);
    player.gainCoins(10);
    player.character = {} as any;
  });

  it("should create a valid dice roll", async () => {
    const dice = player.rollDice(Math.random, new AttackRollData(0, 1, 0, 1, 1, player));
    
    expect(dice).toBeDefined();
    expect(dice.value >= 1 && dice.value <= 6).toBe(true);
  });

  it("should track the issuer correctly", async () => {
    const dice = player.rollDice(Math.random, new AttackRollData(0, 1, 0, 1, 1, player));
    expect(dice.issuer).toBe(player);
    expect(dice.issuer.id).toBe("testPlayer");
  });

  it("should allow setting dice value between 1 and 6", async () => {
    const dice = player.rollDice(Math.random, new AttackRollData(0, 1, 0, 1, 1, player));
    
    dice.value = 1;
    expect(dice.value).toBe(1);
    
    dice.value = 6;
    expect(dice.value).toBe(6);
    
    dice.value = 3;
    expect(dice.value).toBe(3);
  });

  it("should roll and generate new value", async () => {
    const dice = player.rollDice(Math.random, new AttackRollData(0, 1, 0, 1, 1, player));
    const firstValue = dice.value;
    
    dice.roll();
    const secondValue = dice.value;
    
    // Values should be between 1 and 6
    expect(firstValue >= 1 && firstValue <= 6).toBe(true);
    expect(secondValue >= 1 && secondValue <= 6).toBe(true);
  });

  it("should return json representation correctly", async () => {
    const dice = player.rollDice(Math.random, new AttackRollData(0, 1, 0, 1, 1, player));
    const json = dice.json;
    expect(json.issuer.nameKey.interpolates!["content"]).toBe("testPlayer");
    expect(json.diceRoll >= 1 && json.diceRoll <= 6).toBe(true);
  });

  it("should resolve to current value", async () => {
    const dice = player.rollDice(Math.random, new AttackRollData(0, 1, 0, 1, 1, player));
    dice.value = 4;
    
    expect(dice.value).toBe(4);
  });
});

describe("Game - Multiple Players", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;
  let player3: Player;

  beforeEach(() => {
    game = new Game();
    mockGameSelections(game);
    player1 =new Player("player1", Team.Team1);
    player2 =new Player("player2", Team.Team2);
    player3 = new Player("player3", Team.Team3);
    player1.addAttackPoints(2);
    player1.addHealthPoints(4);
    player1.gainCoins(10);
    player2.addAttackPoints(3);
    player2.addHealthPoints(5);
    player2.gainCoins(15);
    player3.addAttackPoints(1);
    player3.addHealthPoints(6);
    player3.gainCoins(8);
  });

  it("should add multiple players", async () => {
    game.entityHandler.addPlayer(player1);
    game.entityHandler.addPlayer(player2);
    game.entityHandler.addPlayer(player3);
    
    expect(game.players.length).toBe(3);
  });

  it("should throw error when adding duplicate player ID", async () => {
    game.entityHandler.addPlayer(player1);
    const duplicatePlayer =new Player("player1", Team.Team1);
    duplicatePlayer.addAttackPoints(2); // Start with 2 attack points for testing
    duplicatePlayer.addHealthPoints(4); // Start with 4 health points for testing
    duplicatePlayer.gainCoins(10); // Start with 10 coins for testing
    
    expect(() => {
      game.entityHandler.addPlayer(duplicatePlayer);
    }).toThrow();
  });

  it("should retrieve correct players", async () => {
    game.entityHandler.addPlayer(player1);
    game.entityHandler.addPlayer(player2);
    game.entityHandler.addPlayer(player3);
    
    expect(() => game.entityHandler.getPlayerById("player1")).not.toThrow();
    expect(() => game.entityHandler.getPlayerById("player2")).not.toThrow();
    expect(() => game.entityHandler.getPlayerById("player3")).not.toThrow();
  });

  it("should maintain player order", async () => {
    game.entityHandler.addPlayer(player1);
    game.entityHandler.addPlayer(player2);
    game.entityHandler.addPlayer(player3);
    
    expect(game.players[0]).toBe(player1);
    expect(game.players[1]).toBe(player2);
    expect(game.players[2]).toBe(player3);
  });

  it("should get all players hands", async () => {
    game.entityHandler.addPlayer(player1);
    game.entityHandler.addPlayer(player2);
    game.entityHandler.addPlayer(player3);
    
    const hands = game.cardHandler.allHands();
    expect(hands.length).toBe(3);
    expect(hands[0]?.player).toBe(player1);
    expect(hands[1]?.player).toBe(player2);
    expect(hands[2]?.player).toBe(player3);
  });
});

describe("Game - Guardrails", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(async () => {
    game = new Game();
    mockGameSelections(game);
    await game.start([{ issuer: "player1", character: "random", team: Team.Team1 }, { issuer: "player2", character: "random", team: Team.Team2 }], false);
    player1 = game.entityHandler.getPlayerById("player1")!;
    player2 = game.entityHandler.getPlayerById("player2")!;
    player1.addAttackPoints(2);
    player1.addHealthPoints(4);
    player1.gainCoins(5);
    player2.addAttackPoints(2);
    player2.addHealthPoints(4);
    player2.gainCoins(5);
  });

  it("should not allow adding players after game start", async () => {
    dischargeEachItemsAndRemoveCoins(game);
    emptyHands(game);
    const latePlayer = new Player("playerlate", Team.Team1);
    latePlayer.addAttackPoints(1);
    latePlayer.addHealthPoints(1);
    latePlayer.gainCoins(0);
    expect(() => game.entityHandler.addPlayer(latePlayer)).toThrow("Game already started");
  });

  it("should select the first n options", async () => {
    const options = [1, 2, 3, 4];
    const result = await game.select(player1, 2, 2, options, {key:""}, "death");
    expect(result.selected).toEqual([1, 2]);
    expect(result.remaining).toEqual([3, 4]);
  });
});

describe("Game - Stack Operations", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(() => {
    game = new Game();
    mockGameSelections(game);
    player1 =new Player("player1", Team.Team1);
    player2 =new Player("player2", Team.Team2);
    player1.addAttackPoints(2);
    player1.addHealthPoints(4);
    player1.gainCoins(10);
    player2.addAttackPoints(3);
    player2.addHealthPoints(5);
    player2.gainCoins(15);
    game.entityHandler.addPlayer(player1);
    game.entityHandler.addPlayer(player2);
  });

  it("should have an empty stack initially", async () => {
    expect(game.stack.size).toBe(0);
  });

  it("should reset the stack", async () => {
    game.resetStack();
    expect(game.stack.size).toBe(0);
  });

  it("should cancel stack", async () => {
    game.cancelStack();
    expect(game.stack.size).toBe(0);
  });

  it("should add to stack dice roll", async () => {
    const dice = player1.rollDice(Math.random, new AttackRollData(0, 1, 0, 1, 1, player1));
    game.addToStack(dice);
    expect(game.stack.size).toBe(1);

  });
});

describe("Stack - Behavior", () => {

  it("should resolve and remove the top element", async () => {
    const stack = new Stack(new Game());
    const loot = { id: "loot", type: "loot" } as any;
    const p1 = new Player("player1", Team.Team1);
    p1.addAttackPoints(1); // Start with 1 attack points for testing
    p1.addHealthPoints(1); // Start with 1 health points for testing
    p1.gainCoins(0); // Start with 0 coins for testing

    
    const dice = p1.rollDice(Math.random, new AttackRollData(0, 1, 0, 1, 1, p1));

    stack.push(loot as any);
    stack.push(dice);

    const resolved = stack.resolve();
    expect(resolved).toBe(dice);
    expect(stack.size).toBe(1);
  });

  it("should remove element at index", async () => {
    const stack = new Stack(new Game());
    const a = { id: "a", type: "loot", onCancel(game: Game){} } as any;
    const b = { id: "b", type: "loot", onCancel(game: Game){} } as any;
    const c = { id: "c", type: "loot", onCancel(game: Game){} } as any;

    stack.push(a as any);
    stack.push(b as any);
    stack.push(c as any);

    stack.removeAt(1);
    expect(stack.size).toBe(2);
    expect(stack.elements[0]).toBe(a);
    expect(stack.elements[1]).toBe(c);
  });

  it("should insert a stack element before another in same reordering group", async () => {
    const stack = new Stack(new Game());
    const a = new DummyStackElement("A");
    const b = new DummyStackElement("B");
    const c = new DummyStackElement("C");

    a.reordering = { groupId: "g1" };
    b.reordering = { groupId: "g1" };
    c.reordering = { groupId: "g1" };

    stack.push(a);
    stack.push(b);
    stack.push(c);

    stack.insertStackElementBefore(c, b);

    expect(stack.elements[0]).toBe(a);
    expect(stack.elements[1]).toBe(c);
    expect(stack.elements[2]).toBe(b);
  });

  it("should throw when trying to reorder elements from different groups", async () => {
    const stack = new Stack(new Game());
    const a = new DummyStackElement("A");
    const b = new DummyStackElement("B");

    a.reordering = { groupId: "g1" };
    b.reordering = { groupId: "g2" };

    stack.push(a);
    stack.push(b);

    expect(() => stack.insertStackElementBefore(b, a)).toThrow("Cannot reorder elements from different groups.");
  });

  it("should throw when one of the elements has no reordering group", async () => {
    const stack = new Stack(new Game());
    const a = new DummyStackElement("A");
    const b = new DummyStackElement("B");

    a.reordering = { groupId: "g1" };

    stack.push(a);
    stack.push(b);

    expect(() => stack.insertStackElementBefore(a, b)).toThrow("Both elements must belong to a reordering group.");
  });
});

describe("GameEventEmitter - listener reordering", () => {
  it("should reorder only the provided listener subset", async () => {
    const emitter = new GameEventEmitter();
    const issuer = new Player("player1", Team.Team1 );
    const seenOrder: string[] = [];
    let idA = -1;
    let idC = -1;

    emitter.on("on:turn:start", () => {
      seenOrder.push("A");
      idA = emitter.getCurrentEmissionContext()?.listenerId ?? idA;
    });
    emitter.on("on:turn:start", () => {
      seenOrder.push("B");
    });
    emitter.on("on:turn:start", () => {
      seenOrder.push("C");
      idC = emitter.getCurrentEmissionContext()?.listenerId ?? idC;
    });

    emitter.emit("on:turn:start", { eventIssuer: issuer });
    expect(seenOrder).toEqual(["A", "B", "C"]);
    expect(idA).toBeGreaterThan(0);
    expect(idC).toBeGreaterThan(0);

    seenOrder.length = 0;
    emitter.reorderListenersBySubset("on:turn:start", [idC, idA]);
    emitter.emit("on:turn:start", { eventIssuer: issuer });

    // A and C were swapped while B stayed in the middle position.
    expect(seenOrder).toEqual(["C", "B", "A"]);
  });
});


describe("TurnHandler", () => {
  it("should advance turns and rounds correctly", async () => {
    const handler = new TurnHandler(null as any);
    const p1 = new Player("player1", Team.Team1);
    p1.addAttackPoints(1); // Start with 1 attack points for testing
    p1.addHealthPoints(1); // Start with 1 health points for testing
    const p2 = new Player("player2", Team.Team2);
    p2.addAttackPoints(1); // Start with 1 attack points for testing
    p2.addHealthPoints(1); // Start with 1 health points for testing

    handler.initialize([p1, p2]);
    expect(handler.current).toBe(p1);
    expect(handler.round).toBe(1);

    handler.endTurn();
    expect(handler.current).toBe(p2);
    expect(handler.round).toBe(1);

    handler.endTurn();
    expect(handler.current).toBe(p1);
    expect(handler.round).toBe(2);
  });
});

describe("Game - Souls & State", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(() => {
    game = new Game();
    mockGameSelections(game);
    player1 =new Player("player1", Team.Team1);
    player1.addAttackPoints(2); // Start with 2 attack points for testing
    player1.addHealthPoints(4); // Start with 4 health points for testing
    player1.gainCoins(10); // Start with 10 coins for testing
    player2 =new Player("player2", Team.Team2);
    player2.addAttackPoints(3); // Start with 3 attack points for testing
    player2.addHealthPoints(5); // Start with 5 health points for testing
    player2.gainCoins(15); // Start with 15 coins for testing
    game.entityHandler.addPlayer(player1);
    game.entityHandler.addPlayer(player2);
  });

  it("should compute players with most souls", async () => {
    const soul1 = { id: "s1", name: "Soul 1", soul: 1, setEternal: ()=>{} } as any;
    const soul2 = { id: "s2", name: "Soul 2", soul: 2, setEternal: ()=>{} } as any;

    game.cardHandler.addSoul(player1, soul1);
    game.cardHandler.addSoul(player2, soul2);

    const leaders = game.playersWithMostSouls;
    expect(leaders.length).toBe(1);
    expect(leaders[0]).toBe(player2);
  });

  it("should return all leaders on tie", async () => {
    const soul = { id: "s1", name: "Soul", soul: 1, setEternal: ()=>{} } as any;
    game.cardHandler.addSoul(player1, soul);
    game.cardHandler.addSoul(player2, soul);

    const leaders = game.playersWithMostSouls;
    expect(leaders.length).toBe(2);
    expect(leaders).toContain(player1);
    expect(leaders).toContain(player2);
  });

  it("should return both players when no souls are present", async () => {
    const leaders = game.playersWithMostSouls;
    expect(leaders.length).toBe(2);
    expect(leaders).toContain(player1);
    expect(leaders).toContain(player2);
  });
});

describe("Game - Damage System", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(async () => {
    const setup = await setupTestGame({
                            characters: ["b2-samson", "b2-isaac"],
                            monsters: ["b2-fly", "b2-fatty"],
                            monsterDeck: ["b2-red_host", "b2-pooter","b2-cod_worm","b2-spider","b2-conjoined_fatty", "b2-dip","b2-leech","b2-gurdy"],
                            treasureDeck: ["b2-boomerang", "b2-guppys_head", "b2-blank_card", "b2-tech_x", "b2-the_battery", "b2-lucky_foot", "b2-mini_mush", "b2-spoon_bender"],
                            bonusSouls: [],
                            playerCount: 2,
                            rooms: true,
                        });
            game = setup.game;
            player1 = setup.player1;
            player2 = setup.player2!;
            game.resetStack();
            game.resetCallbacks();
    player1.addAttackPoints(2); // Start with 2 attack points for testing
    player1.addHealthPoints(10); // Start with 10 health points for testing
    player1.gainCoins(10); // Start with 10 coins for testing
    player2.addAttackPoints(3); // Start with 3 attack points for testing
    player2.addHealthPoints(8); // Start with 8 health points for testing
    player2.gainCoins(15); // Start with 15 coins for testing
    });

  it("should deal damage between entities", async () => {
    const initialHealth = player2.currentHealthPoints;
    const mockCard = { name: "Test Card" } as any;
    
    game.entityHandler.dealDamage(player1, player2, {card: mockCard, visualEffectBox: undefined}, 1);
    await game.actions.resolveStack();
    expect(player2.currentHealthPoints).toBe(initialHealth - 1);
  });

  it("should handle zero damage", async () => {
    const initialHealth = player2.currentHealthPoints;
    const mockCard = { name: "Test Card" } as any;
    
    game.entityHandler.dealDamage(player1, player2, {card: mockCard, visualEffectBox: undefined}, 0);
    await game.actions.resolveStack();
    await game.actions.resolveStack();
    
    expect(player2.currentHealthPoints).toBe(initialHealth);
  });

  it("should handle damage that kills entity", async () => {
    const mockCard = { name: "Test Card" } as any;
    
    game.entityHandler.dealDamage(player1, player2, {card: mockCard, visualEffectBox: undefined}, 100);
    await game.actions.resolveStack();
    await game.actions.resolveStack();

    expect(game.stack.size).toBe(0);
    expect(player2.isDead).toBe(true);
  });
});

describe("Player - Edge Cases & Combinations", () => {
  let player: Player;

  beforeEach(() => {
    player = new Player("testPlayer", Team.Team1);
    player.addAttackPoints(5); // Start with 5 attack points for testing
    player.addHealthPoints(20); // Start with 20 health points for testing
    player.gainCoins(50); // Start with 50 coins for testing
  });

  it("should handle multiple damage and healing cycles", async () => {
    player.receiveDamage(5);
    expect(player.currentHealthPoints).toBe(15);
    
    player.heal();
    expect(player.currentHealthPoints).toBe(20);
    
    player.receiveDamage(10);
    expect(player.currentHealthPoints).toBe(10);
    
    player.heal();
    expect(player.currentHealthPoints).toBe(20);
  });

  it("should handle complex coin transactions", async () => {
    player.gainCoins(25);
    expect(player.coins).toBe(75);
    
    player.loseCoins(20, false);
    expect(player.coins).toBe(55);
    
    player.gainCoins(10);
    expect(player.coins).toBe(65);
    
    player.loseCoins(100, true);
    expect(player.coins).toBe(0);
    
    player.gainCoins(30);
    expect(player.coins).toBe(30);
  });

  it("should maintain player attributes immutably", async () => {
    const originalAttack = player.attackPoints;
    const originalHealth = player.healthPoints;
    
    player.receiveDamage(5);
    
    expect(player.attackPoints).toBe(originalAttack);
    expect(player.healthPoints).toBe(originalHealth);
  });

  it("should handle soul card with zero soul value", async () => {
    const zeroSoulCard = { id: "soul0", name: "Zero Soul", soul: 1 } as any;
    
    // Should not throw since soul is 1
    player.addSoul(zeroSoulCard);
    expect(player.targetableSouls.length).toBe(1);
    expect(player.totalSouls).toBe(1);
  });

  it("should handle many souls correctly", async () => {
    const souls = [];
    for (let i = 1; i <= 10; i++) {
      const soul = { id: `soul${i}`, name: `Soul ${i}`, soul: i } as any;
      souls.push(soul);
      player.addSoul(soul);
    }
    
    expect(player.targetableSouls.length).toBe(10);
    expect(player.totalSouls).toBe(55); // 1+2+3+...+10 = 55
  });

  it("should handle removing items in various ways", async () => {
    const card1 = { id: "card1", name: "Card 1", type: "item" } as any;
    const card2 = { id: "card2", name: "Card 2", type: "item" } as any;
    const card3 = { id: "card3", name: "Card 3", type: "character" } as any;
    
    player.addInPlay(card1);
    player.addInPlay(card2);
    player.addInPlay(card3);
    
    expect(player.inPlay.length).toBe(3);
    
    // Remove regular card
    player.removeInPlay(card1);
    expect(player.inPlay.length).toBe(2);
  });
});
