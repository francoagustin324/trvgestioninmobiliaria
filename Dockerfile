FROM mcr.microsoft.com/playwright:v1.61.0-noble

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build && chown -R pwuser:pwuser /app

USER pwuser
EXPOSE 4173
CMD ["npm", "start"]
