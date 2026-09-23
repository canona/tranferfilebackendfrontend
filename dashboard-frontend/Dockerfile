FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# NEXT_PUBLIC_* được nhúng vào bundle NGAY LÚC BUILD (không phải lúc chạy) -
# PHẢI truyền qua build-arg đúng giá trị production trước khi build.
ARG NEXT_PUBLIC_DASHBOARD_UI_WS_URL
ENV NEXT_PUBLIC_DASHBOARD_UI_WS_URL=$NEXT_PUBLIC_DASHBOARD_UI_WS_URL
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.mjs ./next.config.mjs

EXPOSE 3000
CMD ["npm", "start"]
