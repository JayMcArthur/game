import { ItemCard, LootCard, MonsterCard } from "@/models/cards";
import { TargetBuilder } from "@/models/targetBuilder";
import { Game } from "@/models/game";
import { GameError } from "@/models/GameError";
import {
  type HistoricEntry,
  type UserRequest,
  isStackElementJson,
} from "@/models/handlers/historyHandler";
import { type DetailedState, type IdentifierType, type Issuer, type SerializedTranslation } from "@/shared/api";
import { Player } from "../models/entities/player";
import * as helper from "@/utils/gameRequestHelpers";
import { toSerializedTranslation } from "./translation";

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isPrivateEntry(
  entry: unknown,
): entry is Extract<HistoricEntry, { private: true }> {
  return isObject(entry) && entry.private === true && typeof entry.type === "string";
}

function isUserRequestEntry(entry: HistoricEntry): entry is UserRequest {
  return (
    isObject(entry) &&
    !isPrivateEntry(entry) &&
    typeof entry.type === "string" &&
    isStackElementJson(entry) === false
  );
}

function remapIssuer(game: Game, issuer: Issuer): Issuer {
  const player = game.entityHandler.getPlayerById(issuer);
  return player.id;
}

function applySetGameParameter(
  game: Game,
  payload: HistoricEntry & { type: "GameParameters" },
): void {
  game.gameParameters.loadFromJson(payload.gameParameters as any);
}

function verifyRecordedCharactersAfterStart(
  game: Game,
  characterByPlayer: Map<string, string>,
): void {
  if (characterByPlayer.size === 0 || characterByPlayer.size !== game.players.length) {
    return;
  }

  for (const player of game.players) {
    const expectedSlug = characterByPlayer.get(player.id);
    if (!expectedSlug) continue;

    if (player.character.slug !== expectedSlug) {
      throw new GameError(
        `Character mismatch after replay start for player ${player.id}: expected ${expectedSlug}, got ${player.character.slug}`,
        toSerializedTranslation("error.characterMismatchAfterReplayStart", { player: player.id, slug: expectedSlug, slug2: player.character.slug }),
      );
    }
  }
}

interface GameStateComparison {
  equal: boolean;
  differences: string[];
}

function normalizeDetailedStateForComparison(state: DetailedState): DetailedState {
  const normalized = structuredClone(state);
  normalized.lastStackElementTimeStamp = 0;
  
  for(const array of [normalized.history, normalized.stack])
    for( const index in array)
      if("reordering" in array[index]!)
        array[index]["reordering"]!.groupId = "";


  if (normalized.me.pendingSelection) {
    normalized.me.pendingSelection.requestId = 0;
  }

  normalized.animations = [];
  return normalized;
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) return "undefined";

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectDifferences(
  left: unknown,
  right: unknown,
  path: string,
  differences: string[],
  maxDifferences: number,
): void {
  if (differences.length >= maxDifferences) return;
  if (Object.is(left, right)) return;
  if( left === right) return;

  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);

  if (leftIsArray || rightIsArray) {
    if (!leftIsArray || !rightIsArray) {
      differences.push(
        `${path}: type mismatch (left=${leftIsArray ? "array" : typeof left}, right=${rightIsArray ? "array" : typeof right})`,
      );
      return;
    }

    const leftArray = left as unknown[];
    const rightArray = right as unknown[];

    if (leftArray.length !== rightArray.length) {
      differences.push(
        `${path}: array length mismatch (left=${leftArray.length}, right=${rightArray.length})`,
      );
      if (differences.length >= maxDifferences) return;
    }

    const minLength = Math.min(leftArray.length, rightArray.length);
    for (let index = 0; index < minLength; index++) {
      collectDifferences(
        leftArray[index],
        rightArray[index],
        `${path}[${index}]`,
        differences,
        maxDifferences,
      );
      if (differences.length >= maxDifferences) return;
    }

    return;
  }

  const leftIsObject = isObject(left);
  const rightIsObject = isObject(right);

  if (leftIsObject || rightIsObject) {
    if (!leftIsObject || !rightIsObject) {
      differences.push(
        `${path}: type mismatch (left=${leftIsObject ? "object" : typeof left}, right=${rightIsObject ? "object" : typeof right})`,
      );
      return;
    }

    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);

    for (const key of Array.from(keys).sort()) {
      const leftHasKey = Object.prototype.hasOwnProperty.call(leftRecord, key);
      const rightHasKey = Object.prototype.hasOwnProperty.call(rightRecord, key);
      const leftValue = leftRecord[key];
      const rightValue = rightRecord[key];

      if (!leftHasKey || !rightHasKey) {
        if ((!leftHasKey && rightValue === undefined) || (!rightHasKey && leftValue === undefined)) {
          continue;
        }

        differences.push(
          `${path}.${key}: ${leftHasKey ? "missing on right" : "missing on left"} (left=${formatDiffValue(leftValue)}, right=${formatDiffValue(rightValue)})`,
        );
        if (differences.length >= maxDifferences) return;
        continue;
      }

      collectDifferences(
        leftValue,
        rightValue,
        `${path}.${key}`,
        differences,
        maxDifferences,
      );
      if (differences.length >= maxDifferences) return;
    }

    return;
  }

  differences.push(
    `${path}: value mismatch (left=${formatDiffValue(left)}, right=${formatDiffValue(right)})`,
  );
}

