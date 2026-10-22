import { describe, expect, test } from "bun:test";
import { Game } from "@/models/game";
import { GameParameters } from "@/models/gameParameters";
import { Player } from "@/models/entities/player";
import { schemas, Team } from "@/shared/api";
import {
  addRoomBot, assertBotLobby, configuredGameBotSeats, removeRoomBot,
  roomGamePlayers, roomHasPlayerName, roomPlayers, setRoomBotLevel,
  unusedPlayerName, unusedPlayerTeam,
} from "@/network/botSeats";
import { DEFAULT_CHARACTER, type Room, type Socket, type User } from "@/network/types";

function fixture() {
  // The socket identity is the only transport field used by seat admission.
  const socket = { id: "host-socket" } as Socket;
  const user: User = {
    socket, isHost: true,
    instances: [{
      id: "human-seat", name: "Alice", isCopy: false, isActive: true,
      character: DEFAULT_CHARACTER, team: Team.Team1,
    }],
  };
  const room: Room = {
    id: "bot-seat-test", users: [user], spectators: [],
    params: new GameParameters(() => {}), characters: [],
    lastActionTimestamp: new Date(), createdAt: new Date(),
    gameCount: 0, isJoinAllowed: true,
  };
  return { room, user, socket };
}

describe("server-owned bot seats", () => {
  test("validates explicit levels, bounded names and request fields", () => {
    expect(schemas.addBotRequest.parse({ level: "hard" })).toEqual({ level: "hard" });
    for (const payload of [
      { level: "expert" }, { level: "easy", name: "" },
      { level: "normal", name: "x".repeat(17) },
      { level: "hard", name: "a b" },
      { level: "hard", user: "human-socket" },
    ]) expect(schemas.addBotRequest.safeParse(payload).success).toBe(false);
    expect(schemas.setBotLevelRequest.safeParse({ id: "seat", level: "normal" }).success).toBe(true);
    expect(schemas.removeBotRequest.safeParse({ id: "" }).success).toBe(false);
  });

  test("adds independent seats and counts every human copy and bot toward the four-player limit", () => {
    const { room, user } = fixture();
    user.instances.push({ ...user.instances[0]!, id: "copy", name: "Tainted Alice", isCopy: true });
    addRoomBot(room, { level: "easy" }, 4);
    addRoomBot(room, { level: "hard" }, 4);
    expect(room.bots?.map(seat => seat.name)).toEqual(["Bot", "Bot_2"]);
    expect(room.bots?.map(seat => seat.team)).toEqual([Team.Team2, Team.Team3]);
    expect(room.bots?.every(seat => seat.character.character === "random")).toBe(true);
    expect(room.users).toEqual([user]);
    expect(user.instances).toHaveLength(2);
    expect(roomPlayers(room)).toHaveLength(4);
    expect(() => addRoomBot(room, { level: "normal" }, 4)).toThrow("Room is full");
    expect(new Set(room.bots!.map(seat => seat.id)).size).toBe(2);
  });

  test("shares names and teams across bots, humans and generated copies", () => {
    const { room } = fixture();
    expect(() => addRoomBot(room, { name: "Alice", level: "hard" }, 4)).toThrow("already taken");
    addRoomBot(room, { name: "Tainted_Alice", level: "normal" }, 4);
    expect(roomHasPlayerName(room, "Tainted_Alice")).toBe(true);
    expect(unusedPlayerName(room, "Tainted_Alice")).toBe("Tainted_Alice_2");
    expect(unusedPlayerTeam(room)).toBe(Team.Team3);
    expect(() => addRoomBot(room, { name: "Tainted_Alice", level: "easy" }, 4)).toThrow("already taken");
  });

  test("changes and removes only the named bot ID", () => {
    const { room } = fixture();
    addRoomBot(room, { level: "easy" }, 4);
    addRoomBot(room, { level: "normal" }, 4);
    const [first, second] = room.bots!;
    setRoomBotLevel(room, { id: first!.id, level: "hard" });
    expect(room.bots?.map(seat => seat.level)).toEqual(["hard", "normal"]);
    expect(() => setRoomBotLevel(room, { id: "human-seat", level: "hard" })).toThrow("Bot not found");
    expect(() => removeRoomBot(room, { id: "human-seat" })).toThrow("Bot not found");
    removeRoomBot(room, { id: first!.id });
    expect(room.bots).toEqual([second!]);
    expect(room.users[0]?.instances[0]?.name).toBe("Alice");
  });

  test("requires the current host socket in a waiting room", () => {
    const { room, user, socket } = fixture();
    expect(() => assertBotLobby(room, user, socket)).not.toThrow();
    user.isHost = false;
    expect(() => assertBotLobby(room, user, socket)).toThrow("current room host");
    user.isHost = true;
    expect(() => assertBotLobby(room, user, { id: "replacement" } as Socket)).toThrow("current room host");
    room.users = [];
    expect(() => assertBotLobby(room, user, socket)).toThrow("current room host");
    room.users = [user];
    room.game = new Game("bot-seat-host-gate");
    expect(() => assertBotLobby(room, user, socket)).toThrow("before a game starts");
  });

  test("starts bots with distinct ownership and never adopts a loaded human by name", () => {
    const { room } = fixture();
    addRoomBot(room, { name: "Opponent", level: "hard" }, 4);
    const seat = room.bots![0]!;
    expect(roomGamePlayers(room)).toEqual([
      { issuer: "Alice", character: "random", user: "host-socket", team: Team.Team1 },
      { issuer: "Opponent", character: "random", user: `bot:${seat.id}`, team: Team.Team2 },
    ]);
    const game = new Game("bot-seat-load-gate");
    room.game = game;
    game.entityHandler.addPlayer(new Player("Opponent", Team.Team2, "recorded-human"));
    expect(configuredGameBotSeats(room)).toEqual([]);
    room.game = new Game("bot-seat-restore");
    room.game.entityHandler.addPlayer(new Player("Opponent", Team.Team2, `bot:${seat.id}`));
    expect(configuredGameBotSeats(room)).toEqual([seat]);
    room.users[0]!.instances[0]!.name = "Opponent";
    expect(configuredGameBotSeats(room)).toEqual([]);
  });
});
