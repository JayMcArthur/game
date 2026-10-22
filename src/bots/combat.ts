import type { BotActionOption } from "./types";

export type SimpleCombat = NonNullable<BotActionOption["combat"]>;

export interface CombatOdds {
  winProbability: number;
  expectedDamage: number;
  coverage: "exact-simple" | "approximate";
}

/**
 * Adapted from four_souls/packages/bots/src/combat.ts.
 * Copyright 2026 Jay McArthur.
 * Exact only for independent d6 hit/miss rolls and constant damage, without other effects.
 */
export function combatOdds(input: SimpleCombat, plainMechanics = true): CombatOdds {
  if (Object.values(input).some(value => !Number.isFinite(value)))
    throw new Error("Combat facts must be finite");
  const { playerHp, playerDamage, monsterHp, monsterDamage } = input;
  const p = Math.max(0, Math.min(6, input.hitFaces)) / 6;
  const coverage = plainMechanics ? "exact-simple" : "approximate";
  if (playerHp <= 0) return { winProbability: 0, expectedDamage: 0, coverage };
  if (monsterHp <= 0) return { winProbability: 1, expectedDamage: 0, coverage };
  if (playerDamage <= 0 || p === 0)
    return { winProbability: 0, expectedDamage: playerHp, coverage: "approximate" };
  if (monsterDamage <= 0 || p === 1) return { winProbability: 1, expectedDamage: 0, coverage };
  const hits = Math.ceil(monsterHp / playerDamage);
  const misses = Math.ceil(playerHp / monsterDamage);
  if (hits * misses > 4096) {
    const expectedMisses = hits * (1 - p) / p;
    return {
      winProbability: Math.max(0, Math.min(1, 0.5 + (misses - expectedMisses) / (2 * misses))),
      expectedDamage: Math.min(playerHp, expectedMisses * monsterDamage),
      coverage: "approximate",
    };
  }
  let wins = Array<number>(misses + 1).fill(1);
  let damage = Array<number>(misses + 1).fill(0);
  wins[0] = 0;
  for (let hit = 1; hit <= hits; hit++) {
    const nextWins = Array<number>(misses + 1).fill(0);
    const nextDamage = Array<number>(misses + 1).fill(0);
    for (let miss = 1; miss <= misses; miss++) {
      nextWins[miss] = p * wins[miss]! + (1 - p) * nextWins[miss - 1]!;
      nextDamage[miss] = p * damage[miss]! + (1 - p) * (
        Math.min(monsterDamage, playerHp - (misses - miss) * monsterDamage) + nextDamage[miss - 1]!
      );
    }
    wins = nextWins;
    damage = nextDamage;
  }
  return { winProbability: wins[misses]!, expectedDamage: damage[misses]!, coverage };
}
