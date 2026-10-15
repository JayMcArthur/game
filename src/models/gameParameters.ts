import { GameError } from "@/models/GameError";
import { CARD_SETS } from "@/models/handlers/cardHandler";
import type {
  CharacterCardConfig,
  DeckConfig,
  DeckConfigCard,
  DeckConfigPatch,
  GameParametersJson,
  SetGameParameterRequest,
  DeckName,
} from "@/shared/api";
import { toSerializedTranslation } from "@/utils/translation";
import type { Card, CharacterCard, DeckType } from "./cards";
import { FORBIDDEN_PREFIXES } from "@/utils/loadCards";
class NumericGameParameter {
  private _value: number;
  private _min: number;
  private _max: number;
  private _initialValue: number;

  constructor(
    min: number,
    value: number,
    max: number,
    private readonly onChange: () => void,
  ) {
    this._value = value;
    this._min = min;
    this._max = max;
    this._initialValue = value;
  }

  get value(): number {
    return this._value;
  }

  set value(value: number) {
    this._value = NumericGameParameter.clamp(value, this._min, this._max);
    this.onChange();
  }

  get min(): number {
    return this._min;
  }

  get max(): number {
    return this._max;
  }

  reset(emitChange: boolean = true): void {
    this._value = this._initialValue;
    if (emitChange) {
      this.onChange();
    }
  }

  static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

class DeckParameter {
  protected _type: DeckType;
  protected _currentCount: number = 0;
  protected _cards: { card: Card; param: NumericGameParameter }[] = [];
  protected _minCardInDeck: number;
  protected _maxCardInDeck: number;
  protected _filter: (card: Card) => boolean;

  constructor(
    type: DeckType,
    minCardInDeck: number = 100,
    maxCardInDeck: number = 1000,
    protected readonly onChange: () => void,
    protected F: (card: Card) => boolean,
  ) {
    this._type = type;
    this._currentCount = -1;
    this._filter = F;
    this._minCardInDeck = minCardInDeck;
    this._maxCardInDeck = maxCardInDeck;
    this.createParamForUniqueCards();
    this.resetCardCounts(false);
  }
  get count(): number {
    return this._currentCount;
  }

  get cardsParam(): { card: Card; param: NumericGameParameter }[] {
    return this._cards;
  }
  set filter(F: (card: Card) => boolean) {
    this._filter = F;
  }
  resetCardCounts(emitChange: boolean = true): void {
    this._currentCount = 0;
    for (const card of this._cards) {
      if (this._filter(card.card)) {
        card.param.reset(false);
        this._currentCount += card.param.value;
      } else {
        card.param.value = 0;
      }
    }
    if (emitChange) {
      this.onChange();
    }
  }

  setExpansionEnabled(prefix: string, enabled: boolean): void {
    for (const card of this._cards) {
      if (!card.card.slug.startsWith(prefix)) continue;
      if (enabled) {
        card.param.reset(false);
      } else {
        card.param.value = 0;
      }
    }
    this._currentCount = this._cards.reduce(
      (total, card) => total + card.param.value,
      0,
    );
  }
  createParamForUniqueCards(): void {
    const uniqueCards: { card: Card; count: number }[] = [];
    this._currentCount = 0;
    for (const card of CARD_SETS[this._type].cards) {
      let existing = uniqueCards.find((c) => c.card.isSameCard(card));
      if (!existing) {
        uniqueCards.push({ card, count: 0 });
        existing = uniqueCards[uniqueCards.length - 1]!;
      }
      this._currentCount++;
      existing.count++;
    }
    uniqueCards.forEach((c) => {
      let count = c.count;
      switch (c.card.name) {
        case "A Penny!":
          count = 2;
          break;
        case "2 Cents!":
          count = 6;
          break;
        case "3 Cents!":
          count = 11;
          break;
        case "4 Cents!":
          count = 11;
          break;
        case "A Nickel!":
          count = 6;
          break;
        default:
          break;
      }
      this._cards.push({
        card: c.card,
        param: new NumericGameParameter(0, count, 100, () => {}),
      });
    });
  }

  /** Apply a deck configuration: set counts for provided cards and recompute total */
  applyDeckConfig(cards: DeckConfigCard[]): void {
    for (const c of cards) {
      this.setCardParameter(c.slug, c.count, false);
    }
    this.onChange();
  }

