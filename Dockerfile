FROM node:22-bookworm-slim AS app
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_ENABLE_DEMO=false
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY VITE_ENABLE_DEMO=$VITE_ENABLE_DEMO
RUN npm run build
ENV NODE_ENV=production PORT=3001
USER node
EXPOSE 3001
CMD ["npm","start"]

FROM app AS browser-worker
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install-deps chromium
RUN PLAYWRIGHT_BROWSERS_PATH=/ms-playwright npx playwright install chromium && chmod -R a+rX /ms-playwright
USER node
CMD ["npm","run","worker"]
