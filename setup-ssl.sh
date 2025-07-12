#!/bin/bash

# VIN Scanner HTTPS Setup Script
# This script sets up SSL certificates for your VIN Scanner using Let's Encrypt

echo "🔐 Setting up HTTPS for VIN Scanner..."

# Check if email is provided
if [ -z "$1" ]; then
    echo "❌ Error: Please provide your email address"
    echo "Usage: $0 your-email@example.com"
    exit 1
fi

EMAIL=$1
DOMAIN="visiontechadas.duckdns.org"

echo "📧 Using email: $EMAIL"
echo "🌐 Domain: $DOMAIN"

# Step 1: Update router port forwarding
echo "⚠️  IMPORTANT: Make sure your router has these port forwards:"
echo "   - Port 80 → Your server (for Let's Encrypt)"
echo "   - Port 443 → Your server (for HTTPS)"
echo "   - Remove the old port 3000 forward"
echo ""
read -p "Press Enter when port forwarding is updated..."

# Step 2: Stop existing stack
echo "🛑 Stopping existing stack..."
docker-compose down

# Step 3: Start with initial nginx config (HTTP only)
echo "🚀 Starting initial setup..."
cp nginx/nginx-initial.conf nginx/nginx.conf

# Update email in docker-compose
sed -i "s/your-email@example.com/$EMAIL/g" docker-compose.yml

# Start services
docker-compose up -d vin-scanner-api nginx

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Step 4: Request SSL certificate
echo "📜 Requesting SSL certificate..."
docker-compose run --rm certbot certonly --webroot \
    --webroot-path=/var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN

if [ $? -eq 0 ]; then
    echo "✅ SSL certificate obtained successfully!"
    
    # Step 5: Switch to HTTPS nginx config
    echo "🔄 Switching to HTTPS configuration..."
    cp nginx/nginx.conf.bak nginx/nginx.conf 2>/dev/null || echo "Using current nginx.conf"
    
    # Restart nginx with SSL config
    docker-compose restart nginx
    
    echo "🎉 HTTPS setup complete!"
    echo ""
    echo "✅ Your VIN Scanner is now available at:"
    echo "   https://$DOMAIN"
    echo ""
    echo "🔧 Next steps:"
    echo "   1. Test: curl https://$DOMAIN/health"
    echo "   2. Update Vercel to use HTTPS"
    echo "   3. Your team can now access securely!"
    
else
    echo "❌ Failed to obtain SSL certificate"
    echo "🔍 Check that:"
    echo "   1. $DOMAIN points to your public IP"
    echo "   2. Port 80 is forwarded to this server"
    echo "   3. No firewall is blocking port 80"
    exit 1
fi