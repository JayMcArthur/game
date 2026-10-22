// The fixture runs in a temporary cwd with its own empty database.
import options from "../../server";

const server = Bun.serve({ ...options, hostname: "127.0.0.1", port: 0 });
console.log(`BOT_SOCKET_READY ${server.port}`);

function shutdown(code: number): never {
  void server.stop(true);
  process.exit(code);
}
process.on("SIGTERM", () => shutdown(0));
setTimeout(() => shutdown(2), 25_000);
for await (const chunk of Bun.stdin.stream()) {
  if (new TextDecoder().decode(chunk).includes("stop")) shutdown(0);
}
shutdown(0);
