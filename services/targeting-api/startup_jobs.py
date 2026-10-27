"""Opt-in data jobs that run inside the service after it starts serving.

The directory assets live on the service's mounted volume and nothing else can
reach them, so a job that reads or writes that volume has to run in this
process. Each job is switched on by one environment variable, runs once per
boot on a daemon thread after the HTTP server is up (so health checks and map
requests are never blocked), and reports through the service log in aggregate
form only: counts, shares and decisions, never a business name, key, address or
coordinate. Unsetting the variable makes the next boot skip the job.
"""
import json
import logging
import os
import threading
from pathlib import Path

LOGGER = logging.getLogger('farq.targeting')


def _enabled(name):
    return os.environ.get(name, '').strip().lower() in {'1', 'true', 'yes'}


def _building_population(data_dir):
    import build_building_population as job
    data_dir = Path(data_dir)
    official = data_dir / 'buildings_ingest' / 'population' / 'official_city_population.csv'
    buildings = data_dir / 'buildings_ingest' / 'normalized' / 'buildings.parquet'
    missing = [name for name, path in (('buildings', buildings), ('districts', data_dir / 'districts.geojson')) if not path.is_file()]
    if missing:
        LOGGER.error('startup_job_skipped job=building_population missing_input=%s', ','.join(missing))
        return
    report = job.build(
        buildings=buildings,
        districts=data_dir / 'districts.geojson',
        output_dir=data_dir / 'buildings_ingest' / 'population',
        worldpop=(data_dir / 'buildings_ingest' / 'population' / 'district_population_2025.parquet'),
        official=official if official.is_file() else None,
        elevation_mode=os.environ.get('FARQ_BUILDING_ELEVATION_MODE', 'auto'),
    )
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
