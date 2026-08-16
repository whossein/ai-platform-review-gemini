FROM node:22-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json if available
COPY package*.json ./
COPY turbo.json ./

# Copy workspace package.json files
COPY apps/web/package.json ./apps/web/
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
COPY packages/api/package.json ./packages/api/
COPY packages/config/package.json ./packages/config/
COPY packages/context-engine/package.json ./packages/context-engine/
COPY packages/core/package.json ./packages/core/
COPY packages/git/package.json ./packages/git/
COPY packages/llm/package.json ./packages/llm/
COPY packages/memory/package.json ./packages/memory/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/prompts/package.json ./packages/prompts/
COPY packages/reporting/package.json ./packages/reporting/
COPY packages/repository/package.json ./packages/repository/
COPY packages/shared/package.json ./packages/shared/
COPY packages/skills/package.json ./packages/skills/
COPY packages/tools/package.json ./packages/tools/
COPY packages/ui/package.json ./packages/ui/
COPY packages/workflow-engine/package.json ./packages/workflow-engine/

# Copy the rest of the application code
COPY . .

# Install all dependencies and build the project
RUN npm install
RUN npm run build

# Stage 2: Production environment
FROM node:22-alpine AS runner

WORKDIR /app

# Copy the built output and node_modules from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
