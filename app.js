class VINScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.stream = null;
        this.api = new VINScannerAPI();
        this.vehicles = [];
        this.customers = [];
        this.currentCustomerFilter = null;
        
        this.initEventListeners();
        this.loadCustomers();
        this.loadVehicleList();
        this.setupAutoRefresh();
    }

    initEventListeners() {
        document.getElementById('startCamera').addEventListener('click', () => this.startCamera());
        document.getElementById('stopCamera').addEventListener('click', () => this.stopCamera());
        document.getElementById('captureBtn').addEventListener('click', () => this.captureAndProcess());
        document.getElementById('manualEntryBtn').addEventListener('click', () => this.showManualEntry());
        document.getElementById('vinInput').addEventListener('input', (e) => this.checkDuplicate());
        document.getElementById('roInput').addEventListener('input', (e) => this.checkDuplicate());
        document.getElementById('searchInput').addEventListener('input', (e) => this.searchVehicles(e.target.value));
        document.getElementById('customerFilter').addEventListener('change', (e) => this.updateExportButton());
        document.getElementById('newCustomerName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addCustomer();
        });
    }

    async startCamera() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            
            this.video.srcObject = this.stream;
            
            document.getElementById('startCamera').disabled = true;
            document.getElementById('stopCamera').disabled = false;
            document.getElementById('captureBtn').disabled = false;
            
        } catch (error) {
            console.error('Error accessing camera:', error);
            alert('Unable to access camera. Please check permissions.');
        }
    }

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.video.srcObject = null;
            this.stream = null;
        }
        
        document.getElementById('startCamera').disabled = false;
        document.getElementById('stopCamera').disabled = true;
        document.getElementById('captureBtn').disabled = true;
    }

    async captureAndProcess() {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx.drawImage(this.video, 0, 0);
        
        const videoRect = this.video.getBoundingClientRect();
        const scaleX = this.video.videoWidth / videoRect.width;
        const scaleY = this.video.videoHeight / videoRect.height;
        
        const cropWidth = this.video.videoWidth * 0.8;
        const cropHeight = 60 * scaleY;
        const cropX = (this.video.videoWidth - cropWidth) / 2;
        const cropY = (this.video.videoHeight - cropHeight) / 2;
        
        const croppedCanvas = document.createElement('canvas');
        const croppedCtx = croppedCanvas.getContext('2d');
        croppedCanvas.width = cropWidth;
        croppedCanvas.height = cropHeight;
        
        croppedCtx.drawImage(
            this.canvas,
            cropX, cropY, cropWidth, cropHeight,
            0, 0, cropWidth, cropHeight
        );
        
        this.enhanceImage(croppedCtx, cropWidth, cropHeight);
        
        const imageData = croppedCanvas.toDataURL('image/jpeg', 0.9);
        
        document.getElementById('captureBtn').disabled = true;
        document.getElementById('captureBtn').textContent = 'Processing...';
        
        try {
            const result = await this.processVIN(imageData);
            this.displayResult(result);
        } catch (error) {
            console.error('Error processing VIN:', error);
            alert('Error processing image. Please try again.');
        } finally {
            document.getElementById('captureBtn').disabled = false;
            document.getElementById('captureBtn').textContent = 'Capture VIN';
        }
    }

    enhanceImage(ctx, width, height) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            const contrast = 1.5;
            const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
            const enhanced = factor * (gray - 128) + 128;
            const threshold = enhanced > 128 ? 255 : 0;
            
            data[i] = threshold;
            data[i + 1] = threshold;
            data[i + 2] = threshold;
        }
        
        ctx.putImageData(imageData, 0, 0);
    }

    async processVIN(imageData) {
        const approaches = [
            {
                name: 'Standard',
                config: {
                    tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789',
                    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_TEXT_LINE,
                    tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
                    preserve_interword_spaces: '0'
                }
            },
            {
                name: 'Block mode',
                config: {
                    tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789',
                    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
                    tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
                    preserve_interword_spaces: '0'
                }
            },
            {
                name: 'Auto mode',
                config: {
                    tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789',
                    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
                    preserve_interword_spaces: '0'
                }
            }
        ];

        for (const approach of approaches) {
            console.log(`Trying OCR approach: ${approach.name}`);
            
            try {
                const { data: { text } } = await Tesseract.recognize(imageData, 'eng', {
                    logger: m => console.log(m),
                    ...approach.config
                });
                
                console.log(`${approach.name} OCR Raw text:`, text);
                
                const result = this.extractVIN(text);
                if (result) {
                    console.log(`${approach.name} found VIN:`, result);
                    return result;
                }
            } catch (error) {
                console.error(`${approach.name} OCR failed:`, error);
            }
        }
        
        return '';
    }

    extractVIN(text) {
        const cleanText = text.replace(/[^A-HJ-NPR-Z0-9]/g, '');
        console.log('Cleaned text:', cleanText);
        
        const vinPattern = /[A-HJ-NPR-Z0-9]{17}/g;
        const matches = cleanText.match(vinPattern);
        
        if (matches && matches.length > 0) {
            return matches[0];
        }
        
        const partialPattern = /[A-HJ-NPR-Z0-9]{14,17}/g;
        const partialMatches = cleanText.match(partialPattern);
        
        if (partialMatches && partialMatches.length > 0) {
            return partialMatches[0];
        }
        
        return null;
    }

    showManualEntry() {
        document.getElementById('vinInput').value = '';
        document.getElementById('roInput').value = '';
        document.getElementById('vinResult').classList.remove('d-none');
        document.getElementById('vinInput').focus();
        
        document.querySelector('#vinResult .card-title').textContent = 'Manual Entry';
    }

    displayResult(detectedVIN) {
        document.getElementById('vinInput').value = detectedVIN;
        document.getElementById('roInput').value = '';
        document.getElementById('vinResult').classList.remove('d-none');
        
        document.querySelector('#vinResult .card-title').textContent = detectedVIN ? 'Detected VIN' : 'Manual Entry';
        
        if (!detectedVIN) {
            document.getElementById('vinFeedback').textContent = 'No VIN detected. Please enter manually.';
            document.getElementById('vinFeedback').className = 'form-text text-warning';
        } else {
            this.checkDuplicate();
        }
        
        document.getElementById('vinInput').focus();
    }

    async checkDuplicate() {
        const vin = document.getElementById('vinInput').value.toUpperCase().trim();
        const ro = document.getElementById('roInput').value.trim();
        const feedback = document.getElementById('vinFeedback');
        
        if (!vin && !ro) {
            feedback.textContent = 'Enter either VIN or Repair Order (or both)';
            feedback.className = 'form-text text-muted';
            return;
        }
        
        if (vin && vin.length < 17) {
            feedback.textContent = `VIN must be 17 characters (currently ${vin.length})`;
            feedback.className = 'form-text text-muted';
            return;
        }
        
        const identifier = vin || ro;
        if (!identifier) return;
        
        try {
            const existing = await this.api.searchVehicle(identifier);
            
            if (existing) {
                const lastUpdated = new Date(existing.last_updated).toLocaleDateString();
                feedback.innerHTML = `⚠️ <strong>DUPLICATE!</strong> Found in system:<br>Customer: ${existing.customer_name}<br>Status: <span class="status-badge status-${existing.status}">${existing.status.replace('-', ' ')}</span><br>Last updated: ${lastUpdated}`;
                feedback.className = 'form-text text-danger';
                
                // Pre-fill existing data
                document.getElementById('customerSelect').value = existing.customer_id;
                document.getElementById('statusSelect').value = existing.status;
                document.getElementById('notesInput').value = existing.notes || '';
                if (existing.vin) document.getElementById('vinInput').value = existing.vin;
                if (existing.repair_order) document.getElementById('roInput').value = existing.repair_order;
            } else {
                feedback.textContent = '✅ New entry - ready to save';
                feedback.className = 'form-text text-success';
            }
        } catch (error) {
            console.error('Error checking duplicate:', error);
            feedback.textContent = 'Unable to check for duplicates - proceeding';
            feedback.className = 'form-text text-warning';
        }
    }

    resetScan() {
        document.getElementById('vinResult').classList.add('d-none');
        document.getElementById('vinInput').value = '';
        document.getElementById('roInput').value = '';
        document.getElementById('notesInput').value = '';
        document.getElementById('statusSelect').value = 'pre-scan';
        document.getElementById('customerSelect').value = '';
    }

    async saveVehicle() {
        const vin = document.getElementById('vinInput').value.trim();
        const ro = document.getElementById('roInput').value.trim();
        const customerId = document.getElementById('customerSelect').value;
        const status = document.getElementById('statusSelect').value;
        const notes = document.getElementById('notesInput').value.trim();
        
        if (!vin && !ro) {
            alert('Please enter either a VIN or Repair Order number.');
            return;
        }
        
        if (vin && vin.length !== 17) {
            alert('VIN must be exactly 17 characters.');
            return;
        }
        
        if (!customerId) {
            alert('Please select a customer.');
            return;
        }
        
        try {
            const saveBtn = document.querySelector('button[onclick="saveVehicle()"]');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            
            const result = await this.api.saveVehicle({
                vin: vin || null,
                repair_order: ro || null,
                customer_id: customerId,
                status: status,
                notes: notes
            });
            
            const message = result.action === 'updated' ? 'Vehicle updated successfully!' : 'Vehicle saved successfully!';
            
            if (!this.api.isOnline) {
                alert(message + ' (Saved locally - will sync when server is available)');
            } else {
                alert(message);
            }
            
            this.resetScan();
            await this.loadVehicleList();
            
        } catch (error) {
            console.error('Error saving vehicle:', error);
            alert('Error saving vehicle. Please try again.');
        } finally {
            const saveBtn = document.querySelector('button[onclick="saveVehicle()"]');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Vehicle';
        }
    }

    async loadCustomers() {
        try {
            this.customers = await this.api.getAllCustomers();
            this.populateCustomerSelects();
        } catch (error) {
            console.error('Error loading customers:', error);
        }
    }

    populateCustomerSelects() {
        const selects = ['customerSelect', 'customerFilter'];
        
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (!select) return;
            
            // Clear existing options (except first)
            while (select.children.length > 1) {
                select.removeChild(select.lastChild);
            }
            
            // Add customer options
            this.customers.forEach(customer => {
                const option = document.createElement('option');
                option.value = customer.id;
                option.textContent = customer.name;
                select.appendChild(option);
            });
        });
    }

    async loadVehicleList() {
        const container = document.getElementById('vehicleList');
        container.innerHTML = '<div class="col-12"><p class="text-muted text-center">Loading vehicles...</p></div>';
        
        try {
            const customerId = document.getElementById('customerFilter')?.value || null;
            const dateStart = document.getElementById('dateStart')?.value || null;
            const dateEnd = document.getElementById('dateEnd')?.value || null;
            
            this.vehicles = await this.api.getAllVehicles(customerId, dateStart, dateEnd);
            
            container.innerHTML = '';
            
            if (this.vehicles.length === 0) {
                container.innerHTML = '<div class="col-12"><p class="text-muted text-center">No vehicles found.</p></div>';
                return;
            }
            
            this.vehicles.forEach(vehicle => {
                const card = this.createVehicleCard(vehicle);
                container.appendChild(card);
            });
                
            this.updateConnectionStatus();
            
        } catch (error) {
            console.error('Error loading vehicles:', error);
            container.innerHTML = '<div class="col-12"><p class="text-danger text-center">Error loading vehicles. Please refresh.</p></div>';
        }
    }

    createVehicleCard(vehicle) {
        const col = document.createElement('div');
        col.className = 'col-md-6 col-lg-4 mb-3';
        
        const statusClass = `status-${vehicle.status}`;
        const statusText = vehicle.status.charAt(0).toUpperCase() + vehicle.status.slice(1).replace('-', ' ');
        
        const identifier = vehicle.vin || vehicle.repair_order || 'No ID';
        const identifierType = vehicle.vin ? 'VIN' : 'RO';
        
        col.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h5 class="card-title">${identifier}</h5>
                    <p class="card-text">
                        <strong>Customer:</strong> ${vehicle.customer_name}<br>
                        <strong>Type:</strong> ${identifierType}<br>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </p>
                    ${vehicle.notes ? `<p class="card-text">${vehicle.notes}</p>` : ''}
                    ${vehicle.vin && vehicle.repair_order ? `<p class="card-text"><small class="text-muted">VIN: ${vehicle.vin}<br>RO: ${vehicle.repair_order}</small></p>` : ''}
                    <p class="card-text">
                        <small class="text-muted">Updated: ${new Date(vehicle.last_updated).toLocaleDateString()}</small>
                    </p>
                    <button class="btn btn-sm btn-outline-primary" onclick="editVehicle(${vehicle.id})">Edit</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteVehicle(${vehicle.id})">Delete</button>
                </div>
            </div>
        `;
        
        return col;
    }

    searchVehicles(searchTerm) {
        const filteredVehicles = this.vehicles.filter(vehicle => {
            const searchLower = searchTerm.toLowerCase();
            return (vehicle.vin && vehicle.vin.toLowerCase().includes(searchLower)) ||
                   (vehicle.repair_order && vehicle.repair_order.toLowerCase().includes(searchLower)) ||
                   (vehicle.customer_name && vehicle.customer_name.toLowerCase().includes(searchLower)) ||
                   (vehicle.notes && vehicle.notes.toLowerCase().includes(searchLower));
        });
        
        const container = document.getElementById('vehicleList');
        container.innerHTML = '';
        
        if (filteredVehicles.length === 0) {
            container.innerHTML = '<div class="col-12"><p class="text-muted text-center">No vehicles found.</p></div>';
            return;
        }
        
        filteredVehicles.forEach(vehicle => {
            const card = this.createVehicleCard(vehicle);
            container.appendChild(card);
        });
    }

    async loadCustomerList() {
        const container = document.getElementById('customerList');
        container.innerHTML = '<div class="col-12"><p class="text-muted text-center">Loading customers...</p></div>';
        
        try {
            await this.loadCustomers();
            
            container.innerHTML = '';
            
            if (this.customers.length === 0) {
                container.innerHTML = '<div class="col-12"><p class="text-muted text-center">No customers found.</p></div>';
                return;
            }
            
            this.customers.forEach(customer => {
                const card = this.createCustomerCard(customer);
                container.appendChild(card);
            });
            
        } catch (error) {
            console.error('Error loading customers:', error);
            container.innerHTML = '<div class="col-12"><p class="text-danger text-center">Error loading customers. Please refresh.</p></div>';
        }
    }

    createCustomerCard(customer) {
        const col = document.createElement('div');
        col.className = 'col-md-6 col-lg-4 mb-3';
        
        col.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h5 class="card-title">${customer.name}</h5>
                    <p class="card-text">
                        <small class="text-muted">Added: ${new Date(customer.date_added).toLocaleDateString()}</small>
                    </p>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteCustomer(${customer.id})">Delete</button>
                </div>
            </div>
        `;
        
        return col;
    }

    async addCustomer() {
        const name = document.getElementById('newCustomerName').value.trim();
        
        if (!name) {
            alert('Please enter a customer name.');
            return;
        }
        
        try {
            await this.api.addCustomer(name);
            document.getElementById('newCustomerName').value = '';
            await this.loadCustomers();
            await this.loadCustomerList();
            alert('Customer added successfully!');
        } catch (error) {
            console.error('Error adding customer:', error);
            alert('Error adding customer. Customer may already exist.');
        }
    }

    updateExportButton() {
        const exportBtn = document.getElementById('exportBtn');
        const customerId = document.getElementById('customerFilter').value;
        
        if (customerId) {
            exportBtn.disabled = false;
            const customerName = this.customers.find(c => c.id == customerId)?.name || 'Selected Customer';
            exportBtn.textContent = `Export ${customerName}`;
        } else {
            exportBtn.disabled = true;
            exportBtn.textContent = 'Export Selected Customer';
        }
    }

    setupAutoRefresh() {
        setInterval(async () => {
            if (!document.getElementById('vehicleListView').classList.contains('d-none')) {
                await this.loadVehicleList();
            }
        }, CONFIG.AUTO_REFRESH_INTERVAL);
    }

    updateConnectionStatus() {
        let statusIndicator = document.getElementById('connectionStatus');
        if (!statusIndicator) {
            statusIndicator = document.createElement('span');
            statusIndicator.id = 'connectionStatus';
            statusIndicator.className = 'navbar-text ms-3';
            document.querySelector('.navbar-nav').appendChild(statusIndicator);
        }
        
        if (this.api.isOnline) {
            statusIndicator.innerHTML = '<i class="text-success">●</i> Online';
        } else {
            statusIndicator.innerHTML = '<i class="text-warning">●</i> Offline';
        }
    }
}

