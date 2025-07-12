# VIN Scanner - Team Vehicle Tracking System

A mobile-first web application for scanning and tracking vehicle VINs with team collaboration features.

## Features

- 📱 **Mobile VIN Scanning** - Camera-based OCR for automatic VIN detection
- ✏️ **Manual Entry** - Backup option when OCR fails
- 🔄 **Real-time Sync** - Share data across team members instantly
- ⚠️ **Duplicate Detection** - Prevent multiple people working on same vehicle
- 📊 **Status Tracking** - Pending → In Progress → Completed workflow
- 🌐 **Offline Support** - Works without internet, syncs when connection restored
- 🏠 **Self-hosted** - Run on your own server, no monthly costs

## Quick Start with Docker

### Prerequisites
- Docker and Docker Compose installed on your server
- Port 3000 available
- Domain name or dynamic DNS (optional but recommended)

### Installation

1. **Clone or download the project files to your server**

2. **Build and start the container:**
```bash
cd vinScan
docker-compose up -d
```

3. **Access the application:**
- Local: `http://localhost:3000`
- Network: `http://YOUR_SERVER_IP:3000`
- With domain: `http://yourdomain.com:3000`

4. **Test the API:**
```bash
curl http://localhost:3000/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Network Setup for Remote Access

**For team access from phones/other devices:**

1. **Port Forward (Router Configuration):**
   - Forward external port 3000 → internal port 3000 to your server
   - Or use different external port: 8080 → 3000

2. **Dynamic DNS (Recommended):**
   - Use services like DuckDNS, No-IP, or others
   - Point your domain to your public IP
   - Access via: `http://yourdomain.duckdns.org:3000`

3. **Firewall Configuration:**
   ```bash
   # Ubuntu/Debian
   sudo ufw allow 3000
   
   # CentOS/RHEL
   sudo firewall-cmd --permanent --add-port=3000/tcp
   sudo firewall-cmd --reload
   ```

## Development Setup

**Frontend Development (Vercel):**
- The frontend runs on Vercel: `https://your-project.vercel.app`
- Update `config.js` to point to your server IP/domain
- Frontend automatically detects server availability

**Local Development:**
```bash
# Start server locally
cd server
npm install
npm start

# Access at http://localhost:3000
```

## API Endpoints

- `GET /health` - Health check
- `GET /api/vehicles` - Get all vehicles
- `GET /api/vehicles/:vin` - Get specific vehicle
- `POST /api/vehicles` - Add/update vehicle
- `DELETE /api/vehicles/:vin` - Delete vehicle
- `GET /api/stats` - Get statistics

## Configuration

**Server Configuration:**
- Database: SQLite stored in Docker volume
- Port: 3000 (configurable via PORT env var)
- CORS: Enabled for all origins
- Rate limiting: 100 requests per 15 minutes per IP

**Frontend Configuration (config.js):**
```javascript
const CONFIG = {
    API_BASE_URL: 'http://YOUR_SERVER:3000/api',
    ENABLE_OFFLINE_MODE: true,
    AUTO_REFRESH_INTERVAL: 30000
};
```

## Data Management

**Database Location:**
- Container: `/data/vehicles.db`
- Host: Docker volume `vin_data`

**Backup Database:**
```bash
# Create backup
docker cp vin-scanner-server:/data/vehicles.db ./backup-$(date +%Y%m%d).db

# Restore backup
docker cp ./backup-20231201.db vin-scanner-server:/data/vehicles.db
docker restart vin-scanner-server
```

**Export Data:**
```bash
# Export to CSV
sqlite3 /path/to/vehicles.db ".mode csv" ".output vehicles.csv" "SELECT * FROM vehicles;"
```

## Troubleshooting

**Container won't start:**
```bash
docker logs vin-scanner-server
```

**Database issues:**
```bash
# Reset database (WARNING: deletes all data)
docker-compose down
docker volume rm vinscan_vin_data
docker-compose up -d
```

**Network connectivity:**
```bash
# Test from another device
curl http://YOUR_SERVER_IP:3000/health

# Check if port is open
nmap -p 3000 YOUR_SERVER_IP
```

**Frontend can't connect to server:**
1. Check `config.js` has correct server URL
2. Verify server is running: `docker ps`
3. Check firewall/port forwarding
4. Try accessing server URL directly in browser

## Security Considerations

- Change default port if exposing to internet
- Consider adding authentication for production use
- Use HTTPS in production (add reverse proxy like nginx)
- Regular database backups
- Monitor server logs for unusual activity

## License

MIT License - use freely for personal and commercial projects.