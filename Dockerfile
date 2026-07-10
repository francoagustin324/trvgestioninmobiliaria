FROM mcr.microsoft.com/playwright:v1.61.0-noble

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app

COPY package.json ./
RUN npm install --include=dev

COPY . .
RUN npm run build && chown -R pwuser:pwuser /app

ENV NODE_ENV=production
USER pwuser
EXPOSE 4173
CMD ["npm", "start"]
