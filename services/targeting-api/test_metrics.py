import unittest

from metrics import ServiceMetrics, route_label


class MetricsTests(unittest.TestCase):
    def test_routes_never_keep_user_input(self):
        self.assertEqual(route_label("/tiles/aabb/15/3/4.pbf?district=العليا"), "tiles")
        self.assertEqual(route_label("/unrecognised?q=شركة+مقاولات"), "other")
        self.assertEqual(route_label("/street-density/catalog"), "street_density_catalog")

    def test_prometheus_output_has_counts_and_no_request_content(self):
        metrics = ServiceMetrics()
        metrics.observe("search", 200, 0.125)
        metrics.observe("search", 503, 0.250)
        body = metrics.render_prometheus().decode()
        self.assertIn('atlas_targeting_http_requests_total{route="search",status="200"} 1', body)
        self.assertIn('atlas_targeting_http_request_duration_seconds_count{route="search"} 2', body)
        self.assertNotIn("شركة", body)


if __name__ == "__main__":
    unittest.main()
