# Production image. Run the web app with the default command and the worker with `npm run worker`.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
RUN useradd -r -u 1001 bmc && mkdir -p storage && chown bmc storage
USER bmc
EXPOSE 3000
CMD ["npm", "start"]
