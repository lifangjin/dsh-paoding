#!/usr/bin/env bash
#
# dsh-paoding installer — thin shell wrapper around tools/install.mjs, which
# installs the orchestrator preset into $DSH_HOME/.agent-presets/ (the roster
# root dsh-agent-presets scans for locally authored presets).  The Node
# generator detects the host's enabled MCP servers and local tool plugins at
# install time, resolves their exact tool names, and rewrites the role
# toolFilter.allow lists in agent.cordis.yml — so tools.restrict() never
# rejects a child agent for an unknown host-tool name.
#
# Usage: ./install.sh [--profile <name>] [--patch <file> ...] [--dry-run] [--help]
# After installing: restart the dsh host (or open a new session), then pick
# 「编排模式 (Orchestrator)」 in the new-session preset selector. To make it
# the default, set it in Settings → Agent Presets.
#
# Uninstall: rm -rf "${DSH_HOME:-$HOME/.dsh}/.agent-presets/orchestrator"

set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
export DSH_HOME

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node (>=18) is required to run the dsh-paoding installer" >&2
  exit 1
fi

exec node "$REPO_ROOT/tools/install.mjs" "$@"
