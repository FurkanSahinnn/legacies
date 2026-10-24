---
name: shell-scripting
description: Robust bash and POSIX sh scripts covering the sh vs bash choice, strict mode and where it fails, quoting and word splitting, arrays, [[ ]] vs [ ], safe line reading, trap cleanup with mktemp, exit codes, getopts, GNU vs BSD/macOS portability, ShellCheck, shfmt, bats tests and when to switch languages. Use when writing or reviewing .sh/.bash files or shebang scripts, CI steps, Dockerfile RUN lines, install or entrypoint scripts, or a script that breaks only on macOS or Alpine.
---

# Shell Scripting (bash 5.x, POSIX sh)

Current tools: bash 5.3 (July 2025), POSIX.1-2024, ShellCheck 0.11, shfmt 3.14 and bats-core 1.14. On the target systems, macOS still ships bash 3.2 as `/bin/bash`, Debian and Ubuntu use dash as `/bin/sh`, and Alpine uses BusyBox ash.

## Pick the dialect first

- `#!/bin/sh` means POSIX only. That rules out arrays, `[[ ]]`, `==` inside `[ ]`, `source`, the `function` keyword, `{1..5}`, `<(...)` and `${x,,}`. Use it for Alpine/BusyBox images, `sh -c` hooks and init scripts. `pipefail` has been POSIX since 2024, but only newer shells have it (dash 0.5.13+), so test the real target `/bin/sh`.
- Otherwise use `#!/usr/bin/env bash` and decide the minimum bash version. A script that must run on stock macOS has to stay within bash 3.2.
- What each bash version adds:
  - 4.0: `declare -A`, `mapfile`, `${x,,}`, `globstar`.
  - 4.2: `lastpipe`.
  - 4.3: `declare -n`, `wait -n`.
  - 4.4: `inherit_errexit`, `${x@Q}`, and empty arrays that are safe under `set -u`.
  - 5.0: `EPOCHSECONDS`.
  - 5.1: `SRANDOM`.
  - 5.3: `${ cmd; }`, a command substitution without a subshell.
- `sh script.sh` runs bash code under dash, and `bash script.sh` ignores the shebang. Mark scripts executable and run them directly.

