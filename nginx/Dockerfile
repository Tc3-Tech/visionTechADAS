FROM nginx:alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Copy nginx configuration for HTTP with CORS
COPY nginx-http.conf /etc/nginx/conf.d/default.conf

# Create webroot directory
RUN mkdir -p /var/www/html

# Expose port 80
EXPOSE 80

# Start nginx normally
CMD ["nginx", "-g", "daemon off;"]