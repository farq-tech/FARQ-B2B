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
import shutil
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


def _sha256(path):
    sha = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b''):
            sha.update(block)
    return sha.hexdigest()


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


def _ai_classification_profile(data_dir, aux_dir=None):
    """Count the businesses no activity figure counts, and the evidence each carries (ai_classification.profile).
    Reads the release's directory and classification; writes its report beside the population folder, which outlives
    releases. Skipped when the release files and the job version are unchanged since the last report."""
    import ai_classification as job
    data_dir, aux_dir = Path(data_dir), Path(aux_dir or data_dir)
    inputs = {'targets': data_dir / 'targets.parquet', 'taxonomy': data_dir / 'poi_taxonomy.parquet'}
    missing = [name for name, path in inputs.items() if not path.is_file()]
    if missing:
        LOGGER.error('startup_job_skipped job=ai_classification_profile missing_input=%s', ','.join(missing))
        return
    out_dir = aux_dir / 'ai_classification'
    report_path, marker = out_dir / 'profile.json', out_dir / 'profile_signature.json'
    signature = _signature(job.SOURCE, inputs)
    try:
        if json.loads(marker.read_text(encoding='utf-8')) == signature and report_path.is_file():
            LOGGER.info('startup_job_skipped job=ai_classification_profile reason=inputs_unchanged source=%s', job.SOURCE)
            return
    except (OSError, ValueError):
        pass
    report = job.profile(inputs['targets'], inputs['taxonomy'])
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    marker.write_text(json.dumps(signature), encoding='utf-8')
    # counts and shares only (see ai_classification), so it is safe in the log
    LOGGER.info('ai_classification_profile_done %s', json.dumps(job.log_summary(report), ensure_ascii=False))


