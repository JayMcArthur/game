import { Team, type Requests } from "@/shared/api";
import { generateUserId } from "@/utils/random";
import { DEFAULT_CHARACTER, type Room, type Socket, type User } from "./types";

export const roomPlayers = (room: Room) => [
  ...room.users.flatMap(user => user.instances),
  ...(room.bots ?? []),
];

export const roomHasPlayerName = (room: Room, name: string): boolean =>
  roomPlayers(room).some(player => player.name === name);

export function unusedPlayerName(room: Room, base: string): string {
  let name = base.slice(0, 16);
  for (let suffix = 2; roomHasPlayerName(room, name); suffix++) {
    const ending = `_${suffix}`;
    name = base.slice(0, 16 - ending.length) + ending;
  }
  return name;
}

export const unusedPlayerTeam = (room: Room): Team =>
  [Team.Team1, Team.Team2, Team.Team3, Team.Team4].find(
    team => !roomPlayers(room).some(player => player.team === team),
  ) ?? Team.Team1;

export function assertBotLobby(room: Room, user: User, socket: Socket): void {
  if (!user.isHost || !room.users.includes(user) || user.socket !== socket)
    throw new Error("Only the current room host can configure bots");
  if (room.game !== undefined) throw new Error("Bots can only be configured before a game starts");
}

export function addRoomBot(room: Room, request: Requests.AddBot, maximumPlayers: number): void {
  if (roomPlayers(room).length >= maximumPlayers) throw new Error("Room is full");
  const name = request.name ?? unusedPlayerName(room, "Bot");
  if (roomHasPlayerName(room, name)) throw new Error("That name is already taken");
  (room.bots ??= []).push({
    id: generateUserId(),
    name,
    character: { ...DEFAULT_CHARACTER },
    team: unusedPlayerTeam(room),
    level: request.level,
  });
}

export function removeRoomBot(room: Room, request: Requests.RemoveBot): void {
  if (!room.bots?.some(seat => seat.id === request.id)) throw new Error("Bot not found");
  room.bots = room.bots.filter(seat => seat.id !== request.id);
}

export function setRoomBotLevel(room: Room, request: Requests.SetBotLevel): void {
  const seat = room.bots?.find(seat => seat.id === request.id);
  if (!seat) throw new Error("Bot not found");
  seat.level = request.level;
}

/** Only a configured, originally automated seat may resume after native log load. */
export function configuredGameBotSeats(room: Room) {
  const game = room.game;
  if (!game) return [];
  const humanNames = new Set(room.users.flatMap(user => user.instances.map(instance => instance.name)));
  return (room.bots ?? []).filter(seat =>
    !humanNames.has(seat.name) && game.players.some(player =>
      player.id === seat.name && player.user === `bot:${seat.id}`,
    ),
  );
}

export const roomGamePlayers = (room: Room) => [
  ...room.users.flatMap(user => user.instances.map(instance => ({
    issuer: instance.name,
    character: instance.character.character,
    user: user.socket.id,
    team: instance.team,
  }))),
  ...(room.bots ?? []).map(seat => ({
    issuer: seat.name,
    character: seat.character.character,
    user: `bot:${seat.id}`,
    team: seat.team,
  })),
];
