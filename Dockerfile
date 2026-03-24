# --- Stage 1: Base (System Dependencies) ---
# Use Playwright's official Noble (Ubuntu 24.04) image which includes GLIBC 2.39+
FROM mcr.microsoft.com/playwright:v1.50.0-noble AS base

# Install additional desktop stack dependencies (Playwright Noble already has core X11/GTK libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PLAYWRIGHT_BROWSERS_PATH=/app/pw-browsers \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

# --- Stage 2: Builder (Build Assets) ---
FROM base AS builder
WORKDIR /app

# Copy package files for root
COPY package*.json ./
# Install all dependencies (including dev)
RUN npm install

# Download Playwright Chromium browser
RUN npx playwright install chromium

# Copy web-dashboard package files
COPY web-dashboard/package*.json ./web-dashboard/
WORKDIR /app/web-dashboard
# Install dashboard dependencies
RUN NODE_ENV=development npm install

# Copy all source code for building
WORKDIR /app
COPY . .

# Build the web-dashboard
RUN npm run build

# --- Stage 3: Runner (Production Image) ---
FROM base AS runner
WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy node_modules from builder to ensure binary compatibility (GLIBC)
COPY --from=builder /app/node_modules ./node_modules

# Copy web-dashboard files
COPY web-dashboard/package*.json ./web-dashboard/
COPY --from=builder /app/web-dashboard/node_modules ./web-dashboard/node_modules

# Copy built assets and source code from builder
COPY --from=builder /app/web-dashboard/.next ./web-dashboard/.next
COPY --from=builder /app/web-dashboard/out ./web-dashboard/out
COPY --from=builder /app/web-dashboard/public ./web-dashboard/public
COPY --from=builder /app/web-dashboard/server.js ./web-dashboard/server.js
COPY --from=builder /app/pw-browsers /app/pw-browsers
COPY . .
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Ensure golem_memory and logs directory exist and have correct permissions
RUN mkdir -p golem_memory logs && \
    chmod +x /usr/local/bin/docker-entrypoint.sh && \
    chown -R ubuntu:ubuntu /app

# Use the default 'ubuntu' user provided by the base image (UID 1000)
USER ubuntu

# Expose the dashboard port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Optional desktop stack (Xvfb + x11vnc + noVNC) is started by entrypoint when GOLEM_DESKTOP_MODE=true
ENTRYPOINT ["docker-entrypoint.sh"]

# Start the application
CMD ["npm", "run", "dashboard"]
