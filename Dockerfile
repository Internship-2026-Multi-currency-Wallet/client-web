# syntax=docker/dockerfile:1

# ---- build: compile the static app ----
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Build-time configuration (see src/config-env.ts). Vite inlines VITE_* values.
ARG VITE_APP_ENV=local
ARG VITE_CLIENT=
ARG VITE_WALLET_CORE_URL=
ARG VITE_RATES_SERVICE_URL=
ARG VITE_RATES_SERVICE_WS_URL=
ARG VITE_USE_MOCKS=false
ARG VITE_DEV_USER=
RUN npm run build

# ---- runtime: nginx serving static files, non-root ----
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
