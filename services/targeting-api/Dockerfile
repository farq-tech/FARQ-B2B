FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir duckdb==1.4.5 mapbox-vector-tile==2.2.0 "psycopg[binary]==3.2.13"
COPY services/targeting-api/server.py services/targeting-api/market_analytics.py services/targeting-api/trial_search.py services/targeting-api/contact_lookup.py services/targeting-api/buyer_review.py services/targeting-api/directory_tiles.py services/targeting-api/status_policy.py services/targeting-api/taxonomy_search.py services/targeting-api/data_release.py services/targeting-api/metrics.py services/targeting-api/index.html services/targeting-api/entrypoint.sh ./
RUN chmod +x /app/entrypoint.sh
ENV PORT=8080
EXPOSE 8080
CMD ["/app/entrypoint.sh"]
