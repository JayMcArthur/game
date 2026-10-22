import type { RoomCharacter } from "../shared/api";
import type { GameParameters } from "../models/gameParameters";
import type { Game } from "../models/game";
import type { ClientToServerEvents, ServerToClientEvents } from "@/shared/api";
import type { Socket as SocketIO, Server as ServerIO } from "socket.io";
import type { BotLevel, Team } from "@/shared/api";
import type { BotRunner } from "@/bots/runner";

export type Socket = SocketIO<ClientToServerEvents, ServerToClientEvents>;
export type Server = ServerIO<ClientToServerEvents, ServerToClientEvents>;

export const DEFAULT_CHARACTER: RoomCharacter = {
  character: "random",
  eternal: "random",
};

export interface Instance {
  id: string;
  name: string;
  isCopy: boolean;
  isActive: boolean;
  character: RoomCharacter;
  team: Team;
}

export interface User {
  socket: Socket;
  isHost: boolean;
  instances: Instance[];
}

/** Inside the room — read-only view as a player. */
export interface Spectator {
  socket: Socket;
  viewingName: string;
}

/** A server-owned participant, independent of browser Users and sockets. */
export interface BotSeat {
  id: string;
  name: string;
  character: RoomCharacter;
  team: Team;
  level: BotLevel;
}

export interface Room {
  id: string;
  lastActionTimestamp: Date;
  users: User[];
  bots?: BotSeat[];
  botRunner?: BotRunner;
  spectators: Spectator[];
  params: GameParameters;
  characters: RoomCharacter[];
  game?: Game;
  gameCount: number;
  createdAt: Date;
  isJoinAllowed: boolean;
}

export interface RoomWithGame extends Room {
  game: Game;
}