// Navigation functions
function showScanView() {
    document.getElementById('scanView').classList.remove('d-none');
    document.getElementById('vehicleListView').classList.add('d-none');
    document.getElementById('customerView').classList.add('d-none');
}

function showVehicleList() {
    document.getElementById('scanView').classList.add('d-none');
    document.getElementById('vehicleListView').classList.remove('d-none');
    document.getElementById('customerView').classList.add('d-none');
    scanner.loadVehicleList();
}

function showCustomerView() {
    document.getElementById('scanView').classList.add('d-none');
    document.getElementById('vehicleListView').classList.add('d-none');
    document.getElementById('customerView').classList.remove('d-none');
    scanner.loadCustomerList();
}

// Vehicle management functions
async function editVehicle(vehicleId) {
    try {
        const vehicle = await scanner.api.getVehicleById(vehicleId);
        if (vehicle) {
            document.getElementById('customerSelect').value = vehicle.customer_id;
            document.getElementById('vinInput').value = vehicle.vin || '';
            document.getElementById('roInput').value = vehicle.repair_order || '';
            document.getElementById('statusSelect').value = vehicle.status;
            document.getElementById('notesInput').value = vehicle.notes || '';
            document.getElementById('vinResult').classList.remove('d-none');
            document.querySelector('#vinResult .card-title').textContent = 'Edit Vehicle';
            showScanView();
        }
    } catch (error) {
        console.error('Error loading vehicle for edit:', error);
        alert('Error loading vehicle data.');
    }
}