  setCardParameter(
    slug: string,
    value: number,
    callOnChange: boolean = true,
  ): void {
    const card = this._cards.find((x) => x.card.slug === slug);
    if (card) {
      // set without using setCardParameter to avoid per-card total checks while applying
      const previousCount = card.param.value;
      if (this._currentCount - previousCount + value > this._maxCardInDeck) {
        const newValue =
          card.param.value + (this._maxCardInDeck - this._currentCount);
        card.param.value = newValue;
      } else if (
        this._currentCount - previousCount + value <
        this._minCardInDeck
      ) {
        const newValue =
          card.param.value - (this._currentCount - this._minCardInDeck);
        card.param.value = newValue;
      } else card.param.value = value;
      this._currentCount += card.param.value - previousCount;
    } else {
      throw new GameError(
        `Card with slug ${slug} not found in deck ${this._type}`,
        toSerializedTranslation("error.cardWithSlugNotFound", {
          slug: slug,
          deck: toSerializedTranslation(
            `startStep.gameParams.decks.${this._type as DeckName}`,
          ),
        }),
      );
    }
    if (callOnChange) {
      this.onChange();
    }
  }

  reset(emitChange: boolean = true): void {
    for (const card of this._cards) {
      card.param.reset(emitChange);
    }
    this._currentCount = CARD_SETS[this._type].cards.length;
  }

  get total(): number {
    return this._currentCount;
  }

  get type(): DeckType {
    return this._type;
  }

  json(): DeckConfigCard[] {
    const result: DeckConfigCard[] = [];
    for (const card of this._cards) {
      result.push({
        slug: card.card.slug,
        nameKey: card.card.nameKey,
        count: card.param.value,
        orientation: card.card.type === "room" ? "landscape" : "portrait",
      });
    }
    return result;
  }
}

class CharacterDeckParameter extends DeckParameter {
  constructor(
    minCardInDeck: number = 100,
    maxCardInDeck: number = 1000,
    onChange: () => void,
    F: (card: Card) => boolean,
  ) {
    super("character", minCardInDeck, maxCardInDeck, onChange, F);
  }
  override json(): CharacterCardConfig[] {
    const result: CharacterCardConfig[] = [];
    for (const card of this._cards) {
      result.push({
        slug: card.card.slug,
        nameKey: card.card.nameKey,
        count: card.param.value,
        eternal: (card.card as CharacterCard).eternalCard ?? "random",
        orientation: card.card.type === "room" ? "landscape" : "portrait",
      });
    }
    return result;
  }
}

class BooleanGameParameter {
  private _value: boolean;
  private _initialValue: boolean;

  constructor(
    value: boolean,
    private readonly onChange: () => void,
  ) {
    this._value = value;
    this._initialValue = value;
  }

  set value(value: boolean) {
    this._value = value;
    this.onChange();
  }

  get value(): boolean {
    return this._value;
  }

  reset(emitChange: boolean = true): void {
    this._value = this._initialValue;
    if (emitChange) {
      this.onChange();
    }
  }
}

export class GameParameters {
  readonly miniDraft: BooleanGameParameter;
  readonly useB2Cards: BooleanGameParameter;
  readonly useFSP2Cards: BooleanGameParameter;
  readonly useG2Cards: BooleanGameParameter;
  readonly useRCards: BooleanGameParameter;
  readonly nbSoulsToWin: NumericGameParameter;
  readonly resolveCooldown: NumericGameParameter;
  readonly nbItemsInShop: NumericGameParameter;
  readonly mulliganCharacterNbOptions: NumericGameParameter;
  readonly mulliganCharacterReroll: BooleanGameParameter;
  readonly timer: NumericGameParameter;
  readonly nbRooms: NumericGameParameter;
  readonly nbEncounters: NumericGameParameter;
  readonly deathPenaltyCoins: NumericGameParameter;
  readonly deathPenaltyItem: NumericGameParameter;
  readonly deathPenaltyLoot: NumericGameParameter;
  readonly treasuresOnStart: NumericGameParameter;
  readonly lootOnStart: NumericGameParameter;
  readonly coinsOnStart: NumericGameParameter;
  readonly shopPrice: NumericGameParameter;
  readonly lootPlayPerTurn: NumericGameParameter;
  readonly maxHandSize: NumericGameParameter;
  readonly allowCoinDonation: BooleanGameParameter;
  readonly playWithBonusSouls: BooleanGameParameter;
  readonly playWithRooms: BooleanGameParameter;
  /** only cards with minimum player requirement satisfied in decks. */
  readonly nbPlayerCardRestriction: BooleanGameParameter;
  readonly allowCheatOptions: BooleanGameParameter;
  readonly character: CharacterDeckParameter;
  readonly monster: DeckParameter;
  readonly treasure: DeckParameter;
  readonly loot: DeckParameter;
  readonly bsoul: DeckParameter;
  readonly room: DeckParameter;

