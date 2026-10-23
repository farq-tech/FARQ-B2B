FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py market_analytics.py trial_search.py contact_lookup.py buyer_review.py directory_tiles.py status_policy.py taxonomy_search.py data_paths.py release_data.py build_release_manifest.py entrypoint.sh index.html ./
RUN chmod 0555 entrypoint.sh && mkdir -p /var/lib/farq-targeting
ENV PORT=8080
EXPOSE 8080
CMD ["./entrypoint.sh"]
