import { generateUserId } from "@/utils/random";
import type { Responses } from "@/shared/api";
import { roomHasPlayerName, roomPlayers, unusedPlayerTeam } from "./botSeats";
import { toSerializedTranslation } from "@/utils/translation";
import { MAX_PLAYER_COUNT, roomManager } from "./roomManager";
import { enterStartStep } from "./startStep";
import {
  DEFAULT_CHARACTER,
  type Instance,
  type Room,
  type Socket,
  type User,
} from "./types";
import {
  leaveCurrentStep,
  sendRoomChangedToAll,
  sendUserAssigned,
  updatePlayerCount,
} from "./utils";

export const joinRoomAsPlayer = (
  socket: Socket,
  room: Room,
  name: string,
  callback: (response: Responses.EnterRoom) => void,
): void => {
  if (!room.isJoinAllowed) {
    return callback({
      status: 400,
      error: toSerializedTranslation("error.roomLocked"),
    });
  }

  if (roomPlayers(room).length >= MAX_PLAYER_COUNT) {
    return callback({
      status: 400,
      error: toSerializedTranslation("error.roomFull"),
    });
  }

  if (room.game !== undefined) {
    return callback({
      status: 400,
      error: toSerializedTranslation("error.gameStarted"),
    });
  }

  if (name.length === 0) {
    return callback({
      status: 400,
      error: toSerializedTranslation("error.nameRequired"),
    });
  }

  if (name.length > 16) {
    return callback({
      status: 400,
      error: toSerializedTranslation("error.nameLength"),
    });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return callback({
      status: 400,
      error: toSerializedTranslation("error.nameContent"),
    });
  }

  if (roomHasPlayerName(room, name)) {
    return callback({
      status: 400,
      error: toSerializedTranslation("error.nameAlreadyExists"),
    });
  }

  const instance: Instance = {
    id: generateUserId(),
    name,
    isCopy: false,
    isActive: true,
    character: DEFAULT_CHARACTER,
    team: unusedPlayerTeam(room),
  };
  const user: User = {
    instances: [instance],
    socket,
    isHost: false,
  };
  sendUserAssigned(socket, instance);

  roomManager.removeSpectator(socket);
  room.users.push(user);
  updatePlayerCount(room);

  leaveCurrentStep(socket);
  enterStartStep(socket, room, user);
  sendRoomChangedToAll(room);
  return callback({ status: 200 });
};
