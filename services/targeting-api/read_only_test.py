"""Safeguards shared by the Atlas read-only test deployment.

The test deployment contains generated fictional records.  These helpers make
the safety boundary explicit and testable: no endpoint may write a log, alter a
template, create an RFQ, or call an external provider when the deployment is in
read-only mode.
"""

import os


READ_ONLY_PATHS = frozenset({
    "/templates",
    "/send-template",
    "/send-test-template",
    "/send-farq",
    "/log",
})


def enabled() -> bool:
    return os.environ.get("ATLAS_READ_ONLY") == "1"


def blocks_request(path: str) -> bool:
    """Whether a POST route must be rejected in the read-only deployment."""
    return enabled() and path in READ_ONLY_PATHS


def provider_calls_allowed() -> bool:
    """External Meta calls are never allowed from a read-only deployment."""
    return not enabled()
