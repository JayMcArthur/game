import type { Card } from "./cards";
import type { EffectTextNumberOccurrence } from "@/utils/effectTextNumbers";
import type { EffectTextNumber as EffectTextNumberJson } from "@/shared/api";

export class EffectTextNumber {
  constructor(
    readonly card: Card,
    readonly occurrence: EffectTextNumberOccurrence,
  ) {}

  get occurrenceIndex(): number {
    return this.occurrence.occurrenceIndex;
  }

  get textThroughNumber(): string {
    return this.occurrence.textThroughNumber;
  }

  get value(): number {
    return this.occurrence.value;
  }

  get jsonAPI(): EffectTextNumberJson {
    return {
      card: this.card.jsonAPI,
      occurrenceIndex: this.occurrenceIndex,
      value: this.value,
    };
  }

  matches(identifier: EffectTextNumberJson): boolean {
    return (
      this.card.globalId === identifier.card.globalId &&
      this.occurrenceIndex === identifier.occurrenceIndex &&
      this.value === identifier.value
    );
  }
}
