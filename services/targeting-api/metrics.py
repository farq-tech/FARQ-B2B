"""Low-cardinality operational metrics for the Atlas targeting API.

Metrics intentionally use fixed route labels and status codes only. They never
contain a search string, district label, POI identifier, coordinate, or contact.
"""
from __future__ import annotations

from collections import defaultdict
from threading import Lock


def route_label(path: str) -> str:
    clean = path.split("?", 1)[0]
    if clean.startswith("/tiles/"):
        return "tiles"
    if clean.startswith("/template-status"):
        return "template_status"
    known = {
        "/districts", "/facets", "/status", "/templates", "/cities", "/log", "/login", "/logout",
        "/map-query", "/map-profile", "/map-focus", "/trial-search", "/clusters", "/market-summary",
        "/district-counts", "/district-insights", "/who-buys", "/street-density", "/street-density/catalog",
        "/suggest-specialties", "/search", "/demo-understand", "/demo-search", "/send-template",
        "/send-test-template", "/send-farq", "/metrics",
    }
    return clean.removeprefix("/").replace("-", "_").replace("/", "_") if clean in known else "other"


class ServiceMetrics:
    def __init__(self) -> None:
        self._lock = Lock()
        self._requests: dict[tuple[str, int], int] = defaultdict(int)
        self._seconds: dict[str, tuple[int, float]] = {}

    def observe(self, route: str, status: int, elapsed_seconds: float) -> None:
        route = route if route and route.replace("_", "").isalnum() else "other"
        status = status if 100 <= status <= 599 else 500
        elapsed_seconds = max(0.0, elapsed_seconds)
        with self._lock:
            self._requests[(route, status)] += 1
            count, total = self._seconds.get(route, (0, 0.0))
            self._seconds[route] = (count + 1, total + elapsed_seconds)

    def render_prometheus(self) -> bytes:
        with self._lock:
            requests = sorted(self._requests.items())
            durations = sorted(self._seconds.items())
        lines = [
            "# HELP atlas_targeting_http_requests_total Completed HTTP requests by route and status.",
            "# TYPE atlas_targeting_http_requests_total counter",
        ]
        lines.extend(
            f'atlas_targeting_http_requests_total{{route="{route}",status="{status}"}} {count}'
            for ((route, status), count) in requests
        )
        lines.extend([
            "# HELP atlas_targeting_http_request_duration_seconds Request duration by route.",
            "# TYPE atlas_targeting_http_request_duration_seconds summary",
        ])
        for route, (count, total) in durations:
            lines.append(f'atlas_targeting_http_request_duration_seconds_count{{route="{route}"}} {count}')
            lines.append(f'atlas_targeting_http_request_duration_seconds_sum{{route="{route}"}} {total:.6f}')
        return ("\n".join(lines) + "\n").encode("utf-8")
