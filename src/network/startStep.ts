import { Game } from "@/models/game";
import { GameError } from "@/models/GameError";
import type { HistoricEntry } from "@/models/handlers/historyHandler";
import { schemas } from "@/shared/api";
import { loadGameFromLogs } from "@/utils/loadGameFromLogs";
import { generateUserId } from "@/utils/random";
import { toSerializedTranslation } from "@/utils/translation";
import { enterGameStep } from "./gameStep";
import { globalEndpoints } from "./global";
import { enterIntroStep } from "./introStep";
import { MAX_PLAYER_COUNT, roomManager } from "./roomManager";
import { type Room, type Socket, type User } from "./types";
import {
  addRoomBot, assertBotLobby, removeRoomBot, roomGamePlayers,
  roomHasPlayerName, roomPlayers, setRoomBotLevel, unusedPlayerName,
} from "./botSeats";
import {
  attachGameEventListeners,
  errorGuardedEndpoint,
  getUserByName,
  isRoomWithGame,
  leaveCurrentStep,
  payloadGuardedEndpoint,
  registerRoomActivity,
  sendRoomChangedToAll,
  sendRoomChangedToSpectator,
  sendRoomChangedToUser,
  sendUserAssigned,
  updatePlayerCount,
  startRoomBots,
  stopRoomBots,
} from "./utils";

