FROM node:22-slim

RUN apt-get update && apt-get install -y git curl procps python3 make g++ cron && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

ENV PATH="/app/node_modules/.bin:$PATH"

COPY . .

RUN mkdir -p /data
RUN chmod +x scripts/setup.sh
RUN cp scripts/systemctl /usr/local/bin/systemctl && chmod +x /usr/local/bin/systemctl

EXPOSE 3000

CMD ["./scripts/setup.sh"]
