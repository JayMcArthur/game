import { GameError } from "@/models/GameError";
import type { HistoricEntry } from "@/models/handlers/historyHandler";
import { schemas, type DiceRollJson } from "@/shared/api";
import * as helper from "@/utils/gameRequestHelpers";
import { loadGameFromLogs } from "@/utils/loadGameFromLogs";
import { toSerializedTranslation } from "@/utils/translation";
import { globalEndpoints } from "./global";
import { roomManager } from "./roomManager";
import { enterStartStep } from "./startStep";
import type { RoomWithGame, Socket, User } from "./types";
import {
  attachGameEventListeners,
  errorGuardedEndpoint,
  getUserByName,
  leaveCurrentStep,
  payloadGuardedEndpoint,
  registerRoomActivity,
  sendRoomChangedToAll,
  sendRoomChangedToUser,
} from "./utils";
import { DiceRoll } from "@/models/stackElement";

export const enterGameStep = (
  socket: Socket,
  room: RoomWithGame,
  user: User,
): void => {
  const activeInstance = user.instances.find((instance) => instance.isActive);
  if (!activeInstance) {
    throw new GameError(
      "No active instance found",
      toSerializedTranslation("error.behaviorError", {
        error: "No active instance found",
      }),
    );
  }
  const player = room.game.entityHandler.getPlayerById(activeInstance.name);

  sendRoomChangedToUser(room, user);

  globalEndpoints(socket, room);

  socket.on("saveGame", async (callback) =>
    errorGuardedEndpoint(callback, () => {
      const logs = JSON.stringify(room.game.log, null, 2);
      return callback({ status: 200, logs });
    }),
  );

  socket.on("rollback", async (callback) =>
    errorGuardedEndpoint(callback, async () => {
      const logs: HistoricEntry[] = room.game.getRollbackLog(player);

      if (!logs) {
        return callback({
          status: 400,
          error: "Logs are not valid JSON or not in the expected format.",
        });
      }

      let newGame;
      try {
        newGame = await loadGameFromLogs(logs);
      } catch (error) {
        console.error("Rollback failed while loading logs:", error);
        return callback({
          status: 400,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load game from logs.",
        });
      }

      room.game = newGame;

      attachGameEventListeners(room);

      sendRoomChangedToAll(room);

      for (const user of room.users) {
        leaveCurrentStep(user.socket);
        enterGameStep(user.socket, room, user);
        user.socket.emit("on:room:broadcast", {
          type: "info",
          title: toSerializedTranslation("toast.rollback.title", {
            player: player.id,
          }),
          message: toSerializedTranslation("toast.rollback.message"),
        });
      }

      for (const spectator of room.spectators) {
        spectator.socket.emit("on:room:broadcast", {
          type: "info",
          title: toSerializedTranslation("toast.rollback.title", {
            player: player.id,
          }),
          message: toSerializedTranslation("toast.rollback.message"),
        });
      }

      return callback({ status: 200 });
    }),
  );

  socket.on("declareAttack", async (callback) =>
    errorGuardedEndpoint(callback, () => {
      helper.executeDeclareAttackRequest(room.game, player);
      return callback({ status: 200 });
    }),
  );

  socket.on("attackMonster", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.attackMonsterRequest,
        callback,
        async (payload) => {
          await helper.executeAttackMonsterRequest(room.game, payload, player);
          return callback({ status: 200 });
        },
      ),
    ),
  );

  socket.on("attackRoll", async (callback) =>
    errorGuardedEndpoint(callback, () => {
      helper.executeAttackRollRequest(room.game, player);
      return callback({ status: 200 });
    }),
  );

  socket.on("resolve", async (callback) =>
    errorGuardedEndpoint(callback, async () => {
      registerRoomActivity(room);
      room.game.assert.canResolveNow();
      await helper.executeResolveRequest(room.game, player);
      if (room.game.stack.elements.length > 0)
        room.game.assert.updateLastTimedAction();
      return callback({ status: 200 });
    }),
  );

  socket.on("submitSelection", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.submitSelectionRequest,
        callback,
        (payload) => {
          helper.executeSubmitSelectionRequest(room.game, payload, player);
          return callback({ status: 200 });
        },
      ),
    ),
  );

  socket.on("insertStackElementBefore", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.insertStackElementBeforeRequest,
        callback,
        (payload) => {
          helper.executeInsertStackElementBeforeRequest(
            room.game,
            payload,
            player,
          );
          return callback({ status: 200 });
        },
      ),
    ),
  );

  socket.on("activateWithID", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.activateWithIDRequest,
        callback,
        async (payload) => {
          const choices = await helper.executeActivateWithIdRequest(
            room.game,
            payload,
            player,
          );
          return callback({ response: choices, status: 200 });
        },
      ),
    ),
  );

  socket.on("activate", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.activateRequest,
        callback,
        async (payload) => {
          const choices = await helper.executeActivateRequest(
            room.game,
            payload,
            player,
          );
          return callback({ response: choices, status: 200 });
        },
      ),
    ),
  );

  socket.on("declarePurchase", async (callback) =>
    errorGuardedEndpoint(callback, () => {
      helper.executeDeclarePurchaseRequest(room.game, player);
      return callback({ status: 200 });
    }),
  );

  socket.on("cancelPurchase", async (callback) =>
    errorGuardedEndpoint(callback, () => {
      helper.executeCancelPurchaseRequest(room.game, player);
      return callback({ status: 200 });
    }),
  );

  socket.on("purchase", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.purchaseRequest,
        callback,
        (payload) => {
          helper.executePurchaseRequest(room.game, payload, player);
          return callback({ status: 200 });
        },
      ),
    ),
  );

  socket.on("endTurn", async (callback) =>
    errorGuardedEndpoint(callback, async () => {
      await helper.executeEndTurnRequest(room.game, player);
      return callback({ status: 200 });
    }),
  );

  socket.on("emote", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.emoteRequest,
        callback,
        (payload) => {
          for (const user of room.users) {
            user.socket.emit("on:player:emote", payload.emote, player.id);
          }
          return callback({ status: 200 });
        },
      ),
    ),
  );

  socket.on("giveCoins", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.giveCoinsRequest,
        callback,
        async (payload) => {
          await helper.executeGiveCoinsRequest(room.game, payload, player);
          return callback({ status: 200 });
        },
      ),
    ),
  );

  socket.on("switchToCopy", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.switchToCopyRequest,
        callback,
        (payload) => {
          const targetUser = getUserByName(room, payload.name);
          if (!targetUser) {
            return callback({ status: 400, error: "User not found" });
          }
          if (targetUser.user.socket.id !== socket.id) {
            return callback({
              status: 400,
              error: "You cannot switch to another player.",
            });
          }
          if (targetUser.instance.name === activeInstance.name) {
            return callback({
              status: 400,
              error: "You cannot switch to yourself",
            });
          }

          activeInstance.isActive = false;
          targetUser.instance.isActive = true;
          leaveCurrentStep(user.socket);
          enterGameStep(targetUser.user.socket, room, targetUser.user);

          return callback({ status: 200 });
        },
      ),
    ),
  );

  socket.on("quitGame", async (callback) =>
    errorGuardedEndpoint(callback, () => {
      for (const user of room.users) {
        user.socket.emit("on:game:quit", player.id);
      }
      for (const spectator of room.spectators) {
        spectator.socket.emit("on:game:quit", player.id);
      }

      roomManager.finalizeGameRecord(room);
      roomManager.saveGameLogs(room.id, false);

      // @ts-ignore we are exiting the game, so we don't need to keep the game instance.
      delete room.game;

      sendRoomChangedToAll(room);

      for (const user of room.users) {
        const socket = user.socket;
        leaveCurrentStep(socket);
        enterStartStep(socket, room, user);
      }
      return callback({ status: 200 });
    }),
  );

  if (room.game.gameParameters.allowCheatOptions.value) {
    socket.on("debugLootTop", async (callback) =>
      errorGuardedEndpoint(callback, () => {
        helper.executeDebugLootTopRequest(room.game, player);
        return callback({ status: 200 });
      }),
    );

    socket.on("debugGainTreasureTop", async (callback) =>
      errorGuardedEndpoint(callback, () => {
        helper.executeDebugGainTreasureTopRequest(room.game, player);
        return callback({ status: 200 });
      }),
    );

    socket.on("debugLoot", async (payload, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          payload,
          schemas.debugLootRequest,
          callback,
          (payload) => {
            helper.executeDebugLootRequest(room.game, payload, player);
            return callback({ status: 200 });
          },
        ),
      ),
    );

    socket.on("debugListLoot", async (callback) =>
      errorGuardedEndpoint(callback, () => {
        room.game.addToHistory({
          type: "DebugListLoot",
          issuer: player.id,
        });

        const lootDeck = room.game.decks["loot"];
        if (!lootDeck) {
          return callback({
            status: 400,
            error: "Loot deck not available",
          });
        }
        const cards = lootDeck.cards
          .toSorted((a, b) => (a.name + a.slug).localeCompare(b.name + b.slug))
          .map((c) => c.jsonAPI);

        return callback({ status: 200, cards });
      }),
    );

    socket.on("debugListCardsICanRemove", async (callback) =>
      errorGuardedEndpoint(callback, () => {
        const cards = room.game
          .playerCardsAndGameOwnedCards(player)
          .map((c) => c.jsonAPI);
        return callback({ status: 200, cards });
      }),
    );

    socket.on("debugRemoveCards", async (payload, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          payload,
          schemas.debugRemoveCardsRequest,
          callback,
          (payload) => {
            helper.executeDebugRemoveCardsRequest(room.game, payload, player);
            return callback({
              status: 200,
            });
          },
        ),
      ),
    );

    socket.on("debugListTreasure", async (callback) =>
      errorGuardedEndpoint(callback, () => {
        room.game.addToHistory({
          type: "DebugListTreasure",
          issuer: player.id,
        });

        const treasureDeck = room.game.decks["treasure"];
        if (!treasureDeck) {
          return callback({
            status: 400,
            error: "Treasure deck not available",
          });
        }
        const cards = treasureDeck.cards
          .toSorted((a, b) => (a.name + a.slug).localeCompare(b.name + b.slug))
          .map((c) => c.jsonAPI);

        return callback({ status: 200, cards });
      }),
    );

    socket.on("debugGainTreasure", async (payload, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          payload,
          schemas.debugGainTreasureRequest,
          callback,
          (payload) => {
            helper.executeDebugGainTreasureRequest(room.game, payload, player);
            return callback({ status: 200 });
          },
        ),
      ),
    );

    socket.on("debugGainCoins", async (payload, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          payload,
          schemas.debugGainCoinsRequest,
          callback,
          (payload) => {
            helper.executeDebugGainCoinsRequest(room.game, payload, player);
            return callback({ status: 200 });
          },
        ),
      ),
    );

    socket.on("debugListMonsterDeck", async (callback) =>
      errorGuardedEndpoint(callback, () => {
        room.game.addToHistory({
          type: "DebugListMonsterDeck",
          issuer: player.id,
        });

        const monsterDeck = room.game.decks["monster"];
        if (!monsterDeck) {
          return callback({
            status: 400,
            error: "Monster deck not available",
          });
        }
        const cards = monsterDeck.cards
          .toSorted((a, b) => (a.name + a.slug).localeCompare(b.name + b.slug))
          .map((c) => c.jsonAPI);
        const coverable = room.game.encounters.nonAttackedSlots.map(
          (elem) => elem.jsonAPI,
        );
        return callback({ status: 200, cards, coverable });
      }),
    );

    socket.on("debugPutMonsterCardInSlot", async (payload, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          payload,
          schemas.debugPutMonsterCardInSlotRequest,
          callback,
          (payload) => {
            helper.executeDebugPutMonsterCardInSlotRequest(
              room.game,
              payload,
              player,
            );
            return callback({ status: 200 });
          },
        ),
      ),
    );

    socket.on("debugChangeDiceResult", async (payload, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          payload,
          schemas.debugChangeDiceResultRequest,
          callback,
          (payload) => {
            helper.executeDebugChangeDiceResultRequest(
              room.game,
              payload,
              player,
            );
            return callback({ status: 200 });
          },
        ),
      ),
    );

    socket.on("debugListAvailableDices", async (callback) =>
      errorGuardedEndpoint(callback, () => {
        room.game.addToHistory({
          type: "DebugListDices",
          issuer: player.id,
        });
        const dices = room.game.stack.elements.filter(e => e instanceof DiceRoll).map(e => e.json);
        return callback({ status: 200, dices: dices });
      }),
    );
  }

  socket.on("debugPutRoom", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.debugPutRoomRequest,
        callback,
        (payload) => {
          helper.executeDebugPutRoomRequest(
            room.game,
            payload,
            player,
          );
          return callback({ status: 200 });
        },
      ),
    ),
  );

  socket.on("debugListRooms", async (callback) =>
    errorGuardedEndpoint(callback, () => {
      const cards = room.game.rooms?._deck.cards.toSorted((a, b) => (a.name + a.slug).localeCompare(b.name + b.slug))
          .map((c) => c.jsonAPI) || [];
      return callback({ status: 200, cards });
    }),
  );
};
