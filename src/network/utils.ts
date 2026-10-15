import type { z, ZodType } from "zod";
import type {
  Instance,
  Room,
  RoomWithGame,
  Socket,
  Spectator,
  User,
} from "./types";
import type {
  Capability,
  Room as RoomPayload,
  RoomBroadcast,
  SerializedTranslation,
  GameOverBroadcast,
} from "@/shared/api";
import { MAX_PLAYER_COUNT, roomManager } from "./roomManager";
import { getAdminMessages, getHourlyGameStats } from "@/utils/db";
import { Game } from "@/models/game";
import { GameError } from "@/models/GameError";
import { toSerializedTranslation } from "@/utils/translation";

export const errorGuardedEndpoint = async (
  callback: (response: {
    status: 400;
    error: string | SerializedTranslation;
  }) => void,
  handler: () => void | Promise<void>,
): Promise<void> => {
  try {
    await handler();
  } catch (error) {
    console.error("Error in errorGuardedEndpoint", error);
    if (error instanceof Error) {
      return callback({
        status: 400,
        error:
          error instanceof GameError && error.translation !== undefined
            ? error.translation
            : error.message,
      });
    }
    return callback({ status: 400, error: "Unknown error" });
  }
};

export const payloadGuardedEndpoint = async <T extends ZodType>(
  payload: unknown,
  schema: T,
  callback: (response: { status: 400; error: string }) => void,
  onSuccess: (payload: z.infer<T>) => void | Promise<void>,
): Promise<void> => {
  const validated = schema.safeParse(payload);
  if (!validated.success) {
    return callback({ status: 400, error: validated.error.message });
  }
  await onSuccess(validated.data);
};

export const sendRoomChangedToAll = (room: Room): void => {
  for (const user of room.users) {
    sendRoomChangedToUser(room, user);
  }
  for (const spectator of room.spectators) {
    sendRoomChangedToSpectator(room, spectator);
  }
};

export const sendRoomChangedToUser = (room: Room | null, user: User): void => {
  for (const instance of user.instances) {
    if (instance.isActive) {
      user.socket.emit(
        "on:room:changed",
        room ? generateRoomChangedPayload(room, instance, false) : null,
      );
    } else if (room?.game) {
      // Purge animations
      room.game.detailedStateJSON(
        room.game.entityHandler.getPlayerById(instance.name),
      );
    }
  }
};

export const resolveSpectatorView = (
  room: Room,
  spectator: Spectator,
): Instance | null => {
  const current = getUserByName(room, spectator.viewingName);
  if (current) return current.instance;

  const fallback =
    room.users
      .flatMap((user) => user.instances)
      .find((instance) => instance.isActive) ??
    room.users[0]?.instances[0] ??
    null;

  if (fallback) {
    spectator.viewingName = fallback.name;
  }
  return fallback;
};

export const sendRoomChangedToSpectator = (
  room: Room | null,
  spectator: Spectator,
): void => {
  if (!room) {
    spectator.socket.emit("on:room:changed", null);
    return;
  }

  const viewing = resolveSpectatorView(room, spectator);
  if (!viewing) {
    spectator.socket.emit("on:room:changed", null);
    return;
  }

  spectator.socket.emit(
    "on:room:changed",
    generateRoomChangedPayload(room, viewing, true),
  );
};

export const getJoinCapability = (room: Room): Capability => {
  if (!room.isJoinAllowed) {
    return toSerializedTranslation("error.roomLocked");
  }
  if (room.game !== undefined) {
    return toSerializedTranslation("error.gameStarted");
  }
  if (room.users.flatMap((user) => user.instances).length >= MAX_PLAYER_COUNT) {
    return toSerializedTranslation("error.roomFull");
  }
  return true;
};

