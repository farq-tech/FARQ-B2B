#!/usr/bin/env sh
set -eu

ENV_FILE="${FARQ_LOCAL_ENV_FILE:-.env.production.local}"
COMPOSE_FILE="docker-compose.local-production.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.production.local.example and fill the local values." >&2
  exit 1
fi

# A fixed local signing key keeps the browser session valid across restarts.
# Do not print it or add it to Git.
if ! grep -Eq '^FARQ_SESSION_SECRET=.{32,}$' "$ENV_FILE"; then
  LOCAL_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  python3 - "$ENV_FILE" "$LOCAL_SECRET" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
secret = sys.argv[2]
lines = path.read_text().splitlines()
for index, line in enumerate(lines):
    if line.startswith('FARQ_SESSION_SECRET='):
        lines[index] = f'FARQ_SESSION_SECRET={secret}'
        break
else:
    lines.append(f'FARQ_SESSION_SECRET={secret}')
path.write_text('\n'.join(lines) + '\n')
PY
fi

exec docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up --build "$@"
