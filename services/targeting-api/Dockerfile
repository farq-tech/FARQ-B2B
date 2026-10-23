FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir duckdb==1.4.5 mapbox-vector-tile==2.2.0 "psycopg[binary]==3.2.13"
COPY server.py market_analytics.py trial_search.py contact_lookup.py buyer_review.py directory_tiles.py status_policy.py taxonomy_search.py data_release.py index.html entrypoint.sh ./
RUN chmod +x /app/entrypoint.sh
ENV PORT=8080
EXPOSE 8080
CMD ["/app/entrypoint.sh"]
