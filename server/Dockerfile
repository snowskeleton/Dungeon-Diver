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
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm ci

COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build --workspace=server   # -> server/dist/index.js, shared inlined
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
# ./client (CLIENT_DIR default is ../client relative to dist/).
RUN npm init -y >/dev/null \
  && npm install --omit=dev --no-audit --no-fund \
       colyseus@^0.15.57 express@^4.19.2 matter-js@^0.20.0

EXPOSE 2567
CMD ["node", "dist/index.js"]
