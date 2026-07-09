#!/usr/bin/env sh
# install.sh - one-click wrapper for POSIX. Runs install.js with node.
# Arguments are forwarded: ./install.sh --target ../my-project
exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/install.js" "$@"
