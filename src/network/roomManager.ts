import { GameParameters } from "@/models/gameParameters";
import type { Room, Socket, User } from "./types";
import {
  leaveCurrentStep,
  sendRoomChangedToAll,
  sendRoomChangedToUser,
  sendUserAssigned,
  stopRoomBots,
} from "./utils";
import { CARD_SETS } from "@/models/handlers/cardHandler";
import type { AdminRoom, RoomCharacter } from "@/shared/api";
import { enterIntroStep } from "./introStep";
import bun from "bun";
import {
  finalizeGameRecord as dbFinalizeGameRecord,
  insertGameRecord,
  recordGameEndReached,
} from "@/utils/db";
import { toSerializedTranslation } from "@/utils/translation";

const INACTIVE_ROOM_TIMEOUT = 3 * 60 * 60 * 1_000; // 3 hours
export const MAX_PLAYER_COUNT = 4;

class RoomManager {
  private rooms: Map<string, Room> = new Map();
  constructor() {
    setInterval(() => {
      this.pruneInactiveRooms();
    }, 60_000);
  }

  private pruneInactiveRooms(): void {
    console.log(
      "[RoomManager] Pruning inactive rooms. Threshold is",
      Date.now() - INACTIVE_ROOM_TIMEOUT,
    );
    this.rooms.forEach((room) => {
      console.log(
        "[RoomManager] Checking room",
        room.id,
        "Last action timestamp",
        room.lastActionTimestamp.getTime(),
      );
      if (
        room.lastActionTimestamp.getTime() <
        Date.now() - INACTIVE_ROOM_TIMEOUT
      ) {
        try {
          room.users.forEach((user) => {
            leaveCurrentStep(user.socket);
            enterIntroStep(user.socket);
            sendUserAssigned(user.socket, null);
            sendRoomChangedToUser(null, user);

            user.socket.emit("on:room:broadcast", {
              type: "error",
              title: toSerializedTranslation("toast.roomPurged.title"),
              message: toSerializedTranslation("toast.roomPurged.message"),
            });
          });
          room.spectators.forEach((spectator) => {
            leaveCurrentStep(spectator.socket);
            enterIntroStep(spectator.socket);
            spectator.socket.emit("on:room:changed", null);
            spectator.socket.emit("on:room:broadcast", {
              type: "error",
              title: toSerializedTranslation("toast.roomPurged.title"),
              message: toSerializedTranslation("toast.roomPurged.message"),
            });
          });
          room.spectators = [];
        } catch (error) {
          console.error("[RoomManager] Error pruning inactive room", error);
        } finally {
          this.deleteRoom(room.id);
        }
      }
    });
  }

  createRoom(roomId: string, user: User): Room {
    const room: Room = {
      id: roomId,
      users: [user],
      bots: [],
      spectators: [],
      lastActionTimestamp: new Date(),
      params: new GameParameters(() => {
        sendRoomChangedToAll(room);
      }),
      characters: RoomManager.generateCharacterAndEternalPairs(),
      createdAt: new Date(),
      gameCount: 0,
      isJoinAllowed: true,
    };
    this.rooms.set(roomId, room);
    return room;
  }

  private static generateCharacterAndEternalPairs = (): RoomCharacter[] => {
    const charas = CARD_SETS.character.cards.map((card) => ({
      character: card.jsonAPI,
      eternal: card.eternalCard,
    }));

    return [
      { character: "random", eternal: "random" },
      ...charas.map((card) => ({
        character: card.character.slug,
        eternal: card.eternal ?? "random",
      })),
    ];
  };

  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      stopRoomBots(room);
      this.finalizeGameRecord(room);
    }
    try {
      this.saveGameLogs(roomId, false);
    } catch (error) {
      console.error("[RoomManager] Error saving game logs", error);
    } finally {
      this.rooms.delete(roomId);
      console.log("[RoomManager] Room", roomId, "deleted");
    }
  }

  attachGameRecordListeners(room: Room): void {
    if (!room.game) return;
    room.game.onEndReached.add(() => {
      recordGameEndReached(room.id, new Date().toISOString());
    });
  }

  recordGameStart(room: Room): void {
    if (!room.game) return;
    const params = room.game.gameParameters;
    const teamCount = new Set(
      room.game.players.map(player => player.team),
    ).size;
    insertGameRecord(
      room.id,
      new Date().toISOString(),
      room.users.length,
      room.game.players.length,
      teamCount,
      room.game.turnHandler.numberOfRoundSinceBeginning,
      {
        miniDraft: params.miniDraft.value,
        useFsp2Cards: params.useFSP2Cards.value,
        nbSoulsToWin: params.nbSoulsToWin.value,
        timer: params.timer.value,
        nbPlayerCardRestriction: params.nbPlayerCardRestriction.value,
        allowCheatOptions: params.allowCheatOptions.value,
        playWithBonusSouls: params.playWithBonusSouls.value,
        playWithRooms: params.playWithRooms.value,
        deckMode: params.deckMode,
      },
    );
  }

  finalizeGameRecord(room: Room): void {
    if (!room.game) return;
    dbFinalizeGameRecord(
      room.id,
      room.game.reachedEnd,
      room.game.turnHandler.numberOfRoundSinceBeginning,
      room.lastActionTimestamp.toISOString(),
    );
  }

  saveGameLogs(roomId: string, bugReport: boolean): string | undefined {
    const room = this.rooms.get(roomId);
    if (!room || !room.game) return;
    const game = room.game;

    if (!bugReport && room.game.turnHandler.round < 4) return;

    try {
      let logs = JSON.stringify(game.log, null, 2);

      // Anonymize player names
      for (const [index, player] of game.players.entries()) {
        logs = logs.replaceAll(`"${player.id}`, `"p${index}`);
      }

      // Save logs to file
      const fileName = `${roomId}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const folder = bugReport ? "bug-logs" : "room-logs";
      void bun.write(`db/${folder}/${fileName}`, logs);
      return fileName;
    } catch (error) {
      console.error(
        `[RoomManager] Skipping game log save for room ${roomId} (bugReport=${bugReport}):`,
        error,
      );
      return;
    }
  }

  async getGameLogs(filename: string): Promise<string | undefined> {
    return Bun.file(`db/bug-logs/${filename}`).text();
  }

  findRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  removeSpectator(socket: Socket): void {
    this.rooms.forEach((room) => {
      const before = room.spectators.length;
      room.spectators = room.spectators.filter(
        (spectator) => spectator.socket.id !== socket.id,
      );
      if (room.spectators.length !== before) {
        sendRoomChangedToAll(room);
      }
    });
  }

  get adminRooms(): AdminRoom[] {
    return Array.from(this.rooms.values())
      .map((room) => ({
        id: room.id,
        createdAt: room.createdAt.toISOString(),
        lastAction: room.lastActionTimestamp.toISOString(),
        users: room.users.length,
        gameCount: room.gameCount,
        game: room.game
          ? {
              round: room.game.turnHandler.round,
              maxSoul: room.game.players.reduce(
                (max, player) => Math.max(max, player.totalSouls),
                0,
              ),
            }
          : (false as const),
      }))
      .sort(
        (a, b) =>
          new Date(b.lastAction).getTime() - new Date(a.lastAction).getTime(),
      );
  }
}

export const roomManager = new RoomManager();
