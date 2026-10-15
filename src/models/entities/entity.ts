import type { EntityType, TemporaryEffect } from "@/shared/api";
import type { Card } from "../cards";
import { type DiceRoll } from "../stackElement";
import { GameError } from "@/models/GameError";
import { toSerializedTranslation } from "@/utils/translation";
import type { DamageSource } from "../handlers/entityHandler";

interface DamageObj {
  dealer: Entity | null;
  with: DamageSource | null;
  damage: number;
}

export abstract class Entity {
  private _currentHealthPoints: number;
  protected _color: string = "#D92D18";
  // Either attacking or being attacked.
    /** @private The evasion value from the monster card */
  private _evasion: number = 0;
  private _engagedInCombat: number;
  private _attackDiceModifier: number = 0;
  private _baseAttackPoints: number = 0;
  private _damageTakenThisTurn: DamageObj[] = [];
  private _died: boolean = false;
  private _attackable: boolean = true;
  private _temporaryEffects: TemporaryEffect[] = [];

  get evasion(): number {
    return Math.max(0, Math.min(this._evasion, 6));
  }
  
  set evasion(value: number) {
    this._evasion = value; // Value can be set to anything, but getter will ensure it is between 0 and 6.
  }

  set baseAttackPoints(value: number) {
    this.addAttackPoints(value - this._baseAttackPoints);
    this._baseAttackPoints = value;
  }

  get attackable(): boolean {
    return this._attackable;
  }

  set attackable(value: boolean) {
    this._attackable = value;
  }

  constructor(
    readonly id: string,
    private _attackPoints: number,
    private _healthPoints: number
  ) {
    this.id = id;
    this._currentHealthPoints = this._healthPoints;
    this._engagedInCombat = 0;
    this._baseAttackPoints = _attackPoints;
  }

  receiveDamage(damage: number, dealer: Entity | null = null, abilityCard: DamageSource | null = null): boolean {
    if(damage <= 0) return true;
    this._damageTakenThisTurn.push({dealer: dealer!, with: abilityCard!, damage: damage});
    this._currentHealthPoints -= damage;
    if (this._currentHealthPoints < 0) {
      this._currentHealthPoints = 0;
      return false;
    }
    return true;
  }

  resetEntityFlags(): void {
    this._engagedInCombat = 0;
    this._damageTakenThisTurn = [];
    this._died = false;

  }

  get damageTakenThisTurn(): DamageObj[] {
    return this._damageTakenThisTurn;
  }

  get isEngagedInCombat(): boolean {
    return this._engagedInCombat > 0;
  }

  combatEnded(): void{
    this._engagedInCombat = Math.max(0, this._engagedInCombat - 1);
  }

  engageInCombat(): void {
    this._engagedInCombat += 1;
  }

  heal(amount:number|"full" = "full"): void {
    if(amount === "full")
      this._currentHealthPoints = this._healthPoints;
    else
      this._currentHealthPoints = Math.min(this._currentHealthPoints + amount, this._healthPoints);
  }

  die(): void {
    this._currentHealthPoints = 0;
    this._died = true;
  }
  /** An entity if it has been marked as dead. 
   * Note that an entity may have 0 health points but not be dead if their death has not been resolved.
  */
  get isDead(): boolean {
    return this._died;
  }

  get currentHealthPoints(): number {
    return this._currentHealthPoints;
  }
  
  get healthPoints(): number {
    return this._healthPoints;
  }

  addHealthPoints(amount: number): void {
    this._healthPoints += amount;
    if(amount > 0)
      this._currentHealthPoints += amount;
    if (amount < 0 && this._currentHealthPoints > this._healthPoints) {
      this._currentHealthPoints = this._healthPoints;
    }
  }
  
  addAttackPoints(amount: number): void {
    // Attack points cannot be negative.
    if (this._attackPoints + amount < 0) {
      throw new GameError("Attack points cannot be negative.", toSerializedTranslation("error.attackPointsCannotBeNegative"));
    }
    this._attackPoints += amount;
  }

  addAttackDiceModifier(amount: number): void {
    this._attackDiceModifier += amount;
  }

  get attackPoints(): number {
    return this._attackPoints;
  }

  get attackDiceModifier(): number {
    return this._attackDiceModifier;
  }

  addTemporaryEffect(effect: TemporaryEffect): void {
    // Add temporary effect to the list
    this._temporaryEffects.push(effect) ;
  }

  removeTemporaryEffect(effect: TemporaryEffect): void {
    const index = this._temporaryEffects.indexOf(effect);
    if (index !== -1) {
      this._temporaryEffects.splice(index, 1);
    }
  }

  get color(): string {
    return this._color;
  }

  set color(value: string) {
    this._color = value;
  }

  get temporaryEffects(): TemporaryEffect[] {
    return this._temporaryEffects;
  }
  abstract get json(): EntityType;
  abstract get card(): Card;
}

