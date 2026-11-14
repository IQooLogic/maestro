# Releasing maestro

This file tells you how to publish a new version of maestro: bump the version, tag it and create the GitHub release. To make a change before a release, see [CONTRIBUTING.md](CONTRIBUTING.md).

Do the steps in order. Each step has a check. Do not go to the next step until the check passes.

## What a release is

A release has three parts. All three use the same version number:

| Part | Where | Example |
|------|-------|---------|
| Version | `version` in `.claude-plugin/plugin.json` | `0.3.0` |
| Tag | An annotated git tag on the commit that sets that version | `v0.3.0` |
| GitHub release | A page at `https://github.com/IQooLogic/maestro/releases` for that tag, with release notes | `v0.3.0` |

Users who installed from GitHub get new commits with `claude plugin update` even without a new version. The version and tag give a fixed point to refer to, roll back to and write notes about.

## Before you start

You need:

- Push access to `IQooLogic/maestro`.
- The `claude` CLI.
- The GitHub CLI `gh`, logged in. Check with:

  ```
  gh auth status
  ```

  The output must show `Logged in to github.com` and the `repo` scope. If it does not, run `gh auth login`.
- A local `master` that tracks `origin/master`. Check with:

  ```
  git rev-parse --abbrev-ref master@{upstream}
  ```

  The output must be `origin/master`. A fresh clone does this for you. If the output is `fatal: no upstream configured`, run `git branch -u origin/master master` once.

## 1. Choose the version number

