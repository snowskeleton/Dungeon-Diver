# --- build: bundle the server (shared/ inlined by esbuild) + build the client --
FROM node:20-slim AS build
WORKDIR /app

# node:20-slim ships npm 10, but package-lock.json is written by npm 11 and npm 10
# rejects it ("Missing esbuild@0.28.1 from lock file" — it re-resolves vitest's
# bundled vite differently). Match the npm that generated the lock.
RUN npm install -g npm@11

# Install the full workspace graph so `shared` resolves for both builds.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY engine/package.json ./engine/
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm ci

COPY shared ./shared
COPY engine ./engine
COPY server ./server
COPY client ./client
RUN npm run build --workspace=server   # -> server/dist/index.js, shared inlined
# The client bundles the engine (authoritative sim) via the @engine alias, so engine/
# must be present above for vite to resolve it.
RUN npm run build --workspace=client   # -> client/dist (static site)

# --- runtime: the bundle + its externalized deps, serving the client too --------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=2567

COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist ./client
# The bundle externalizes these (see server/package.json build script); everything
# else — including all of shared/ — is baked into dist/index.js. The server serves
# ./client (CLIENT_DIR default is ../client relative to dist/) and runs the P2P
# signaling relay. It holds no game code, so no engine deps here.
RUN npm init -y >/dev/null \
  && npm install --omit=dev --no-audit --no-fund \
       express@^4.19.2 ws@^8.18.0

EXPOSE 2567
CMD ["node", "dist/index.js"]
