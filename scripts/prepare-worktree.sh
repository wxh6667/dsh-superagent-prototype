#!/usr/bin/env bash
# Creates a ticket worktree from the local repository. Use as the Execution settings' prepare command.
set -euo pipefail

: "${DSH_SUPERAGENT_LOCAL_REPO:?the local Source has no repository configured}"
: "${DSH_SUPERAGENT_DIR:?the ticket directory is not set}"
: "${DSH_SUPERAGENT_NAME:?the ticket worktree name is not set}"
: "${DSH_SUPERAGENT_BASE_BRANCH:?the local base branch is not set}"

git -C "$DSH_SUPERAGENT_LOCAL_REPO" worktree add "$DSH_SUPERAGENT_DIR" -b "$DSH_SUPERAGENT_NAME" "$DSH_SUPERAGENT_BASE_BRANCH"
