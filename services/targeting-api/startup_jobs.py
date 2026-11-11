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
import re
import shutil
import threading
from functools import lru_cache
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


def _sha256(path):
    sha = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b''):
            sha.update(block)
    return sha.hexdigest()


@lru_cache(maxsize=8)
def _file_matches_sha256(path, expected, size, modified_ns):
    # Size and modification time invalidate the cache whenever an atomic upload replaces the input.
    try:
        return _sha256(path) == expected
    except OSError:
        return False


def _buildings_match_configured_sha(path):
    expected = os.environ.get('FARQ_BUILDINGS_SHA256', '').strip().lower()
    if not expected:
        return Path(path).is_file()
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        return False
    try:
        stat = Path(path).stat()
        return _file_matches_sha256(str(path), expected, stat.st_size, stat.st_mtime_ns)
    except OSError:
        return False


def _building_population_signature(data_dir, aux_dir, buildings, source):
    import district_reference
    data_dir, aux_dir = Path(data_dir), Path(aux_dir)
    out_dir = aux_dir / 'buildings_ingest' / 'population'
    official = out_dir / 'official_city_population.csv'
    inputs = {
        'buildings': buildings,
        'districts': data_dir / 'districts.geojson',
        'worldpop': out_dir / 'district_population_2025.parquet',
        'official': official,
        'pois': data_dir / 'targets.parquet',
        'reference': Path(district_reference.PATH),
        'corrections': Path(canonical_data.CORRECTIONS_PATH),
    }
    settings = {'elevation_mode': os.environ.get('FARQ_BUILDING_ELEVATION_MODE', 'auto')}
    digest = os.environ.get('FARQ_BUILDINGS_SHA256', '').strip().lower()
    if digest:
        settings['buildings_sha256'] = digest
    return _signature(source, inputs, settings)


def building_population_output_current(data_dir, aux_dir=None):
    """Whether building-derived outputs match the configured, verified building input and current job inputs."""
    import build_building_population as job
    data_dir = Path(data_dir)
    aux_dir = Path(aux_dir or data_dir)
    buildings = aux_dir / 'buildings_ingest' / 'normalized' / 'buildings.parquet'
    if not _buildings_match_configured_sha(buildings):
        return False
    marker = aux_dir / 'buildings_ingest' / 'population' / 'district_population_buildings_signature.json'
    try:
        stored = json.loads(marker.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return False
    current = _building_population_signature(data_dir, aux_dir, buildings, job.SOURCE)
    return stored == current


def _fetch_buildings(target):
    """Put the building layer on the volume from the project's bucket when it is missing there.

    FARQ_BUILDINGS_OBJECT names the object and FARQ_BUILDINGS_SHA256 its digest."""
    return _fetch('building_population', 'buildings', 'FARQ_BUILDINGS', target)


def _fetch(job, name, prefix, target):
    """Download the bucket object <prefix>_OBJECT to target when its digest is <prefix>_SHA256.

    The bucket and its keys come from the Railway bucket variables (BUCKET, ENDPOINT, REGION, ACCESS_KEY_ID,
    SECRET_ACCESS_KEY). The file is written beside the target, checked against the digest and only then moved into
    place, so a partial or different download never reaches a reader. Returns True when the file is in place."""
    key, digest = os.environ.get(f'{prefix}_OBJECT', '').strip(), os.environ.get(f'{prefix}_SHA256', '').strip().lower()
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
        if _sha256(partial) != digest:
            LOGGER.error('startup_job_input_rejected job=%s input=%s reason=sha256_mismatch', job, name)
            return False
        os.replace(partial, target)
        LOGGER.info('startup_job_input_fetched job=%s input=%s bytes=%s', job, name, target.stat().st_size)
        return True
    finally:
        partial.unlink(missing_ok=True)


def _adopt_legacy_buildings(buildings, data_dir):
    """Move a building layer left in the data release folder (where the first upload wrote it) to the population
    folder, which outlives data releases. Returns True when it was moved."""
    legacy = Path(data_dir) / 'buildings_ingest' / 'normalized' / 'buildings.parquet'
    if buildings.is_file() or not legacy.is_file() or legacy.resolve() == buildings.resolve():
        return False
    buildings.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(legacy), str(buildings))
    LOGGER.info('startup_job_input_moved job=building_population input=buildings')
    return True


