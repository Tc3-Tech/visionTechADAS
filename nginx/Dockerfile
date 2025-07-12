FROM nginx:alpine

# Install certbot and dependencies
RUN apk add --no-cache certbot certbot-nginx openssl

# Copy initial nginx configuration (HTTP only for certificate request)
COPY nginx-initial.conf /etc/nginx/conf.d/default.conf

# Copy SSL-enabled configuration (will be used after certificate generation)
COPY nginx-ssl.conf /etc/nginx/conf.d/nginx-ssl.conf

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create directories
RUN mkdir -p /var/www/certbot /etc/letsencrypt/live /etc/letsencrypt/archive

# Expose ports
EXPOSE 80 443

# Use custom entrypoint
ENTRYPOINT ["/entrypoint.sh"]