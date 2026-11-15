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

- The main session cannot `Edit`, `Write` or `NotebookEdit` code files. It may still edit `*.md` files, and under `.claude/` only `projects/`, `plans/`, `memory/` and `settings(.local).json`. Code under `.claude/` (hooks, plugins) is blocked too. The deny message tells the model which implementer to use.
- The main session's `Bash` runs, but maestro compares the git work tree before and after each command. If the command changed files that the main session may not edit, maestro tells the model which files changed and shows a toast. It does not undo the change. If maestro cannot read the work tree before the command, it refuses the command. Read-only commands are not checked after they run.
- An Agent call's `model` parameter cannot move work to another tier: the model is set by the subagent type.
- The scout's `Bash` runs only `git log`, `git show`, `git diff`, `git blame`, `ls` and `wc`, one command of plain words at a time. Any shell syntax (quotes, `\`, `$`, globs, braces, pipes, redirects, `;`, `&&`) is refused, so bash runs exactly the words the guard checked. So are git's `--output`, `--ext-diff` and `--textconv`, and any prefix git would read as one of them (`--out=`). If the guard cannot look up which agent made the call, it refuses the call.
- The conversation's first prompt carries the routing rules as hidden context (`prompt.submit`). After a `/clear` or a main-session compaction, the next prompt carries them again. The system prompt and the first message's context blocks are owned by a plugin that runs ahead of this one, so they cannot carry it.

## Limits

- The implementers' `Bash` is not guarded. The main session's `Bash` is not refused, only checked after it runs. The check sees only files in the git work tree of the session's folder: it skips a folder outside git, other repositories, files that git ignores, and writes that a background command makes after it returns.
- The scout's allowlist checks the command's words, not what the program does. Keep `SCOUT_COMMANDS` short, and check each option of a new entry for writes; add any you find to `RISKY_OPTIONS`.
- `git diff` still runs a diff driver set in your git config (`diff.external`, textconv filters), as it does when you run it yourself.
- `/model` does not change the main session's model while the plugin is on. Change `ORCHESTRATOR_MODEL` in `hooks/register.ts` instead.

## Commands

`/maestro off` allows code edits in the main session; `/maestro on` blocks them again. `/maestro status` shows the current state. A reload resets to `on`.

## Configuration

Edit the constants at the top of `hooks/register.ts`: `ORCHESTRATOR_MODEL`, `SPAWN_MODELS`, `ORCHESTRATOR_EDITABLE`, `SCOUT_COMMANDS`.

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

With no `--scope`, the shell commands install for every project (`user` scope). At the session prompt, `/plugin install` asks which scope to use. See [Every project or one project](#every-project-or-one-project) to choose. Then run `/reload-plugins`, or start a new session.

`IQooLogic/maestro` is the short form of `https://github.com/IQooLogic/maestro.git`. You can also give the full HTTPS or SSH URL (`git@github.com:IQooLogic/maestro.git`). Claude Code clones the repository with your git credentials.

To get a newer version later:

```
claude plugin marketplace update maestro
claude plugin update maestro@maestro
```

### Every project or one project

maestro changes how every session it is on works: the main session runs on Fable and cannot edit code files. Choose where to turn it on with `--scope`. Use the same scope for the marketplace and for the plugin.

| Scope | maestro is on | Written to | Shared through git |
|-------|---------------|------------|--------------------|
| `user` (default) | In every project you open | `~/.claude/settings.json` | No |
| `project` | In this project, for everyone who uses it | `<project>/.claude/settings.json` | Yes, when you commit the file |
| `local` | In this project, for you only | `<project>/.claude/settings.local.json` | No |

**Every project.** From any folder:

```
claude plugin marketplace add IQooLogic/maestro
claude plugin install maestro@maestro --scope user
```

**One project, for the whole team.** From the project's root folder:

```
claude plugin marketplace add IQooLogic/maestro --scope project
claude plugin install maestro@maestro --scope project
```

This writes both the marketplace and the plugin into `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "maestro": { "source": { "source": "github", "repo": "IQooLogic/maestro" } }
  },
  "enabledPlugins": { "maestro@maestro": true }
}
```

Commit that file, so that everyone who opens the project uses the same setting.

**One project, for you only.** From the project's root folder, use `--scope local` in both commands. Add `.claude/settings.local.json` to the project's `.gitignore` if it is not ignored already.

**Turn it off in one project.** If maestro is on at a wider scope, turn it off at a narrower one. From the project's root folder:

```
claude plugin disable maestro@maestro --scope local     # for you only
claude plugin disable maestro@maestro --scope project   # for everyone in the project
```

This writes `"maestro@maestro": false` into that scope's settings file, and the narrower scope wins. `claude plugin enable` with the same scope turns it back on. To lift only the edit block for one session, use `/maestro off` instead (see [Commands](#commands)).

**See where it is on.** From the project's folder, `claude plugin list` shows maestro's version, `Scope` and `Status` (`✔ enabled` or `✘ disabled`).

**Remove it.** Use the scope you installed it with:

```
claude plugin uninstall maestro@maestro --scope project
claude plugin marketplace remove maestro
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

Both must pass before a change is merged or released.

End-to-end tests run real headless sessions against a small Go project. They cost money; see [e2e/README.md](e2e/README.md):

```
e2e/run.sh
```

## Contributing and releases

- To report a problem or send a change, see [CONTRIBUTING.md](CONTRIBUTING.md).
- To publish a new version (version bump, tag and GitHub release), see [RELEASING.md](RELEASING.md).

## License

MIT. See [LICENSE](LICENSE).