function compareGameState(original: DetailedState, loaded: DetailedState): GameStateComparison {
  const normalizedOriginal = normalizeDetailedStateForComparison(original);
  const normalizedLoaded = normalizeDetailedStateForComparison(loaded);
  const differences: string[] = [];
  const maxDifferences = 25;

  collectDifferences(normalizedOriginal, normalizedLoaded, "gameState", differences, maxDifferences);

  return {
    equal: differences.length === 0,
    differences,
  };
}

function setupLoadingSubmitSelectionHandling(game: Game, logs: HistoricEntry[]): void {
  const submitSelectionEntries = logs.filter(
    (entry): entry is Extract<UserRequest, { type: "SubmitSelection" }> =>
      isUserRequestEntry(entry) && entry.type === "SubmitSelection",
  ).sort((a, b) => a.payload.requestId - b.payload.requestId);
  game.setSelectionHandlerNextId(submitSelectionEntries.length);
  let i = 0;

  game.selectMultiple = async <T>(selections: {
    player: Player;
    min: number;
    max: number;
    options: T[];
    description: SerializedTranslation;
    skippable?: boolean;
    canUseOnBoardSelection: boolean;
  }[]): Promise<{ playerId: string; selected: T[]; remaining: T[] }[]> => {
    const results: { playerId: string; selected: T[]; remaining: T[] }[] = [];

    for (const selection of selections) {
      for(let j = i; j < submitSelectionEntries.length; j++)
      {
        const entry = submitSelectionEntries[j];
        if(entry !== undefined && selections.map(s=>s.player.id).includes(entry.issuer))
        {
          submitSelectionEntries.splice(j, 1);
          submitSelectionEntries.splice(i, 0, entry);
          break
        }
        console.log("Weird That it happens.");
      }
      const entry = submitSelectionEntries[i++];
      if (entry === undefined) {
        throw new GameError(
          "No more SubmitSelection entries in logs to match the game's selectMultiple call. This may indicate a mismatch between the game state and the logs, or an issue with log formatting.",
          toSerializedTranslation("error.behaviorError", { error: "No more SubmitSelection entries in logs to match the game's selectMultiple call." }),
        );
      }

      const resolvedOptions = entry.payload.selections.map((id) => {
        const option = TargetBuilder["resolveIdentifier"](id, selection.options);
        if (option === undefined) {
          throw new GameError(`Invalid selection identifier: ${id.payload}`,
            toSerializedTranslation("error.invalidSelectionIdentifier")
          );
        }
        return option as T;
      });

      results.push({
        playerId: entry.issuer,
        selected: resolvedOptions,
        remaining: selection.options.filter((option) => !resolvedOptions.includes(option)),
      });
    }

    return results;
  };
}

