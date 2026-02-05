FROM oven/bun:latest

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Run the application
CMD ["bun", "run", "index.ts"]
