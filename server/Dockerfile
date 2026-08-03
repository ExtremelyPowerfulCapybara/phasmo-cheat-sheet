FROM node:20-alpine

WORKDIR /app

# Copy server package files and install dependencies
COPY server/package*.json ./

RUN npm ci --omit=dev

# Copy server source code
COPY server/ ./server/

# Copy static files from repo root that the server will serve
COPY index.html ./
COPY jquery/ ./jquery/
COPY scripts-v10/ ./scripts-v10/
COPY styles-v10/ ./styles-v10/
COPY themes-v10/ ./themes-v10/
COPY login-v10/ ./login-v10/
COPY wiki-v10/ ./wiki-v10/
COPY events-v10/ ./events-v10/
COPY models-v10/ ./models-v10/
COPY partners-v10/ ./partners-v10/
COPY feed-v10/ ./feed-v10/
COPY imgs/ ./imgs/
COPY info/ ./info/
COPY assets/ ./assets/
COPY mini/ ./mini/
COPY copyShare.js ./

# Ensure data directory exists for persistent storage
RUN mkdir -p /app/server/data

EXPOSE 3000

CMD ["node", "server/server.js"]
