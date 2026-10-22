import type { BotLevel } from "@/shared/api";
import type { Game } from "@/models/game";
import { decideBot } from "./policy";
import {
  completeBotActivation, createBotInput, executeBotCommand, fallbackBotDecision,
  submitBotSelection, validateBotDecision,
} from "./host";
import type { BotCommand, BotDecision, BotInput, BotPolicy } from "./types";

export interface BotSeatConfig {
  playerId: string;
  level: BotLevel;
  seed?: number;
}

export interface BotRunnerOptions {
  policy?: BotPolicy;
  onError?: (error: Error) => void;
  onDecision?: (input: BotInput, decision: BotDecision) => void;
}

/** One gameplay request per game, with independent replies to waiting selections. */
export class BotRunner {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private requestPending = false;
  private currentRequest: Promise<void> | undefined;
  private turnKey = "";
  private readonly randomStates = new Map<string, number>();
  private readonly activations = new Map<string, number>();
  private readonly answered = new Set<number>();
  private readonly policy: BotPolicy;
  public readonly diagnostics: { phase: "policy" | "native"; playerId: string }[] = [];
  public actionCount = 0;

  constructor(
    private readonly game: Game,
    private readonly seats: readonly BotSeatConfig[],
    private readonly options: BotRunnerOptions = {},
  ) {
    if (new Set(seats.map(seat => seat.playerId)).size !== seats.length) throw new Error("Duplicate bot seat");
    seats.forEach((seat, index) => {
      game.entityHandler.getPlayerById(seat.playerId);
      this.randomStates.set(seat.playerId, (seat.seed ?? (0x9e3779b9 + index)) >>> 0);
    });
    this.policy = options.policy ?? decideBot;
  }

  start(): this {
    if (this.running) return this;
    this.running = true;
    this.game.onStateChange.add(this.wake);
    this.game.onEndReached.add(this.stop);
    this.wake();
    return this;
  }

  stop = (): void => {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.game.onStateChange.remove(this.wake);
    this.game.onEndReached.remove(this.stop);
  };

  /** A victory signal can fire before the winning native request finishes logging. */
  async whenIdle(): Promise<void> {
    await this.currentRequest;
  }

  private wake = (): void => {
    if (!this.running || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.pump();
    }, 0);
  };

  private input(seat: BotSeatConfig): BotInput {
    return createBotInput(this.game, seat.playerId, {
      level: seat.level,
      randomState: this.randomStates.get(seat.playerId)!,
      turnActions: this.activations.get(seat.playerId) ?? 0,
    });
  }

  private decide(input: BotInput): BotDecision {
    const decision = this.policy(input);
    validateBotDecision(input, decision);
    return decision;
  }

  private report(phase: "policy" | "native", seat: BotSeatConfig, cause: unknown): void {
    this.diagnostics.push({ phase, playerId: seat.playerId });
    // Diagnostics are bounded even when a custom strategy repeatedly fails.
    if (this.diagnostics.length > 100) this.diagnostics.shift();
    this.options.onError?.(new Error(`Bot ${phase} failure for ${seat.playerId}`, { cause }));
  }

  private async pump(): Promise<void> {
    if (!this.running) return;
    if (this.game.isGameOver || this.game.reachedEnd) { this.stop(); return; }
    for (const id of this.answered) if (!this.game.pendingMultipleSelections.has(id)) this.answered.delete(id);
    const key = `${this.game.turnHandler.numberOfRoundSinceBeginning}:${this.game.currentPlayer.id}`;
    if (key !== this.turnKey) {
      this.turnKey = key;
      this.activations.clear();
    }
    const pending = [...this.game.pendingMultipleSelections.values()].find(selection =>
      !this.answered.has(selection.requestId) && this.seats.some(seat => seat.playerId === selection.playerId));
    const seat = pending
      ? this.seats.find(seat => seat.playerId === pending.playerId)
      : !this.requestPending ? this.seats.find(seat => seat.playerId === this.game.currentPlayer.id) : undefined;
    if (!seat) return;
    let input: BotInput;
    let decision: BotDecision;
    let command: BotCommand | undefined;
    try {
      input = this.input(seat);
      decision = this.decide(input);
      if (decision.kind === "action") {
        command = input.actions[decision.index]!.command;
        if (command.type === "activate") {
          const completed = completeBotActivation(this.game, this.game.entityHandler.getPlayerById(seat.playerId), command, { ...input, randomState: decision.randomState }, this.policy);
          command = completed.command;
          decision.randomState = completed.randomState;
        }
      }
    } catch (cause) {
      this.report("policy", seat, cause);
      try {
        // The failed strategy may have mutated its input; recovery gets a fresh offer.
        input = this.input(seat);
        decision = fallbackBotDecision(input);
        validateBotDecision(input, decision);
        if (decision.kind === "action") {
          command = input.actions[decision.index]!.command;
          if (command.type === "activate") {
            const completed = completeBotActivation(this.game, this.game.entityHandler.getPlayerById(seat.playerId), command, input, fallbackBotDecision);
            command = completed.command;
          }
        }
      } catch (recoveryError) {
        this.report("native", seat, recoveryError);
        this.stop();
        return;
      }
    }
    this.randomStates.set(seat.playerId, decision.randomState);
    if (decision.kind === "wait") {
      // A resolve cooldown is a timed wake; every other wait is state-change driven.
      if (this.game.actions.canResolve(this.game.currentPlayer, false) === true &&
        this.game.assert.canResolveNow(false) !== true) {
        const delay = Math.max(1, this.game.assert.lastTimedAction + 1000 * this.game.gameParameters.resolveCooldown.value - Date.now());
        if (this.running) this.timer = setTimeout(() => { this.timer = undefined; this.wake(); }, delay);
      }
      return;
    }
    const player = this.game.entityHandler.getPlayerById(seat.playerId);
    try {
      this.options.onDecision?.(input, decision);
      if (!this.running) return;
      if (decision.kind === "selection") {
        const selection = input.state.me.pendingSelection;
        if (!selection || this.game.pendingMultipleSelections.get(selection.requestId)?.playerId !== seat.playerId)
          throw new Error("Bot selection no longer belongs to this seat");
        this.answered.add(selection.requestId);
        submitBotSelection(this.game, player, selection.requestId, decision.indexes.map(index => input.selection!.options[index]!));
        this.actionCount++;
        this.wake();
        return;
      }
      if (!command) throw new Error("Bot action has no native command");
      if (command.type === "activate") this.activations.set(seat.playerId, (this.activations.get(seat.playerId) ?? 0) + 1);
      this.requestPending = true;
      // Wake callbacks can now answer mandatory choices opened by this await.
      this.currentRequest = executeBotCommand(this.game, player, command);
      await this.currentRequest;
      this.actionCount++;
    } catch (cause) {
      // A native request can already have changed the game. Never issue compensation.
      this.report("native", seat, cause);
      this.stop();
    } finally {
      if (decision.kind === "action") {
        this.requestPending = false;
        this.currentRequest = undefined;
      }
      this.wake();
    }
  }
}