async function deleteVehicle(vehicleId) {
    if (confirm('Are you sure you want to delete this vehicle?')) {
        try {
            await scanner.api.deleteVehicle(vehicleId);
            await scanner.loadVehicleList();
            alert('Vehicle deleted successfully!');
        } catch (error) {
            console.error('Error deleting vehicle:', error);
            alert('Error deleting vehicle. Please try again.');
        }
    }
}

// Customer management functions
async function deleteCustomer(customerId) {
    if (confirm('Are you sure you want to delete this customer? This will only work if they have no vehicles.')) {
        try {
            await scanner.api.deleteCustomer(customerId);
            await scanner.loadCustomers();
            await scanner.loadCustomerList();
            alert('Customer deleted successfully!');
        } catch (error) {
            console.error('Error deleting customer:', error);
            alert('Error deleting customer. They may have existing vehicles.');
        }
    }
}

function addCustomer() {
    scanner.addCustomer();
}

function showAddCustomer() {
    const name = prompt('Enter customer name:');
    if (name && name.trim()) {
        scanner.api.addCustomer(name.trim()).then(() => {
            scanner.loadCustomers();
            alert('Customer added successfully!');
        }).catch(error => {
            console.error('Error adding customer:', error);
            alert('Error adding customer. Customer may already exist.');
        });
    }
}

