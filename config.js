// Configuration for VIN Scanner
const CONFIG = {
    // Server configuration
    API_BASE_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api'  // Development
        : 'https://visiontechadas.duckdns.org/api',  // Production (HTTPS port 443)
    
    // Fallback to localStorage if server is unavailable
    ENABLE_OFFLINE_MODE: true,
    
    // User identification (you can customize this)
    USER_ID: 'user_' + Math.random().toString(36).substr(2, 9),
    
    // App settings
    AUTO_REFRESH_INTERVAL: 60000, // 60 seconds (reduced frequency)
    MAX_RETRY_ATTEMPTS: 2, // reduced from 3 to 2
    REQUEST_TIMEOUT: 10000 // 10 seconds
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
} else {
    window.CONFIG = CONFIG;
}