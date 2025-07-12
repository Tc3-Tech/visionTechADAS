# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory in container
WORKDIR /app

# Create data directory for SQLite database
RUN mkdir -p /data && chmod 755 /data

# Copy package.json and package-lock.json (if available)
COPY server/package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy server source code
COPY server/ .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S vinscanner -u 1001 && \
    chown -R vinscanner:nodejs /app /data

# Switch to non-root user
USER vinscanner

# Expose port 3000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the server
CMD ["npm", "start"]