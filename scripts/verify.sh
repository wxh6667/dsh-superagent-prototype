#!/usr/bin/env bash
# Single verification entrypoint for this repository, also used by DSH's Stop verification.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# DSH exports git variables for worker shells; tests must not inherit them, and a localized git
# message must not change a test's expected text.
unset GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_ASKPASS GIT_TERMINAL_PROMPT GIT_PAGER
export LANG=C LC_ALL=C

pnpm check
