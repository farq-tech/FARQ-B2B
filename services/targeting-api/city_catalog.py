"""City catalog helpers shared by the targeting API and its tests."""
from collections import Counter


def city_rows_with_district_counts(city_rows, district_features):
    """Keep every market city and count only named district features the map can display."""
    district_counts = Counter(
        properties.get("city_en")
        for feature in district_features
        if isinstance(feature, dict)
        and isinstance((properties := feature.get("properties")), dict)
        and isinstance(properties.get("city_en"), str)
        and properties["city_en"].strip()
        and isinstance(properties.get("id"), (str, int, float))
        and not isinstance(properties.get("id"), bool)
        and bool(str(properties.get("id")).strip())
        and isinstance(feature.get("geometry"), dict)
        and feature["geometry"].get("type") in ("Polygon", "MultiPolygon")
        and isinstance(properties.get("ar") or properties.get("district_ar"), str)
        and bool((properties.get("ar") or properties.get("district_ar")).strip())
    )
    return [
        {"en": city_en, "ar": city_ar, "n": place_count, "districts": district_counts.get(city_en, 0)}
        for city_en, city_ar, place_count in city_rows
    ]
