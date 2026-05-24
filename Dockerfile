FROM node:22-alpine

ARG APP_VERSION=0.1.0
ARG APP_COMMIT=local

LABEL org.opencontainers.image.title="NodePilot"
LABEL org.opencontainers.image.description="Docker server panel"
LABEL org.opencontainers.image.source="https://github.com/jeanparant2-coder/panel_server"

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
ENV DOCKER_SOCKET=/var/run/docker.sock
ENV APP_VERSION=$APP_VERSION
ENV APP_COMMIT=$APP_COMMIT
ENV APP_IMAGE=ghcr.io/jeanparant2-coder/panel_server:latest
ENV APP_REPO=jeanparant2-coder/panel_server

COPY package.json ./
COPY app ./app

RUN mkdir -p /data/assets /data/plugins

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "app/server.js"]