// Filtering and export functions
function filterVehicles() {
    scanner.loadVehicleList();
}

async function exportCustomerData() {
    const customerId = document.getElementById('customerFilter').value;
    const dateStart = document.getElementById('dateStart').value;
    const dateEnd = document.getElementById('dateEnd').value;
    
    if (!customerId) {
        alert('Please select a customer to export.');
        return;
    }
    
    try {
        const exportData = await scanner.api.exportCustomerData(customerId, dateStart, dateEnd);
        
        // Create downloadable content
        let content = `Vehicle Report for ${exportData.customer}\n`;
        content += `Generated: ${new Date(exportData.generated_at).toLocaleString()}\n`;
        if (exportData.date_range.start || exportData.date_range.end) {
            content += `Date Range: ${exportData.date_range.start || 'Beginning'} to ${exportData.date_range.end || 'End'}\n`;
        }
        content += `\n`;
        
        if (exportData.vehicles.length === 0) {
            content += 'No vehicles found for this customer in the specified date range.\n';
        } else {
            content += `Total Vehicles: ${exportData.vehicles.length}\n\n`;
            
            exportData.vehicles.forEach((vehicle, index) => {
                content += `${index + 1}. `;
                if (vehicle.vin) content += `VIN: ${vehicle.vin}`;
                if (vehicle.vin && vehicle.repair_order) content += ` | `;
                if (vehicle.repair_order) content += `RO: ${vehicle.repair_order}`;
                content += `\n   Status: ${vehicle.status.replace('-', ' ').toUpperCase()}`;
                content += `\n   Date Added: ${new Date(vehicle.date_added).toLocaleDateString()}`;
                content += `\n   Last Updated: ${new Date(vehicle.last_updated).toLocaleDateString()}`;
                if (vehicle.notes) content += `\n   Notes: ${vehicle.notes}`;
                content += `\n\n`;
            });
        }
        
        // Create and download file
        const blob = new Blob([content], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${exportData.customer.replace(/[^a-z0-9]/gi, '_')}_vehicle_report_${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        alert('Vehicle report downloaded successfully!');
        
    } catch (error) {
        console.error('Error exporting customer data:', error);
        alert('Error generating report. Please try again.');
    }
}

// Utility functions
function saveVehicle() {
    scanner.saveVehicle();
}

function resetScan() {
    scanner.resetScan();
}

// Initialize the scanner
const scanner = new VINScanner();