export const enterStartStep = (
  socket: Socket,
  room: Room,
  user: User,
): void => {
  for (const instance of user.instances) {
    instance.isActive = !instance.isCopy;
  }

  sendRoomChangedToUser(room, user);

  globalEndpoints(socket, room);

  socket.on("leaveRoom", async (callback) =>
    errorGuardedEndpoint(callback, () => {
      if (user.isHost) {
        const spectators = [...room.spectators];
        room.users.forEach((user) => {
          leaveCurrentStep(user.socket);
          enterIntroStep(user.socket);
          sendUserAssigned(user.socket, null);
          sendRoomChangedToUser(null, user);
        });
        for (const spectator of spectators) {
          leaveCurrentStep(spectator.socket);
          enterIntroStep(spectator.socket);
          sendRoomChangedToSpectator(null, spectator);
        }
        room.spectators = [];
        roomManager.deleteRoom(room.id);
      } else {
        room.users = room.users.filter((u) => u.socket.id !== user.socket.id);
        updatePlayerCount(room);

        sendRoomChangedToAll(room);

        sendUserAssigned(socket, null);
        sendRoomChangedToUser(null, user);

        leaveCurrentStep(socket);
        enterIntroStep(socket);
      }

      return callback({ status: 200 });
    }),
  );

  socket.on("setName", async (request, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        request,
        schemas.setNameRequest,
        callback,
        (payload) => {
          if (payload.length === 0) {
            return callback({ status: 400, error: "A name is required" });
          }

          if (payload.length > 16) {
            return callback({
              status: 400,
              error: "Your name needs to be less than 16 characters",
            });
          }

          if (!/\w/u.test(payload)) {
            return callback({
              status: 400,
              error:
                "Your name can only contain letters, numbers and underscores",
            });
          }

          if (roomHasPlayerName(room, payload)) {
            return callback({
              status: 400,
              error: "That name is already taken",
            });
          }

          const activeInstance = user.instances.find(
            (instance) => instance.isActive,
          );
          if (!activeInstance) {
            return callback({ status: 400, error: "No active instance found" });
          }

          activeInstance.name = payload;
          sendRoomChangedToAll(room);
        },
      ),
    ),
  );

  socket.on("setTeam", async (request, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        request,
        schemas.setTeamRequest,
        callback,
        (payload) => {
          const bot = room.bots?.find(seat => seat.name === payload.name);
          if (bot) {
            assertBotLobby(room, user, socket);
            bot.team = payload.team;
            sendRoomChangedToAll(room);
            return callback({ status: 200 });
          }
          const targetUser = getUserByName(room, payload.name);
          if (!targetUser) {
            return callback({ status: 400, error: "User not found" });
          }
          if (targetUser.user.socket.id !== user.socket.id) {
            return callback({
              status: 400,
              error: "You cannot set the team of another player",
            });
          }
          targetUser.instance.team = payload.team;
          sendRoomChangedToAll(room);
          return callback({ status: 200 });
        },
      ),
    ),
  );

  socket.on("selectCharacter", async (payload, callback) =>
    errorGuardedEndpoint(callback, async () =>
      payloadGuardedEndpoint(
        payload,
        schemas.selectCharacterRequest,
        callback,
        (payload) => {
          const bot = room.bots?.find(seat => seat.name === payload.name);
          if (bot) {
            assertBotLobby(room, user, socket);
            bot.character = payload.character;
            sendRoomChangedToAll(room);
            return callback({ status: 200 });
          }
          const targetUser = user.instances.find(
            (user) => user.name === payload.name,
          );
          if (!targetUser) {
            return callback({ status: 400, error: "User not found" });
          }
          targetUser.character = payload.character;
          sendRoomChangedToAll(room);
          return callback({ status: 200 });
        },
      ),
    ),
  );

  if (user.isHost) {
    socket.on("addBot", async (request, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(request, schemas.addBotRequest, callback, payload => {
          assertBotLobby(room, user, socket);
          addRoomBot(room, payload, MAX_PLAYER_COUNT);
          updatePlayerCount(room);
          registerRoomActivity(room);
          sendRoomChangedToAll(room);
          return callback({ status: 200 });
        }),
      ),
    );

    socket.on("removeBot", async (request, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(request, schemas.removeBotRequest, callback, payload => {
          assertBotLobby(room, user, socket);
          removeRoomBot(room, payload);
          updatePlayerCount(room);
          registerRoomActivity(room);
          sendRoomChangedToAll(room);
          return callback({ status: 200 });
        }),
      ),
    );

    socket.on("setBotLevel", async (request, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(request, schemas.setBotLevelRequest, callback, payload => {
          assertBotLobby(room, user, socket);
          setRoomBotLevel(room, payload);
          registerRoomActivity(room);
          sendRoomChangedToAll(room);
          return callback({ status: 200 });
        }),
      ),
    );

    socket.on("kickFromRoom", async (request, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          request,
          schemas.kickFromRoomRequest,
          callback,
          (payload) => {
            const target = getUserByName(room, payload.name);
            if (!target) {
              return callback({ status: 400, error: "User not found" });
            }
            if (target.instance.isCopy) {
              target.user.instances = target.user.instances.filter(
                (instance) => instance.id !== target.instance.id,
              );
            } else {
              room.users = room.users.filter(
                (user) => user.socket.id !== target.user.socket.id,
              );
            }

            updatePlayerCount(room);
            sendRoomChangedToAll(room);

            if (target.instance.isActive) {
              const socket = target.user.socket;
              sendUserAssigned(socket, null);
              sendRoomChangedToUser(null, target.user);

              leaveCurrentStep(socket);
              enterIntroStep(socket);
            }

            return callback({ status: 200 });
          },
        ),
      ),
    );

    socket.on("makeCopyOfPlayer", async (request, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          request,
          schemas.makeCopyOfPlayerRequest,
          callback,
          (payload) => {
            const original = getUserByName(room, payload.name);
            if (!original) {
              return callback({ status: 400, error: "User not found" });
            }
            if (
              roomPlayers(room).length >= MAX_PLAYER_COUNT
            ) {
              return callback({ status: 400, error: "Room is full" });
            }
            if (original.instance.isCopy) {
              return callback({ status: 400, error: "User is already a copy" });
            }
            const prefixes = ["Tainted", "Holy", "Cursed"];

            const prefix =
              prefixes[original.user.instances.length - (1 % prefixes.length)];

            let newName = `${prefix} ${original.instance.name}`;
            if (newName.length > 16) {
              newName = newName.slice(0, 15) + "…";
            }

            newName = unusedPlayerName(room, newName);
            original.user.instances.push({
              id: generateUserId(),
              name: newName,
              isCopy: true,
              isActive: false,
              character: original.instance.character,
              team: original.instance.team,
            });
            updatePlayerCount(room);
            sendRoomChangedToAll(room);
            return callback({ status: 200 });
          },
        ),
      ),
    );

    socket.on("setJoinPermission", async (payload, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          payload,
          schemas.setJoinPermission,
          callback,
          (payload) => {
            room.isJoinAllowed = payload;
            sendRoomChangedToAll(room);
            return callback({ status: 200 });
          },
        ),
      ),
    );

    socket.on("setGameParameter", async (payload, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          payload,
          schemas.setGameParameterRequest,
          callback,
          (payload) => {
            registerRoomActivity(room);
            room.params.setParameterByKey(payload.parameter, payload.value);
          },
        ),
      ),
    );

    socket.on("resetGameParameters", async (callback) =>
      errorGuardedEndpoint(callback, () => {
        room.params.reset();
        updatePlayerCount(room);
        sendRoomChangedToAll(room);
        return callback({ status: 200 });
      }),
    );

    socket.on("loadGameParameters", async (payload, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          payload,
          schemas.loadGameParametersRequest,
          callback,
          (payload) => {
            const settings = JSON.parse(payload);
            room.params.loadFromJson(settings);
            return callback({ status: 200 });
          },
        ),
      ),
    );

    socket.on("loadGame", async (payload, callback) =>
      errorGuardedEndpoint(callback, async () =>
        payloadGuardedEndpoint(
          payload,
          schemas.loadGameRequest,
          callback,
          async (payload) => {
            // Ensure requester is an authorized player in the current room game.
            const logs: HistoricEntry[] = JSON.parse(payload);
            if (!logs)
              throw new GameError(
                "Logs are not valid JSON or not in the expected format.",
                toSerializedTranslation("error.parsingError", {
                  error:
                    "Logs are not valid JSON or not in the expected format.",
                }),
              );
            stopRoomBots(room);
            room.game = await loadGameFromLogs(logs);
            room.gameCount++;

            attachGameEventListeners(room);
            startRoomBots(room);

            if (!isRoomWithGame(room)) {
              return callback({ status: 400, error: "Game not found" });
            }

            roomManager.attachGameRecordListeners(room);
            roomManager.recordGameStart(room);

            sendRoomChangedToAll(room);

            for (const user of room.users) {
              const activeInstance = user.instances.find(
                (instance) => instance.isActive,
              );
              if (!activeInstance) continue;
              leaveCurrentStep(user.socket);
              enterGameStep(user.socket, room, user);
              user.socket.emit("on:room:broadcast", {
                type: "info",
                title: toSerializedTranslation("toast.gameLoaded.title", {
                  player: activeInstance.name,
                }),
                message: toSerializedTranslation("toast.gameLoaded.message"),
              });
            }

            for (const spectator of room.spectators) {
              spectator.socket.emit("on:room:broadcast", {
                type: "info",
                title: toSerializedTranslation("toast.gameLoaded.title", {
                  player: spectator.viewingName,
                }),
                message: toSerializedTranslation("toast.gameLoaded.message"),
              });
            }

            return callback({ status: 200 });
          },
        ),
      ),
    );

    socket.on("start", async (callback) =>
      errorGuardedEndpoint(callback, async () => {
        assertBotLobby(room, user, socket);
        if (roomPlayers(room).length > MAX_PLAYER_COUNT) throw new Error("Room is full");
        const params = room.params;

        const game = new Game("", params);

        const playersWithCharacters = roomGamePlayers(room);

        game.startOfGameSetup(playersWithCharacters);
        game.addToHistory({
          type: "Start",
          players: playersWithCharacters,
          params: room.params.toJson(),
        });

        // Assign after setup so mid-setup state changes don't serialize an uninitialized game.
        room.game = game;
        room.gameCount++;
        attachGameEventListeners(room);

        if (!isRoomWithGame(room)) {
          return callback({ status: 400, error: "Game not found" });
        }

        roomManager.attachGameRecordListeners(room);
        roomManager.recordGameStart(room);

        for (const user of room.users) {
          const socket = user.socket;
          leaveCurrentStep(socket);
          enterGameStep(socket, room, user);
        }
        sendRoomChangedToAll(room);
        startRoomBots(room);
        await game.atGameStartDecisions();

        return callback({ status: 200 });
      }),
    );
  }
};
