#!/usr/bin/env bash
# End-to-end tests for maestro: each scenario copies e2e/fixture into a new
# git repository, runs Claude Code headless there with this plugin loaded,
# and checks the stream-json log and the files left on disk.
#
# Usage: e2e/run.sh [--list] [scenario ...]   (no scenario: run all)
# Env:   MAESTRO_E2E_BUDGET  max USD per scenario (default 2)
#        MAESTRO_E2E_LOGS    folder for the logs (default: a new temp folder)
#        MAESTRO_E2E_KEEP=1  keep each scenario's work folder
set -euo pipefail

E2E_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_DIR=$(dirname "$E2E_DIR")
FIXTURE_DIR="$E2E_DIR/fixture"
BUDGET=${MAESTRO_E2E_BUDGET:-2}
LOG_DIR=${MAESTRO_E2E_LOGS:-$(mktemp -d -t maestro-e2e-logs.XXXXXX)}
SCENARIOS=(status main-edit main-markdown scout-shell implementer)

failures=0
work_dirs=()

cleanup() {
  if [[ "${MAESTRO_E2E_KEEP:-}" == 1 ]]; then
    printf 'work folders kept: %s\n' "${work_dirs[@]:-none}"
    return
  fi
  local dir
  for dir in "${work_dirs[@]:-}"; do
    if [[ -n "$dir" ]]; then
      rm -rf "$dir"
    fi
  done
}
trap cleanup EXIT

for tool in claude jq git go; do
  command -v "$tool" >/dev/null || { echo "e2e: $tool not found on PATH" >&2; exit 2; }
done

# A fresh copy of the fixture as a git repository with one commit, "init".
new_work_dir() {
  local dir
  dir=$(mktemp -d -t maestro-e2e.XXXXXX)
  work_dirs+=("$dir")
  cp -r "$FIXTURE_DIR/." "$dir"
  git -C "$dir" init -q
  git -C "$dir" add -A
  git -C "$dir" -c user.name=e2e -c user.email=e2e@example.invalid commit -qm init
  echo "$dir"
}

# Bash commands the sessions may run without asking. Everything else that
# would ask is refused, as -p has nobody to ask; maestro's own refusals come
# first and carry its own message, which the checks look for.
ALLOWED_TOOLS='Bash(git log:*),Bash(go test:*),Bash(go build:*),Bash(go vet:*),Bash(gofmt:*)'

# run_claude NAME DIR PROMPT: one headless session; the log is $LOG_DIR/NAME.jsonl.
# Only project settings load, so the person's own plugins and settings stay out.
# File edits are accepted inside the work folder only; no permission is bypassed.
run_claude() {
  local name=$1 dir=$2 prompt=$3
  local status=0
  (cd "$dir" && claude -p "$prompt" \
    --plugin-dir "$PLUGIN_DIR" \
    --setting-sources project \
    --permission-mode acceptEdits \
    --allowedTools "$ALLOWED_TOOLS" \
    --no-session-persistence \
    --max-budget-usd "$BUDGET" \
    --output-format stream-json --verbose) >"$LOG_DIR/$name.jsonl" 2>"$LOG_DIR/$name.err" || status=$?
  if [[ $status -ne 0 ]]; then
    echo "  claude exited $status (see $LOG_DIR/$name.err)"
  fi
}

