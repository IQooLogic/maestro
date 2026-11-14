# End-to-end tests

`claude plugin test .` checks each hook alone, with no model and no real session. These tests run real headless Claude Code sessions with maestro loaded, against a small Go project, and check what happened on disk and in the session log.

## Run them

From the repository root:

```
e2e/run.sh                  # all scenarios
e2e/run.sh main-edit scout-shell   # some of them
e2e/run.sh --list           # the scenario names
```

You need `claude` (logged in), `jq`, `git` and `go` on your `PATH`.

**They cost money.** Each scenario is a real session on your account: the main loop runs on Fable, and subagents on Haiku or Sonnet. A full run cost about $1.30 when these tests were written (`status` is free, the others $0.25 to $0.45 each). `MAESTRO_E2E_BUDGET` caps each scenario (default `2`, in USD).

| Variable | Default | Effect |
|----------|---------|--------|
| `MAESTRO_E2E_BUDGET` | `2` | Max USD per scenario (`--max-budget-usd`) |
| `MAESTRO_E2E_LOGS` | a new temp folder | Where each scenario's `<name>.jsonl` and `<name>.err` go |
| `MAESTRO_E2E_KEEP` | unset | `1` keeps each scenario's work folder for a look afterwards |

The script exits `0` when every check passes, `1` when one fails, and `2` when a tool is missing or a scenario name is unknown.

## What each scenario checks

| Scenario | The session is asked to | Checks |
|----------|-------------------------|--------|
| `status` | Run `/maestro status` | The answer says edits are blocked. No model call. |
| `main-edit` | Edit `main.go` itself | maestro refuses the Edit, `main.go` is unchanged, and the main loop ran on Fable. |
| `main-markdown` | Write `NOTES.md` itself | The file is written and nothing is refused. |
| `scout-shell` | Have the scout run `git log --oneline` and `git log --oneline > log.txt` | The scout ran `git log`, `log.txt` was not written, and the scout ran on Haiku. A line says which layer stopped the redirect. |
| `implementer` | Delegate a change to `maestro:implementer-sonnet` | `main.go` has the change, `go test` passes, and the implementer ran on Sonnet. |

In `scout-shell`, either the scout's own prompt or maestro's hook can stop the redirect. Today the scout usually declines to send it, so the hook is not reached. Both count as a pass, because the outcome (no file written) is what matters here. The unit tests check that the hook refuses it.

## How it works

For each scenario, `run.sh`:

1. Copies `e2e/fixture/` (a Go program that prints `Hello, <name>!`) into a new temp folder, and makes it a git repository with one commit, `init`.
2. Runs `claude -p` there with:
   - `--plugin-dir` set to this repository, so maestro loads from your working copy.
   - `--setting-sources project`, so your own settings and plugins stay out.
   - `--permission-mode acceptEdits` and `--allowedTools` for `git log` and a few `go` commands. Nothing bypasses the permission checks, and anything else that would ask is refused, because `-p` has nobody to ask.
   - `--output-format stream-json --verbose`, so the log has every message, tool call and tool result, with the model that answered.
3. Checks the log with `jq` and the files with `git` and `grep`.
4. Deletes the temp folder, unless `MAESTRO_E2E_KEEP=1`.

The model decides what to do, so a scenario can fail because the model chose differently, not because maestro is broken. When one fails, read the log first. For example:

```
jq -c 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | {name, input}' <logs>/main-edit.jsonl
```

## Add a scenario

1. Write a `scenario_<name>` function in `run.sh`. Start it with `new_work_dir`, run `run_claude <name> "$dir" '<prompt>'`, then add one `check` for each thing that must be true.
2. Add `<name>` to `SCENARIOS`. A `-` in the name maps to `_` in the function name.
3. Check outcomes (files, git state, which model answered, maestro's own messages) rather than the model's wording.
4. Do not ask a model to try an action that its instructions forbid just to see a hook refuse it. Test the hook in `tests/maestro.test.ts` instead.
5. If the scenario needs another shell command, add it to `ALLOWED_TOOLS`. Keep that list short.
6. Add a row to the table above.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for when to run these tests.
