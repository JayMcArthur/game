# Four Souls Game

```sh
bun install --frozen-lockfile
bun start
```

Copy `json/` and `translations/` from the [public card data](https://github.com/TS-Four-Souls/data/tree/f30ee9e9db9af14745784800a233e5ab9ae2c543)
to `data/cards/` and `data/translations/`.

## Bots

The server supports Easy, Normal and Hard bots in games with 2–4 players.
Lobby hosts can use these Socket.IO requests:

```ts
addBot({ level: "normal", name: "Bot" }, callback)
setBotLevel({ id, level: "hard" }, callback)
removeBot({ id }, callback)
```

Callbacks return `{ status: 200 }` or `{ status: 400, error }`.
Bot entries have `bot: { id, level }` in the room's player list.
Bots count toward the four-player limit and use native game actions and choices.

`decideBot(input)` in `src/bots/policy.ts` accepts actor state and current offers,
then returns an action, selection or wait. Edit `src/bots/default-playbooks.json`
to adjust the five official-card playbooks. New card mechanics need code and tests.

Strategy errors fall back to legal progress. Native execution errors stop with
a diagnostic to avoid retrying a partially applied action. Off-turn voluntary
reactions are not automated; difficulty ordering still needs calibration.

## Checks

```sh
bun run ts
bun run test:bots
bun run bots:play --seed example --levels normal,hard --output /private/new-run
```

The game command saves a result and native log, or a failure history.
See [game-log checks](docs/bots-records.md) to review decisions and test playbook changes.

Combat and policy helpers were adapted from [four_souls](https://github.com/JayMcArthur/four_souls/tree/51c8fdbc7d65fb4007a940b365a737496ba140f5).
