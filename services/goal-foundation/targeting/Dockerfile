FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir duckdb==1.4.5 "psycopg[binary]==3.2.*"
COPY server.py trial_search.py contact_lookup.py index.html ./
COPY data/targets.parquet data/holder_rfq.json ./data/
ENV PORT=8080
EXPOSE 8080
CMD ["python3", "server.py"]