def _evidence_labels(data_dir, out_dir):
    """Build the evidence labels (evidence_classification.build) when FARQ_AI_CLASSIFY_EVIDENCE is on; returns the
    file when it is in place. Skipped when its inputs and version are unchanged."""
    import evidence_classification as ev
    path = out_dir / ev.OUT
    if not _enabled('FARQ_AI_CLASSIFY_EVIDENCE'):
        return None
    crosswalk = data_dir / 'taxonomy' / 'activity_map.csv'
    if not crosswalk.is_file():
        crosswalk = Path(__file__).resolve().parent / 'reference' / 'activity_map.csv'
    inputs = {'targets': data_dir / 'targets.parquet', 'taxonomy': data_dir / 'poi_taxonomy.parquet',
              'taxonomy_json': data_dir / 'taxonomy' / 'farq_taxonomy.json', 'crosswalk': crosswalk}
    missing = [name for name, p in inputs.items() if not p.is_file()]
    if missing:
        LOGGER.error('startup_job_skipped job=evidence_labels missing_input=%s', ','.join(missing))
        return None
    marker, signature = out_dir / 'evidence_signature.json', _signature(ev.VERSION, inputs)
    try:
        if json.loads(marker.read_text(encoding='utf-8')) == signature and path.is_file():
            LOGGER.info('startup_job_skipped job=evidence_labels reason=inputs_unchanged source=%s', ev.VERSION)
            return path
    except (OSError, ValueError):
        pass
    report = ev.build(inputs['targets'], inputs['taxonomy'], inputs['taxonomy_json'], crosswalk, out_dir)
    marker.write_text(json.dumps(signature), encoding='utf-8')
    (out_dir / 'evidence_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    LOGGER.info('evidence_labels_done %s', json.dumps(report, ensure_ascii=False))   # counts and accuracies only
    return path


def _classification_layer(data_dir, aux_dir=None):
    """Build the served AI classification layer (classification_layer.build) from the release classification, the
    merged classification (fetched from the bucket by FARQ_CLASSIFICATION_MERGED_OBJECT / _SHA256 when its digest
    changes) and the evidence labels (FARQ_AI_CLASSIFY_EVIDENCE). Either source may be absent. Skipped when the inputs
    and the layer version are unchanged."""
    import classification_layer as layer
    data_dir, aux_dir = Path(data_dir), Path(aux_dir or data_dir)
    out_dir = aux_dir / 'ai_classification'
    out_dir.mkdir(parents=True, exist_ok=True)
    merged = out_dir / 'classification_merged.parquet'
    digest = os.environ.get('FARQ_CLASSIFICATION_MERGED_SHA256', '').strip().lower()
    if digest and not (merged.is_file() and _sha256(merged) == digest):
        _fetch('classification_layer', 'merged', 'FARQ_CLASSIFICATION_MERGED', merged)
    merged_ok = merged.is_file() and bool(digest) and _sha256(merged) == digest
    evidence = _evidence_labels(data_dir, out_dir)
    inputs = {'taxonomy': data_dir / 'poi_taxonomy.parquet', 'taxonomy_json': data_dir / 'taxonomy' / 'farq_taxonomy.json'}
    missing = [name for name, path in inputs.items() if not path.is_file()]
    if missing or not (merged_ok or evidence):
        LOGGER.error('startup_job_skipped job=classification_layer missing_input=%s', ','.join(missing) or 'merged_and_evidence')
        return
    if merged_ok:
        inputs['merged'] = merged
    if evidence:
        inputs['evidence'] = evidence
    marker = out_dir / 'layer_signature.json'
    signature = _signature(layer.VERSION, inputs)
    try:
        if json.loads(marker.read_text(encoding='utf-8')) == signature and (out_dir / layer.LAYER).is_file():
            LOGGER.info('startup_job_skipped job=classification_layer reason=inputs_unchanged source=%s', layer.VERSION)
            return
    except (OSError, ValueError):
        pass
    report = layer.build(inputs['taxonomy'], inputs.get('merged'), inputs['taxonomy_json'], out_dir, evidence=inputs.get('evidence'))
    marker.write_text(json.dumps(signature), encoding='utf-8')
    (out_dir / 'layer_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    LOGGER.info('classification_layer_done %s', json.dumps(report, ensure_ascii=False))   # counts only
    # a review sample of what the layer changed, on production: names and labels only, into the bucket
    targets = data_dir / 'targets.parquet'

    def layer_review(path):
        import duckdb
        db = duckdb.connect()
        _review_sql(db, f"""
            with t as (select poi_key, any_value(city_en) city_en, any_value(name_ar) name_ar, any_value(name_en) name_en
                       from read_parquet('{targets}') group by poi_key)
            (select 'sub' kind, l.poi_key, t.city_en, t.name_ar, t.name_en, l.sub_id as label, l.orig_sub_id, l.ai_method, l.ai_evidence
             from read_parquet('{out_dir / layer.LAYER}') l join t using (poi_key) where l.ai_method is not null
             using sample 150 rows (reservoir, 7))
            union all
            (select 'main_only', m.poi_key, t.city_en, t.name_ar, t.name_en, m.main_id, null, m.ai_method, m.ai_evidence
             from read_parquet('{out_dir / layer.MAIN_ONLY}') m join t using (poi_key) using sample 150 rows (reservoir, 7))""", path)
        db.close()

    if targets.is_file():
        _review('classification_layer', layer_review, out_dir / 'layer_review_sample.csv', f'reviews/classification_layer_{layer.VERSION}.csv')


def _upload_review(job, local, key):
    """Put a review file (business names, never a contact) in the project's bucket under reviews/, for the owner's
    review outside the log. Returns the key, or None when no bucket is configured."""
    bucket = os.environ.get('BUCKET', '').strip()
    if not bucket:
        return None
    import boto3
    client = boto3.client('s3', endpoint_url=os.environ.get('ENDPOINT') or None, region_name=os.environ.get('REGION') or None,
                          aws_access_key_id=os.environ.get('ACCESS_KEY_ID') or None, aws_secret_access_key=os.environ.get('SECRET_ACCESS_KEY') or None)
    client.upload_file(str(local), bucket, key)
    LOGGER.info('startup_job_review_uploaded job=%s key=%s', job, key)
    return key


def _review_sql(db, sql, path):
    db.execute(f"copy ({sql}) to '{path}' (header, delimiter ',')")


def _review(job, build, local, key):
    """Write and upload one review sample; a failure here is logged and never fails the job it reviews."""
    try:
        build(local)
        return _upload_review(job, local, key)
    except Exception as error:   # the layer is built; only its review copy is missing
        LOGGER.error('startup_job_review_failed job=%s error_type=%s', job, type(error).__name__)
        return None


def _poi_standard(data_dir, aux_dir=None):
    """Apply the POI enrichment standard (poi_standard.run) to the published release and the served classification,
    on production (docs/production-first.md). Writes poi_standard/poi_standard.parquet beside the population folder,
    logs the report (counts only), and puts a review sample in the bucket. Skipped when nothing it reads changed."""
    import classification_layer
    import duckdb
    import poi_standard as job
    data_dir, aux_dir = Path(data_dir), Path(aux_dir or data_dir)
    out_dir = aux_dir / 'poi_standard'
    inputs = {'targets': data_dir / 'targets.parquet',
              'taxonomy': Path(classification_layer.served_taxonomy(str(data_dir / 'poi_taxonomy.parquet'))),
              'taxonomy_json': data_dir / 'taxonomy' / 'farq_taxonomy.json',
              'category_map': Path(__file__).resolve().parent / 'reference' / 'standard_category_map.csv'}
    missing = [name for name, path in inputs.items() if not path.is_file()]
    if missing:
        LOGGER.error('startup_job_skipped job=poi_standard missing_input=%s', ','.join(missing))
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    out, marker = out_dir / 'poi_standard.parquet', out_dir / 'signature.json'
    signature = _signature(job.VERSION, inputs)
    try:
        if json.loads(marker.read_text(encoding='utf-8')) == signature and out.is_file():
            LOGGER.info('startup_job_skipped job=poi_standard reason=inputs_unchanged source=%s', job.VERSION)
            return
    except (OSError, ValueError):
        pass
    partial = out_dir / 'poi_standard.next.parquet'
    for stale in (partial, partial.with_suffix('.report.json')):
        stale.unlink(missing_ok=True)
    report = job.run(str(inputs['targets']), str(inputs['taxonomy']), str(inputs['category_map']), str(partial),
                     taxonomy_json=str(inputs['taxonomy_json']))
    os.replace(partial, out)
    os.replace(partial.with_suffix('.report.json'), out_dir / 'poi_standard.report.json')
    marker.write_text(json.dumps(signature), encoding='utf-8')
    LOGGER.info('poi_standard_done %s', json.dumps(report, ensure_ascii=False))   # counts and accuracies only
    def standard_review(path):
        db = duckdb.connect()
        _review_sql(db, f"""
            (select 'english_name' kind, poi_key, std_name_ar, std_name_en, std_category, std_secondary_category, std_flags,
                    regexp_extract(std_inferred, 'name_en:[a-z_]+') as name_method
             from read_parquet('{out}') where std_inferred like '%name_en:%' using sample 200 rows (reservoir, 7))
            union all
            (select 'flagged', poi_key, std_name_ar, std_name_en, std_category, std_secondary_category, std_flags, ''
             from read_parquet('{out}') where std_flags <> '' using sample 100 rows (reservoir, 7))""", path)
        db.close()

    _review('poi_standard', standard_review, out_dir / 'review_sample.csv', f'reviews/poi_standard_{job.VERSION}.csv')


def _duplicate_review(data_dir, aux_dir=None):
    """Class C duplicate review on the published release (duplicate_review.build): grades only, never a merge. Logs
    the counts and puts the samples and the audit in the bucket under reviews/. Skipped when the release is unchanged."""
    import duplicate_review as job
    data_dir, aux_dir = Path(data_dir), Path(aux_dir or data_dir)
    targets, out_dir = data_dir / 'targets.parquet', aux_dir / 'duplicate_review'
    if not targets.is_file():
        LOGGER.error('startup_job_skipped job=duplicate_review missing_input=targets')
        return
    marker, signature = out_dir / 'signature.json', _signature(job.VERSION, {'targets': targets})
    try:
        if json.loads(marker.read_text(encoding='utf-8')) == signature:
            LOGGER.info('startup_job_skipped job=duplicate_review reason=inputs_unchanged source=%s', job.VERSION)
            return
    except (OSError, ValueError):
        pass
    report = job.build(targets, out_dir)
    marker.write_text(json.dumps(signature), encoding='utf-8')
    LOGGER.info('duplicate_review_done %s', json.dumps(report, ensure_ascii=False))   # counts only
    for name in ('sample_remaining.csv', 'sample_excluded.csv', 'duplicate_review_c_audit.parquet', 'duplicate_review_c.report.json'):
        _review('duplicate_review', lambda path: None, out_dir / name, f'reviews/{job.VERSION}/{name}')


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
    if os.environ.get('FARQ_CLASSIFICATION_MERGED_OBJECT', '').strip() or _enabled('FARQ_AI_CLASSIFY_EVIDENCE'):
        threading.Thread(target=_run, args=('classification_layer', _classification_layer, data_dir, aux_dir), daemon=True, name='job-classification-layer').start()
        started.append('classification_layer')
    if _enabled('FARQ_DUPLICATE_REVIEW'):
        threading.Thread(target=_run, args=('duplicate_review', _duplicate_review, data_dir, aux_dir), daemon=True, name='job-duplicate-review').start()
        started.append('duplicate_review')
    if _enabled('FARQ_POI_STANDARD'):
        threading.Thread(target=_run, args=('poi_standard', _poi_standard, data_dir, aux_dir), daemon=True, name='job-poi-standard').start()
        started.append('poi_standard')
    if _enabled('FARQ_AI_CLASSIFY_PROFILE'):
        threading.Thread(target=_run, args=('ai_classification_profile', _ai_classification_profile, data_dir, aux_dir), daemon=True, name='job-ai-classification-profile').start()
        started.append('ai_classification_profile')
    return started
