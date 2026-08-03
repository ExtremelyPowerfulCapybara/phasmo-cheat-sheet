FROM node:20-alpine

WORKDIR /app

# Copy server package files and install dependencies
COPY server/package*.json ./

RUN npm ci --omit=dev

# Copy server source code
COPY server/ ./server/

# Copy static files from repo root that the server will serve
COPY index.html ./
COPY scripts-v10/ ./scripts-v10/
COPY imgs/ ./imgs/
COPY wiki-v10/ ./wiki-v10/
COPY styles/ ./styles/
COPY fonts/ ./fonts/
COPY sounds/ ./sounds/

# Ensure data directory exists for persistent storage
RUN mkdir -p /app/server/data

EXPOSE 3000

CMD ["node", "server/server.js"]
