import { z } from "zod";

export const extensionsAvailable = {
  "b2-": "Base Game",
  "fsp2-": "Four Souls 2+",
  "r-": "Requiem",
  "g2-": "Gold Box",
};

const basicSerializedTranslationSchema = z.object({
  key: z.string(),
});
export type BasicSerializedTranslation = z.infer<
  typeof basicSerializedTranslationSchema
>;

export const serializedTranslationSchema =
  basicSerializedTranslationSchema.extend({
    interpolates: z
      .record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          basicSerializedTranslationSchema,
          z.array(basicSerializedTranslationSchema),
        ]),
      )
      .optional(),
  });
export type SerializedTranslation = z.infer<typeof serializedTranslationSchema>;

export const identifierTypeSchema = z.object({
  nameKey: serializedTranslationSchema,
  slug: z.string(),
  globalId: z.number(),
  orientation: z.union([z.literal("portrait"), z.literal("landscape")]),
});
export type IdentifierType = z.infer<typeof identifierTypeSchema>;

export const entityTypeSchema = identifierTypeSchema.extend({
  color: z.string(),
  type: z.union([
    z.literal("player"),
    z.literal("monster"),
    z.literal("animated"),
  ]),
});
export type EntityType = z.infer<typeof entityTypeSchema>;

const cardSchema = identifierTypeSchema;
export type Card = z.infer<typeof cardSchema>;

const effectTextNumberSchema = z.object({
  card: cardSchema,
  occurrenceIndex: z.number().int().nonnegative(),
  value: z.number().int().min(0).max(7),
});
export type EffectTextNumber = z.infer<typeof effectTextNumberSchema>;

const shopItemSchema = cardSchema.extend({ price: z.number() });
const VisualEffectBoxSchema = z.object({
  startIndex: z.number(),
  endIndex: z.number(),
});
export type VisualEffectBox = z.infer<typeof VisualEffectBoxSchema>;

const DescriptiveVisualEffectBoxSchema = VisualEffectBoxSchema.extend({
  description: z.string(),
});
export type DescriptiveVisualEffectBox = z.infer<
  typeof DescriptiveVisualEffectBoxSchema
>;

const activeEffectEntrySchema = z.object({
  visualEffectBox: VisualEffectBoxSchema,
  index: z.union([z.literal("tap"), z.number()]),
  description: z.string(),
});
export type ActiveEffectEntry = z.infer<typeof activeEffectEntrySchema>;

const deckNameSchema = z.union([
  z.literal("loot"),
  z.literal("treasure"),
  z.literal("monster"),
  z.literal("room"),
]);
export type DeckName = z.infer<typeof deckNameSchema>;

const deckConfigCardSchema = z.object({
  nameKey: basicSerializedTranslationSchema,
  slug: z.string(),
  count: z.number(),
  orientation: z.union([z.literal("portrait"), z.literal("landscape")]),
});

const characterCardSchema = deckConfigCardSchema.extend({
  eternal: z.union([z.string(), z.literal("random")]),
});
export type CharacterCardConfig = z.infer<typeof characterCardSchema>;

export type DeckConfigCard =
  | z.infer<typeof deckConfigCardSchema>
  | z.infer<typeof characterCardSchema>;

const deckSchema = z.object({
  total: z.number(),
  cards: z.array(deckConfigCardSchema),
});

const characterDeckSchema = z.object({
  total: z.number(),
  cards: z.array(characterCardSchema),
});

const serializedCardAndBoxSchema = z.object({
  card: cardSchema,
  visualEffectBox: VisualEffectBoxSchema.optional(),
});
export type SerializedCardAndBox = z.infer<typeof serializedCardAndBoxSchema>;

const cardEffectSchema = serializedCardAndBoxSchema.extend({
  index: z.union([z.literal("tap"), z.number()]),
  visualEffectBox: VisualEffectBoxSchema,
});
export type CardEffect = z.infer<typeof cardEffectSchema>;

export interface SetCardCountRequest {
  slug: string;
  count: number;
}
const serializedChooseOneSchema = serializedCardAndBoxSchema.extend({
  description: z.string(),
  visualEffectBox: VisualEffectBoxSchema,
});
export type SerializedChooseOne = z.infer<typeof serializedChooseOneSchema>;

// Forward declare types for circular references
export type SelectionItem =
  | { type: "card"; payload: Card }
  | { type: "stackElement"; payload: StackElement }
  | { type: "cardEffect"; payload: CardEffect }
  | { type: "player"; payload: EntityType }
  | { type: "monster"; payload: EntityType }
  | { type: "animated"; payload: EntityType }
  | { type: "deck"; payload: DeckName }
  | { type: "number"; payload: number }
  | { type: "effectTextNumber"; payload: EffectTextNumber }
  | { type: "boolean"; payload: boolean }
  | { type: "string"; payload: string }
  | {
      type: "couplePlayerHand";
      payload: { player: IdentifierType; hand: Card[] };
    }
  | { type: "chooseOne"; payload: SerializedChooseOne }
  | { type: "character"; payload: RoomCharacter }
  | { type: "array"; payload: SelectionItem[] }
  | { type: "serializedTranslation"; payload: SerializedTranslation }
  | { type: "object"; payload: { [key: string]: SelectionItem } }
  | { type: "null"; payload: null }
  | { type: "unknown"; payload: null };

export type StackElement =
  | LootCardOnStackJson
  | DeathOnStackJson
  | LootStepJson
  | DamageOnStackJson
  | DiceWillRollJson
  | DiceRollJson
  | EndOfTurnJson
  | EffectOnStackJson;

