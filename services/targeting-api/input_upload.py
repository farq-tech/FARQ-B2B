"""One-time upload of a data input straight onto the service's volume, for files nothing else can deliver.

The volume is mounted only in this service, so an input that is not in the data release (today the building
layer) has no other way in. The endpoint exists only while FARQ_INPUT_UPLOAD_TOKEN is set; it takes one fixed
input, never a path from the request, streams it beside its destination, and moves it into place only when the
SHA-256 matches the digest configured beforehand (FARQ_BUILDINGS_SHA256), so the caller cannot choose what file
lands where. Unset the token once the file is in place and the endpoint is gone.
"""
import hashlib
import hmac
import os
from pathlib import Path

PATH = '/admin/inputs/buildings'
MAX_BYTES = 300 * 1024 * 1024
CHUNK = 4 * 1024 * 1024


def destination(data_dir):
    return Path(data_dir) / 'buildings_ingest' / 'normalized' / 'buildings.parquet'


def receive(headers, stream, data_dir, environ=os.environ):
    """(status, body) for one upload. headers: a mapping with Content-Length and X-Farq-Upload-Token."""
    token, digest = environ.get('FARQ_INPUT_UPLOAD_TOKEN', ''), environ.get('FARQ_BUILDINGS_SHA256', '').strip().lower()
    if not token:
        return 404, {'error': 'NOT_FOUND'}
    given = headers.get('X-Farq-Upload-Token') or ''
    if len(token) < 32 or not hmac.compare_digest(given.encode(), token.encode()):
        return 401, {'error': 'UNAUTHORIZED'}
    if len(digest) != 64:
        return 409, {'error': 'NO_EXPECTED_DIGEST'}
    try:
        size = int(headers.get('Content-Length') or 0)
    except ValueError:
        size = 0
    if not 0 < size <= MAX_BYTES:
        return 413, {'error': 'SIZE'}
    target = destination(data_dir)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + '.upload')
    sha, left = hashlib.sha256(), size
    try:
        with partial.open('wb') as handle:
            while left:
                block = stream.read(min(CHUNK, left))
                if not block:
                    return 400, {'error': 'INCOMPLETE'}
                sha.update(block)
                handle.write(block)
                left -= len(block)
        if sha.hexdigest() != digest:
            return 422, {'error': 'SHA256_MISMATCH'}
        os.replace(partial, target)
        return 200, {'ok': True, 'bytes': size, 'sha256': digest}
    finally:
        partial.unlink(missing_ok=True)
