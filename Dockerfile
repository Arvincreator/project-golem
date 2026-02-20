# Base image with Node.js 20 (Slim version for smaller size & multi-arch support)
FROM node:20-slim

# Install system dependencies for Puppeteer (Chromium)
RUN apt-get update && apt-get install -y \
    chromium \
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

# Set working directory
WORKDIR /app

# Copy root package files
COPY package*.json ./

# Skip downloading Chrome and use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install root production dependencies
RUN npm ci --omit=dev

# Copy web-dashboard package files
COPY web-dashboard/package*.json ./web-dashboard/

# Install web-dashboard dependencies
WORKDIR /app/web-dashboard
RUN npm ci

# Copy web-dashboard source code (This depends on what is needed for build)
# We copy the whole directory, relying on .dockerignore to exclude node_modules
COPY web-dashboard ./

# Build web-dashboard
# Ensure next build works in this environment
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Switch back to root app directory
WORKDIR /app

# Copy the rest of the application source code
COPY . .

# Expose the dashboard port
EXPOSE 3000

# Start the application in dashboard mode
CMD ["npm", "run", "dashboard"]
