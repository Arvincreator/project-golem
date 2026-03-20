# --- Stage 1: Base (System Dependencies) ---
FROM node:20-slim AS base

# Install system dependencies for Puppeteer (Chromium) + curl for healthcheck
# We keep these in the base because they are needed at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true \
    PLAYWRIGHT_BROWSERS_PATH=/usr/bin/chromium \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

# --- Stage 2: Builder (Build Assets) ---
FROM base AS builder
WORKDIR /app

# Copy package files for root
COPY package*.json ./
# Install all dependencies (including dev) to build web-dashboard
RUN npm install

# Copy web-dashboard package files
COPY web-dashboard/package*.json ./web-dashboard/
WORKDIR /app/web-dashboard
# Install dashboard dependencies
RUN npm install

# Copy all source code for building
WORKDIR /app
COPY . .

# Build the web-dashboard
RUN npm run build

# --- Stage 3: Runner (Production Image) ---
FROM base AS runner
WORKDIR /app

# Create a non-root user for security
RUN groupadd -r golem && useradd -r -g golem golem

# Copy production node_modules from builder (or reinstall production-only)
# Reinstalling production-only is cleaner to keep image size small
COPY package*.json ./
RUN npm ci --omit=dev

# Copy web-dashboard production node_modules
COPY web-dashboard/package*.json ./web-dashboard/
WORKDIR /app/web-dashboard
RUN npm ci --omit=dev

# Copy built assets and source code from builder
WORKDIR /app
COPY --from=builder /app/web-dashboard/.next ./web-dashboard/.next
COPY --from=builder /app/web-dashboard/public ./web-dashboard/public
COPY --from=builder /app/web-dashboard/server.js ./web-dashboard/server.js
COPY . .

# Ensure golem_memory and logs directory exist and have correct permissions
RUN mkdir -p golem_memory logs && \
    chown -R golem:golem /app

# Switch to non-root user
USER golem

# Expose the dashboard port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start the application
CMD ["npm", "run", "dashboard"]
