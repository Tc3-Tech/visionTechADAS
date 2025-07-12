FROM nginx:alpine

# Copy nginx configuration
COPY nginx-initial.conf /etc/nginx/conf.d/default.conf

# Create directory for certbot webroot
RUN mkdir -p /var/www/certbot

# Expose ports
EXPOSE 80 443