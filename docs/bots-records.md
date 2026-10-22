# Reviewing bot decisions from TS game logs

This tool reads the **TS-Four-Souls/game** `game.log` JSON array. It does not read
platform Session Records, screenshots or browser state exports. Human games have
not yet been supplied; repository tests generate native TS logs.

The existing TS socket `saveGame` request returns `{status: 200, logs}` where
`logs` is the JSON string of `room.game.log` (see `src/network/gameStep.ts`).
Keep that string unchanged in the private input file, including private seed and
state-checkpoint entries needed for replay. Record the server's producing commit
and preserve its public content copy separately; neither is attested by the log
format itself. Do not substitute the visible history list or redact entries and
then claim the original replay remains verified.

Run from the TS checkout with its public `data/` copy and installed Bun:

```sh
bun scripts/bots/records.ts capture \
  --log /private/cases/game.log.json --entry 42 --actor Alice \
  --level hard --random-state 1234 --producing-commit FULL_40_CHARACTER_COMMIT \
  --expect /private/cases/expect.json --out /private/cases/decision.json

bun scripts/bots/records.ts check \
  --log /private/cases/game.log.json --case /private/cases/decision.json \
  --playbooks /private/cases/reviewed-playbooks.json --out /private/cases/result.json
```

`--entry N` is a zero-based **exclusive prefix length**: replay entries `[0, N)`
and inspect the actor's decision before entry N. Entry N, when present, must be
an ordinary request by that actor. Use the array length to inspect the current
end of a complete saved log, including its final native `GameState` checkpoint.
Do not include the recorded decision itself in the prefix or append a fabricated
request to make a prefix replay. `--actor` is the exact native Player name/id.

The initial supported subset is a completed, quiescent action boundary after at
least one gameplay request following `Start`. Pending native selections, the
last asynchronous `Start`, incomplete setup, missing selection replies,
reset/rollback, debug commands and unknown replay entries are rejected. A
complete earlier prefix can be usable even if a later decision is unsupported.
The tool does not change the loader or infer an unfinished continuation.

`--random-state` is an explicit analysis-policy seed/state, an unsigned 32-bit
integer. It is not historical gameplay RNG or a claim about the human's policy.
Optional capture `--turn-actions N` defaults to zero; set it to a known bot work
counter when reviewing that counter's effect. Capture and check optionally accept
`--playbooks FILE`; check can evaluate an edited validated configuration against
exactly the same captured input. Capture-only flags are rejected on check.

A reviewed expectation contains alternatives and/or forbidden commands:

```json
{
  "reason": "Declare an attack or end the turn; do not make another purchase",
  "anyOf": [{ "type": "declareAttack" }, { "type": "endTurn" }],
  "noneOf": [{ "type": "declarePurchase" }]
}
```

An empty `anyOf` permits any offered command except `noneOf`. At least one
pattern is required. A pattern may constrain `sourceSlug`; `attackMonster`
may constrain `target` to a public card globalId or `"top"`; `purchase` may
constrain `target` to the shop index or `"top"`. An `activate` pattern may supply
an exact ordered `targetChoices` array using native `SelectionItem` JSON.
These are reviewed behavior assertions, not copied human-intent equality,
a scoring script, automatic training or proof that the match will be won.

The raw log, cases, expectations, edited profiles and reports stay **outside the
checkout**. Put them in a directory with mode 0700 and files with mode 0600.
Input permissions are checked; output files are owner-only, parent directories
are created with mode 0700, and existing outputs are never overwritten. Use new
result filenames for each check. The input file is not modified. Logs are bounded
to 64 MiB and 100,000 entries; no credentials or raw log is copied into a case.
The case still contains the actor's private hand and must remain private.

Stdout contains only CAPTURED/PASS/FAIL and a case hash. Exit 0 means capture or
review success, exit 1 means a valid current decision failed the reviewed
expectation, and exit 2 means invalid input/build/replay/output. Legacy native
console diagnostics are suppressed only inside this standalone CLI; errors use
bounded stage messages without paths, parser fragments or private state. The
library API retains ordinary detailed errors for a trusted caller.

## What admission establishes

The native loader replays the exact prefix and compares any native `GameState`
checkpoints it encounters. The actor must exist in that roster and have a real
host action offer. Capture uses only `createBotInput` for that actor. Check
reconstructs that input from the same raw log checksum, rejects changed input,
then runs the current production policy with the selected playbook document.
The returned action index must name an actual host offer. Activations use the
same native progressive-selector completion and decision validation as the live
host, with the current configuration and advanced policy random state. Target
expectations match that completed command. No card is executed by a preview.
The result is not submitted
into a live game, and it does not execute a second private simulation.

Cases normalize only the native loader's known volatile presentation fields:
animations, the last stack timestamp and reordering group ids. No hidden deck,
unoffered opposing hand, raw gameplay seed, Game object or credential is added to
policy input. Native loading reseeds gameplay RNG when it finishes. Consequently
this tool does **not** certify an exact future random counterfactual or completion
of an effect through later selections/rolls.

CLI analysis requires committed source. The report records the actual analysis
Git commit/tree separately from the caller-specified producing commit. The
producing commit must be reachable and have the same tracked native inventory
(`src/models`, `src/shared`, `src/types`, `src/utils`, dependency/compiler
files). The bot host/types inventory is bound separately. Policy/default-playbook
changes do not masquerade as mechanical changes; a changed host input contract
requires a fresh capture from the original log. The actual public `data/` bytes
and `FORBIDDEN_PREFIXES` value are hashed as the replayed content identity.

Native TS logs do not contain signed build or content certificates. The supplied
producing commit is an operator assertion checked against the available Git
inventory; the current data digest is **replayed content**, not invented proof of
the historical catalogue. Preserve the original producing checkout/content with
real games. Incompatible source/content, modified logs or unsupported prefixes
must be diagnosed with that original build; there is no compatibility bypass or
migration. Source/configuration/case hashes explain a check, not its correctness.

For a card correction, retain the raw log and original case, write an explicit
reviewed expectation, evaluate the current baseline, edit a separate versioned
playbook JSON, and recheck the same case. Then add a focused native consequence
and counterexample test before claiming the correction works. These cases become
development evidence; fresh held-out games remain necessary for strength claims.
