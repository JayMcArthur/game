const EFFECT_TEXT_NUMBER_PATTERN = /(?<!\w)([0-7])(?!\w)/g;

export interface EffectTextNumberOccurrence {
  occurrenceIndex: number;
  textThroughNumber: string;
  value: number;
}

export function findEffectTextNumbers(
  outcomes: readonly string[],
): EffectTextNumberOccurrence[] {
  let occurrenceIndex = 0;

  return outcomes.flatMap((outcome) =>
    [...outcome.matchAll(EFFECT_TEXT_NUMBER_PATTERN)].map((match) => ({
      occurrenceIndex: occurrenceIndex++,
      textThroughNumber: outcome
        .slice(0, match.index + match[0].length)
        .trim(),
      value: Number(match[1]),
    })),
  );
}

export function findValidEffectTextNumberReplacements(
  currentValue: number,
  adjustment: number,
  minimum: number,
  maximum: number,
): number[] {
  return [
    ...(currentValue - adjustment >= minimum
      ? [currentValue - adjustment]
      : []),
    ...(currentValue + adjustment <= maximum
      ? [currentValue + adjustment]
      : []),
  ];
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
    outcome.replace(EFFECT_TEXT_NUMBER_PATTERN, (value) => {
      if (currentOccurrence++ !== occurrenceIndex) return value;
      replaced = true;
      return String(newValue);
    }),
  );

  if (!replaced) {
    throw new RangeError(
      `Effect text number occurrence does not exist: ${occurrenceIndex}`,
    );
  }

  return updatedOutcomes;
}
