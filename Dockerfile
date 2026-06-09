# projview demo image for the internal Crucible launchpad.
# Serves the bundled sample docs as a read-only web app.
# node:20-slim (Debian) - alpine's bundled npm hits "Exit handler never called"
# on mermaid's large dependency tree, leaving a half-installed node_modules.
FROM node:22-slim

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

# preview the bundled docs/ fixtures; --no-open since there's no browser in a container
CMD ["node", "bin/projview.js", "--demo", "--no-open"]
