#!/bin/sh
set -eu

DATA_DIR="${FARQ_TARGETING_DATA_DIR:-/app/data}"
export FARQ_TARGETING_DATA_DIR="$DATA_DIR"

# Production data is released from the project's S3-compatible Bucket. The
# bootstrap verifies every object before it replaces the local active copy;
# startup stops rather than serving a partial or unverified map.
if [ -n "${TARGETING_DATA_BUCKET:-}" ] || [ -n "${TARGETING_DATA_RELEASE:-}" ]; then
  export TARGETING_DATA_DIR="$DATA_DIR"
  export TARGETING_DATA_REQUIRED=1
  python3 /app/release_data.py
fi

for file in targets.parquet poi_taxonomy.parquet street_density.parquet trade_clusters.parquet districts.geojson taxonomy/farq_taxonomy.json; do
  if [ ! -s "$DATA_DIR/$file" ]; then
    echo "Missing required read-only Atlas data: $DATA_DIR/$file" >&2
    exit 78
  fi
done

# A release manifest is optional during migration. When supplied it makes
# startup fail closed if mounted assets differ from the approved build.
# The verifier only reads data; it never writes to the mounted volume.
if [ -n "${FARQ_TARGETING_RELEASE_MANIFEST:-}" ]; then
  python3 /app/data_release.py "$DATA_DIR" --verify-manifest "$FARQ_TARGETING_RELEASE_MANIFEST"
fi

exec python3 /app/server.py