const selectionItemSchema: z.ZodType<SelectionItem> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("card"), payload: cardSchema }),
    z.object({ type: z.literal("cardEffect"), payload: cardEffectSchema }),
    z.object({ type: z.literal("stackElement"), payload: stackElementSchema }),
    z.object({ type: z.literal("player"), payload: entityTypeSchema }),
    z.object({ type: z.literal("monster"), payload: entityTypeSchema }),
    z.object({ type: z.literal("deck"), payload: deckNameSchema }),
    z.object({ type: z.literal("number"), payload: z.number() }),
    z.object({
      type: z.literal("effectTextNumber"),
      payload: effectTextNumberSchema,
    }),
    z.object({ type: z.literal("boolean"), payload: z.boolean() }),
    z.object({ type: z.literal("string"), payload: z.string() }),
    z.object({
      type: z.literal("serializedTranslation"),
      payload: serializedTranslationSchema,
    }),
    z.object({
      type: z.literal("chooseOne"),
      payload: serializedChooseOneSchema,
    }),
    z.object({
      type: z.literal("couplePlayerHand"),
      payload: z.object({
        player: identifierTypeSchema,
        hand: z.array(cardSchema),
      }),
    }),
    z.object({
      type: z.literal("array"),
      payload: z.array(selectionItemSchema),
    }),
    z.object({
      type: z.literal("object"),
      payload: z.record(z.string(), selectionItemSchema),
    }),
    z.object({ type: z.literal("null"), payload: z.null() }),
    z.object({ type: z.literal("unknown"), payload: z.null() }),
  ]),
);

const pendingSelectionReasonSchema = z.union([
  serializedCardAndBoxSchema,
  z.literal("death"),
  z.literal("maxHandSize"),
  z.literal("coinGift"),
  z.literal("miniDraft"),
]);
export type PendingSelectionReason = z.infer<
  typeof pendingSelectionReasonSchema
>;

const pendingSelectionDetailSchema = z.object({
  requestId: z.number(),
  reason: pendingSelectionReasonSchema,
  description: serializedTranslationSchema,
});
export type pendingSelectionDetail = z.infer<
  typeof pendingSelectionDetailSchema
>;

const pendingSelectionSchema = pendingSelectionDetailSchema.extend({
  options: z.array(selectionItemSchema),
  min: z.number(),
  max: z.number(),
  canUseOnBoardSelection: z.boolean(),
});
export type PendingSelection = z.infer<typeof pendingSelectionSchema>;

const temporaryEffectSchema = z.object({
  card: identifierTypeSchema,
  issuer: z.string(),
  targets: z.array(selectionItemSchema),
  visualEffectBox: VisualEffectBoxSchema.optional(),
});
export type TemporaryEffect = z.infer<typeof temporaryEffectSchema>;

const capabilitySchema = z.union([
  z.literal(true),
  serializedTranslationSchema,
]);
export type Capability = z.infer<typeof capabilitySchema>;

const statsSchema = z.object({
  healthPoints: z.number(),
  attackPoints: z.number(),
  evasionPoints: z.number().optional(),
  isEngagedInCombat: z.boolean(),
  temporaryEffect: z.array(temporaryEffectSchema),
  capabilities: z.object({
    targetable: capabilitySchema,
  }),
});

const counterTypeSchema = z.union([z.literal("normal"), z.literal("golden")]);
export type CounterType = z.infer<typeof counterTypeSchema>;

const serializedCounterSchema = z.object({
  type: counterTypeSchema,
  value: z.number(),
});
export type SerializedCounter = z.infer<typeof serializedCounterSchema>;

const attackableCardSchema = cardSchema.extend({
  counters: z.array(serializedCounterSchema).optional(),
  stats: statsSchema.optional(),
});
export type MonsterCard = z.infer<typeof attackableCardSchema>;

const inPlayCardSchema = attackableCardSchema.extend({
  charged: z.boolean().optional(),
  eternal: z.boolean().optional(),
  capabilities: z.object({
    activate: capabilitySchema,
  }),
});
export type InPlayCard = z.infer<typeof inPlayCardSchema>;

const inPlayWithStatsCardSchema = inPlayCardSchema.extend({
  stats: statsSchema,
});
export type InPlayWithStatsCard = z.infer<typeof inPlayWithStatsCardSchema>;

const inPlayMeCardSchema = inPlayCardSchema.extend({
  effects: z.array(activeEffectEntrySchema).optional(),
});
export type InPlayMeCard = z.infer<typeof inPlayMeCardSchema>;

const inPlayWithStatsMeCardSchema = inPlayMeCardSchema.extend({
  stats: statsSchema,
});
export type InPlayWithStatsMeCard = z.infer<typeof inPlayWithStatsMeCardSchema>;

const bonusSoulCardSchema = cardSchema.extend({
  granted: z.boolean(),
  counters: z.array(serializedCounterSchema).optional(),
});
export type BonusSoulCard = z.infer<typeof bonusSoulCardSchema>;

/**
 * Represents the server's response when building targets progressively
 */
const targetSelectorResponseSchema = z.object({
  /** Description of what to select */
  description: serializedTranslationSchema,
  /** Minimal number of targets to select */
  min: z.number(),
  /** Maximal number of targets to select */
  max: z.number(),
  /** Available options as string identifiers */
  options: z.array(selectionItemSchema),
  /** Whether target building is complete */
  complete: z.boolean(),
  /** For choose-one selectors: true = picking option description, false = picking actual targets */
  isChooseOne: z.boolean(),
});
export type TargetSelectorResponse = z.infer<
  typeof targetSelectorResponseSchema
>;

const stackReorderingInfoSchema = z.object({
  groupId: z.string(),
  ownerId: z.string().optional(),
  event: z.string().optional(),
  listenerId: z.number().optional(),
});
export type StackReorderingInfo = z.infer<typeof stackReorderingInfoSchema>;

const lootCardOnStackJsonSchema = z.object({
  type: z.literal("LootCardEffect"),
  card: identifierTypeSchema,
  targets: z.array(selectionItemSchema),
  visualEffectBox: VisualEffectBoxSchema.optional(),
  issuer: entityTypeSchema,
  id: z.number(),
  reordering: stackReorderingInfoSchema.optional(),
});
export type LootCardOnStackJson = z.infer<typeof lootCardOnStackJsonSchema>;

const diceRollJsonSchema = z.object({
  type: z.literal("diceRoll"),
  diceRoll: z.number(),
  issuer: entityTypeSchema,
  card: identifierTypeSchema.optional(),
  targets: z.array(selectionItemSchema).optional(),
  visualEffectBox: VisualEffectBoxSchema.optional(),
  modifier: z.number(),
  id: z.number(),
  reordering: stackReorderingInfoSchema.optional(),
});
export type DiceRollJson = z.infer<typeof diceRollJsonSchema>;

const diceWillRollJsonSchema = z.object({
  type: z.literal("diceWillRoll"),
  issuer: entityTypeSchema,
  card: identifierTypeSchema,
  visualEffectBox: VisualEffectBoxSchema.optional(),
  attackRoll: z.boolean(),
  id: z.number(),
  reordering: stackReorderingInfoSchema.optional(),
});
export type DiceWillRollJson = z.infer<typeof diceWillRollJsonSchema>;

