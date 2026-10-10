#!/usr/bin/env bash
# Rejoue le scénario de démo de bout en bout (nécessite Node >= 20 et la plateforme démarrée).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || node scripts/init-env.mjs
exec node scripts/demo.mjs "$@"