def _building_population(data_dir, aux_dir=None):
    """data_dir: the data release (district atlas, directory); aux_dir: the population folder that outlives
    releases (WorldPop layers, the building layer and this job's outputs), the same one the server reads."""
    import build_building_population as job
    import district_reference
    data_dir, aux_dir = Path(data_dir), Path(aux_dir or data_dir)
    out_dir = aux_dir / 'buildings_ingest' / 'population'
    official = out_dir / 'official_city_population.csv'
    buildings = aux_dir / 'buildings_ingest' / 'normalized' / 'buildings.parquet'
    _adopt_legacy_buildings(buildings, data_dir)
    if not _buildings_match_configured_sha(buildings):
        try:
            _fetch_buildings(buildings)
        except Exception as error:
            LOGGER.error('startup_job_input_fetch_failed job=building_population input=buildings error_type=%s', type(error).__name__)
    if not _buildings_match_configured_sha(buildings):
        LOGGER.error('startup_job_skipped job=building_population reason=building_input_not_current')
        return
    missing = [name for name, path in (('districts', data_dir / 'districts.geojson'),) if not path.is_file()]
    if missing:
        LOGGER.error('startup_job_skipped job=building_population missing_input=%s', ','.join(missing))
        return
    reference = Path(district_reference.PATH)
    inputs = {'buildings': buildings, 'districts': data_dir / 'districts.geojson', 'worldpop': out_dir / 'district_population_2025.parquet',
              'official': official, 'pois': data_dir / 'targets.parquet', 'reference': reference,
              'corrections': Path(canonical_data.CORRECTIONS_PATH)}   # renamed polygons change which reference row a district takes
    elevation_mode = os.environ.get('FARQ_BUILDING_ELEVATION_MODE', 'auto')
    signature = _building_population_signature(data_dir, aux_dir, buildings, job.SOURCE)
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


def _real_estate_inputs():
    """Put the real-estate tables (build_real_estate_reference.py) on the volume, where insights reads them through
    REAL_ESTATE_DISTRICTS and REAL_ESTATE_LISTINGS. Each is fetched again only when its configured digest changes,
    so a new collection is published by uploading the files and setting the two digests."""
    for name, prefix, path in (('districts', 'FARQ_REAL_ESTATE_DISTRICTS', os.environ.get('REAL_ESTATE_DISTRICTS')),
                               ('listings', 'FARQ_REAL_ESTATE_LISTINGS', os.environ.get('REAL_ESTATE_LISTINGS'))):
        if not path:
            LOGGER.error('startup_job_skipped job=real_estate_inputs input=%s reason=no_target_path', name)
            continue
        target, digest = Path(path), os.environ.get(f'{prefix}_SHA256', '').strip().lower()
        if target.is_file() and _sha256(target) == digest:
            LOGGER.info('startup_job_skipped job=real_estate_inputs input=%s reason=inputs_unchanged', name)
            continue
        _fetch('real_estate_inputs', name, prefix, target)


def _run(name, target, *args):
    try:
        LOGGER.info('startup_job_started job=%s', name)
        target(*args)
    except Exception as error:   # a failed job must never take the service down; the type names the cause
        LOGGER.error('startup_job_failed job=%s error_type=%s', name, type(error).__name__)


def start(data_dir, aux_dir=None):
    """Launch every enabled job on its own daemon thread; returns the names started."""
    started = []
    if _enabled('FARQ_BUILD_BUILDING_POPULATION'):
        threading.Thread(target=_run, args=('building_population', _building_population, data_dir, aux_dir), daemon=True, name='job-building-population').start()
        started.append('building_population')
    if os.environ.get('FARQ_REAL_ESTATE_LISTINGS_OBJECT', '').strip():
        threading.Thread(target=_run, args=('real_estate_inputs', _real_estate_inputs), daemon=True, name='job-real-estate-inputs').start()
        started.append('real_estate_inputs')
    return started
