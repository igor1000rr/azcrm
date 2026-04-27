FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation fonts-noto-color-emoji \
    libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libdrm2 libgbm1 libgtk-3-0 libxcomposite1 libxdamage1 libxrandr2 \
    libxshmfence1 libpango-1.0-0 libcairo2 \
    ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

EXPOSE 3100
CMD ["node", "index.js"]
