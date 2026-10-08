FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
ARG VITE_ALLOWED_EMAILS=abdulrhman@farq.sa
ENV VITE_ALLOWED_EMAILS=$VITE_ALLOWED_EMAILS
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.py ./
ENV PORT=8080
EXPOSE 8080
CMD ["python3", "server.py"]
