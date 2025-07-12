#!/bin/sh

DOMAIN="visiontechadas.duckdns.org"
EMAIL="${LETSENCRYPT_EMAIL:-admin@example.com}"

echo "🚀 Starting VIN Scanner nginx with SSL setup..."
echo "📧 Email: $EMAIL"
echo "🌐 Domain: $DOMAIN"

# Start nginx in background with initial HTTP-only config
nginx -g "daemon off;" &
NGINX_PID=$!

# Wait for nginx to start
sleep 5

# Check if certificate already exists
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo "📜 Requesting SSL certificate from Let's Encrypt..."
    
    # Request certificate
    certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email $EMAIL \
        --agree-tos \
        --no-eff-email \
        --force-renewal \
        -d $DOMAIN
    
    if [ $? -eq 0 ]; then
        echo "✅ SSL certificate obtained successfully!"
        
        # Switch to SSL configuration
        echo "🔄 Switching to HTTPS configuration..."
        cp /etc/nginx/conf.d/nginx-ssl.conf /etc/nginx/conf.d/default.conf
        
        # Reload nginx with SSL config
        nginx -s reload
        
        echo "🎉 HTTPS is now active!"
    else
        echo "❌ Failed to obtain SSL certificate, continuing with HTTP only"
    fi
else
    echo "✅ SSL certificate already exists"
    echo "🔄 Using HTTPS configuration..."
    cp /etc/nginx/conf.d/nginx-ssl.conf /etc/nginx/conf.d/default.conf
    nginx -s reload
fi

# Setup certificate renewal
echo "⏰ Setting up certificate auto-renewal..."
echo "0 12 * * * /usr/bin/certbot renew --quiet && /usr/sbin/nginx -s reload" | crontab -

# Start cron daemon
crond

# Wait for nginx process
wait $NGINX_PID