  readonly _onChange: () => void;
  private _currentNbPlayers: number;
  readonly _getCurrentNbPlayers = (): number =>
    Math.max(this._currentNbPlayers, 1);

  private _deckMode: "standard" | "custom" = "standard";
  get deckMode(): "standard" | "custom" {
    return this._deckMode;
  }
  private _filter: (card: Card) => boolean = (card: Card) => {
    // Expansion toggles always apply, including in custom mode.
    if (!this.useB2Cards.value && card.slug.startsWith("b2-")) return false;
    if (!this.useFSP2Cards.value && card.slug.startsWith("fsp2-")) return false;
    if (!this.useG2Cards.value && card.slug.startsWith("g2-")) return false;
    if (!this.useRCards.value && card.slug.startsWith("r-")) return false;
    // In custom mode, don't apply the player-count filter.
    if (this._deckMode === "custom") return true;
    // cards meeting player minimum filter
    if (
      this.nbPlayerCardRestriction.value &&
      card.minimumPlayers > this._getCurrentNbPlayers()
    )
      return false;
    return true;
  };

  private updateExpansionCards(prefix: string, enabled: boolean): void {
    this._deckMode = "standard";
    for (const deck of [
      this.character,
      this.monster,
      this.treasure,
      this.loot,
      this.bsoul,
      this.room,
    ]) {
      deck.setExpansionEnabled(prefix, enabled);
    }
    this._onChange();
  }

  constructor(onChange: () => void) {
    this._onChange = onChange;
    this._currentNbPlayers = 0;
    this.miniDraft = new BooleanGameParameter(false, onChange);
    this.nbPlayerCardRestriction = new BooleanGameParameter(true, onChange);
    this.useB2Cards = new BooleanGameParameter(
      true,
      () => this.updateExpansionCards("b2-", this.useB2Cards.value),
    );
    this.useFSP2Cards = new BooleanGameParameter(
      true,
      () => this.updateExpansionCards("fsp2-", this.useFSP2Cards.value),
    );
    this.useG2Cards = new BooleanGameParameter(
      true,
      () => this.updateExpansionCards("g2-", this.useG2Cards.value),
    );
    this.useRCards = new BooleanGameParameter(
      process.env.USE_REQUIEM === "true",
      () => this.updateExpansionCards("r-", this.useRCards.value),
    );
    this.nbSoulsToWin = new NumericGameParameter(1, 4, 20, onChange);
    this.resolveCooldown = new NumericGameParameter(0, 0, 100, onChange);
    this.character = new CharacterDeckParameter(4, 100, onChange, this._filter);
    this.monster = new DeckParameter(
      "monster",
      0,
      1000,
      onChange,
      this._filter,
    );
    this.treasure = new DeckParameter(
      "treasure",
      0,
      1000,
      onChange,
      this._filter,
    );
    this.loot = new DeckParameter("loot", 0, 1000, onChange, this._filter);
    this.bsoul = new DeckParameter("bsoul", 0, 100, onChange, this._filter);
    this.room = new DeckParameter("room", 0, 100, onChange, this._filter);
    this.nbItemsInShop = new NumericGameParameter(0, 2, 6, onChange);
    this.mulliganCharacterNbOptions = new NumericGameParameter(1, 1, 5, onChange);
    this.mulliganCharacterReroll = new BooleanGameParameter(false, onChange);
    this.nbRooms = new NumericGameParameter(1, 1, 1, onChange);
    this.nbEncounters = new NumericGameParameter(1, 2, 6, onChange);
    this.timer = new NumericGameParameter(0, 0, 100, onChange);
    this.deathPenaltyCoins = new NumericGameParameter(0, 1, 20, onChange);
    this.deathPenaltyItem = new NumericGameParameter(0, 1, 10, onChange);
    this.deathPenaltyLoot = new NumericGameParameter(0, 1, 10, onChange);
    this.treasuresOnStart = new NumericGameParameter(0, 0, 10, onChange);
    this.lootOnStart = new NumericGameParameter(0, 3, 10, onChange);
    this.coinsOnStart = new NumericGameParameter(0, 3, 20, onChange);
    this.shopPrice = new NumericGameParameter(1, 10, 20, onChange);
    this.maxHandSize = new NumericGameParameter(1, 10, 100, onChange);
    this.allowCoinDonation = new BooleanGameParameter(true, onChange);
    this.lootPlayPerTurn = new NumericGameParameter(1, 1, 10, onChange);
    this.allowCheatOptions = new BooleanGameParameter(true, onChange);
    this.playWithBonusSouls = new BooleanGameParameter(true, onChange);
    this.playWithRooms = new BooleanGameParameter(
      process.env.USE_ROOMS === "true",
      onChange,
    );
  }