## Strict mode and where it does not protect you

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit   # bash 4.4+: a failure inside $(...) also aborts
trap 'printf "%s: line %d: exit %d: %s\n" "${0##*/}" "$LINENO" "$?" "$BASH_COMMAND" >&2' ERR
```

- **Conditions:** `set -e` is off inside `if`/`while`/`until` conditions, in `&&`/`||` lists (except the last command), after `!`, and in every function called from those places. `if deploy; then` runs all of `deploy` without errexit. Check statuses that matter explicitly with `cmd || die "cmd failed"`.
- **`local`:** `local out=$(cmd)` returns the status of `local`, so the failure disappears (SC2155). Declare, then assign: `local out; out=$(cmd)`.
- **Arithmetic:** `((count++))` evaluates to 0 on the first increment and aborts the script. Write `count=$((count + 1))`.
- **`cond && action`:** as the last line of a function, it makes the function return 1 whenever `cond` is false, which aborts the caller. Use `if`.
- **SIGPIPE:** with `pipefail`, `producer | grep -q x` and `producer | head -n1` fail with 141 when the reader exits early. Capture first (`out=$(producer)`, then `grep -q x <<<"$out"`), or use a reader that consumes all input, such as `sed -n 1p`.
- **Command substitution:** without `inherit_errexit`, a failing command inside `$(...)` doesn't stop the rest of the substitution.
- **Empty arrays:** before bash 4.4, `"${arr[@]}"` on an empty array is an error under `set -u`. In bash 3.2, write `${arr[@]+"${arr[@]}"}`.
- **Messages:** strict mode is a backstop, not error handling. A message saying what failed and why beats a bare exit code.

## Quoting and word splitting

- Quote every expansion: `"$var"`, `"$(cmd)"`, `"${arr[@]}"`, `"$@"`. Unquoted expansions split on IFS and glob-expand (SC2086, SC2046). `"$*"` joins all arguments into one string.
- Build argument lists in arrays, never as strings passed to `eval`:

```bash
rsync_args=(--archive --delete)
if ((dry_run)); then rsync_args+=(--dry-run); fi
rsync "${rsync_args[@]}" -- "$src/" "$dest/"
```

- Put `--` before user-supplied names (`rm -- "$f"`, `grep -- "$pattern" "$file"`), and glob with `./*` so that a file named `-rf` is not read as an option.
- Use `printf '%s\n' "$x"`, not `echo "$x"`: shells disagree on how `echo` handles `-n`, `-e` and backslashes.
- An unmatched glob stays literal. Use `shopt -s nullglob` in bash, or `[ -e "$f" ] || continue` inside the loop in sh. Never parse `ls`; use globs or `find -print0`.

## Arrays (bash only)

- Basic operations: `files=()`, `files+=("$f")`, `"${files[@]}"`, `${#files[@]}`, and `"${!files[@]}"` for the indices.
- From command output, use `mapfile -t lines < <(cmd)`. For NUL-safe file names, use `mapfile -d '' -t files < <(find . -name '*.log' -print0)` (bash 4.4+). Never write `arr=($(cmd))` (SC2207).
- Associative arrays need `declare -A map` (bash 4+). Without it, string keys silently collapse into index 0.
- POSIX sh has only `"$@"`. Accumulate with `set -- "$@" "$item"`.

## Tests: `[[ ]]` and `[ ]`

- **`[[ ]]` (bash):**
  - Variables inside are not split or globbed, and `&&`/`||` work inside the brackets.
  - An unquoted right side is a pattern (`[[ $f == *.tar.gz ]]`); quote it for a literal match.
  - `=~` takes a regex; keep the regex in a variable:

```bash
re='^v([0-9]+)\.([0-9]+)\.([0-9]+)$'
if [[ $tag =~ $re ]]; then major=${BASH_REMATCH[1]}; fi
```

- **`[ ]` (sh):** quote every operand, use `=` (not `==`), and chain tests as `[ … ] && [ … ]` rather than with the obsolescent `-a`/`-o`.
- **Numbers:** compare them with `(( n > 3 ))` in bash or `[ "$n" -gt 3 ]` in sh. `[[ $n > 3 ]]` compares strings, so `10 > 3` is false.

## Reading input

```bash
while IFS= read -r line || [[ -n $line ]]; do
  printf 'got: %s\n' "$line"
done < "$file"
```

- `IFS=` keeps surrounding whitespace, and `-r` keeps backslashes. The `||` clause keeps a final line that has no trailing newline.
- `cmd | while read …` runs the loop in a subshell, so variables set inside it are lost afterwards. Use `done < <(cmd)` or `shopt -s lastpipe` (bash 4.2+, scripts only), or a temp file in sh.
- A command inside the loop that reads stdin (`ssh`, `ffmpeg`, `docker exec -i`) swallows the rest of the input. Give it `</dev/null`, or read from fd 3: `while IFS= read -r line <&3; do …; done 3< "$file"`.
- File names can contain newlines. Use `find … -print0 | while IFS= read -r -d '' f`, or `find … -exec cmd {} +`.

## Cleanup, temp files and exit codes

```bash
workdir=$(mktemp -d "${TMPDIR:-/tmp}/release.XXXXXX")
cleanup() { rm -rf -- "$workdir"; }
trap cleanup EXIT
```

- **Signals:** bash runs the EXIT trap on normal exit, `exit`, errexit and fatal signals. dash and other sh implementations skip it when the script is killed by a signal, so add `trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM`.
- **One trap:** a second `trap … EXIT` replaces the first. Keep one cleanup function that releases everything, and set the trap right after creating the first resource.
- **Temp names:** `mktemp` with an explicit template works with both GNU and BSD. Never derive temp names from `$$` or use fixed paths.
- **Exit codes:**

  | Code | Meaning |
  |---|---|
  | 0 | success |
  | 1 | failure |
  | 2 | usage error |
  | 126 | not executable |
  | 127 | command not found |
  | 128+N | killed by signal N (130 INT, 141 PIPE, 143 TERM) |

  In bash, `"${PIPESTATUS[@]}"` holds the status of each stage of the last pipeline.
- **Errors:** write them to stderr: `die() { printf '%s: %s\n' "${0##*/}" "$*" >&2; exit 1; }`.

