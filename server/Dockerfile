
FROM node:22-alpine

WORKDIR /app/server

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/storage/private /app/backups \
    && chown -R node:node /app

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