const deathOnStackJsonSchema = z.object({
  type: z.literal("death"),
  receiver: entityTypeSchema,
  from: entityTypeSchema,
  source: z.union([z.lazy(() => diceRollJsonSchema), identifierTypeSchema]),
  visualEffectBox: VisualEffectBoxSchema.optional(),
  id: z.number(),
  reordering: stackReorderingInfoSchema.optional(),
});
export type DeathOnStackJson = z.infer<typeof deathOnStackJsonSchema>;

const lootStepJsonSchema = z.object({
  type: z.literal("lootStep"),
  player: entityTypeSchema,
  nbLoots: z.number(),
  id: z.number(),
  reordering: stackReorderingInfoSchema.optional(),
});
export type LootStepJson = z.infer<typeof lootStepJsonSchema>;

const endOfTurnJsonSchema = z.object({
  type: z.literal("endOfTurn"),
  player: entityTypeSchema,
  id: z.number(),
  reordering: stackReorderingInfoSchema.optional(),
});
export type EndOfTurnJson = z.infer<typeof endOfTurnJsonSchema>;

const damageOnStackJsonSchema = z.object({
  type: z.literal("damage"),
  receiver: entityTypeSchema,
  from: entityTypeSchema,
  damage: z.number(),
  source: z.union([z.lazy(() => diceRollJsonSchema), identifierTypeSchema]),
  visualEffectBox: VisualEffectBoxSchema.optional(),
  id: z.number(),
  reordering: stackReorderingInfoSchema.optional(),
});
export type DamageOnStackJson = z.infer<typeof damageOnStackJsonSchema>;

const effectOnStackJsonSchema = z.object({
  type: z.literal("effect"),
  issuer: entityTypeSchema,
  targets: z.array(selectionItemSchema),
  card: identifierTypeSchema,
  visualEffectBox: VisualEffectBoxSchema.optional(),
  effect: z.string(),
  id: z.number(),
  reordering: stackReorderingInfoSchema.optional(),
});
export type EffectOnStackJson = z.infer<typeof effectOnStackJsonSchema>;

const stackElementSchema: z.ZodType<StackElement> = z.lazy(() =>
  z.union([
    lootCardOnStackJsonSchema,
    deathOnStackJsonSchema,
    lootStepJsonSchema,
    endOfTurnJsonSchema,
    damageOnStackJsonSchema,
    diceWillRollJsonSchema,
    diceRollJsonSchema,
    effectOnStackJsonSchema,
  ]),
);
export type StackElementJson = z.infer<typeof stackElementSchema>;

const selectionItemTypeSchema = z.union([
  z.literal("card"),
  z.literal("stackElement"),
  z.literal("cardEffect"),
  z.literal("player"),
  z.literal("monster"),
  z.literal("number"),
  z.literal("boolean"),
  z.literal("string"),
  z.literal("couplePlayerHand"),
  z.literal("array"),
  z.literal("object"),
  z.literal("null"),
  z.literal("deck"),
  z.literal("unknown"),
]);
export type SelectionItemType = z.infer<typeof selectionItemTypeSchema>;

const issuerSchema = z.string();

export type Issuer = z.infer<typeof issuerSchema>;

const debugChangeDiceResultRequestSchema = z.object({
  dice: diceRollJsonSchema,
  value: z.number().min(1).max(6),
});
const debugLootRequestSchema = z.object({
  cards: z.array(identifierTypeSchema),
});
const debugGainTreasureRequestSchema = z.object({
  cards: z.array(identifierTypeSchema),
});
const debugPutMonsterCardInSlotRequestSchema = z.object({
  card: identifierTypeSchema,
  toCover: z.union([cardSchema, z.literal("top")]),
});

const debugGainCoinsRequestSchema = z.object({
  coins: z.number(),
});

const debugRemoveCardsRequestSchema = z.object({
  cards: z.array(identifierTypeSchema),
});

const debugPutRoomRequestSchema = z.object({
  card: identifierTypeSchema,
  toCover: cardSchema,
});

const contactTypeSchema = z.enum(["contact", "bug", "suggestion"]);
export type ContactType = z.infer<typeof contactTypeSchema>;

const contactRequestSchema = z.object({
  type: contactTypeSchema,
  description: z.string().min(1).max(3000),
  email: z.email().optional(),
});

const giveCoinsSchema = z.object({
  target: z.string(),
  coins: z.number(),
});

const attackMonsterSchema = z.union([
  z.object({
    card: cardSchema,
  }),
  z.object({
    card: z.literal("top"),
    toCoverIndex: z.number(),
  }),
]);

const booleanGameParameterSchema = z.object({
  text: z.string(),
  value: z.boolean(),
  translationKey: serializedTranslationSchema,
});

const numberGameParameterSchema = z.object({
  text: z.string(),
  value: z.number(),
  replaceZeroWith: z.string().optional(),
  translationKey: serializedTranslationSchema,
});
const decksConfigSchema = z.object({
  useBonusSouls: booleanGameParameterSchema,
  useRooms: booleanGameParameterSchema.optional(),
  nbPlayerCardRestriction: booleanGameParameterSchema.optional(),
  useFSP2Cards: booleanGameParameterSchema.optional(),
  useG2Cards: booleanGameParameterSchema.optional(),
  useB2Cards: booleanGameParameterSchema.optional(),
  useRCards: booleanGameParameterSchema.optional(),

  character: characterDeckSchema,
  monster: deckSchema,
  treasure: deckSchema,
  loot: deckSchema,
  bsoul: deckSchema.optional(),
  room: deckSchema.optional(),
});

export type DeckConfig = z.infer<typeof decksConfigSchema>;

const decksConfigPatchSchema = z.object({
  useBonusSouls: booleanGameParameterSchema.optional(),
  useRooms: booleanGameParameterSchema.optional(),
  nbPlayerCardRestriction: booleanGameParameterSchema.optional(),
  useFSP2Cards: booleanGameParameterSchema.optional(),
  useG2Cards: booleanGameParameterSchema.optional(),
  useB2Cards: booleanGameParameterSchema.optional(),
  useRCards: booleanGameParameterSchema.optional(),

  monster: z.array(deckConfigCardSchema).optional(),
  character: z.array(deckConfigCardSchema).optional(),
  treasure: z.array(deckConfigCardSchema).optional(),
  loot: z.array(deckConfigCardSchema).optional(),
  bsoul: z.array(deckConfigCardSchema).optional(),
  room: z.array(deckConfigCardSchema).optional(),
});

