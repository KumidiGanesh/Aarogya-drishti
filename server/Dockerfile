
FROM node:22-alpine

WORKDIR /app/server

# Copy backend package files
COPY server/package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy backend source code
COPY server/ .

# Create required storage directories
RUN mkdir -p /app/storage/private /app/backups \
    && chown -R node:node /app

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
