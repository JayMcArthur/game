const EFFECT_TEXT_NUMBER_PATTERN = /\d+|[❶❷❸❹❺❻➀➁➂➃➄➅]/g;

const FILLED_CIRCLED_DIGITS = ["", "❶", "❷", "❸", "❹", "❺", "❻"];
const SANS_SERIF_CIRCLED_DIGITS = ["", "➀", "➁", "➂", "➃", "➄", "➅"];

export type EffectTextNumberFormat =
  | "plain"
  | "filledCircled"
  | "sansSerifCircled";

export interface EffectTextNumberOccurrence {
  format: EffectTextNumberFormat;
  occurrenceIndex: number;
  sourceText: string;
  textThroughNumber: string;
  value: number;
}

function numberFormat(sourceText: string): EffectTextNumberFormat {
  if (FILLED_CIRCLED_DIGITS.includes(sourceText)) return "filledCircled";
  if (SANS_SERIF_CIRCLED_DIGITS.includes(sourceText)) {
    return "sansSerifCircled";
  }
  return "plain";
}

function numberValue(sourceText: string): number {
  const format = numberFormat(sourceText);
  if (format === "filledCircled") {
    return FILLED_CIRCLED_DIGITS.indexOf(sourceText);
  }
  if (format === "sansSerifCircled") {
    return SANS_SERIF_CIRCLED_DIGITS.indexOf(sourceText);
  }
  return Number(sourceText);
}

export function formatEffectTextNumber(
  value: number,
  format: EffectTextNumberFormat,
): string {
  if (format === "filledCircled") return FILLED_CIRCLED_DIGITS[value]!;
  if (format === "sansSerifCircled") {
    return SANS_SERIF_CIRCLED_DIGITS[value]!;
  }
  return String(value);
}

export function findEffectTextNumbers(
  outcomes: readonly string[],
): EffectTextNumberOccurrence[] {
  let occurrenceIndex = 0;

  return outcomes.flatMap((outcome) =>
    [...outcome.matchAll(EFFECT_TEXT_NUMBER_PATTERN)].map((match) => ({
      format: numberFormat(match[0]),
      occurrenceIndex: occurrenceIndex++,
      sourceText: match[0],
      textThroughNumber: outcome
        .slice(0, match.index + match[0].length)
        .trim(),
      value: numberValue(match[0]),
    })),
  );
}

export function findValidEffectTextNumberReplacements(
  currentValue: number,
  adjustment: number,
  minimum: number,
  maximum: number,
): number[] {
  return [currentValue - adjustment, currentValue + adjustment].filter(
    (value) => value >= minimum && value <= maximum,
  );
}

export function replaceEffectTextNumber(
  outcomes: readonly string[],
  occurrenceIndex: number,
  newValue: number,
): string[] {
  if (!Number.isInteger(newValue) || newValue < 1 || newValue > 6) {
    throw new RangeError(
      `Effect text number must be between 1 and 6: ${newValue}`,
    );
  }

  let currentOccurrence = 0;
  let replaced = false;
  const updatedOutcomes = outcomes.map((outcome) =>
    outcome.replace(EFFECT_TEXT_NUMBER_PATTERN, (sourceText) => {
      if (currentOccurrence++ !== occurrenceIndex) return sourceText;
      replaced = true;
      return formatEffectTextNumber(newValue, numberFormat(sourceText));
    }),
  );

  if (!replaced) {
    throw new RangeError(
      `Effect text number occurrence does not exist: ${occurrenceIndex}`,
    );
  }

  return updatedOutcomes;
}
