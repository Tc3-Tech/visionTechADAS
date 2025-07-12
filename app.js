class VINScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.stream = null;
        this.api = new VINScannerAPI();
        this.vehicles = [];
        
        this.initEventListeners();
        this.loadVehicleList();
        this.setupAutoRefresh();
    }

    initEventListeners() {
        document.getElementById('startCamera').addEventListener('click', () => this.startCamera());
        document.getElementById('stopCamera').addEventListener('click', () => this.stopCamera());
        document.getElementById('captureBtn').addEventListener('click', () => this.captureAndProcess());
        document.getElementById('manualEntryBtn').addEventListener('click', () => this.showManualEntry());
        document.getElementById('vinInput').addEventListener('input', (e) => this.checkDuplicate(e.target.value));
        document.getElementById('searchInput').addEventListener('input', (e) => this.filterVehicles(e.target.value));
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
        // Set canvas to video dimensions
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx.drawImage(this.video, 0, 0);
        
        // Calculate crop area (the blue overlay box)
        const videoRect = this.video.getBoundingClientRect();
        const scaleX = this.video.videoWidth / videoRect.width;
        const scaleY = this.video.videoHeight / videoRect.height;
        
        // Blue box is 80% width, 60px height, centered
        const cropWidth = this.video.videoWidth * 0.8;
        const cropHeight = 60 * scaleY;
        const cropX = (this.video.videoWidth - cropWidth) / 2;
        const cropY = (this.video.videoHeight - cropHeight) / 2;
        
        // Create cropped canvas
        const croppedCanvas = document.createElement('canvas');
        const croppedCtx = croppedCanvas.getContext('2d');
        croppedCanvas.width = cropWidth;
        croppedCanvas.height = cropHeight;
        
        // Draw cropped area
        croppedCtx.drawImage(
            this.canvas,
            cropX, cropY, cropWidth, cropHeight,
            0, 0, cropWidth, cropHeight
        );
        
        // Enhance the image for better OCR
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
        // Get image data
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        // Increase contrast and convert to grayscale
        for (let i = 0; i < data.length; i += 4) {
            // Convert to grayscale
            const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            
            // Increase contrast
            const contrast = 1.5;
            const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
            const enhanced = factor * (gray - 128) + 128;
            
            // Apply thresholding for better text recognition
            const threshold = enhanced > 128 ? 255 : 0;
            
            data[i] = threshold;     // Red
            data[i + 1] = threshold; // Green
            data[i + 2] = threshold; // Blue
            // Alpha stays the same
        }
        
        // Put enhanced image back
        ctx.putImageData(imageData, 0, 0);
    }

    async processVIN(imageData) {
        // Try multiple OCR approaches
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
        // Clean the text first
        const cleanText = text.replace(/[^A-HJ-NPR-Z0-9]/g, '');
        console.log('Cleaned text:', cleanText);
        
        // Look for 17-character sequences
        const vinPattern = /[A-HJ-NPR-Z0-9]{17}/g;
        const matches = cleanText.match(vinPattern);
        
        if (matches && matches.length > 0) {
            return matches[0];
        }
        
        // Fallback: look for any sequence that could be a partial VIN (14+ chars)
        const partialPattern = /[A-HJ-NPR-Z0-9]{14,17}/g;
        const partialMatches = cleanText.match(partialPattern);
        
        if (partialMatches && partialMatches.length > 0) {
            return partialMatches[0];
        }
        
        return null;
    }

    cleanVIN(vin) {
        return vin.replace(/[^A-HJ-NPR-Z0-9]/g, '').substring(0, 17);
    }

    showManualEntry() {
        document.getElementById('vinInput').value = '';
        document.getElementById('vinResult').classList.remove('d-none');
        document.getElementById('vinInput').focus();
        
        // Update the card title
        document.querySelector('#vinResult .card-title').textContent = 'Manual VIN Entry';
    }

    displayResult(detectedVIN) {
        document.getElementById('vinInput').value = detectedVIN;
        document.getElementById('vinResult').classList.remove('d-none');
        
        // Update the card title
        document.querySelector('#vinResult .card-title').textContent = detectedVIN ? 'Detected VIN' : 'Manual VIN Entry';
        
        if (!detectedVIN) {
            document.getElementById('vinFeedback').textContent = 'No VIN detected. Please enter manually.';
            document.getElementById('vinFeedback').className = 'form-text text-warning';
        } else {
            this.checkDuplicate(detectedVIN);
        }
        
        document.getElementById('vinInput').focus();
    }

    async checkDuplicate(vin) {
        const cleanVin = vin.toUpperCase().trim();
        const feedback = document.getElementById('vinFeedback');
        
        if (cleanVin.length < 17) {
            feedback.textContent = `VIN must be 17 characters (currently ${cleanVin.length})`;
            feedback.className = 'form-text text-muted';
            return;
        }
        
        if (cleanVin.length === 17) {
            try {
                const existing = await this.api.getVehicleByVIN(cleanVin);
                
                if (existing) {
                    const lastUpdated = new Date(existing.last_updated).toLocaleDateString();
                    feedback.innerHTML = `⚠️ <strong>DUPLICATE!</strong> This VIN already exists with status: <span class="status-badge status-${existing.status}">${existing.status.replace('-', ' ')}</span><br>Last updated: ${lastUpdated}`;
                    feedback.className = 'form-text text-danger';
                    
                    // Pre-fill the existing data
                    document.getElementById('statusSelect').value = existing.status;
                    document.getElementById('notesInput').value = existing.notes || '';
                } else {
                    feedback.textContent = '✅ New VIN - ready to save';
                    feedback.className = 'form-text text-success';
                }
            } catch (error) {
                console.error('Error checking duplicate:', error);
                feedback.textContent = 'Unable to check for duplicates - proceeding';
                feedback.className = 'form-text text-warning';
            }
        }
    }

    resetScan() {
        document.getElementById('vinResult').classList.add('d-none');
        document.getElementById('vinInput').value = '';
        document.getElementById('notesInput').value = '';
        document.getElementById('statusSelect').value = 'pre-scan';
    }

    async saveVehicle() {
        const vin = document.getElementById('vinInput').value.trim();
        const status = document.getElementById('statusSelect').value;
        const notes = document.getElementById('notesInput').value.trim();
        
        if (!vin || vin.length !== 17) {
            alert('Please enter a valid 17-character VIN.');
            return;
        }
        
        try {
            // Disable save button to prevent double-clicks
            const saveBtn = document.querySelector('button[onclick="saveVehicle()"]');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            
            const result = await this.api.saveVehicle({
                vin: vin.toUpperCase(),
                status: status,
                notes: notes
            });
            
            const message = result.action === 'updated' ? 'Vehicle updated successfully!' : 'Vehicle saved successfully!';
            
            // Show connection status
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
            // Re-enable save button
            const saveBtn = document.querySelector('button[onclick="saveVehicle()"]');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Vehicle';
        }
    }

    async loadVehicleList() {
        const container = document.getElementById('vehicleList');
        container.innerHTML = '<div class="col-12"><p class="text-muted text-center">Loading vehicles...</p></div>';
        
        try {
            this.vehicles = await this.api.getAllVehicles();
            
            container.innerHTML = '';
            
            if (this.vehicles.length === 0) {
                container.innerHTML = '<div class="col-12"><p class="text-muted text-center">No vehicles scanned yet.</p></div>';
                return;
            }
            
            this.vehicles
                .sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated))
                .forEach(vehicle => {
                    const card = this.createVehicleCard(vehicle);
                    container.appendChild(card);
                });
                
            // Show connection status
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
        
        col.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h5 class="card-title">${vehicle.vin}</h5>
                    <p class="card-text">
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </p>
                    ${vehicle.notes ? `<p class="card-text">${vehicle.notes}</p>` : ''}
                    <p class="card-text">
                        <small class="text-muted">Updated: ${new Date(vehicle.last_updated).toLocaleDateString()}</small>
                    </p>
                    <button class="btn btn-sm btn-outline-primary" onclick="editVehicle('${vehicle.vin}')">Edit</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteVehicle('${vehicle.vin}')">Delete</button>
                </div>
            </div>
        `;
        
        return col;
    }

    filterVehicles(searchTerm) {
        const filteredVehicles = this.vehicles.filter(vehicle => 
            vehicle.vin.toLowerCase().includes(searchTerm.toLowerCase()) ||
            vehicle.notes.toLowerCase().includes(searchTerm.toLowerCase())
        );
        
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

    setupAutoRefresh() {
        setInterval(async () => {
            if (document.getElementById('vehicleListView').classList.contains('d-none')) {
                return; // Don't refresh if not viewing vehicle list
            }
            await this.loadVehicleList();
        }, CONFIG.AUTO_REFRESH_INTERVAL);
    }

    updateConnectionStatus() {
        // Add a connection status indicator to the navbar
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

function showScanView() {
    document.getElementById('scanView').classList.remove('d-none');
    document.getElementById('vehicleListView').classList.add('d-none');
}

function showVehicleList() {
    document.getElementById('scanView').classList.add('d-none');
    document.getElementById('vehicleListView').classList.remove('d-none');
    scanner.loadVehicleList();
}

function editVehicle(vin) {
    const vehicle = scanner.vehicles.find(v => v.vin === vin);
    if (vehicle) {
        document.getElementById('vinInput').value = vehicle.vin;
        document.getElementById('statusSelect').value = vehicle.status;
        document.getElementById('notesInput').value = vehicle.notes;
        document.getElementById('vinResult').classList.remove('d-none');
        showScanView();
    }
}

async function deleteVehicle(vin) {
    if (confirm('Are you sure you want to delete this vehicle?')) {
        try {
            await scanner.api.deleteVehicle(vin);
            await scanner.loadVehicleList();
            alert('Vehicle deleted successfully!');
        } catch (error) {
            console.error('Error deleting vehicle:', error);
            alert('Error deleting vehicle. Please try again.');
        }
    }
}

function saveVehicle() {
    scanner.saveVehicle();
}

function resetScan() {
    scanner.resetScan();
}

const scanner = new VINScanner();