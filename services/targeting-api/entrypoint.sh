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

exec python3 /app/server.py
