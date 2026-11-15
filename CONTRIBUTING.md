# Contributing to maestro

Thank you for your help. This file tells you how to set up a working copy, make a change, test it and send it. To publish a new version, see [RELEASING.md](RELEASING.md).

## Report a problem

Open an issue at https://github.com/IQooLogic/maestro/issues. Include:

- What you did, what you expected, and what happened.
- The output of `claude --version` and the maestro version (`version` in `.claude-plugin/plugin.json`).
- Any dim maestro line from the transcript. `claude --debug` logs every hook failure.

To report a way around a guard (an edit the main session should not make, or a scout command that writes), describe the type of problem in the issue. Do not post a working command that bypasses it.

## Set up a working copy

1. Fork the repository on GitHub, then clone your fork:

   ```
   git clone git@github.com:<your-account>/maestro.git
   cd maestro
   ```

2. Load the plugin from the clone. Pick one way:

   - For one session: `claude --plugin-dir /path/to/maestro`.
   - For every session: link the clone into the skills folder with `ln -s /path/to/maestro ~/.claude/skills/maestro`.

   If maestro is also installed from the marketplace, uninstall that copy first with `claude plugin uninstall maestro`. Otherwise the plugin loads twice. The README sections [Run without installing](README.md#run-without-installing) and [Auto-reload in every session](README.md#auto-reload-in-every-session) give the details.

3. Make sure that the tests pass before you change anything:

   ```
   claude plugin validate .
   claude plugin test .
   ```

## Where things are

| Path | What it holds |
|------|---------------|
| `hooks/register.ts` | All hooks: the edit guard, model pinning, routing rules, the scout shell guard, the main-session shell check and the `/maestro` command. The constants at the top are the configuration. |
| `hooks/hooks.json` | Names the hooks module. |
| `agents/*.md` | The scout and the two implementers: their model, tools and prompt. |
| `tests/maestro.test.ts` | The tests. `claude plugin test .` runs them. |
| `e2e/` | End-to-end tests: real headless sessions against a small Go project. See [e2e/README.md](e2e/README.md). |
| `.claude-plugin/plugin.json` | The plugin manifest: name, version, author, license. The icon is `icon.png` in the same folder. |
| `.claude-plugin/marketplace.json` | Makes the repository a marketplace, so `/plugin marketplace add IQooLogic/maestro` works. |

## Make a change

1. Create a branch from `master`:

   ```
   git switch master
   git pull
   git switch -c fix/short-name
   ```

2. Make the change. Match the code around it: naming, comment density and the hook shape `($, e, next)`.

3. Add or change a test for each behaviour you change. A change to a guard needs tests for both sides: what it allows and what it refuses.

4. Run the checks:

   ```
   claude plugin validate .
   claude plugin test .
   ```

   Both must pass. `validate` must show no `✘` line.

5. Try the change in a real session. With `--plugin-dir` or the skills link, a saved file reloads the plugin. Run `/maestro status` to see that it loaded.

   For a change to a hook, an agent or the routing rules, also run the end-to-end tests: `e2e/run.sh`. They run real sessions and cost about $1.30 for a full run. See [e2e/README.md](e2e/README.md).

6. If the change is visible to users, update `README.md` in the same branch.

### Changes to the guards

The guards are the main reason maestro exists. Take extra care:

- **Edit guard (`ORCHESTRATOR_EDITABLE`).** A new pattern lets the main session edit more files. Add a test that the files you want are allowed and that code next to them is still refused.
- **Scout shell (`SCOUT_COMMANDS`, `RISKY_OPTIONS`, `PLAIN_WORDS`).** The guard checks words, not what a program does. Before you add a command, read its manual for each option that writes a file or runs a program, and add those options to `RISKY_OPTIONS`. Do not add characters to `PLAIN_WORDS` that bash expands or splits on (quotes, `\`, `$`, `*`, `?`, `{`, `}`, `;`, `&`, `|`, `<`, `>`). Add each refused form to the scout test.
- **Fail closed.** If a guard cannot decide, it must refuse and say why. It must never let the call through without a check.

## Commit messages

Use one header line in this form:

```
<type>(<optional scope>): <short summary>
```

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `style`, `build`.
- Scopes in use: `hooks`, `agents`, `readme`.
- Write the summary in lowercase and in the imperative ("add", not "added"), with no period at the end. Keep the full line at 72 characters or fewer.

Examples from the history:

```
fix(hooks): re-send routing rules after clear and compaction
feat(agents): give scout an allowlisted read-only shell
test: assert the edit guard's own deny message
```

Make one commit for each logical change. The release notes are written from these headers (see [RELEASING.md](RELEASING.md#5-write-the-release-notes)).

## Send a pull request

1. Push your branch to your fork: `git push -u origin fix/short-name`.
2. Open a pull request against `IQooLogic/maestro`, branch `master`.
3. In the description, write:
   - What changed and why.
   - How you tested it: the checks you ran and what you tried in a session.
   - For a guard change: what it now allows or refuses that it did not before.
4. Do not change `version` in `plugin.json`. The maintainer sets it when they make a release.

## License

maestro uses the MIT license (see [LICENSE](LICENSE)). When you send a contribution, you agree that it is published under that license.
