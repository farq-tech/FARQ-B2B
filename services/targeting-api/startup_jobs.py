"""Opt-in data jobs that run inside the service after it starts serving.

The directory assets live on the service's mounted volume and nothing else can
reach them, so a job that reads or writes that volume has to run in this
process. Each job is switched on by one environment variable, runs on a daemon
thread after the HTTP server is up (so health checks and map requests are never
blocked), is skipped when its version and input files match its last successful
run, and reports through the service log in aggregate form only: counts, shares and decisions, never a business name, key, address or
coordinate. Unsetting the variable makes the next boot skip the job.
"""
import hashlib
import json
import logging
import os
import threading
from pathlib import Path

import canonical_data

LOGGER = logging.getLogger('farq.targeting')


def _enabled(name):
    return os.environ.get(name, '').strip().lower() in {'1', 'true', 'yes'}


def _signature(source, paths, settings=None):
    """What a job's output depends on: the job version, its settings and each input file's size and modification time."""
    stats = {}
    for name, path in paths.items():
        try:
            stat = Path(path).stat()
            stats[name] = [stat.st_size, stat.st_mtime_ns]
        except (OSError, TypeError):
            stats[name] = None
    return {'source': source, 'settings': settings or {}, 'inputs': stats}


def _fetch_buildings(target):
    """Put the building layer on the volume from the project's bucket when it is missing there.

    FARQ_BUILDINGS_OBJECT names the object and FARQ_BUILDINGS_SHA256 its digest; the bucket and its keys come
    from the Railway bucket variables (BUCKET, ENDPOINT, REGION, ACCESS_KEY_ID, SECRET_ACCESS_KEY). The file is
    written beside the target, checked against the digest and only then moved into place, so a partial or
    different download never reaches the job. Returns True when the file is in place."""
    key, digest = os.environ.get('FARQ_BUILDINGS_OBJECT', '').strip(), os.environ.get('FARQ_BUILDINGS_SHA256', '').strip().lower()
    bucket = os.environ.get('BUCKET', '').strip()
    if not key or not digest or not bucket:
        return False
    import boto3
    client = boto3.client('s3', endpoint_url=os.environ.get('ENDPOINT') or None, region_name=os.environ.get('REGION') or None,
                          aws_access_key_id=os.environ.get('ACCESS_KEY_ID') or None, aws_secret_access_key=os.environ.get('SECRET_ACCESS_KEY') or None)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + '.download')
    try:
        client.download_file(bucket, key, str(partial))
        sha = hashlib.sha256()
        with partial.open('rb') as handle:
            for block in iter(lambda: handle.read(4 * 1024 * 1024), b''):
                sha.update(block)
        if sha.hexdigest() != digest:
            LOGGER.error('startup_job_input_rejected job=building_population input=buildings reason=sha256_mismatch')
            return False
        os.replace(partial, target)
        LOGGER.info('startup_job_input_fetched job=building_population input=buildings bytes=%s', target.stat().st_size)
        return True
    finally:
        partial.unlink(missing_ok=True)


def _building_population(data_dir):
    import build_building_population as job
    import district_reference
    data_dir = Path(data_dir)
    out_dir = data_dir / 'buildings_ingest' / 'population'
    official = out_dir / 'official_city_population.csv'
    buildings = data_dir / 'buildings_ingest' / 'normalized' / 'buildings.parquet'
    if not buildings.is_file():
        _fetch_buildings(buildings)
    missing = [name for name, path in (('buildings', buildings), ('districts', data_dir / 'districts.geojson')) if not path.is_file()]
    if missing:
        LOGGER.error('startup_job_skipped job=building_population missing_input=%s', ','.join(missing))
        return
    reference = Path(district_reference.PATH)
    inputs = {'buildings': buildings, 'districts': data_dir / 'districts.geojson', 'worldpop': out_dir / 'district_population_2025.parquet',
              'official': official, 'pois': data_dir / 'targets.parquet', 'reference': reference,
              'corrections': Path(canonical_data.CORRECTIONS_PATH)}   # renamed polygons change which reference row a district takes
    elevation_mode = os.environ.get('FARQ_BUILDING_ELEVATION_MODE', 'auto')
    signature = _signature(job.SOURCE, inputs, {'elevation_mode': elevation_mode})
    marker = out_dir / 'district_population_buildings_signature.json'
    try:
        if json.loads(marker.read_text(encoding='utf-8')) == signature:
            LOGGER.info('startup_job_skipped job=building_population reason=inputs_unchanged source=%s', job.SOURCE)
            return
    except (OSError, ValueError):
        pass
    report = job.build(
        buildings=buildings,
        districts=data_dir / 'districts.geojson',
        output_dir=out_dir,
        worldpop=inputs['worldpop'],
        official=official if official.is_file() else None,
        elevation_mode=elevation_mode,
        pois=inputs['pois'] if inputs['pois'].is_file() else None,
        reference=reference if reference.is_file() else None,
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps(signature), encoding='utf-8')
    # The report holds aggregates only (see build_building_population), so it is safe in the log.
    LOGGER.info('building_population_done %s', json.dumps(report, ensure_ascii=False))


def _run(name, target, *args):
    try:
        LOGGER.info('startup_job_started job=%s', name)
        target(*args)
    except Exception as error:   # a failed job must never take the service down; the type names the cause
        LOGGER.error('startup_job_failed job=%s error_type=%s', name, type(error).__name__)


def start(data_dir):
    """Launch every enabled job on its own daemon thread; returns the names started."""
    started = []
    if _enabled('FARQ_BUILD_BUILDING_POPULATION'):
        threading.Thread(target=_run, args=('building_population', _building_population, data_dir), daemon=True, name='job-building-population').start()
        started.append('building_population')
    return started
