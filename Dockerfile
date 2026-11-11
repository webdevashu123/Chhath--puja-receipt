# ==========================================
# Production Dockerfile for Chhath Puja Portal
# Node 20 + Chromium + Noto Fonts for Puppeteer
# ==========================================

FROM node:20-bookworm-slim

# Install Chromium and Indian & Noto fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-core \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-indic \
    fonts-deva-extra \
    ca-certificates \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Point Puppeteer to the system Chromium binary
ENV CHROME_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=production \
    PORT=5000

WORKDIR /app

# Install package dependencies
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Build Vite frontend for production
RUN npm run build

# Prune devDependencies to keep container lean
RUN npm prune --omit=dev

# Create and persist data directories
RUN mkdir -p data/receipts data/backups

# Expose server port
EXPOSE 5000

# Use dumb-init to handle PID 1 signal forwarding and zombie reap for Puppeteer
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["npx", "tsx", "server/index.ts"]
