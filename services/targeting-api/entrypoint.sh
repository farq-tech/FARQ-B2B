#!/bin/sh
set -eu

DATA_DIR="${FARQ_TARGETING_DATA_DIR:-/app/data}"
export FARQ_TARGETING_DATA_DIR="$DATA_DIR"

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
