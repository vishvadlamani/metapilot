#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# 1. Meta CLI (Python ≥3.12)
if ! command -v meta &>/dev/null; then
  echo "Installing Meta Ads CLI (PyPI: meta-ads)..."
  if command -v uv &>/dev/null; then
    uv tool install meta-ads
  elif command -v pipx &>/dev/null; then
    pipx install meta-ads
  else
    echo "Need uv or pipx. Install one and rerun." >&2
    exit 1
  fi
fi

# 2. Bun deps
if ! command -v bun &>/dev/null; then
  echo "Bun not found. Install: https://bun.sh" >&2
  exit 1
fi
bun install

# 3. Runtime dirs
mkdir -p logs

# 4. Meta auth (interactive — opens browser)
if ! meta auth status >/dev/null 2>&1; then
  echo "Authenticating with Meta..."
  meta auth login
fi

# 5. Ad account selection
if [[ -z "${AD_ACCOUNT_ID:-}" ]]; then
  echo
  echo "Pick an ad account from the list below, then export AD_ACCOUNT_ID:"
  echo "  meta ads adaccount list"
  echo "  export AD_ACCOUNT_ID=act_XXXXXXXXXX"
  echo
fi

# 6. Verify
bun run src/index.ts auth-status
echo
echo "Setup complete. Try: bun run src/index.ts campaigns"
