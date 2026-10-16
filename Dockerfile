FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
ARG VITE_ALLOWED_EMAILS=abdulrhman@farq.sa
ENV VITE_ALLOWED_EMAILS=$VITE_ALLOWED_EMAILS
# Mapbox public token (pk.…) for the targeting map; unset = the drawn map
ARG VITE_MAPBOX_TOKEN=
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
# scheduled sends store (Postgres); imported only when TARGETING_SCHEDULE_ENABLED=1
RUN pip install --no-cache-dir 'psycopg[binary]==3.2.*'
COPY server.py trial.py saudi_rhythm.py schedule.py session_cookie.py ./
ENV PORT=8080
EXPOSE 8080
CMD ["python3", "server.py"]
