FROM node:22-slim

RUN apt-get update && apt-get install -y git curl procps python3 make g++ cron && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --prefer-online && npm cache clean --force

ENV PATH="/app/node_modules/.bin:$PATH"
ENV ALPHACLAW_ROOT_DIR=/data

RUN mkdir -p /data

EXPOSE 8080

CMD ["alphaclaw", "start"]
