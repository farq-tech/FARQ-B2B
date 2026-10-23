"""Filesystem boundaries for the targeting service.

Directory data is a versioned, read-only release.  Operational logs belong in a
separate writable directory so a deployment cannot mutate its data snapshot.
"""
from __future__ import annotations

import os
from pathlib import Path


HERE = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("TARGETING_DATA_DIR", HERE / "data")).expanduser().resolve()
RUNTIME_DIR = Path(os.environ.get("TARGETING_RUNTIME_DIR", HERE / "data")).expanduser().resolve()


def data_file(name: str) -> str:
    """Return a file in the approved data release without accepting traversal."""
    candidate = (DATA_DIR / name).resolve()
    if candidate != DATA_DIR and DATA_DIR not in candidate.parents:
        raise ValueError("data path escapes release")
    return str(candidate)


def runtime_file(name: str) -> str:
    """Return a writable operational file outside the immutable data release."""
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    candidate = (RUNTIME_DIR / name).resolve()
    if candidate != RUNTIME_DIR and RUNTIME_DIR not in candidate.parents:
        raise ValueError("runtime path escapes directory")
    return str(candidate)
