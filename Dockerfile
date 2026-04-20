ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev --ignore-scripts

FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian12:nonroot
WORKDIR /app
COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/dist ./dist
COPY --from=builder --chown=nonroot:nonroot /app/package.json ./package.json
ENV NODE_ENV=production \
    SF_METRICS_PORT=9090 \
    SF_METRICS_BIND=0.0.0.0
EXPOSE 9090
USER nonroot
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD ["/nodejs/bin/node","-e","fetch('http://127.0.0.1:'+ (process.env.SF_METRICS_PORT||9090) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["dist/index.js"]
