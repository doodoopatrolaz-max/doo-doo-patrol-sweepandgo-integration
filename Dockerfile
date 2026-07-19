FROM node:24-slim AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
COPY public ./public
COPY SWEEPANDGO_FIELD_MAP.md ./SWEEPANDGO_FIELD_MAP.md
COPY GOHIGHLEVEL_FIELD_MAP.md ./GOHIGHLEVEL_FIELD_MAP.md

EXPOSE 3000
CMD ["node", "--experimental-strip-types", "src/server.ts"]
