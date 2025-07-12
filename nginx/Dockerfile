FROM nginx:alpine

# Install certbot and dependencies
RUN apk add --no-cache certbot certbot-nginx openssl

# Create directories first
RUN mkdir -p /var/www/certbot /etc/letsencrypt/live /etc/letsencrypt/archive

# Copy all files
COPY . /tmp/nginx-config/

# Copy configurations
COPY nginx-initial.conf /etc/nginx/conf.d/default.conf
COPY nginx-ssl.conf /etc/nginx/conf.d/nginx-ssl.conf

# Copy and setup entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Debug: List files to verify they exist
RUN ls -la /entrypoint.sh && head -5 /entrypoint.sh

# Expose ports
EXPOSE 80 443

# Use custom entrypoint
ENTRYPOINT ["/entrypoint.sh"]