## Options with getopts

```sh
verbose=0 out=-
while getopts ':vo:h' opt; do
  case $opt in
    v) verbose=1 ;;
    o) out=$OPTARG ;;
    h) usage; exit 0 ;;
    :) printf '%s: -%s needs a value\n' "${0##*/}" "$OPTARG" >&2; exit 2 ;;
    *) printf '%s: unknown option -%s\n' "${0##*/}" "$OPTARG" >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
```

- `getopts` is POSIX and handles short options only. The leading `:` in the option string lets you print your own messages for a missing value (`:`) and an unknown option (`?`).
- For long options, write a `while (($#)); do case $1 in --out=*) … ;; --) shift; break ;; esac; shift; done` loop. Avoid the external `getopt`: the GNU version is missing on macOS, and the BSD version breaks arguments that contain spaces.

## Portability: GNU vs BSD/macOS

| Need | GNU/Linux | BSD/macOS | Portable choice |
|---|---|---|---|
| Edit in place | `sed -i 's/a/b/' f` | `sed -i '' 's/a/b/' f` | `sed -i.bak … f && rm f.bak`, or a temp file plus `mv` |
| Extended regex | `sed -E`, `grep -E` | same | `-E`. Avoid `\+` and `\|` in basic regex, and `grep -P` |
| Date arithmetic | `date -d '-1 day'` | `date -v-1d` | `date -u +%s` plus arithmetic, or another language |
| File size | `stat -c %s f` | `stat -f %z f` | `wc -c < f` |
| Absolute path | `readlink -f` | missing on older macOS | `cd -P -- "$dir" && pwd -P` |
| Time limit | `timeout 30 cmd` | not installed | check `command -v timeout` first |
| Custom find output | `find -printf` | not available | `find … -exec … {} +` |
| awk | often gawk | BWK awk | POSIX awk only (no `gensub`, `asort`) |

- Check dependencies with `command -v jq >/dev/null || die "jq is required"`, not `which`.
- macOS `wc -l` pads its output with spaces. The results of `sort`, `uniq` and regex ranges depend on the locale, so set `LC_ALL=C` when you need byte-wise, reproducible output.
- CRLF line endings break scripts (`$'\r': command not found`). Add `*.sh text eol=lf` to `.gitattributes`.

## ShellCheck and shfmt

- **Running ShellCheck:** use `shellcheck -x scripts/*.sh`, where `-x` follows `source`d files. Libraries without a shebang need `# shellcheck shell=bash`. Keep repo-wide settings in `.shellcheckrc`, for example `external-sources=true`.
- **Suppressing:** disable one finding at one command and give the reason: `# shellcheck disable=SC2034 # read by the sourcing script`. A directive directly under the shebang applies to the whole file, so keep only `shell=` or `source-path=` there.
- **Fix, don't silence:**
  - SC2086/SC2046: quote the expansion.
  - SC2155: declare, then assign.
  - SC2164: `cd dir || exit`.
  - SC2207: use `mapfile`.
  - SC2015: `A && B || C` is not if/else.
  - SC2181: test the command, not `$?`.
  - SC3xxx: a bashism in a `#!/bin/sh` file.
