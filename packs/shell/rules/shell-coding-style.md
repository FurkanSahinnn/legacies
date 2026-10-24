---
paths:
  - "**/*.sh"
  - "**/*.bash"
---
# Shell Scripts

For depth, see the `shell-scripting` skill.

## Conventions
- **Shebang:** it declares the dialect. Use `#!/usr/bin/env bash` for bash features and `#!/bin/sh` only for POSIX-only code: no `[[ ]]`, arrays, `source`, `==` in `[ ]`, `{1..5}` or `<(...)`. Remember that macOS `/bin/bash` is 3.2.
- **Strict mode:** bash scripts start with `set -Eeuo pipefail`, plus `shopt -s inherit_errexit` on bash 4.4+. Failures you expect still get an explicit check (`if ! out=$(cmd); then …`), because `set -e` is off inside conditions and `&&`/`||` lists.
- **Quoting:** quote every expansion (`"$var"`, `"$(cmd)"`, `"${arr[@]}"`, `"$@"`). Build argument lists in arrays, never with `eval` or string concatenation.
- **Command substitution:** write `local x; x=$(cmd)`, never `local x=$(cmd)`, which masks the exit status. For counters, use `n=$((n + 1))`, not `((n++))`.
- **Reading input:** read lines with `while IFS= read -r line; do …; done < "$file"`. When variables set in the loop must survive it, feed it with `< <(cmd)` instead of piping into `while`. For file lists, use `find -print0` or `-exec … {} +`, never `ls` output.
- **Cleanup:** create temp files with `mktemp` and remove them with a single `trap cleanup EXIT`. In POSIX sh, also trap `HUP INT TERM` to `exit`.
- **Errors and output:** errors go to stderr with a non-zero exit, and usage errors exit 2. Use `printf` instead of `echo` for anything other than fixed text.
- **Dependencies and arguments:** check dependencies with `command -v tool`. Put `--` before user-supplied paths and patterns.
- **Names and structure:** functions are `lower_snake_case`, and constants and exported variables are `UPPER_CASE`. Logic lives in functions behind a guarded `main "$@"`, so tests can source the file.
- **Portability:** scripts that must run on macOS, BSD or BusyBox avoid GNU-only flags: `sed -i` without a suffix, `date -d`, `readlink -f`, `grep -P`, `stat -c` and `find -printf`.
- **Line endings:** shell files use LF (`*.sh text eol=lf` in `.gitattributes`).

## Tools
- **Lint:** run `shellcheck -x path/to/script.sh` and fix the findings. Disable a single code on a single command, with a reason comment.
- **Format:** run `shfmt -d .` in CI and `shfmt -w .` locally, with settings in `.editorconfig`.
- **Test:** use bats-core (`bats -r test/`) with the bats-support and bats-assert helpers. `run -N`/`run !` need `bats_require_minimum_version 1.5.0`.
