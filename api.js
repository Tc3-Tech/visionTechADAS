class VINScannerAPI {
    constructor() {
        this.baseURL = CONFIG.API_BASE_URL;
        this.userId = CONFIG.USER_ID;
        this.isOnline = true;
        this.retryAttempts = 0;
        
        // Test server connection on startup
        this.testConnection();
    }

    async testConnection() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
            
            const response = await fetch(`${this.baseURL.replace('/api', '')}/health`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            this.isOnline = response.ok;
            console.log('Server connection:', this.isOnline ? 'Online' : 'Offline');
        } catch (error) {
            console.log('Server offline, using localStorage fallback');
            this.isOnline = false;
        }
    }

    async makeRequest(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            }
        };

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
            
            const response = await fetch(url, { 
                ...defaultOptions, 
                ...options,
                signal: controller.signal 
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                // Don't mark as offline for 404 (not found) - that's a valid response
                if (response.status !== 404) {
                    this.isOnline = false;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            this.isOnline = true;
            this.retryAttempts = 0;
            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            
            // Don't retry or go offline for 404s (not found is a valid response)
            if (error.message.includes('404')) {
                throw error;
            }
            
            // If server fails and we have offline mode enabled
            if (CONFIG.ENABLE_OFFLINE_MODE && this.retryAttempts < CONFIG.MAX_RETRY_ATTEMPTS) {
                this.retryAttempts++;
                this.isOnline = false;
                throw new Error('Server unavailable - using offline mode');
            }
            
            throw error;
        }
    }

    async getAllVehicles() {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.getLocalVehicles();
        }

        try {
            return await this.makeRequest('/vehicles');
        } catch (error) {
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                console.log('Falling back to local storage');
                return this.getLocalVehicles();
            }
            throw error;
        }
    }

    async getVehicleByVIN(vin) {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.getLocalVehicle(vin);
        }

        try {
            return await this.makeRequest(`/vehicles/${vin}`);
        } catch (error) {
            if (error.message.includes('404')) {
                // 404 is expected for new VINs - don't go offline or retry
                return null; // Vehicle not found
            }
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                console.log('Server error, falling back to local storage');
                return this.getLocalVehicle(vin);
            }
            throw error;
        }
    }

    async saveVehicle(vehicleData) {
        const payload = {
            ...vehicleData,
            user: this.userId
        };

        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.saveLocalVehicle(payload);
        }

        try {
            const result = await this.makeRequest('/vehicles', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            
            // Also save locally as backup
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                this.saveLocalVehicle(payload);
            }
            
            return result;
        } catch (error) {
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                console.log('Server unavailable, saving locally');
                return this.saveLocalVehicle(payload);
            }
            throw error;
        }
    }

    async deleteVehicle(vin) {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.deleteLocalVehicle(vin);
        }

        try {
            const result = await this.makeRequest(`/vehicles/${vin}`, {
                method: 'DELETE'
            });
            
            // Also delete locally
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                this.deleteLocalVehicle(vin);
            }
            
            return result;
        } catch (error) {
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                return this.deleteLocalVehicle(vin);
            }
            throw error;
        }
    }

    async getStats() {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.getLocalStats();
        }

        try {
            return await this.makeRequest('/stats');
        } catch (error) {
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                return this.getLocalStats();
            }
            throw error;
        }
    }

    // Local storage fallback methods
    getLocalVehicles() {
        const vehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
        return vehicles.map(v => ({
            vin: v.vin,
            status: v.status,
            notes: v.notes,
            date_added: v.dateAdded,
            last_updated: v.lastUpdated,
            created_by: v.createdBy || 'local',
            updated_by: v.updatedBy || 'local'
        }));
    }

    getLocalVehicle(vin) {
        const vehicles = this.getLocalVehicles();
        return vehicles.find(v => v.vin === vin.toUpperCase()) || null;
    }

    saveLocalVehicle(vehicleData) {
        const vehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
        const existingIndex = vehicles.findIndex(v => v.vin === vehicleData.vin);
        
        const vehicle = {
            vin: vehicleData.vin.toUpperCase(),
            status: vehicleData.status,
            notes: vehicleData.notes || '',
            lastUpdated: new Date().toISOString(),
            dateAdded: existingIndex >= 0 ? vehicles[existingIndex].dateAdded : new Date().toISOString(),
            createdBy: vehicleData.user || 'local',
            updatedBy: vehicleData.user || 'local'
        };

        if (existingIndex >= 0) {
            vehicles[existingIndex] = vehicle;
        } else {
            vehicles.push(vehicle);
        }

        localStorage.setItem('vehicles', JSON.stringify(vehicles));
        return { 
            message: existingIndex >= 0 ? 'Vehicle updated locally' : 'Vehicle saved locally',
            action: existingIndex >= 0 ? 'updated' : 'created'
        };
    }

    deleteLocalVehicle(vin) {
        const vehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
        const filteredVehicles = vehicles.filter(v => v.vin !== vin.toUpperCase());
        localStorage.setItem('vehicles', JSON.stringify(filteredVehicles));
        return { message: 'Vehicle deleted locally' };
    }

    getLocalStats() {
        const vehicles = this.getLocalVehicles();
        return {
            total: vehicles.length,
            pre_scan: vehicles.filter(v => v.status === 'pre-scan').length,
            post_scan: vehicles.filter(v => v.status === 'post-scan').length,
            calibration: vehicles.filter(v => v.status === 'calibration').length,
            completed: vehicles.filter(v => v.status === 'completed').length
        };
    }

    // Sync local data to server when connection is restored
    async syncLocalData() {
        if (!this.isOnline) return;

        const localVehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
        console.log(`Syncing ${localVehicles.length} local vehicles to server`);

        for (const vehicle of localVehicles) {
            try {
                await this.saveVehicle({
                    vin: vehicle.vin,
                    status: vehicle.status,
                    notes: vehicle.notes
                });
            } catch (error) {
                console.error('Failed to sync vehicle:', vehicle.vin, error);
            }
        }
    }
}