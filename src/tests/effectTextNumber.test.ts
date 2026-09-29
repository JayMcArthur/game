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
  it("finds all digit runs and records their numeral format", () => {
    expect(
      findEffectTextNumbers(["LV1: Roll a ❺ or ➁, gain 10¢, then roll 3x."]),
    ).toEqual([
      {
        occurrenceIndex: 0,
        sourceText: "1",
        textThroughNumber: "LV1",
        value: 1,
        format: "plain",
      },
      {
        occurrenceIndex: 1,
        sourceText: "❺",
        textThroughNumber: "LV1: Roll a ❺",
        value: 5,
        format: "filledCircled",
      },
      {
        occurrenceIndex: 2,
        sourceText: "➁",
        textThroughNumber: "LV1: Roll a ❺ or ➁",
        value: 2,
        format: "sansSerifCircled",
      },
      {
        occurrenceIndex: 3,
        sourceText: "10",
        textThroughNumber: "LV1: Roll a ❺ or ➁, gain 10",
        value: 10,
        format: "plain",
      },
      {
        occurrenceIndex: 4,
        sourceText: "3",
        textThroughNumber: "LV1: Roll a ❺ or ➁, gain 10¢, then roll 3",
        value: 3,
        format: "plain",
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

  it("preserves circled numeral formats when replacing a value", () => {
    expect(replaceEffectTextNumber(["Roll a ❺ or ➄."], 0, 4)).toEqual([
      "Roll a ❹ or ➄.",
    ]);
    expect(replaceEffectTextNumber(["Roll a ❺ or ➄."], 1, 6)).toEqual([
      "Roll a ❺ or ➅.",
    ]);
  });

  it("detects values outside the editable range without offering a replacement", () => {
    expect(
      findEffectTextNumbers(["LEVEL 10+ and LEVEL 25+"]).map(
        ({ value }) => value,
      ),
    ).toEqual([10, 25]);
    expect(findValidEffectTextNumberReplacements(10, 1, 1, 6)).toEqual([]);
    expect(findValidEffectTextNumberReplacements(25, 1, 1, 6)).toEqual([]);
  });

  it("rejects an occurrence that does not exist", () => {
    expect(() => replaceEffectTextNumber(["Gain 1¢."], 1, 2)).toThrow(
      "Effect text number occurrence does not exist: 1",
    );
  });
});
