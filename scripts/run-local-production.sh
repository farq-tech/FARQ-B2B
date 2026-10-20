#!/usr/bin/env sh
set -eu

ENV_FILE="${FARQ_LOCAL_ENV_FILE:-.env.production.local}"
COMPOSE_FILE="docker-compose.local-production.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.production.local.example and fill the local values." >&2
  exit 1
fi

exec docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up --build "$@"