export type DeckConfigPatch = z.infer<typeof decksConfigPatchSchema>;

const gameParametersSchema = z.object({
  miniDraft: booleanGameParameterSchema,
  nbSoulsToWin: numberGameParameterSchema,
  resolveCooldown: numberGameParameterSchema,
  timer: numberGameParameterSchema,
  nbItemsInShop: numberGameParameterSchema,
  nbEncounters: numberGameParameterSchema,
  // nbRooms: numberGameParameterSchema,
  deathPenaltyCoins: numberGameParameterSchema,
  deathPenaltyItem: numberGameParameterSchema,
  deathPenaltyLoot: numberGameParameterSchema,
  treasuresOnStart: numberGameParameterSchema,
  lootOnStart: numberGameParameterSchema,
  coinsOnStart: numberGameParameterSchema,
  shopPrice: numberGameParameterSchema,
  maxHandSize: numberGameParameterSchema,
  allowCoinDonation: booleanGameParameterSchema,
  lootPlayPerTurn: numberGameParameterSchema,
  allowCheatOptions: booleanGameParameterSchema,
  decksConfig: decksConfigSchema,
});
export type GameParametersJson = z.infer<typeof gameParametersSchema>;

// Utility types to extract keys based on parameter value type
export type NumberParameterKeys = {
  [K in keyof GameParametersJson]: GameParametersJson[K] extends {
    value: number;
  }
    ? K
    : never;
}[keyof GameParametersJson];

export type BooleanParameterKeys = {
  [K in keyof GameParametersJson]: GameParametersJson[K] extends {
    value: boolean;
  }
    ? K
    : never;
}[keyof GameParametersJson];

export function isBooleanParameterKey(
  key: keyof GameParametersJson,
): key is BooleanParameterKeys {
  return gameParametersSchema.shape[key] === booleanGameParameterSchema;
}

export function isNumberParameterKey(
  key: keyof GameParametersJson,
): key is NumberParameterKeys {
  return gameParametersSchema.shape[key] === numberGameParameterSchema;
}

export function isParameterKey(key: string): key is keyof GameParametersJson {
  return key in gameParametersSchema.shape;
}

const createRoomRequestSchema = z.object({
  name: z.string(),
});

const setNameRequestSchema = z.string();

export enum Team {
  Team1 = 1,
  Team2 = 2,
  Team3 = 3,
  Team4 = 4,
}

const setTeamRequestSchema = z.object({
  name: z.string(),
  team: z.enum(Team),
});

