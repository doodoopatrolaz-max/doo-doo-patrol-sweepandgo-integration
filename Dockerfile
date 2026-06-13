FROM node:24-slim AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY migrations ./migrations

EXPOSE 3000
CMD ["node", "--experimental-strip-types", "src/server.ts"]
