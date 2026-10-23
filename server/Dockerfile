# Build from the repository root: docker build -f server/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/shared src/shared
COPY server server
RUN npx esbuild server/index.ts --bundle --platform=node --target=node22 --outfile=dist/server.js

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist/server.js ./server.js
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server.js"]
