#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Single structured briefing per spec §3.5.
bun run src/index.ts briefing
