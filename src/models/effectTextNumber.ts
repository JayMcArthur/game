import type { Card } from "./cards";
import type {
  EffectTextNumberFormat,
  EffectTextNumberOccurrence,
} from "@/utils/effectTextNumbers";
import type { CardAndEffectTextNumber, EffectTextNumber as EffectTextNumberJson } from "@/shared/api";

export class EffectTextNumber {
  constructor(
    readonly card: Card,
    readonly occurrence: EffectTextNumberOccurrence,
  ) {}

  get occurrenceIndex(): number {
    return this.occurrence.occurrenceIndex;
  }

  get format(): EffectTextNumberFormat {
    return this.occurrence.format;
  }

  get sourceText(): string {
    return this.occurrence.sourceText;
  }

  get textThroughNumber(): string {
    return this.occurrence.textThroughNumber;
  }

  get value(): number {
    return this.occurrence.value;
  }

  get jsonAPI(): CardAndEffectTextNumber {
    return {
      description: this.occurrence.textThroughNumber,
      card: this.card.jsonAPI,
      occurrenceIndex: this.occurrenceIndex,
      value: this.value,
    };
  }

  matches(identifier: CardAndEffectTextNumber): boolean {
    return (
      this.card.globalId === identifier.card.globalId &&
      this.occurrenceIndex === identifier.occurrenceIndex &&
      this.value === identifier.value
    );
  }
}
