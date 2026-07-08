#!/usr/bin/env sh
# install.sh — обёртка одного клика (POSIX). Запускает install.js на node.
# Аргументы прокидываются: ./install.sh --target ../my-project
exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/install.js" "$@"