export const sendRoomBroadcast = (
  room: Room,
  broadcast: {
    type: RoomBroadcast["type"];
    title: RoomBroadcast["title"];
    message: RoomBroadcast["message"];
    players: string[];
  },
): void => {
  for (const user of room.users) {
    for (const instance of user.instances) {
      if (!instance.isActive) continue;
      if (!broadcast.players.includes(instance.name)) continue;
      user.socket.emit("on:room:broadcast", {
        type: broadcast.type,
        title: broadcast.title,
        message: broadcast.message,
      });
    }
  }

  for (const spectator of room.spectators) {
    if (!broadcast.players.includes(spectator.viewingName)) continue;
    spectator.socket.emit("on:room:broadcast", {
      type: broadcast.type,
      title: broadcast.title,
      message: broadcast.message,
    });
  }
};
export const sendEndGameBroadcast = (
  room: Room,
  broadcast: GameOverBroadcast,
): void => {
  for (const user of room.users) {
    for (const instance of user.instances) {
      if (!instance.isActive) continue;
       user.socket.emit("on:room:gameover", broadcast);
    }
  }
  for (const spectator of room.spectators) {
    spectator.socket.emit("on:room:gameover", broadcast);
  }
};


export const attachGameEventListeners = (room: Room): void => {
  if (!room.game) return;

  room.game.onStateChange.add(() => {
    sendRoomChangedToAll(room);
  });

  room.game.onRoomBroadcast.add((broadcast) => {
    sendRoomBroadcast(room, broadcast);
  });

  room.game.onEndReached.add((broadcast) => {
    sendEndGameBroadcast(room, broadcast);
  });
};

export const sendAdminChanged = (socket: Socket): void => {
  socket.emit("on:admin:changed", {
    rooms: roomManager.adminRooms,
    messages: getAdminMessages(),
    stats: {
      hourly: getHourlyGameStats(),
    },
  });
};

const generateRoomChangedPayload = (
  room: Room,
  recipient: Instance,
  isSpectator: boolean,
): RoomPayload => {
  let game = room.game?.detailedStateJSON(
    room.game.entityHandler.getPlayerById(recipient.name),
  );

  // Clean up the game state for spectators
  if (game && isSpectator) {
    game.me.hand = [];
    game.me.pendingSelection = undefined;
  }

  return {
    id: room.id,
    players: room.users
      .map((user) =>
        user.instances.flatMap((instance) => ({
          isMe: user.instances.some((i) => i.id === recipient.id),
          isHost: user.isHost,
          isCopy: instance.isCopy,
          name: instance.name,
          character: instance.character,
          team: instance.team,
        })),
      )
      .flat(),
    characters: room.characters,
    gameParameters: room.params.toJson(),
    game,
    isJoinAllowed: room.isJoinAllowed,
    isSpectator,
    spectatorCount: room.spectators.length,
    createdAt: room.createdAt,
    capabilities: {
      join: getJoinCapability(room),
    },
  };
};

export const sendUserAssigned = (
  socket: Socket,
  instance: Instance | null,
): void => {
  socket.emit("on:user:assigned", instance?.id ?? null);
};

export const updatePlayerCount = (room: Room): void => {
  room.params.setPlayerCount(
    room.users.flatMap((user) => user.instances).length,
  );
};

export const leaveCurrentStep = (socket: Socket): void => {
  for (const event of socket.eventNames()) {
    if (event === "disconnect") continue;
    socket.removeAllListeners(event);
  }
};

export const registerRoomActivity = (room: Room): void => {
  room.lastActionTimestamp = new Date();
};

export const getUserByName = (
  room: Room,
  name: string,
): { user: User; instance: User["instances"][number] } | null => {
  for (const user of room.users) {
    for (const instance of user.instances) {
      if (instance.name === name) {
        return { user, instance };
      }
    }
  }
  return null;
};

export const getFirstViewableInstance = (room: Room): Instance | null => {
  return (
    room.users
      .flatMap((user) => user.instances)
      .find((instance) => instance.isActive) ??
    room.users[0]?.instances[0] ??
    null
  );
};

export const isRoomWithGame = (
  room: Room | RoomWithGame,
): room is RoomWithGame => {
  return "game" in room && room.game instanceof Game;
};
