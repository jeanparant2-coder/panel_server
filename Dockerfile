FROM node:22-alpine

LABEL org.opencontainers.image.title="NodePilot"
LABEL org.opencontainers.image.description="Docker server panel"
LABEL org.opencontainers.image.source="https://github.com/jeanparant2-coder/panel_server"

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
ENV DOCKER_SOCKET=/var/run/docker.sock

COPY package.json ./
COPY app ./app

RUN mkdir -p /data/assets /data/plugins

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "app/server.js"]