function findInitialSeed(logs: unknown[]): string {
  const entry = logs.find(
    (log): log is Extract<HistoricEntry, { type: "randomSeed" }> =>
      isPrivateEntry(log) && log.type === "randomSeed" && typeof log.seed === "string",
  );

  if (!entry || !entry.seed || entry.seed === "") {
    throw new GameError("No valid randomSeed entry found in logs for game initialization.",
      toSerializedTranslation("error.behaviorError", { error: "No valid randomSeed entry found in logs for game initialization." })
    );
  }

  return entry.seed;
}

function isLastIndexUsedForReplay(index: number, logs: HistoricEntry[])
{
  for(let i=index+1; i<logs.length; i++)
  {
    if(isUserRequestEntry(logs[i]!) && ![
        "CreateRoom",
        "JoinRoom",
        "LeaveRoom",
        "Rejoin",
        "IsGameOngoing",
        "LoadGame",
        "DebugListCardsICanRemove",
        "DebugListMonsterDeck",
        "DebugListTreasure",
        "DebugListLoot",
        "Join",
      ].includes(logs[i]!.type))
      {
        return false;
      }
  }
  return true;
}

export async function loadGameFromLogs(
  logs: HistoricEntry[],
  verbose: number = 0,
): Promise<Game> {
  if (verbose >= 1)
    console.log(`Loading game from logs with ${logs.length} entries...`);

  const game = new Game(findInitialSeed(logs));
  const characterByPlayer = new Map<string, string>();

  const normalMultipleSelection = game.selectMultiple;
  setupLoadingSubmitSelectionHandling(game, logs);

  try {
    for (const [index, entry] of logs.entries()) {
      if (!isUserRequestEntry(entry) && !isPrivateEntry(entry)) {
        continue;
      }

      if (verbose >= 1)
        console.log(`Replaying log entry ${index}\n`);

      switch (entry.type) {
        case "CreateRoom":
        case "JoinRoom":
        case "LeaveRoom":
        case "Rejoin":
        case "IsGameOngoing":
        case "LoadGame":
        case "DebugListCardsICanRemove":
        case "DebugListMonsterDeck":
        case "DebugListTreasure":
        case "DebugListLoot":
        case "DebugListDices":
        case "Join": 
        // SubmitSelection is handled by the custom selectMultiple override, so we skip it here.
        break;
        case "SubmitSelection": 
          game.addToHistory(entry);
          break;

        case "character": {
          characterByPlayer.set(entry.playerId, entry.slug);
          break;
        }

        case "randomSeed": {
          game.seed = entry.seed;
          break;
        }

        case "GameParameters": {
          applySetGameParameter(game, entry as HistoricEntry & { type: "GameParameters" });
          break;
        }

        case "SetGameParameter": {
          const payload = entry.payload;
          game.gameParameters.setParameterByKey(payload.parameter, payload.value);
          game.addToHistory(entry);
          break;
        }

        case "Start": {
          if(isLastIndexUsedForReplay(index, logs))
          {
            game.selectMultiple = normalMultipleSelection;
            void game.start(entry.players);
          }
          else
          {
            await game.start(entry.players);
            await game.awaitPromises();
            // verifyRecordedCharactersAfterStart(game, characterByPlayer); Can be wrong due to the mulligan thingy.
          }
          game.addToHistory(entry);
          break;
        }

        case "Reset": {
          throw new GameError(
            "Reset are supposed to be handled by creating a new game instance, but a Reset entry was found in logs. This may indicate an issue with log formatting or replay logic.",
            toSerializedTranslation("error.behaviorError", { error: "Reset are supposed to be handled by creating a new game instance, but a Reset entry was found in logs." }),
          );
        }
        case "GameState": {
          const state = entry.gameState;
          if (!state) {
            throw new GameError("GameState entry is missing gameState payload", toSerializedTranslation("error.behaviorError", { error: "GameState entry is missing gameState payload" }));
          }

          if (game.players[0] === undefined)
            throw new GameError("GameState entry is missing player data", toSerializedTranslation("error.behaviorError", { error: "GameState entry is missing player data" }));

          const comparison = compareGameState(game.detailedStateJSON(game.players[0]), state);
          if (!comparison.equal) {
            const differencesMessage = comparison.differences
              .map((difference, index) => `${index + 1}. ${difference}`)
              .join("\n");

            throw new GameError(
              `Current game state does not match GameState entry from logs. Differences:\n${differencesMessage}`,
              toSerializedTranslation("error.behaviorError", { error: `Current game state does not match GameState entry from logs. Differences:\n${differencesMessage}` })
            );
          }

          break;
        }
        case "DeclareAttack": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDeclareAttackRequest(game, player);
          break;
        }

        case "AttackMonster": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          await helper.executeAttackMonsterRequest(game, entry.payload, player);
          break;
        }

        case "AttackRoll": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeAttackRollRequest(game, player);
          break;
        }

        case "Resolve": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await helper.executeResolveRequest(game, player);
          break;
        }

        case "InsertStackElementBefore": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeInsertStackElementBeforeRequest(game, entry.payload, player);
          break;
        }

        case "Activate": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          try {
            await helper.executeActivateRequest(game, entry.payload, player);
          } catch (error) {
            throw new GameError(
              `Failed to replay Activate request from logs: ${error instanceof Error ? error.message : error}`,
              toSerializedTranslation("error.behaviorError", { error: `Failed to replay Activate request from logs: ${error instanceof Error ? error.message : error}` })
            );
          }
          break;
        }

        case "DeclarePurchase": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDeclarePurchaseRequest(game, player);
          break;
        }

        case "CancelPurchase": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeCancelPurchaseRequest(game, player);
          break;
        }

        case "Purchase": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executePurchaseRequest(game, entry.payload, player);
          break;
        }

        case "EndTurn": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          await helper.executeEndTurnRequest(game, player);
          break;
        }

        case "GiveCoins": {
          const from = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          await helper.executeGiveCoinsRequest(game, entry.payload, from);
          break;
        }

        case "DebugLootTop": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDebugLootTopRequest(game, player);
          break;
        }

        case "DebugGainTreasureTop": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDebugGainTreasureTopRequest(game, player);
          break;
        }

        case "DebugLoot": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDebugLootRequest(game, entry.payload, player);
          break;
        }

        case "DebugGainCoins": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDebugGainCoinsRequest(game, entry.payload, player);
          break;
        }

        case "DebugPutMonsterCardInSlot": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDebugPutMonsterCardInSlotRequest(game, entry.payload, player);
          break;
        }

        case "DebugGainTreasure": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDebugGainTreasureRequest(game, entry.payload, player);
          break;
        }

        case "DebugChangeDiceResult": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDebugChangeDiceResultRequest(game, entry.payload, player);
          break;
        }

        case "DebugPutRoom": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDebugPutRoomRequest(game, entry.payload, player);
          break;
        }

        case "DebugRemoveCards": {
          const player = game.entityHandler.getPlayerById(remapIssuer(game, entry.issuer));
          helper.executeDebugRemoveCardsRequest(game, entry.payload, player);
          break;
        }

        default:
          throw new GameError(`Unsupported log entry type for replay: ${(entry as HistoricEntry).type}`,
            toSerializedTranslation("error.behaviorError", { error: `Unsupported log entry type for replay: ${(entry as HistoricEntry).type}` }));
      }
    }
    for (const player of game.players) {
      player.animations(true);
    }
    // The replay above may have re-applied a trailing "randomSeed" entry that is not part of the
    // original game flow; drop it before appending the fresh post-load seed below.
    game.removeTrailingRandomSeed();
    game.seed = "";
    if(game.stack.isEmpty())
      game.assert.lastTimedAction = 0;
    return game;
  }catch (error) {
    throw error;
  }
   finally {
    game.selectMultiple = normalMultipleSelection;
  }
}