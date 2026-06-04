# projview demo image for the internal Crucible launchpad.
# Serves the bundled sample docs as a read-only web app.
# node:20-slim (Debian) - alpine's bundled npm hits "Exit handler never called"
# on mermaid's large dependency tree, leaving a half-installed node_modules.
FROM node:20-slim

WORKDIR /app

# install runtime deps first for better layer caching (deterministic from lockfile)
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# the launchpad standardises on port 8080; bind all interfaces for container networking
ENV HOST=0.0.0.0 \
    PORT=8080 \
    NODE_ENV=production
EXPOSE 8080

# preview the bundled docs/ fixtures; --no-open since there's no browser in a container
CMD ["node", "bin/projview.js", "--demo", "--no-open"]
