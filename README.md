# maestro

Runs Claude Code as a tiered team:

| Role | Model | How |
|------|-------|-----|
| Orchestrator / advisor (main session) | Fable | `turn.step` rewrites the main loop's model |
| Implementer, needs judgment | Opus | `maestro:implementer-opus`, model pinned at spawn |
| Implementer, well-specified | Sonnet | `maestro:implementer-sonnet`, model pinned at spawn |
| Reading, searching | Haiku | `maestro:scout` (read-only tools), model pinned at spawn |

Built-in agents are pinned too: `Explore` → Haiku, `general-purpose` and `claude` → Sonnet. `Plan` keeps the orchestrator's model.

## What it enforces

- The main session cannot `Edit`, `Write` or `NotebookEdit` code files. It may still edit `*.md` files and anything under `.claude/` (plans, docs, memory). The deny message tells the model which implementer to use.
- An Agent call's `model` parameter cannot move work to another tier: the model is set by the subagent type.
- The session's first prompt carries the routing rules as hidden context (`prompt.submit`). The system prompt and the first message's context blocks are owned by a plugin that runs ahead of this one, so they cannot carry it.

## Limits

- `Bash` is not guarded: the orchestrator can still write files through the shell.
- `/model` does not change the main session's model while the plugin is on. Change `ORCHESTRATOR_MODEL` in `hooks/register.ts` instead.

## Commands

`/maestro off` allows code edits in the main session; `/maestro on` blocks them again. `/maestro status` shows the current state. A reload resets to `on`.

## Configuration

Edit the constants at the top of `hooks/register.ts`: `ORCHESTRATOR_MODEL`, `SPAWN_MODELS`, `ORCHESTRATOR_EDITABLE`.

## Install

This repository is a plugin marketplace (`.claude-plugin/marketplace.json`). Add the marketplace once, then install the plugin from it.

### From GitHub

At the prompt of a Claude Code session:

```
/plugin marketplace add IQooLogic/maestro
/plugin install maestro@maestro
```

From a shell:

```
claude plugin marketplace add IQooLogic/maestro
claude plugin install maestro@maestro
```

Pick the `user` scope when asked, so the plugin is on in every project. Then run `/reload-plugins`, or start a new session.

`IQooLogic/maestro` is the short form of `https://github.com/IQooLogic/maestro.git`. You can also give the full HTTPS or SSH URL (`git@github.com:IQooLogic/maestro.git`). Claude Code clones the repository with your git credentials.

To get a newer version later:

```
claude plugin marketplace update maestro
claude plugin update maestro@maestro
```

### From a local checkout

Clone the repository and add the folder instead of the GitHub name. The plugin is then read from the checkout, and edits there take effect on `/reload-plugins` with no reinstall:

```
git clone https://github.com/IQooLogic/maestro.git /path/to/maestro
```

```
/plugin marketplace add /path/to/maestro
/plugin install maestro@maestro
```

### Check that it is on

Run `/maestro status` in a session. `/plugin` lists `maestro` under the installed plugins.

## Run without installing

For one session, from a shell:

```
claude --plugin-dir /path/to/maestro
```

An interactive session watches that folder and reloads the hooks module when a file changes.

## Auto-reload in every session

An interactive session watches some plugin folders and reloads the hooks module when you save a file in them. An installed plugin is not watched. Pick one of these ways to load maestro from a watched folder, and uninstall the marketplace copy first (`claude plugin uninstall maestro`), so the plugin does not load twice.

**Option A: link it into the skills folder (recommended).** Claude Code loads every plugin under `~/.claude/skills/<name>` in every session and watches it. A link is watched at the folder it points to, so you edit the repository and the session reloads:

```
ln -s /path/to/maestro ~/.claude/skills/maestro
```

To use a copy instead of a link, run `cp -r` with the same paths. A copy is watched too, but edits in the repository do not reach it: copy again after each change, or edit the copy and bring the changes back.

For one project only, put the link or copy in that project's `.claude/skills/maestro`.

**Option B: name the folder in your settings.** Add the folder to the `env` block of `~/.claude/settings.json`. It loads as if you had passed `--plugin-dir` to every session, and the folder is watched:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/maestro"
}
```

Separate several folders with `:`. This works only in the user settings, not a project's.

**When the reload happens**

- You save a file in an editor: the plugin reloads once the folder is quiet (about a quarter second after a single save).
- Claude edits the plugin in its own turn: the plugin reloads once, when the turn ends.
- A save that leaves a file unchanged reloads nothing. After a failed reload, the next save tries again.
- A reload runs `register` and `session.start` again, so `/maestro` is back to `on`.
- `claude -p` always loads fresh. A long-lived headless session (SDK, desktop app) watches only with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`, set the same way as Option B.

A hook that fails, or a module that does not load, is named in a dim line in the transcript. `claude --debug` logs every occurrence.

## Reload after an edit

- Installed from a local folder marketplace, or started with `--plugin-dir`: run `/reload-plugins` in the session (a `--plugin-dir` session also reloads on save).
- Installed from GitHub: commit and push, then `claude plugin marketplace update maestro`, `claude plugin update maestro@maestro` and `/reload-plugins`.

A reload runs `register` and `session.start` again, so `/maestro` is back to `on`.

## Check

```
claude plugin validate .
claude plugin test .
```

## License

MIT. See [LICENSE](LICENSE).
