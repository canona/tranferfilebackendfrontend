FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# config/channel-registry.json là dữ liệu vận hành thật, KHÔNG có trong image
# (xem .gitignore) - mount volume vào đây lúc chạy container (xem hướng dẫn deploy).
RUN mkdir -p /app/config

EXPOSE 8080 8081
CMD ["node", "dist/app/main.js"]