const basicResponseSchema = z.union([
  z.object({
    status: z.literal(200),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type BasicResponse = z.infer<typeof basicResponseSchema>;

const debugListLootResponseSchema = z.union([
  z.object({
    status: z.literal(200),
    cards: z.array(cardSchema),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type DebugListLootResponse = z.infer<typeof debugListLootResponseSchema>;

const debugListRoomsResponseSchema = z.union([
  z.object({
    status: z.literal(200),
    cards: z.array(cardSchema),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type DebugListRoomsResponse = z.infer<
  typeof debugListRoomsResponseSchema
>;

const DebugListMonsterDeckResponseSchema = z.union([
  z.object({
    status: z.literal(200),
    cards: z.array(cardSchema),
    coverable: z.array(cardSchema),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type DebugListMonsterDeckResponse = z.infer<
  typeof DebugListMonsterDeckResponseSchema
>;

const debugListCardsICanRemoveResponseSchema = z.union([
  z.object({
    status: z.literal(200),
    cards: z.array(cardSchema),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type DebugListCardsICanRemoveResponse = z.infer<
  typeof debugListCardsICanRemoveResponseSchema
>;

const DebugPutRoomResponseSchema = z.union([
  z.object({
    status: z.literal(200),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type DebugPutRoomResponse = z.infer<typeof DebugPutRoomResponseSchema>;

const debugListTreasureResponseSchema = z.union([
  z.object({
    status: z.literal(200),
    cards: z.array(cardSchema),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type DebugListTreasureResponse = z.infer<
  typeof debugListTreasureResponseSchema
>;

const debugListAvailableDicesSchema = z.union([
  z.object({
    status: z.literal(200),
    dices: z.array(diceRollJsonSchema),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type DebugListAvailableDicesResponse = z.infer<
  typeof debugListAvailableDicesSchema
>;

const nextTargetSelectorResponseSchema = z.union([
  z.object({
    response: z.lazy(() => targetSelectorResponseSchema),
    status: z.literal(200),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type NextTargetSelectorResponse = z.infer<
  typeof nextTargetSelectorResponseSchema
>;

const submitSelectionSchema = z.object({
  requestId: z.number(),
  selections: z.array(selectionItemSchema),
});

const insertStackElementBeforeSchema = z.object({
  elementToMoveStackId: z.number(),
  targetStackId: z.union([z.number(), z.literal("start")]),
});

const purchaseSchema = z.object({
  index: z.union([z.number(), z.literal("top")]),
});

const attackRequirementSchema = z.object({
  target: z.union([cardSchema, z.literal("topDeck")]),
  source: cardSchema,
});

export type AttackRequirement = z.infer<typeof attackRequirementSchema>;
const cardActivationSchema = z.object({
  type: z.union([
    z.literal("hand"),
    z.literal("inPlay"),
    z.literal("character"),
    z.literal("room"),
  ]),
  index: z.number(),
  effectIndex: z.union([z.number(), z.literal("tap")]),
  targetChoices: z.array(selectionItemSchema).optional(),
});
const cardActivationWithIdSchema = z.object({
  type: z.union([
    z.literal("hand"),
    z.literal("inPlay"),
    z.literal("character"),
    z.literal("room"),
  ]),
  index: z.number(),
  effectIndex: z.number(),
  targetChoices: z.array(selectionItemSchema).optional(),
});

const setGameParameterRequestSchema = z.discriminatedUnion("parameter", [
  z.object({
    parameter: z.enum(
      Object.keys(gameParametersSchema.shape).filter(
        (key) =>
          gameParametersSchema.shape[
            key as keyof typeof gameParametersSchema.shape
          ] === numberGameParameterSchema,
      ) as [NumberParameterKeys, ...NumberParameterKeys[]],
    ),
    value: z.number(),
  }),
  z.object({
    parameter: z.enum(
      Object.keys(gameParametersSchema.shape).filter(
        (key) =>
          gameParametersSchema.shape[
            key as keyof typeof gameParametersSchema.shape
          ] === booleanGameParameterSchema,
      ) as [BooleanParameterKeys, ...BooleanParameterKeys[]],
    ),
    value: z.boolean(),
  }),
  z.object({
    parameter: z.literal("decksConfig"),
    value: decksConfigPatchSchema,
  }),
]);
export type SetGameParameterRequest = z.infer<
  typeof setGameParameterRequestSchema
>;

const playerSchema = z.object({
  name: z.string(),
  color: z.string(),
  team: z.enum(Team),
  handSize: z.number(),
  hand: z.array(cardSchema).optional(),
  character: inPlayWithStatsCardSchema,
  inPlay: z.array(inPlayCardSchema),
  souls: z.number(),
  soulCards: z.array(cardSchema),
  coins: z.number(),
  remainingLootPlay: z.number(),
  attackRequirements: z.array(attackRequirementSchema),
  isEngagedInPurchase: z.boolean(),
  capabilities: z.object({
    canSwitchTo: capabilitySchema,
    canDonateCoinsTo: capabilitySchema,
  }),
  pendingSelection: pendingSelectionDetailSchema.optional(),
});
export type Player = z.infer<typeof playerSchema>;

const playerMeSchema = playerSchema.extend({
  hand: z.array(cardSchema),
  character: inPlayWithStatsMeCardSchema,
  inPlay: z.array(inPlayMeCardSchema),
  numberOfCardsOverMaxHandSize: z.number(),
  capabilities: z.object({
    endTurn: capabilitySchema,
    declareAttack: capabilitySchema,
    declarePurchase: capabilitySchema,
    rollDice: capabilitySchema,
    buyTreasure: capabilitySchema,
    useLoot: capabilitySchema,
    resolve: capabilitySchema,
    canSwitchTo: capabilitySchema,
    canDonateCoinsTo: capabilitySchema,
  }),
  pendingSelection: pendingSelectionSchema.optional(),
});
export type PlayerMe = z.infer<typeof playerMeSchema>;

const genericAnimationSchema = z.object({
  id: z.string(),
  type: z.string(),
});

const playLootAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("playLoot"),
  card: identifierTypeSchema,
  player: z.string(),
});

const drawLootAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("drawLoot"),
  nb: z.number(),
  player: z.string(),
});

const diceRollAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("diceRoll"),
  player: z.string(),
  diceRoll: z.number(),
});

const transferLootAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("transferLoot"),
  card: identifierTypeSchema,
  sender: z.string(),
  recipient: z.string(),
});

const discardLootAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("discardLoot"),
  card: identifierTypeSchema,
  player: z.string(),
});

const buyTopDeckTreasureAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("buyTopDeckTreasure"),
  card: identifierTypeSchema,
  player: z.string(),
});

const buyShopTreasureAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("buyShopTreasure"),
  card: identifierTypeSchema,
  player: z.string(),
});

const activateInPlayAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("activateInPlay"),
  card: identifierTypeSchema,
});

const obtainBonusSoulAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("obtainBonusSoul"),
  card: identifierTypeSchema,
  player: z.string(),
});

const obtainMonsterSoulAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("obtainMonsterSoul"),
  card: identifierTypeSchema,
  player: z.string(),
});

const giveCoinsAnimationSchema = genericAnimationSchema.extend({
  type: z.literal("giveCoins"),
  sender: z.string(),
  recipient: z.string(),
  count: z.number(),
});

const animationSchema = z.discriminatedUnion("type", [
  playLootAnimationSchema,
  drawLootAnimationSchema,
  diceRollAnimationSchema,
  transferLootAnimationSchema,
  discardLootAnimationSchema,
  buyTopDeckTreasureAnimationSchema,
  buyShopTreasureAnimationSchema,
  obtainBonusSoulAnimationSchema,
  obtainMonsterSoulAnimationSchema,
  activateInPlayAnimationSchema,
  giveCoinsAnimationSchema,
]);
export type Animation = z.infer<typeof animationSchema>;

const encounterSchema = z.object({
  discard: z.array(cardSchema),
  deckSize: z.number(),
  capabilities: z.object({
    targetableDeck: capabilitySchema,
  }),
  inPlay: z.array(
    z.object({
      top: attackableCardSchema,
      covered: z.array(cardSchema),
    }),
  ),
});
export type Encounter = z.infer<typeof encounterSchema>;

const shopSchema = z.object({
  discard: z.array(cardSchema),
  deckSize: z.number(),
  inPlay: z.array(shopItemSchema),
  topDeckPrice: z.number(),
  firstCardTreasureDeck: cardSchema.optional(),
});
export type Shop = z.infer<typeof shopSchema>;

const roomSlotSchema = z
  .object({
    discard: z.array(cardSchema),
    deckSize: z.number(),
    inPlay: z.array(inPlayMeCardSchema),
  })
  .optional();
export type RoomSlot = z.infer<typeof roomSlotSchema>;

const lootDeckSchema = z.object({
  discard: z.array(cardSchema),
  deckSize: z.number(),
});
export type LootDeck = z.infer<typeof lootDeckSchema>;

export const detailedStateSchema = z.object({
  me: playerMeSchema,
  players: z.array(playerSchema),
  monsters: encounterSchema,
  treasure: shopSchema,
  loot: lootDeckSchema,
  bonusSouls: z.array(bonusSoulCardSchema).optional(),
  room: roomSlotSchema,
  turn: z.string(),
  round: z.number(),
  stack: z.array(z.lazy(() => stackElementSchema)),
  history: z.array(stackElementSchema),
  animations: z.array(animationSchema),
  lastStackElementTimeStamp: z.number(),
  pendingSelections: z.array(
    z.object({
      player: z.object({ name: z.string(), color: z.string() }),
      reason: pendingSelectionReasonSchema,
      description: serializedTranslationSchema,
      requestId: z.number(),
    }),
  ),
});
export type DetailedState = z.infer<typeof detailedStateSchema>;

const roomCharacterSchema = z.object({
  character: z.union([z.string(), z.literal("random")]),
  eternal: z.union([z.string(), z.literal("random")]),
});
export type RoomCharacter = z.infer<typeof roomCharacterSchema>;

const roomPlayerSchema = z.object({
  name: z.string(),
  character: roomCharacterSchema,
  isMe: z.boolean(),
  isHost: z.boolean(),
  isCopy: z.boolean(),
  team: z.enum(Team),
});

export type RoomPlayer = z.infer<typeof roomPlayerSchema>;

const roomSchema = z.object({
  id: z.string(),
  players: z.array(roomPlayerSchema),
  characters: z.array(roomCharacterSchema),
  gameParameters: gameParametersSchema,
  game: detailedStateSchema.optional(),
  isJoinAllowed: z.boolean(),
  isSpectator: z.boolean(),
  spectatorCount: z.number(),
  createdAt: z.date(),
  capabilities: z.object({
    join: capabilitySchema,
  }),
});
export type Room = z.infer<typeof roomSchema>;

const roomBroadcastSchema = z.object({
  type: z.enum(["info", "error", "success", "warning", "victory"]),
  title: serializedTranslationSchema,
  message: serializedTranslationSchema,
});
export type RoomBroadcast = z.infer<typeof roomBroadcastSchema>;

const saveGameResponseSchema = z.union([
  z.object({
    status: z.literal(200),
    logs: z.string(),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type SaveGameResponse = z.infer<typeof saveGameResponseSchema>;

const enterRoomRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rejoin"),
    roomId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("join"),
    roomId: z.string(),
    name: z.string(),
  }),
  z.object({
    type: z.literal("spectate"),
    roomId: z.string(),
  }),
]);
const setJoinPermissionSchema = z.boolean();

const loadGameRequestSchema = z.string();

const loadGameParametersRequestSchema = z.string();

const selectCharacterRequestSchema = z.object({
  name: z.string(),
  character: roomCharacterSchema,
});

const kickFromRoomRequestSchema = z.object({
  name: z.string(),
});

const makeCopyOfPlayerRequestSchema = z.object({
  name: z.string(),
});

const switchToCopyRequestSchema = z.object({
  name: z.string(),
});

const adminLoginRequestSchema = z.object({
  password: z.string(),
});

const adminRoomSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastAction: z.string(),
  users: z.number(),
  gameCount: z.number(),
  game: z.union([
    z.object({
      round: z.number(),
      maxSoul: z.number(),
    }),
    z.literal(false),
  ]),
});
export type AdminRoom = z.infer<typeof adminRoomSchema>;

const adminMessageSchema = z.object({
  id: z.number(),
  createdAt: z.string(),
  type: contactTypeSchema,
  description: z.string(),
  email: z.string().nullable(),
  logs: z.string().nullable(),
  resolved: z.boolean(),
  reply: z.string().nullable(),
});
export type AdminMessage = z.infer<typeof adminMessageSchema>;

const adminHourlyStatSchema = z.object({
  gameCount: z.number(),
  date: z.string(),
});

const adminStatsSchema = z.object({
  hourly: z.array(adminHourlyStatSchema).length(24),
});

export type AdminStats = z.infer<typeof adminStatsSchema>;

const adminResponseSchema = z.object({
  rooms: z.array(adminRoomSchema),
  messages: z.array(adminMessageSchema),
  stats: adminStatsSchema,
});
export type AdminResponse = z.infer<typeof adminResponseSchema>;

const adminGetLogsRequestSchema = z.object({
  id: z.number(),
});
export type AdminGetLogsRequest = z.infer<typeof adminGetLogsRequestSchema>;

const adminGetLogsResponseSchema = z.union([
  z.object({
    status: z.literal(200),
    logs: z.string(),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
  z.object({
    status: z.literal(500),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type AdminGetLogsResponse = z.infer<typeof adminGetLogsResponseSchema>;

const adminChangeMessageStatusRequestSchema = z.object({
  id: z.number(),
  resolved: z.boolean(),
});
export type AdminChangeMessageStatusRequest = z.infer<
  typeof adminChangeMessageStatusRequestSchema
>;

const adminReplyToMessageRequestSchema = z.object({
  id: z.number(),
  message: z.string(),
});
export type AdminReplyToMessageRequest = z.infer<
  typeof adminReplyToMessageRequestSchema
>;

const adminReplyToMessageResponseSchema = z.union([
  z.object({
    status: z.literal(200),
  }),
  z.object({
    status: z.literal(400),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
  z.object({
    status: z.literal(500),
    error: z.union([z.string(), serializedTranslationSchema]),
  }),
]);
export type AdminReplyToMessageResponse = z.infer<
  typeof adminReplyToMessageResponseSchema
>;

export const schemas = {
  issuer: issuerSchema,
  room: roomSchema,
  createRoomRequest: createRoomRequestSchema,
  setNameRequest: setNameRequestSchema,
  setTeamRequest: setTeamRequestSchema,
  attackMonsterRequest: attackMonsterSchema,
  debugLootRequest: debugLootRequestSchema,
  debugRemoveCardsRequest: debugRemoveCardsRequestSchema,
  debugPutRoomRequest: debugPutRoomRequestSchema,
  debugGainTreasureRequest: debugGainTreasureRequestSchema,
  debugPutMonsterCardInSlotRequest: debugPutMonsterCardInSlotRequestSchema,
  debugChangeDiceResultRequest: debugChangeDiceResultRequestSchema,
  debugGainCoinsRequest: debugGainCoinsRequestSchema,
  contactRequest: contactRequestSchema,
  submitSelectionRequest: submitSelectionSchema,
  insertStackElementBeforeRequest: insertStackElementBeforeSchema,
  activateRequest: cardActivationSchema,
  activateWithIDRequest: cardActivationWithIdSchema,
  purchaseRequest: purchaseSchema,
  giveCoinsRequest: giveCoinsSchema,
  enterRoomRequest: enterRoomRequestSchema,
  setJoinPermission: setJoinPermissionSchema,
  loadGameRequest: loadGameRequestSchema,
  setGameParameterRequest: setGameParameterRequestSchema,
  loadGameParametersRequest: loadGameParametersRequestSchema,
  selectCharacterRequest: selectCharacterRequestSchema,
  kickFromRoomRequest: kickFromRoomRequestSchema,
  makeCopyOfPlayerRequest: makeCopyOfPlayerRequestSchema,
  switchToCopyRequest: switchToCopyRequestSchema,
  adminLoginRequest: adminLoginRequestSchema,
  adminGetLogsRequest: adminGetLogsRequestSchema,
  adminChangeMessageStatusRequest: adminChangeMessageStatusRequestSchema,
  adminReplyToMessageRequest: adminReplyToMessageRequestSchema,
};

export namespace Requests {
  export type CreateRoom = z.infer<typeof createRoomRequestSchema>;
  export type SetName = z.infer<typeof setNameRequestSchema>;
  export type SetTeam = z.infer<typeof setTeamRequestSchema>;
  export type SetGameParameter = z.infer<typeof setGameParameterRequestSchema>;
  export type SubmitSelection = z.infer<typeof submitSelectionSchema>;
  export type InsertStackElementBefore = z.infer<
    typeof insertStackElementBeforeSchema
  >;
  export type Activate = z.infer<typeof cardActivationSchema>;
  export type ActivateWithID = z.infer<typeof cardActivationWithIdSchema>;
  export type Purchase = z.infer<typeof purchaseSchema>;
  export type GiveCoins = z.infer<typeof giveCoinsSchema>;
  export type AttackMonster = z.infer<typeof attackMonsterSchema>;
  export type DebugLoot = z.infer<typeof debugLootRequestSchema>;
  export type DebugGainCoins = z.infer<typeof debugGainCoinsRequestSchema>;
  export type DebugPutMonsterCardInSlot = z.infer<
    typeof debugPutMonsterCardInSlotRequestSchema
  >;
  export type KickFromRoomRequest = z.infer<typeof kickFromRoomRequestSchema>;
  export type DebugChangeDiceResult = z.infer<
    typeof debugChangeDiceResultRequestSchema
  >;
  export type DebugPutRoom = z.infer<typeof debugPutRoomRequestSchema>;
  export type DebugRemoveCards = z.infer<typeof debugRemoveCardsRequestSchema>;
  export type DebugGainTreasure = z.infer<
    typeof debugGainTreasureRequestSchema
  >;
  export type Contact = z.infer<typeof contactRequestSchema>;
  export type EnterRoom = z.infer<typeof enterRoomRequestSchema>;
  export type SetJoinPermission = z.infer<typeof setJoinPermissionSchema>;
  export type LoadGame = z.infer<typeof loadGameRequestSchema>;
  export type LoadGameParameters = z.infer<
    typeof loadGameParametersRequestSchema
  >;
  export type SelectCharacter = z.infer<typeof selectCharacterRequestSchema>;
  export type KickFromRoom = z.infer<typeof kickFromRoomRequestSchema>;
  export type SwitchToCopy = z.infer<typeof switchToCopyRequestSchema>;
  export type AdminLogin = z.infer<typeof adminLoginRequestSchema>;
  export type AdminGetLogs = z.infer<typeof adminGetLogsRequestSchema>;
  export type AdminChangeMessageStatus = z.infer<
    typeof adminChangeMessageStatusRequestSchema
  >;
  export type AdminReplyToMessage = z.infer<
    typeof adminReplyToMessageRequestSchema
  >;
  export type MakeCopyOfPlayer = z.infer<typeof makeCopyOfPlayerRequestSchema>;
}

export namespace Responses {
  export type SetName = BasicResponse;
  export type SetTeam = BasicResponse;
  export type SetGameParameter = BasicResponse;
  export type Start = BasicResponse;
  export type Rollback = BasicResponse;
  export type DeclareAttack = BasicResponse;
  export type Resolve = BasicResponse;
  export type SubmitSelection = BasicResponse;
  export type InsertStackElementBefore = BasicResponse;
  export type EndTurn = BasicResponse;
  export type Activate = NextTargetSelectorResponse;
  export type Purchase = BasicResponse;
  export type DeclarePurchase = BasicResponse;
  export type CancelPurchase = BasicResponse;
  export type AttackMonster = BasicResponse;
  export type AttackRoll = BasicResponse;
  export type DebugLoot = BasicResponse;
  export type DebugLootTop = BasicResponse;
  export type DebugListLoot = DebugListLootResponse;
  export type DebugListRooms = DebugListRoomsResponse;
  export type DebugListMonsterDeck = DebugListMonsterDeckResponse;
  export type DebugListCardsICanRemove = DebugListCardsICanRemoveResponse;
  export type DebugPutRoom = DebugPutRoomResponse;
  export type DebugRemoveCards = BasicResponse;
  export type DebugListTreasure = DebugListTreasureResponse;
  export type DebugPutMonsterCardInSlot = BasicResponse;
  export type DebugListAvailableDices = DebugListAvailableDicesResponse;
  export type DebugChangeDiceResult = BasicResponse;
  export type DebugGainTreasure = BasicResponse;
  export type DebugGainCoins = BasicResponse;
  export type Contact = BasicResponse;
  export type GiveCoins = BasicResponse;
  export type CreateRoom = BasicResponse;
  export type EnterRoom = BasicResponse;
  export type SetJoinPermission = BasicResponse;
  export type LeaveRoom = BasicResponse;
  export type QuitGame = BasicResponse;
  export type KickFromRoom = BasicResponse;
  export type MakeCopyOfPlayer = BasicResponse;
  export type SaveGame = SaveGameResponse;
  export type LoadGame = BasicResponse;
  export type LoadGameParameters = BasicResponse;
  export type ResetGameParameters = BasicResponse;
  export type SelectCharacter = BasicResponse;
  export type SwitchToCopy = BasicResponse;
  export type AdminLogin = BasicResponse;
  export type AdminGetLogs = AdminGetLogsResponse;
  export type AdminChangeMessageStatus = BasicResponse;
  export type AdminReplyToMessage = AdminReplyToMessageResponse;
}

export interface ServerToClientEvents {
  "on:room:changed": (room: Room | null) => void;
  "on:user:assigned": (userId: string | null) => void;
  "on:room:broadcast": (broadcast: RoomBroadcast) => void;
  "on:game:quit": (userId: string) => void;
  "on:admin:changed": (admin: AdminResponse) => void;
}

export interface ClientToServerEvents {
  createRoom: (
    request: Requests.CreateRoom,
    callback: (response: Responses.CreateRoom) => void,
  ) => void;

  enterRoom: (
    request: Requests.EnterRoom,
    callback: (response: Responses.EnterRoom) => void,
  ) => void;

  leaveRoom: (callback: (response: Responses.LeaveRoom) => void) => void;

  setJoinPermission: (
    request: Requests.SetJoinPermission,
    callback: (response: Responses.SetJoinPermission) => void,
  ) => void;

  kickFromRoom: (
    request: Requests.KickFromRoom,
    callback: (response: Responses.KickFromRoom) => void,
  ) => void;

  makeCopyOfPlayer: (
    request: Requests.MakeCopyOfPlayer,
    callback: (response: Responses.MakeCopyOfPlayer) => void,
  ) => void;

  setName: (
    request: Requests.SetName,
    callback: (response: Responses.SetName) => void,
  ) => void;

  setTeam: (
    request: Requests.SetTeam,
    callback: (response: Responses.SetTeam) => void,
  ) => void;

  start: (callback: (response: Responses.Start) => void) => void;

  rollback: (callback: (response: Responses.Rollback) => void) => void;

  declareAttack: (
    callback: (response: Responses.DeclareAttack) => void,
  ) => void;

  resolve: (callback: (response: Responses.Resolve) => void) => void;

  submitSelection: (
    request: Requests.SubmitSelection,
    callback: (response: Responses.SubmitSelection) => void,
  ) => void;

  insertStackElementBefore: (
    request: Requests.InsertStackElementBefore,
    callback: (response: Responses.InsertStackElementBefore) => void,
  ) => void;

  endTurn: (callback: (response: Responses.EndTurn) => void) => void;

  activate: (
    request: Requests.Activate,
    callback: (response: Responses.Activate) => void,
  ) => void;

  activateWithID: (
    request: Requests.ActivateWithID,
    callback: (response: Responses.Activate) => void,
  ) => void;

  purchase: (
    request: Requests.Purchase,
    callback: (response: Responses.Purchase) => void,
  ) => void;

  attackMonster: (
    request: Requests.AttackMonster,
    callback: (response: Responses.AttackMonster) => void,
  ) => void;

  attackRoll: (callback: (response: Responses.AttackRoll) => void) => void;

  debugLootTop: (callback: (response: Responses.DebugLootTop) => void) => void;

  debugGainTreasureTop: (
    callback: (response: Responses.DebugLootTop) => void,
  ) => void;

  debugLoot: (
    request: Requests.DebugLoot,
    callback: (response: Responses.DebugLoot) => void,
  ) => void;

  debugListLoot: (
    callback: (response: Responses.DebugListLoot) => void,
  ) => void;

  debugListRooms: (
    callback: (response: Responses.DebugListRooms) => void,
  ) => void;

  debugPutRoom: (
    request: Requests.DebugPutRoom,
    callback: (response: Responses.DebugPutRoom) => void,
  ) => void;

  debugListCardsICanRemove: (
    callback: (response: Responses.DebugListCardsICanRemove) => void,
  ) => void;

  debugRemoveCards: (
    request: Requests.DebugRemoveCards,
    callback: (response: Responses.DebugRemoveCards) => void,
  ) => void;

  debugListTreasure: (
    callback: (response: Responses.DebugListTreasure) => void,
  ) => void;

  debugGainTreasure: (
    request: Requests.DebugGainTreasure,
    callback: (response: Responses.DebugGainTreasure) => void,
  ) => void;

  debugListMonsterDeck: (
    callback: (response: Responses.DebugListMonsterDeck) => void,
  ) => void;

  debugListAvailableDices: (
    callback: (response: Responses.DebugListAvailableDices) => void,
  ) => void;

  debugPutMonsterCardInSlot: (
    request: Requests.DebugPutMonsterCardInSlot,
    callback: (response: Responses.DebugPutMonsterCardInSlot) => void,
  ) => void;

  debugChangeDiceResult: (
    request: Requests.DebugChangeDiceResult,
    callback: (response: Responses.DebugChangeDiceResult) => void,
  ) => void;

  debugGainCoins: (
    request: Requests.DebugGainCoins,
    callback: (response: Responses.DebugGainCoins) => void,
  ) => void;

  contact: (
    request: Requests.Contact,
    callback: (response: Responses.Contact) => void,
  ) => void;

  giveCoins: (
    request: Requests.GiveCoins,
    callback: (response: Responses.GiveCoins) => void,
  ) => void;

  declarePurchase: (
    callback: (response: Responses.DeclarePurchase) => void,
  ) => void;

  cancelPurchase: (
    callback: (response: Responses.CancelPurchase) => void,
  ) => void;

  saveGame: (callback: (response: Responses.SaveGame) => void) => void;

  loadGame: (
    request: Requests.LoadGame,
    callback: (response: Responses.LoadGame) => void,
  ) => void;

  setGameParameter: (
    request: Requests.SetGameParameter,
    callback: (response: Responses.SetGameParameter) => void,
  ) => void;

  loadGameParameters: (
    request: Requests.LoadGameParameters,
    callback: (response: Responses.LoadGameParameters) => void,
  ) => void;

  resetGameParameters: (
    callback: (response: Responses.ResetGameParameters) => void,
  ) => void;

  selectCharacter: (
    request: Requests.SelectCharacter,
    callback: (response: Responses.SelectCharacter) => void,
  ) => void;

  switchToCopy: (
    request: Requests.SwitchToCopy,
    callback: (response: Responses.SwitchToCopy) => void,
  ) => void;

  quitGame: (callback: (response: Responses.QuitGame) => void) => void;

  adminLogin: (
    request: Requests.AdminLogin,
    callback: (response: Responses.AdminLogin) => void,
  ) => void;

  adminGetLogs: (
    request: Requests.AdminGetLogs,
    callback: (response: Responses.AdminGetLogs) => void,
  ) => void;

  adminChangeMessageStatus: (
    request: Requests.AdminChangeMessageStatus,
    callback: (response: Responses.AdminChangeMessageStatus) => void,
  ) => void;

  adminReplyToMessage: (
    request: Requests.AdminReplyToMessage,
    callback: (response: Responses.AdminReplyToMessage) => void,
  ) => void;
}
