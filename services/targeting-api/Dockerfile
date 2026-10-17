FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir duckdb==1.4.5 mapbox-vector-tile==2.2.0 "psycopg[binary]==3.2.13"
COPY server.py market_analytics.py trial_search.py contact_lookup.py buyer_review.py directory_tiles.py status_policy.py taxonomy_search.py index.html ./
COPY data/targets.parquet data/holder_rfq.json data/poi_taxonomy.parquet data/street_density.parquet data/trade_clusters.parquet data/districts.geojson ./data/
COPY data/taxonomy ./data/taxonomy
ENV PORT=8080
EXPOSE 8080
CMD ["python3", "server.py"]
