#!/usr/bin/env bash
# runners/_init/setup.sh — venv lifecycle manager
#
# Idempotent initialization: creates venv + pip install for each runner
# that has a requirements.txt and no existing venv/.
#
# Usage:
#   bash setup.sh           # create missing venvs only
#   bash setup.sh --force   # rebuild all venvs from scratch

set -euo pipefail

FORCE=false
[[ "${1:-}" == "--force" ]] && FORCE=true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNERS_DIR="$(dirname "$SCRIPT_DIR")"

echo "[setup] scanning runners in $RUNNERS_DIR"

for dir in "$RUNNERS_DIR"/*/; do
  name="$(basename "$dir")"

  [[ "$name" == "_init" ]] && continue

  req_file="$dir/requirements.txt"
  [[ -f "$req_file" ]] || { echo "[setup] $name: no requirements.txt, skipping"; continue; }

  venv_dir="$dir/venv"

  if [[ -d "$venv_dir" ]]; then
    if $FORCE; then
      echo "[setup] $name: --force, rebuilding venv"
      rm -rf "$venv_dir"
    else
      echo "[setup] $name: venv exists, skipping"
      continue
    fi
  fi

  echo "[setup] $name: creating venv..."
  python3 -m venv "$venv_dir"
  echo "[setup] $name: installing dependencies..."
  "$venv_dir/bin/pip" install -r "$req_file" --quiet
  echo "[setup] $name: done"
done

echo "[setup] all runners ready"
