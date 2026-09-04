import { describe, expect, it } from "bun:test";
import type { Card } from "@/models/cards";
import { EffectTextNumber } from "@/models/effectTextNumber";
import { TargetBuilder } from "@/models/targetBuilder";
import {
  findEffectTextNumbers,
  findValidEffectTextNumberReplacements,
  replaceEffectTextNumber,
} from "@/utils/effectTextNumbers";

describe("effect text number selections", () => {
  it("includes zero and seven but excludes digits that are part of words", () => {
    expect(
      findEffectTextNumbers(["LV1: Gain +0¢, then loot 7."]),
    ).toEqual([
      { occurrenceIndex: 0, textThroughNumber: "LV1: Gain +0", value: 0 },
      {
        occurrenceIndex: 1,
        textThroughNumber: "LV1: Gain +0¢, then loot 7",
        value: 7,
      },
    ]);
  });

  it("allows zero and seven when the replacement remains between one and six", () => {
    expect(findValidEffectTextNumberReplacements(0, 1, 1, 6)).toEqual([1]);
    expect(findValidEffectTextNumberReplacements(7, 1, 1, 6)).toEqual([6]);
  });

  it("serializes and resolves a semantic number occurrence", () => {
    const card = {
      globalId: 42,
      jsonAPI: {
        slug: "b2-the_poop",
        globalId: 42,
        nameKey: { key: "cardNames.b2-the_poop" },
      },
    } as Card;
    const [occurrence] = findEffectTextNumbers(["Prevent the next 1 damage."]);
    const choice = new EffectTextNumber(card, occurrence!);

    const serialized = TargetBuilder.convertToSelectionItems([choice])[0]!;

    expect(serialized).toEqual({
      type: "effectTextNumber",
      payload: {
        card: card.jsonAPI,
        occurrenceIndex: 0,
        value: 1,
      },
    });
    expect(
      TargetBuilder["resolveIdentifier"](serialized, [choice]),
    ).toBe(choice);
  });

  it("replaces only the selected occurrence when text prefixes repeat", () => {
    expect(
      replaceEffectTextNumber(
        ["Gain 1¢.", "Gain 1¢, then loot 1."],
        1,
        2,
      ),
    ).toEqual(["Gain 1¢.", "Gain 2¢, then loot 1."]);
  });

  it("rejects an occurrence that does not exist", () => {
    expect(() => replaceEffectTextNumber(["Gain 1¢."], 1, 2)).toThrow(
      "Effect text number occurrence does not exist: 1",
    );
  });
});
