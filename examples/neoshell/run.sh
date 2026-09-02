#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# gtk4-layer-shell has to be loaded before libwayland-client, which language
# bindings cannot guarantee through normal imports.
export LD_PRELOAD="${LD_PRELOAD:-}${LD_PRELOAD:+:}/usr/lib/libgtk4-layer-shell.so"

exec gjs -m dist/neoshell.js