  toJson(): GameParametersJson {
    const decks: DeckConfig = {
      useBonusSouls: {
        text: "Use bonus souls?",
        value: this.playWithBonusSouls.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.useBonusSouls",
        ),
      },
      ...(this.room.cardsParam.length > 0
        ? {
            useRooms: {
              text: "Use rooms?",
              value: this.playWithRooms.value,
              translationKey: toSerializedTranslation(
                "startStep.gameParams.useRooms",
              ),
            },
          }
        : {}),
      ...(this._currentNbPlayers < 3
        ? {
            nbPlayerCardRestriction: {
              text: "Number player card restriction",
              value: this.nbPlayerCardRestriction.value,
              translationKey: toSerializedTranslation(
                "startStep.gameParams.nbPlayerCardRestriction",
              ),
            },
          }
        : {}),
      ...(!FORBIDDEN_PREFIXES.includes("b2-")
        ? {
            useB2Cards: {
              text: "Use base game cards?",
              value: this.useB2Cards.value,
              translationKey: toSerializedTranslation(
                "startStep.gameParams.useExpansionCards",
                { expansionName: "Base Game" },
              ),
            },
          }
        : {}),
      ...(!FORBIDDEN_PREFIXES.includes("r-")
        ? {
            useRCards: {
              text: "Use Requiem cards?",
              value: this.useRCards.value,
              translationKey: toSerializedTranslation(
                "startStep.gameParams.useExpansionCards",
                { expansionName: "Requiem" },
              ),
            },
          }
        : {}),
      ...(!FORBIDDEN_PREFIXES.includes("fsp2-")
        ? {
            useFSP2Cards: {
              text: "Use four souls+ cards?",
              value: this.useFSP2Cards.value,
              translationKey: toSerializedTranslation(
                "startStep.gameParams.useExpansionCards",
                { expansionName: "Four Souls+" },
              ),
            },
          }
        : {}),
      ...(!FORBIDDEN_PREFIXES.includes("g2-")
        ? {
            useG2Cards: {
              text: "Use gold box+ cards?",
              value: this.useG2Cards.value,
              translationKey: toSerializedTranslation(
                "startStep.gameParams.useExpansionCards",
                { expansionName: "Gold Box V2" },
              ),
            },
          }
        : {}),
      character: { total: this.character.count, cards: this.character.json() },
      monster: { total: this.monster.count, cards: this.monster.json() },
      treasure: { total: this.treasure.count, cards: this.treasure.json() },
      loot: { total: this.loot.count, cards: this.loot.json() },
      ...(this.playWithBonusSouls.value
        ? { bsoul: { total: this.bsoul.count, cards: this.bsoul.json() } }
        : {}),
      ...(this.playWithRooms.value
        ? { room: { total: this.room.count, cards: this.room.json() } }
        : {}),
    };
    return {
      miniDraft: {
        text: "Mini-draft",
        value: this.miniDraft.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.miniDraft",
        ),
      }, //: At the start of the game, lay out (number of players + 1) treasure cards. Each player choose one of them and gain them, in turn order. Put the last card on the bottom of the treasure deck. Repeat this process with the order reversed.
      nbSoulsToWin: {
        text: "Number of souls to win",
        value: this.nbSoulsToWin.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.nbSoulsToWin",
        ),
      },
      resolveCooldown: {
        text: "Cooldown between Resolve",
        value: this.resolveCooldown.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.resolveCooldown",
        ),
      },
      allowCheatOptions: {
        text: "Allow cheat options",
        value: this.allowCheatOptions.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.allowCheatOptions",
        ),
      },
      nbItemsInShop: {
        text: "Number of items in the shop",
        value: this.nbItemsInShop.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.nbItemsInShop",
        ),
      },
      mulliganCharacterNbOptions: {
        text: "Number of mulligan options for random characters",
        value: this.mulliganCharacterNbOptions.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.mulliganCharacterNbOptions",
        ),
      },
      mulliganCharacterReroll: {
        text: "Allow rerolling of mulligan options for random characters",
        value: this.mulliganCharacterReroll.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.mulliganCharacterReroll",
        ),
      },
      timer: {
        text: "Number of rounds before losing",
        value: this.timer.value,
        replaceZeroWith: "∞",
        translationKey: toSerializedTranslation("startStep.gameParams.timer"),
      },
      nbEncounters: {
        text: "Number of encounters",
        value: this.nbEncounters.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.nbEncounters",
        ),
      },
      // nbRooms: {text: "Number of rooms", value: this.nbRooms.value},
      deathPenaltyCoins: {
        text: "Death penalty coins",
        value: this.deathPenaltyCoins.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.deathPenaltyCoins",
        ),
      },
      deathPenaltyItem: {
        text: "Death penalty item",
        value: this.deathPenaltyItem.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.deathPenaltyItem",
        ),
      },
      deathPenaltyLoot: {
        text: "Death penalty loot",
        value: this.deathPenaltyLoot.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.deathPenaltyLoot",
        ),
      },
      treasuresOnStart: {
        text: "Treasures on start",
        value: this.treasuresOnStart.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.treasuresOnStart",
        ),
      },
      lootOnStart: {
        text: "Loot on start",
        value: this.lootOnStart.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.lootOnStart",
        ),
      },
      coinsOnStart: {
        text: "Coins on start",
        value: this.coinsOnStart.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.coinsOnStart",
        ),
      },
      shopPrice: {
        text: "Shop price",
        value: this.shopPrice.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.shopPrice",
        ),
      },
      maxHandSize: {
        text: "Max hand size",
        value: this.maxHandSize.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.maxHandSize",
        ),
      },
      allowCoinDonation: {
        text: "Allow coin donation",
        value: this.allowCoinDonation.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.allowCoinDonation",
        ),
      },
      lootPlayPerTurn: {
        text: "Loot play per turn",
        value: this.lootPlayPerTurn.value,
        translationKey: toSerializedTranslation(
          "startStep.gameParams.lootPlayPerTurn",
        ),
      },
      decksConfig: decks,
    };
  }

  loadFromJson(
    json: SetGameParameterRequest | GameParametersJson,
    deckMode: "standard" | "custom" = "standard",
  ): void {
    for (const key in json) {
      if (!json.hasOwnProperty(key)) continue;
      if (key === "decksConfig") {
        const decks = (json as any).decksConfig as DeckConfig;
        // Apply flags first: expansion toggles restore that expansion's default
        // counts, so applying card counts before them would overwrite custom decks.
        if (decks.useBonusSouls) {
          this.playWithBonusSouls.value = decks.useBonusSouls.value;
        }
        if (decks.useRooms) {
          this.playWithRooms.value = decks.useRooms.value;
        }
        if (decks.useB2Cards) {
          this.useB2Cards.value = decks.useB2Cards.value;
        }
        if (decks.useFSP2Cards) {
          this.useFSP2Cards.value = decks.useFSP2Cards.value;
        }
        if (decks.useG2Cards) {
          this.useG2Cards.value = decks.useG2Cards.value;
        }
        if (decks.useRCards) {
          this.useRCards.value = decks.useRCards.value;
        }
        if (decks.nbPlayerCardRestriction) {
          this.nbPlayerCardRestriction.value =
            decks.nbPlayerCardRestriction.value;
        }
        if (decks.monster) {
          this.monster.applyDeckConfig(decks.monster.cards);
        }
        if (decks.treasure) {
          this.treasure.applyDeckConfig(decks.treasure.cards);
        }
        if (decks.loot) {
          this.loot.applyDeckConfig(decks.loot.cards);
        }
        if (decks.bsoul) {
          this.bsoul.applyDeckConfig(decks.bsoul.cards);
        }
        if (decks.room) {
          this.room.applyDeckConfig(decks.room.cards);
        }
        if (decks.character) {
          this.character.applyDeckConfig(decks.character.cards);
        }
        this._deckMode = deckMode;
        continue;
      }
      if (this.hasOwnProperty(key)) {
        const param = (this as any)[key] as
          | NumericGameParameter
          | BooleanGameParameter;
        if (param && typeof (json as any)[key].value !== "undefined") {
          param.value = (json as any)[key].value;
        }
      }
    }
  }

  /** Set a single parameter by key without full serialization/deserialization cycle
   * Avoids the overhead of serializing all parameters when only changing one */
  setParameterByKey(key: string, value: any): void {
    if (key === "decksConfig") {
      // Special handling for complex deck configuration
      const decks = value as DeckConfigPatch;

      // Apply provided deck card counts first so that top-level flags (like
      // nbPlayerCardRestriction) that may remove/restore cards are applied
      // afterwards and take precedence.
      if (
        decks.monster ||
        decks.treasure ||
        decks.loot ||
        decks.bsoul ||
        decks.room ||
        decks.character
      ) {
        // If specific cards were provided, we assume the config is custom and switch to custom mode to avoid overwriting counts with standard config when toggling flags.
        this._deckMode = "custom";
      }
      if (decks.monster) this.monster.applyDeckConfig(decks.monster);
      if (decks.treasure) this.treasure.applyDeckConfig(decks.treasure);
      if (decks.loot) this.loot.applyDeckConfig(decks.loot);
      if (decks.bsoul) this.bsoul.applyDeckConfig(decks.bsoul);
      if (decks.room) this.room.applyDeckConfig(decks.room);
      if (decks.character) this.character.applyDeckConfig(decks.character);
      if (decks.useBonusSouls?.value !== undefined) {
        this.playWithBonusSouls.value = decks.useBonusSouls.value;
      }
      if (decks.useRooms?.value !== undefined) {
        this.playWithRooms.value = decks.useRooms.value;
      }
      if (decks.nbPlayerCardRestriction?.value !== undefined) {
        this.nbPlayerCardRestriction.value =
          decks.nbPlayerCardRestriction.value;
        for (const deck of [
          this.character,
          this.monster,
          this.treasure,
          this.loot,
          this.bsoul,
          this.room,
        ]) {
          deck.filter = this._filter;
          deck.resetCardCounts(false);
        }
        this._onChange();
      }
      if (decks.useB2Cards?.value !== undefined) {
        this.useB2Cards.value = decks.useB2Cards.value;
      }
      if (decks.useFSP2Cards?.value !== undefined) {
        this.useFSP2Cards.value = decks.useFSP2Cards.value;
      }
      if (decks.useG2Cards?.value !== undefined) {
        this.useG2Cards.value = decks.useG2Cards.value;
      }
      if (decks.useRCards?.value !== undefined) {
        this.useRCards.value = decks.useRCards.value;
      }
      return;
    }

    // Handle scalar parameters (numeric or boolean)
    if (this.hasOwnProperty(key)) {
      const param = (this as any)[key] as
        | NumericGameParameter
        | BooleanGameParameter;
      if (param && param instanceof NumericGameParameter) {
        param.value = value;
      } else if (param && param instanceof BooleanGameParameter) {
        param.value = value;
      }
    }
  }

  reset() {
    this.miniDraft.reset();
    this.useB2Cards.reset();
    this.useFSP2Cards.reset();
    this.useG2Cards.reset();
    this.useRCards.reset();
    this.nbSoulsToWin.reset();
    this.resolveCooldown.reset();
    this.nbItemsInShop.reset();
    this.mulliganCharacterNbOptions.reset();
    this.mulliganCharacterReroll.reset();
    this.timer.reset();
    this.nbRooms.reset();
    this.nbEncounters.reset();
    this.deathPenaltyCoins.reset();
    this.deathPenaltyItem.reset();
    this.deathPenaltyLoot.reset();
    this.treasuresOnStart.reset();
    this.lootOnStart.reset();
    this.coinsOnStart.reset();
    this.shopPrice.reset();
    this.lootPlayPerTurn.reset();
    this.maxHandSize.reset();
    this.allowCoinDonation.reset();
    this.playWithBonusSouls.reset();
    this.playWithRooms.reset();
    this.nbPlayerCardRestriction.reset();
    this.allowCheatOptions.reset();
    this.character.reset();
    this.monster.reset();
    this.treasure.reset();
    this.loot.reset();
    this.bsoul.reset();
    this.room.reset();
    this._deckMode = "standard";
  }

  setPlayerCount(count: number): void {
    this._currentNbPlayers = count;
    if (this.nbPlayerCardRestriction.value && this._deckMode === "standard") {
      for (const deck of [
        this.character,
        this.monster,
        this.treasure,
        this.loot,
        this.bsoul,
        this.room,
      ]) {
        deck.filter = this._filter;
        deck.resetCardCounts(false);
      }
    }
  }
}