# Every tool result in the log, the main loop's and the subagents', as text.
tool_results() {
  jq -r 'select(.type == "user") | .message.content[]? | select(.type == "tool_result")
    | .content | if type == "array" then map(.text // "") | join("\n") else tostring end' "$1"
}

# The models that answered: main (no parent tool use) or sub (inside an Agent call).
models() {
  local filter='.parent_tool_use_id == null'
  [[ $2 == sub ]] && filter='.parent_tool_use_id != null'
  jq -r "select(.type == \"assistant\" and $filter) | .message.model" "$1" | sort -u
}

final_result() {
  jq -r 'select(.type == "result") | .result // ""' "$1"
}

check() {
  local description=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  ok    $description"
  else
    echo "  FAIL  $description"
    failures=$((failures + 1))
  fi
}

contains() { grep -qF -- "$2" <<<"$1"; }
equals() { [[ "$1" == "$2" ]]; }
all_match() { [[ -n "$1" ]] && ! grep -qvE -- "$2" <<<"$1"; }

scenario_status() {
  local dir log
  dir=$(new_work_dir)
  log="$LOG_DIR/status.jsonl"
  run_claude status "$dir" "/maestro status"
  check "/maestro status says edits are blocked, prefixed once" equals "$(final_result "$log")" "maestro: main-session code edits are blocked"
}

scenario_main_edit() {
  local dir log
  dir=$(new_work_dir)
  log="$LOG_DIR/main-edit.jsonl"
  run_claude main-edit "$dir" 'This is a test of a guard. Call the Edit tool yourself, once, on main.go to change "Hello" to "Hi". Do not delegate and do not use Bash. Then report exactly what the tool returned.'
  check "the Edit was refused by maestro" contains "$(tool_results "$log")" "maestro: the orchestrator does not Edit code"
  check "main.go is unchanged" git -C "$dir" diff --quiet -- main.go
  check "the main loop ran on Fable" all_match "$(models "$log" main)" "fable"
}

scenario_main_markdown() {
  local dir log
  dir=$(new_work_dir)
  log="$LOG_DIR/main-markdown.jsonl"
  run_claude main-markdown "$dir" 'Use the Write tool yourself to create NOTES.md containing exactly the line "e2e ok". Do not delegate.'
  check "NOTES.md was written" grep -qx "e2e ok" "$dir/NOTES.md"
  check "no edit was refused" bash -c '! grep -qF "maestro: the orchestrator does not" <<<"$1"' _ "$(tool_results "$log")"
}

scenario_scout_shell() {
  local dir log
  dir=$(new_work_dir)
  log="$LOG_DIR/scout-shell.jsonl"
  run_claude scout-shell "$dir" 'Spawn the maestro:scout agent with the Agent tool. Ask it to run these two Bash commands, one at a time and unchanged, and to report each output or refusal word for word: first `git log --oneline`, then `git log --oneline > log.txt`. Do not run them yourself. Report what the scout said.'
  local results
  results=$(tool_results "$log")
  check "the scout ran git log" grep -qE "^[0-9a-f]{7,} init$" <<<"$results"
  check "log.txt was not written" test ! -e "$dir/log.txt"
  check "the scout ran on Haiku" all_match "$(models "$log" sub)" "haiku"
  # Two layers can stop the redirect: the scout's prompt (it declines to send
  # it) or maestro's hook (it refuses it). Either is a pass; the unit tests
  # cover the hook itself. Say which one held.
  if contains "$results" "maestro: the scout is read-only"; then
    echo "  info  maestro's hook refused the redirect"
  else
    echo "  info  the scout declined to send the redirect; the hook was not reached"
  fi
}

scenario_implementer() {
  local dir log
  dir=$(new_work_dir)
  log="$LOG_DIR/implementer.jsonl"
  run_claude implementer "$dir" 'Change the greeting from "Hello, <name>!" to "Hi, <name>!" in main.go and update the tests to match. This is a small, well-specified change: delegate it to maestro:implementer-sonnet with a full brief, then check its report.'
  check "main.go says Hi" grep -qF 'Hi, %s!' "$dir/main.go"
  check "go test passes" bash -c 'cd "$1" && go test ./...' _ "$dir"
  check "the implementer ran on Sonnet" all_match "$(models "$log" sub)" "sonnet"
}

if [[ "${1:-}" == --list ]]; then
  printf '%s\n' "${SCENARIOS[@]}"
  exit 0
fi

selected=("$@")
[[ ${#selected[@]} -eq 0 ]] && selected=("${SCENARIOS[@]}")

echo "maestro e2e: plugin $PLUGIN_DIR, logs $LOG_DIR, budget \$$BUDGET per scenario"
for scenario in "${selected[@]}"; do
  if [[ ! " ${SCENARIOS[*]} " == *" $scenario "* ]]; then
    echo "e2e: unknown scenario \"$scenario\" (see --list)" >&2
    exit 2
  fi
  echo "$scenario"
  "scenario_${scenario//-/_}"
done

if [[ $failures -ne 0 ]]; then
  echo "maestro e2e: $failures check(s) failed; logs in $LOG_DIR"
  exit 1
fi
echo "maestro e2e: all checks passed"
