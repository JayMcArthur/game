import { describe, expect, it } from "bun:test";
import { combatOdds } from "@/bots/combat";

describe("bounded bot combat estimates", () => {
  it("matches an independent enumeration of short fights including received overkill", () => {
    function enumerate(hits: number, hp: number): { win: number; damage: number } {
      if (hits === 0) return { win: 1, damage: 0 };
      if (hp <= 0) return { win: 0, damage: 0 };
      const hit = enumerate(hits - 1, hp);
      const miss = enumerate(hits, hp - 2);
      return { win: (hit.win + miss.win) / 2, damage: (hit.damage + Math.min(hp, 2) + miss.damage) / 2 };
    }
    for (const playerHp of [1, 2, 3, 4]) {
      for (const monsterHp of [1, 2, 3]) {
        const actual = combatOdds({ playerHp, playerDamage: 1, monsterHp, monsterDamage: 2, hitFaces: 3 });
        const expected = enumerate(monsterHp, playerHp);
        expect(actual.winProbability).toBeCloseTo(expected.win, 12);
        expect(actual.expectedDamage).toBeCloseTo(expected.damage, 12);
        expect(actual.coverage).toBe("exact-simple");
      }
    }
  });

  it("handles certain hits, impossible hits and already ended fights", () => {
    const facts = { playerHp: 2, playerDamage: 1, monsterHp: 1, monsterDamage: 1, hitFaces: 6 };
    expect(combatOdds(facts).winProbability).toBe(1);
    expect(combatOdds({ ...facts, hitFaces: 0 }).winProbability).toBe(0);
    expect(combatOdds({ ...facts, playerHp: 0 }).winProbability).toBe(0);
    expect(combatOdds({ ...facts, monsterHp: 0 }).winProbability).toBe(1);
    expect(combatOdds({ ...facts, monsterDamage: 0 }).expectedDamage).toBe(0);
    expect(combatOdds({ ...facts, playerDamage: 0 }).coverage).toBe("approximate");
  });

  it("labels complex and oversized fights approximate without an unbounded table", () => {
    const facts = { playerHp: 2, playerDamage: 1, monsterHp: 2, monsterDamage: 1, hitFaces: 3 };
    expect(combatOdds(facts, false).coverage).toBe("approximate");
    const large = combatOdds({ ...facts, playerHp: 1_000_000, monsterHp: 1_000_000 });
    expect(large.coverage).toBe("approximate");
    expect(large.winProbability).toBeGreaterThanOrEqual(0);
    expect(large.winProbability).toBeLessThanOrEqual(1);
    expect(() => combatOdds({ ...facts, playerHp: Infinity })).toThrow("finite");
  });
});
