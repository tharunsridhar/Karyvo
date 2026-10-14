FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim AS app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --legacy-peer-deps
COPY server/ ./
RUN npm run build
COPY --from=web /web/dist /app/public
ENV NODE_ENV=production WEB_DIST=/app/public PORT=4000
EXPOSE 4000
# Migrations run on every start. With AUTO_SEED=true the demo data is loaded too (safe to repeat),
# which matters on hosts without a shell, like Render free.
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$AUTO_SEED\" = \"true\" ]; then npx tsx prisma/seed.ts; fi && node dist/index.js"]
