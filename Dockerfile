# Build My Church: the web app and the background worker in one image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Placeholder values only so the build can load its config; real ones come from the environment at run time.
RUN APP_URL=http://localhost:3000 DATABASE_URL=postgres://x:x@localhost/x DATABASE_ADMIN_URL=postgres://x:x@localhost/x \
    ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= BLIND_INDEX_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    SESSION_SECRET=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= NEXT_TELEMETRY_DISABLED=1 npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app /app
EXPOSE 3000
CMD ["sh", "scripts/docker-start.sh"]
