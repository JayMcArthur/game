import type { BotLevel, Card, DetailedState, Requests, SelectionItem } from "@/shared/api";

export type BotCommand =
  | { type: "declareAttack" }
  | { type: "declarePurchase" }
  | { type: "cancelPurchase" }
  | { type: "attackRoll" }
  | { type: "resolve" }
  | { type: "endTurn" }
  | { type: "attackMonster"; payload: Requests.AttackMonster }
  | { type: "purchase"; payload: Requests.Purchase }
  | { type: "activate"; payload: Requests.Activate };

export interface BotActionOption {
  command: BotCommand;
  source?: Card;
  /** Effective public combat stats. */
  combat?: {
    playerHp: number;
    playerDamage: number;
    monsterHp: number;
    monsterDamage: number;
    hitFaces: number;
  };
  rewards?: { soul: number; coin: number; loot: number; treasure: number };
  cost?: number;
}

export interface BotSelection {
  options: SelectionItem[];
  min: number;
  max: number;
  sourceSlug?: string;
  /** Captured native effect identity; omitted for ambiguous mandatory prompts. */
  sourceEffectIndex?: number | "tap";
  /** Only engine-owned prompts are mandatory; activation targets are progressive. */
  purpose: "activation" | "mandatory";
  reason?: "death" | "maxHandSize" | "other";
}

export interface BotInput {
  version: 1;
  state: DetailedState;
  soulsToWin: number;
  level: BotLevel;
  randomState: number;
  turnActions: number;
  actions: BotActionOption[];
  selection?: BotSelection;
}

export type BotDecision = (
  | { kind: "action"; index: number }
  | { kind: "selection"; indexes: number[] }
  | { kind: "wait" }
) & { randomState: number; reason: string };

export type BotPolicy = (input: BotInput) => BotDecision;
