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

    // Customer API methods
    async getAllCustomers() {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.getLocalCustomers();
        }

        try {
            return await this.makeRequest('/customers');
        } catch (error) {
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                console.log('Falling back to local storage for customers');
                return this.getLocalCustomers();
            }
            throw error;
        }
    }

    async addCustomer(name) {
        const payload = {
            name: name.trim(),
            user: this.userId
        };

        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.saveLocalCustomer(payload);
        }

        try {
            const result = await this.makeRequest('/customers', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            
            // Also save locally as backup
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                this.saveLocalCustomer(payload);
            }
            
            return result;
        } catch (error) {
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                console.log('Server unavailable, saving customer locally');
                return this.saveLocalCustomer(payload);
            }
            throw error;
        }
    }

    async deleteCustomer(customerId) {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.deleteLocalCustomer(customerId);
        }

        try {
            const result = await this.makeRequest(`/customers/${customerId}`, {
                method: 'DELETE'
            });
            
            // Also delete locally
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                this.deleteLocalCustomer(customerId);
            }
            
            return result;
        } catch (error) {
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                return this.deleteLocalCustomer(customerId);
            }
            throw error;
        }
    }

    // Vehicle API methods (updated for new schema)
    async getAllVehicles(customerId = null, dateStart = null, dateEnd = null) {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.getLocalVehicles(customerId, dateStart, dateEnd);
        }

        try {
            let endpoint = '/vehicles';
            const params = new URLSearchParams();
            
            if (customerId) params.append('customer_id', customerId);
            if (dateStart) params.append('date_start', dateStart);
            if (dateEnd) params.append('date_end', dateEnd);
            
            if (params.toString()) {
                endpoint += '?' + params.toString();
            }
            
            return await this.makeRequest(endpoint);
        } catch (error) {
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                console.log('Falling back to local storage for vehicles');
                return this.getLocalVehicles(customerId, dateStart, dateEnd);
            }
            throw error;
        }
    }

    async searchVehicle(identifier) {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.getLocalVehicleByIdentifier(identifier);
        }

        try {
            return await this.makeRequest(`/vehicles/search/${encodeURIComponent(identifier)}`);
        } catch (error) {
            if (error.message.includes('404')) {
                // 404 is expected for new vehicles - don't go offline or retry
                return null; // Vehicle not found
            }
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                console.log('Server error, falling back to local storage');
                return this.getLocalVehicleByIdentifier(identifier);
            }
            throw error;
        }
    }

    async getVehicleById(vehicleId) {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.getLocalVehicleById(vehicleId);
        }

        try {
            return await this.makeRequest(`/vehicles/id/${vehicleId}`);
        } catch (error) {
            if (error.message.includes('404')) {
                return null; // Vehicle not found
            }
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                console.log('Server error, falling back to local storage');
                return this.getLocalVehicleById(vehicleId);
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
                console.log('Server unavailable, saving vehicle locally');
                return this.saveLocalVehicle(payload);
            }
            throw error;
        }
    }

    async deleteVehicle(vehicleId) {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.deleteLocalVehicle(vehicleId);
        }

        try {
            const result = await this.makeRequest(`/vehicles/${vehicleId}`, {
                method: 'DELETE'
            });
            
            // Also delete locally
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                this.deleteLocalVehicle(vehicleId);
            }
            
            return result;
        } catch (error) {
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                return this.deleteLocalVehicle(vehicleId);
            }
            throw error;
        }
    }

    // Export functionality
    async exportCustomerData(customerId, dateStart = null, dateEnd = null) {
        if (!this.isOnline && CONFIG.ENABLE_OFFLINE_MODE) {
            return this.getLocalExportData(customerId, dateStart, dateEnd);
        }

        try {
            const payload = {
                customer_id: customerId,
                date_start: dateStart,
                date_end: dateEnd
            };

            return await this.makeRequest('/vehicles/export', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        } catch (error) {
            if (CONFIG.ENABLE_OFFLINE_MODE) {
                console.log('Server unavailable, generating local export data');
                return this.getLocalExportData(customerId, dateStart, dateEnd);
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

    // Local storage fallback methods for customers
    getLocalCustomers() {
        const customers = JSON.parse(localStorage.getItem('customers') || '[]');
        return customers.map((c, index) => ({
            id: c.id || index + 1,
            name: c.name,
            date_added: c.dateAdded || new Date().toISOString(),
            created_by: c.createdBy || 'local'
        }));
    }

    saveLocalCustomer(customerData) {
        const customers = JSON.parse(localStorage.getItem('customers') || '[]');
        const existingIndex = customers.findIndex(c => c.name.toLowerCase() === customerData.name.toLowerCase());
        
        if (existingIndex >= 0) {
            throw new Error('Customer already exists');
        }

        const customer = {
            id: Date.now(), // Simple ID generation for local storage
            name: customerData.name,
            dateAdded: new Date().toISOString(),
            createdBy: customerData.user || 'local'
        };

        customers.push(customer);
        localStorage.setItem('customers', JSON.stringify(customers));
        
        return { 
            id: customer.id,
            name: customer.name,
            message: 'Customer saved locally'
        };
    }

    deleteLocalCustomer(customerId) {
        const customers = JSON.parse(localStorage.getItem('customers') || '[]');
        const vehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
        
        // Check if customer has vehicles
        const customerVehicles = vehicles.filter(v => v.customerId == customerId);
        if (customerVehicles.length > 0) {
            throw new Error('Cannot delete customer with existing vehicles');
        }
        
        const filteredCustomers = customers.filter(c => c.id != customerId);
        localStorage.setItem('customers', JSON.stringify(filteredCustomers));
        return { message: 'Customer deleted locally' };
    }

    // Local storage fallback methods for vehicles (updated)
    getLocalVehicles(customerId = null, dateStart = null, dateEnd = null) {
        const vehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
        const customers = this.getLocalCustomers();
        
        let filteredVehicles = vehicles;
        
        if (customerId) {
            filteredVehicles = filteredVehicles.filter(v => v.customerId == customerId);
        }
        
        if (dateStart) {
            filteredVehicles = filteredVehicles.filter(v => {
                const vehicleDate = new Date(v.dateAdded || v.date_added);
                return vehicleDate >= new Date(dateStart);
            });
        }
        
        if (dateEnd) {
            filteredVehicles = filteredVehicles.filter(v => {
                const vehicleDate = new Date(v.dateAdded || v.date_added);
                return vehicleDate <= new Date(dateEnd);
            });
        }
        
        return filteredVehicles.map(v => {
            const customer = customers.find(c => c.id == v.customerId);
            return {
                id: v.id || Date.now(),
                vin: v.vin || null,
                repair_order: v.repairOrder || v.repair_order || null,
                customer_id: v.customerId || v.customer_id,
                customer_name: customer ? customer.name : 'Unknown Customer',
                status: v.status,
                notes: v.notes || '',
                date_added: v.dateAdded || v.date_added || new Date().toISOString(),
                last_updated: v.lastUpdated || v.last_updated || new Date().toISOString(),
                created_by: v.createdBy || v.created_by || 'local',
                updated_by: v.updatedBy || v.updated_by || 'local'
            };
        });
    }

    getLocalVehicleByIdentifier(identifier) {
        const vehicles = this.getLocalVehicles();
        return vehicles.find(v => 
            (v.vin && v.vin.toUpperCase() === identifier.toUpperCase()) ||
            (v.repair_order && v.repair_order.toUpperCase() === identifier.toUpperCase())
        ) || null;
    }

    getLocalVehicleById(vehicleId) {
        const vehicles = this.getLocalVehicles();
        return vehicles.find(v => v.id == vehicleId) || null;
    }

    saveLocalVehicle(vehicleData) {
        const vehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
        const existingIndex = vehicles.findIndex(v => 
            (vehicleData.vin && v.vin === vehicleData.vin && v.customerId == vehicleData.customer_id) ||
            (vehicleData.repair_order && v.repairOrder === vehicleData.repair_order && v.customerId == vehicleData.customer_id)
        );
        
        const vehicle = {
            id: existingIndex >= 0 ? vehicles[existingIndex].id : Date.now(),
            vin: vehicleData.vin ? vehicleData.vin.toUpperCase() : null,
            repairOrder: vehicleData.repair_order || null,
            customerId: vehicleData.customer_id,
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

    deleteLocalVehicle(vehicleId) {
        const vehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
        const filteredVehicles = vehicles.filter(v => v.id != vehicleId);
        localStorage.setItem('vehicles', JSON.stringify(filteredVehicles));
        return { message: 'Vehicle deleted locally' };
    }

    getLocalExportData(customerId, dateStart = null, dateEnd = null) {
        const customers = this.getLocalCustomers();
        const customer = customers.find(c => c.id == customerId);
        
        if (!customer) {
            throw new Error('Customer not found');
        }
        
        const vehicles = this.getLocalVehicles(customerId, dateStart, dateEnd);
        
        return {
            customer: customer.name,
            vehicles: vehicles.map(v => ({
                vin: v.vin,
                repair_order: v.repair_order,
                status: v.status,
                notes: v.notes,
                date_added: v.date_added,
                last_updated: v.last_updated
            })),
            date_range: {
                start: dateStart,
                end: dateEnd
            },
            generated_at: new Date().toISOString()
        };
    }

    getLocalStats() {
        const vehicles = this.getLocalVehicles();
        return {
            total: vehicles.length,
            'pre-scan': vehicles.filter(v => v.status === 'pre-scan').length,
            'post-scan': vehicles.filter(v => v.status === 'post-scan').length,
            calibration: vehicles.filter(v => v.status === 'calibration').length,
            completed: vehicles.filter(v => v.status === 'completed').length
        };
    }

    // Sync local data to server when connection is restored
    async syncLocalData() {
        if (!this.isOnline) return;

        console.log('Syncing local data to server...');
        
        // Sync customers first
        const localCustomers = JSON.parse(localStorage.getItem('customers') || '[]');
        for (const customer of localCustomers) {
            try {
                await this.addCustomer(customer.name);
            } catch (error) {
                console.error('Failed to sync customer:', customer.name, error);
            }
        }
        
        // Then sync vehicles
        const localVehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
        for (const vehicle of localVehicles) {
            try {
                await this.saveVehicle({
                    vin: vehicle.vin,
                    repair_order: vehicle.repairOrder,
                    customer_id: vehicle.customerId,
                    status: vehicle.status,
                    notes: vehicle.notes
                });
            } catch (error) {
                console.error('Failed to sync vehicle:', vehicle.vin || vehicle.repairOrder, error);
            }
        }
        
        console.log('Local data sync completed');
    }
}