maestro uses [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

| Change since the last release | Increase | Example |
|-------------------------------|----------|---------|
| Only fixes, no new behaviour | `PATCH` | `0.3.0` → `0.3.1` |
| New behaviour, or a guard that allows or refuses more | `MINOR` | `0.3.0` → `0.4.0` |
| A change that breaks how people use or configure it | `MAJOR` | `0.3.0` → `1.0.0` |

Before 1.0.0, a breaking change increases `MINOR`, not `MAJOR`.

To see what changed, list the commits since the last tag:

```
git fetch --tags
git describe --tags --abbrev=0
git log --oneline $(git describe --tags --abbrev=0)..master
```

The commit types tell you the size: `feat` means `MINOR`; only `fix`, `test`, `docs` and `chore` mean `PATCH`.

In the steps below, replace `X.Y.Z` with the version you chose.

## 2. Make sure master is ready

```
git switch master
git pull
git status
```

**Check:** `git status` shows `nothing to commit, working tree clean`, and the branch is up to date with `origin/master`.

Then run the checks:

```
claude plugin validate .
claude plugin test .
```

**Check:** `validate` ends with `✔ Validation passed` and shows no `✘` line. `test` shows `0 fail`.

Then run the end-to-end tests (real sessions, about $1.30, see [e2e/README.md](e2e/README.md)):

```
e2e/run.sh
```

**Check:** the last line is `maestro e2e: all checks passed`. If a scenario fails, read its log before you decide: the model can choose differently from one run to the next. Run that scenario again on its own (`e2e/run.sh <name>`). Stop if it fails again.

If a check fails, stop. Fix the problem in a normal change (see [CONTRIBUTING.md](CONTRIBUTING.md#make-a-change)), then start again from step 2.

## 3. Bump the version

1. In `.claude-plugin/plugin.json`, set `"version"` to `"X.Y.Z"`. `marketplace.json` has no version: do not add one.

2. Validate again:

   ```
   claude plugin validate .
   ```

3. Commit and push only that change:

   ```
   git add .claude-plugin/plugin.json
   git commit -m "chore: bump to X.Y.Z"
   git push origin master
   ```

**Check:** `git log --oneline -1` shows `chore: bump to X.Y.Z`, and `git status` shows that your branch is up to date with `origin/master`.

## 4. Write the release notes

Write the notes in a file outside the repository, for example `/tmp/release-vX.Y.Z.md`. Do not commit it.

Get the list of changes. If this is the first release, use `git log --oneline` instead:

```
git log --oneline $(git describe --tags --abbrev=0)..master
```

Write each change as a sentence about what it does for the user, not as the commit header. Leave out commits users do not see, for example test-only changes and version bumps. Use this template:

````markdown
One or two sentences: what this release is about.

## Install

```
/plugin marketplace add IQooLogic/maestro
/plugin install maestro@maestro
```

To update an existing install:

```
claude plugin marketplace update maestro
claude plugin update maestro@maestro
```

Then run `/reload-plugins` in an open session.

## Changes

- Added: ...
- Changed: ...
- Fixed: ...

## Breaking changes

Only if there are any: what breaks, and what the user must do.

## Known limits

Copy the Limits section of the README if it changed.
````

The [v0.3.0 release](https://github.com/IQooLogic/maestro/releases/tag/v0.3.0) is an example.

## 5. Tag the release

Make an annotated tag on the version bump commit, then push the tag:

```
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

**Check:**

```
git ls-remote --tags origin vX.Y.Z
```

The output shows `refs/tags/vX.Y.Z`. The line that ends in `^{}` shows the same commit as `git rev-parse HEAD`.

## 6. Create the GitHub release

```
gh release create vX.Y.Z \
  --repo IQooLogic/maestro \
  --verify-tag \
  --title "vX.Y.Z" \
  --notes-file /tmp/release-vX.Y.Z.md
```

`--verify-tag` stops the command if the tag is not on GitHub. Without it, `gh` would make a new tag from the current branch.

**Check:**

```
gh release view vX.Y.Z --repo IQooLogic/maestro --json tagName,isDraft,isPrerelease,url
```

The output shows `"isDraft":false` and `"isPrerelease":false`. Open the `url` and read the notes once on the page.

To prepare the release and publish it later, add `--draft` to `gh release create`. Publish it with `gh release edit vX.Y.Z --repo IQooLogic/maestro --draft=false`.

## 7. Test the install

Do this on a machine or in a user account where maestro is installed from GitHub, not from a local folder.

1. Update to the new version:

   ```
   claude plugin marketplace update maestro
   claude plugin update maestro@maestro
   ```

2. Start a new session, or run `/reload-plugins` in an open one.
3. Run `/maestro status`. It must answer `maestro: main-session code edits are blocked`.
4. Run `claude plugin list`. maestro must show version `X.Y.Z`.

For a first install, use the commands in the [Install](README.md#install) section of the README instead of step 1.

## If something went wrong

**The notes are wrong.** Edit them. This changes nothing else:

```
gh release edit vX.Y.Z --repo IQooLogic/maestro --notes-file /tmp/release-vX.Y.Z.md
```

**The tag is on the wrong commit, and nobody has installed it yet.** Delete the release and the tag, then do steps 5 and 6 again:

```
gh release delete vX.Y.Z --repo IQooLogic/maestro --yes
git push origin --delete vX.Y.Z
git tag -d vX.Y.Z
```

**The release has a bug, and people may have installed it.** Do not move or delete the tag: users and their caches may already point to it. Fix the bug in a normal change and make a new `PATCH` release. In the notes of the bad release, add a line that names the fixed version:

```
gh release edit vX.Y.Z --repo IQooLogic/maestro --notes "**Use vX.Y.(Z+1) instead: ...**

$(gh release view vX.Y.Z --repo IQooLogic/maestro --json body --jq .body)"
```

## Short version

When you know the steps, this is all of them:

```
git switch master && git pull && git status
claude plugin validate . && claude plugin test . && e2e/run.sh
# set "version": "X.Y.Z" in .claude-plugin/plugin.json
git add .claude-plugin/plugin.json && git commit -m "chore: bump to X.Y.Z" && git push origin master
# write /tmp/release-vX.Y.Z.md
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z
gh release create vX.Y.Z --repo IQooLogic/maestro --verify-tag --title "vX.Y.Z" --notes-file /tmp/release-vX.Y.Z.md
gh release view vX.Y.Z --repo IQooLogic/maestro
```
