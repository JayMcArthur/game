import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DeckConfigPatch, GameParametersJson, Room } from "@/shared/api";

interface Reply { status: number; error?: unknown; logs?: string }
interface NativeEntry {
  type: string;
  issuer?: string;
  players?: { issuer: string; user?: string }[];
}

/** Engine.IO v4 / Socket.IO client for the server fixture. */
class Client {
  room: Room | null = null;
  readonly botSetupRequests = new Set<number>();
  private nextAck = 0;
  private readonly pending = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly socket: WebSocket;
  readonly connected: Promise<void>;

  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    this.connected = new Promise((resolveConnection, reject) => {
      const timer = setTimeout(() => reject(new Error("Socket.IO connection timed out")), 3000);
      this.socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")));
      this.socket.addEventListener("message", event => {
        const packet = String(event.data);
        if (packet.startsWith("0")) this.socket.send(`40${JSON.stringify({ apiKey: "bot-socket-fixture" })}`);
        else if (packet === "2") this.socket.send("3");
        else if (packet.startsWith("40")) { clearTimeout(timer); resolveConnection(); }
        else if (packet.startsWith("44")) { clearTimeout(timer); reject(new Error("Socket.IO authentication failed")); }
        else if (packet.startsWith("42")) {
          const [name, payload] = JSON.parse(packet.slice(2)) as [string, Room | null];
          if (name === "on:room:changed") {
            this.room = payload;
            for (const selection of payload?.game?.pendingSelections ?? [])
              if (selection.player.name === "Cpu" && selection.reason === "mulliganCharacters")
                this.botSetupRequests.add(selection.requestId);
          }
        } else if (packet.startsWith("43")) {
          const match = /^(\d+)(\[.*)$/s.exec(packet.slice(2));
          if (!match) return;
          const id = Number(match[1]);
          const pending = this.pending.get(id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(id);
          pending.resolve((JSON.parse(match[2]!) as [Reply])[0]);
        }
      });
    });
  }

  request(name: string, payload?: unknown): Promise<Reply> {
    const id = this.nextAck++;
    return new Promise((resolveReply, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Socket.IO ${name} acknowledgement timed out`));
      }, 4000);
      this.pending.set(id, { resolve: resolveReply, reject, timer });
      this.socket.send(`42${id}${JSON.stringify(payload === undefined ? [name] : [name, payload])}`);
    });
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Socket.IO test client closed"));
    }
    this.pending.clear();
    this.socket.close();
  }
}

async function drain(stream: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) onText(decoder.decode(chunk, { stream: true }));
}

const delay = (milliseconds: number) => new Promise<void>(resolveDelay => setTimeout(resolveDelay, milliseconds));

test("actual Socket.IO lobby owns bots and completes their pending setup before autonomous native requests", async () => {
  const repository = resolve(dirname(import.meta.path), "../../..");
  const directory = mkdtempSync(join(tmpdir(), "ts-bot-server-socket-"));
  mkdirSync(join(directory, "db"), { mode: 0o700 });
  symlinkSync(join(repository, "data"), join(directory, "data"), "dir");
  const fixture = Bun.spawn([
    process.execPath, "--tsconfig-override", join(repository, "tsconfig.json"),
    join(repository, "src/tests/bots/serverSocketFixture.ts"),
  ], {
    cwd: directory,
    env: { FRONT_API_KEY: "bot-socket-fixture" },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  let stdout = "";
  let stderr = "";
  let reportPort!: (port: number) => void;
  const ready = new Promise<number>(resolvePort => { reportPort = resolvePort; });
  const output = drain(fixture.stdout, text => {
    stdout = (stdout + text).slice(-16_384);
    const match = /BOT_SOCKET_READY (\d+)/.exec(stdout);
    if (match) reportPort(Number(match[1]));
  });
  const errors = drain(fixture.stderr, text => { stderr = (stderr + text).slice(-16_384); });
  const clients: Client[] = [];
  try {
    const port = await Promise.race([
      ready,
      fixture.exited.then(code => { throw new Error(`Server fixture exited ${code}: ${stderr}`); }),
    ]);
    const host = new Client(port);
    const guest = new Client(port);
    clients.push(host, guest);
    await Promise.all(clients.map(client => client.connected));
    expect((await host.request("createRoom", { name: "Host" })).status).toBe(200);
    expect((await host.request("addBot", { level: "hard", name: "Cpu" })).status).toBe(200);
    const first = host.room!.players.find(player => player.name === "Cpu")!;
    expect(first.bot).toMatchObject({ level: "hard" });
    expect(first.character.character).toBe("random");
    expect([first.isMe, first.isHost, first.isCopy]).toEqual([false, false, false]);
    expect((await host.request("setBotLevel", { id: first.bot!.id, level: "normal" })).status).toBe(200);
    expect(host.room!.players.find(player => player.name === "Cpu")!.bot?.level).toBe("normal");
    expect((await host.request("addBot", { level: "easy", name: "Removed" })).status).toBe(200);
    const removed = host.room!.players.find(player => player.name === "Removed")!.bot!;
    expect((await guest.request("enterRoom", { type: "join", roomId: host.room!.id, name: "Guest" })).status).toBe(200);
    expect(host.room!.players).toHaveLength(4);
    expect((await host.request("addBot", { level: "easy" })).status).toBe(400);
    expect((await host.request("addBot", { level: "expert" })).status).toBe(400);
    expect((await guest.request("setTeam", { name: "Cpu", team: 1 })).status).toBe(400);
    expect(host.room!.players.find(player => player.name === "Cpu")!.team).toBe(first.team);
    expect((await host.request("removeBot", { id: removed.id })).status).toBe(200);
    expect(host.room!.players.map(player => player.name).sort()).toEqual(["Cpu", "Guest", "Host"]);
    expect((await host.request("addBot", { level: "easy", name: "Guest" })).status).toBe(400);
    expect((await host.request("selectCharacter", { name: "Host", character: { character: "b2-isaac", eternal: "random" } })).status).toBe(200);

    const original = host.room!.gameParameters;
    const settings: Partial<Omit<GameParametersJson, "decksConfig">> & { decksConfig: DeckConfigPatch } = {
      resolveCooldown: { ...original.resolveCooldown, value: 0 },
      mulliganCharacterNbOptions: { ...original.mulliganCharacterNbOptions, value: 2 },
      allowCheatOptions: { ...original.allowCheatOptions, value: false },
      decksConfig: {
        useFSP2Cards: { ...original.decksConfig.useFSP2Cards!, value: false },
        useG2Cards: { ...original.decksConfig.useG2Cards!, value: false },
        useRCards: { ...original.decksConfig.useRCards!, value: false },
        useBonusSouls: { ...original.decksConfig.useBonusSouls!, value: false },
      },
    };
    expect((await host.request("loadGameParameters", JSON.stringify(settings))).status).toBe(200);
    let started = false;
    let failure: unknown;
    const start = host.request("start").then(reply => {
      expect(reply.status).toBe(200);
      started = true;
    }).catch(error => { failure = error; });
    const humans = clients.map(client => ({ client, busy: false, answered: new Set<number>() }));
    const requests: Promise<void>[] = [start];
    let log: NativeEntry[] = [];
    let humanActions = 0;
    for (let iteration = 0; iteration < 160; iteration++) {
      if (failure) throw failure;
      for (const human of humans) {
        const state = human.client.room?.game;
        if (!state) continue;
        const selection = state.me.pendingSelection;
        if (selection && !human.answered.has(selection.requestId)) {
          human.answered.add(selection.requestId);
          const reply = await human.client.request("submitSelection", {
            requestId: selection.requestId,
            selections: selection.options.slice(0, selection.min),
          });
          expect(reply.status).toBe(200);
        } else if (started && !selection && !human.busy && state.turn === state.me.name) {
          const event = state.me.capabilities.resolve === true ? "resolve"
            : state.me.capabilities.endTurn === true ? "endTurn" : undefined;
          if (!event) continue;
          human.busy = true;
          // A native end/resolve may await this same human's later selection.
          requests.push(human.client.request(event).then(reply => {
            expect(reply.status).toBe(200);
            humanActions++;
          }).catch(error => { failure = error; }).finally(() => { human.busy = false; }));
        }
      }
      if (started) {
        const saved = await host.request("saveGame");
        expect(saved.status).toBe(200);
        log = JSON.parse(saved.logs!) as NativeEntry[];
        if (humanActions > 0 && log.some(entry => entry.issuer === "Cpu" && entry.type !== "SubmitSelection")) break;
      }
      await delay(10);
    }
    if (failure) throw failure;
    expect(started).toBe(true);
    expect(humanActions).toBeGreaterThan(0);
    expect(host.botSetupRequests.size).toBeGreaterThan(0);
    expect(log.some(entry => entry.issuer === "Cpu" && entry.type === "SubmitSelection")).toBe(true);
    expect(log.some(entry => entry.issuer === "Cpu" && ["Resolve", "Activate", "EndTurn", "DeclareAttack", "DeclarePurchase"].includes(entry.type))).toBe(true);
    expect(log.find(entry => entry.type === "Start")?.players?.find(player => player.issuer === "Cpu")?.user).toBe(`bot:${first.bot!.id}`);
    await Promise.all(requests);
    expect((await host.request("quitGame")).status).toBe(200);
    expect((await host.request("leaveRoom")).status).toBe(200);
    expect(stderr).not.toContain("Unhandled Rejection");
    expect(stderr).not.toContain("[BotRunner]");
  } finally {
    clients.forEach(client => client.close());
    if (fixture.exitCode === null) {
      fixture.stdin.write("stop\n");
      fixture.stdin.end();
    }
    const code = await fixture.exited;
    await Promise.all([output, errors]);
    rmSync(directory, { recursive: true, force: true });
    expect(code).toBe(0);
  }
}, 20_000);
