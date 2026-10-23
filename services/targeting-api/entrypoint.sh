#!/bin/sh
set -eu

# A Railway Volume can be mounted at /var/lib/farq-targeting. The service also
# works locally with services/targeting-api/data when no release variables exist.
if [ "${TARGETING_DATA_REQUIRED:-}" = "1" ] || [ -n "${TARGETING_DATA_BUCKET:-}" ]; then
  export TARGETING_DATA_DIR="${TARGETING_DATA_DIR:-/var/lib/farq-targeting/current}"
  export TARGETING_RUNTIME_DIR="${TARGETING_RUNTIME_DIR:-/var/lib/farq-targeting/runtime}"
fi

python3 release_data.py
exec python3 server.py