- **ShellCheck 0.11:** SC2002 (useless `cat`) is off by default.
- **shfmt:** run `shfmt -d .` in CI (it prints a diff and exits non-zero) and `shfmt -w .` to fix files.
  - Configure it in `.editorconfig`: `indent_style = space`, `indent_size = 2`, `switch_case_indent = true`, `binary_next_line = true`.
  - Any formatting flag on the command line disables EditorConfig.
  - `-ln posix` forces POSIX parsing.

## Testing with bats

```bash
#!/usr/bin/env bats
bats_require_minimum_version 1.5.0

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  source "$BATS_TEST_DIRNAME/../bin/release.sh"
}

@test "version_parts splits a tag" {
  run version_parts v1.12.3
  assert_success
  assert_output '1 12 3'
}

@test "unknown option is a usage error" {
  run -2 "$BATS_TEST_DIRNAME/../bin/release.sh" -z
  assert_output --partial 'unknown option'
}
```

- **Sourceable scripts:** put the logic in functions and end the file with `if [[ ${BASH_SOURCE[0]} == "$0" ]]; then set -Eeuo pipefail; main "$@"; fi`, so tests can source it without running `main` or inheriting strict mode.
- **`run`:**
  - It executes in a subshell and fills `$status`, `$output` and `${lines[@]}`.
  - `run -N` and `run !` assert the status; declare `bats_require_minimum_version 1.5.0` to use them.
  - `run --separate-stderr` fills `$stderr`.
  - A bare `! cmd` never fails a test; use `run ! cmd`.
- **Isolation:** write files under `$BATS_TEST_TMPDIR`. Fake external commands with stub executables placed first on `PATH` in `setup`.
- **Running:** use `bats -r test/`.
  - `--jobs N` needs GNU parallel.
  - `--report-formatter junit --output reports/` writes a CI report.
  - `--filter-status failed` reruns the failures.

## When to stop using shell

Switch to Python, Go or the project's main language when the script:

- passes roughly 100–150 lines, or needs several functions that share mutable state;
- parses or emits JSON, YAML or CSV beyond a single `jq` filter;
- needs floating-point math, time-zone arithmetic, retries with backoff, or concurrency beyond `&` and `wait`;
- must run natively on Windows, or has branchy logic that needs unit tests more than glue.

If callers expect a script, keep a thin shell wrapper that checks the environment and runs `exec python3 -m tool "$@"`.

## Review checklist

- [ ] The shebang matches the features used, and the minimum bash version is known (macOS ships 3.2).
- [ ] `set -Eeuo pipefail` is set, failures you expect are checked explicitly, and there is no `local x=$(…)` or `((n++))`.
- [ ] Every expansion is quoted, argument lists are built in arrays, and user-supplied paths follow `--`.
- [ ] Input is read with `IFS= read -r`, file lists are NUL-delimited, and nothing parses `ls`.
- [ ] Temp files come from `mktemp` and are removed by an EXIT trap (plus signal traps in sh).
- [ ] Errors go to stderr with a non-zero exit, and usage errors exit 2.
- [ ] No GNU-only flags appear where macOS, BSD or BusyBox must work.
- [ ] `shellcheck -x` and `shfmt -d` are clean, and bats tests cover the logic.

<!-- Written for legacies (MIT). Checked against: https://www.gnu.org/software/bash/manual/bash.html, https://lists.gnu.org/archive/html/bug-bash/2025-07/msg00005.html, https://pubs.opengroup.org/onlinepubs/9799919799/, https://austingroupbugs.net/view.php?id=789, https://github.com/koalaman/shellcheck/blob/master/CHANGELOG.md, https://github.com/koalaman/shellcheck/wiki/Directive, https://github.com/mvdan/sh/blob/master/cmd/shfmt/shfmt.1.scd, https://bats-core.readthedocs.io/en/stable/usage.html, https://github.com/bats-core/bats-core/blob/master/docs/CHANGELOG.md, 2026-10 -->
