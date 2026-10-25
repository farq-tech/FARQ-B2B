#!/usr/bin/env bash
set -euo pipefail

if [[ -f /custom_files/valhalla-seed.tar.gz ]]; then
  echo "Installing the staged routing graph into the persistent Railway volume."
  tar -xzf /custom_files/valhalla-seed.tar.gz -C /custom_files
  rm /custom_files/valhalla-seed.tar.gz
fi

if [[ ! -d /custom_files/valhalla_tiles ]]; then
  echo "Valhalla graph is not staged yet; waiting for the persistent volume upload."
  exec sleep 2147483647
fi

export serve_tiles=True
export use_tiles_ignore_pbf=True
export build_admins=False
export build_time_zones=False
export build_elevation=False
export build_transit=False
export build_tar=False
export update_existing_config=True
export server_threads="${SERVER_THREADS:-2}"

exec /valhalla/scripts/docker-entrypoint.sh "$@"
