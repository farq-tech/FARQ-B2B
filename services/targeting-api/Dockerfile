FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir duckdb==1.4.5 mapbox-vector-tile==2.2.0 "psycopg[binary]==3.2.13" boto3==1.40.58 pyshp==3.1.6
COPY services/targeting-api/ ./
RUN chmod +x /app/entrypoint.sh
ENV PORT=8080
EXPOSE 8080
CMD ["/app/entrypoint.sh"]
