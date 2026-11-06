# projview demo image for the internal Crucible launchpad.
# Serves the bundled sample docs as a read-only web app.
# node:22-slim (Debian) - alpine's bundled npm hits "Exit handler never called"
# on mermaid's large dependency tree, leaving a half-installed node_modules.
# Pinned to a digest (the multi-arch index) so a rebuild is reproducible; bump
# it deliberately: docker buildx imagetools inspect node:22-slim
FROM node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

WORKDIR /app

# install runtime deps first for better layer caching (deterministic from lockfile).
# optional CA secret lets the build succeed behind a TLS-intercepting proxy
# (e.g. Netskope); pass it with:  docker build --secret id=cacert,src=nscacert.pem .
# it is a no-op when absent (internal builders that already trust the CA), and
# the cert is never written into an image layer.
COPY package*.json ./
RUN --mount=type=secret,id=cacert,required=false \
    sh -c 'if [ -s /run/secrets/cacert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/cacert; fi; npm ci --omit=dev --no-audit --no-fund'

COPY . .

# the launchpad standardises on port 8080; bind all interfaces for container networking
ENV HOST=0.0.0.0 \
    PORT=8080 \
    NODE_ENV=production
EXPOSE 8080

# the app only reads its own files, so it runs as the image's unprivileged
# node user - not root on a public bind. The files stay root-owned: read-only to it.
USER node

# up = the page answers. Plain node, as slim images carry no curl / wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# preview the bundled docs/ fixtures; --no-open since there's no browser in a container
CMD ["node", "bin/projview.js", "--demo", "--no-open"]
