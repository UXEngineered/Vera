FROM oven/bun:1.3 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json vera.config.json ./
COPY src ./src
COPY prompts ./prompts
COPY examples ./examples
COPY evals ./evals

ENV NODE_ENV=production \
    PORT=3000 \
    TRUST_PROXY=1 \
    VERA_TRACE=console
EXPOSE 3000
USER bun
CMD ["bun", "src/server/index.ts"]
