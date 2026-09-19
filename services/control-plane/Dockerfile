FROM node:22-bookworm-slim
WORKDIR /srv/control-plane
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/main.js"]
