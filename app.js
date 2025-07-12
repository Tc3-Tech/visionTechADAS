class VINScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.stream = null;
        this.vehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
        
        this.initEventListeners();
        this.loadVehicleList();
    }

    initEventListeners() {
        document.getElementById('startCamera').addEventListener('click', () => this.startCamera());
        document.getElementById('stopCamera').addEventListener('click', () => this.stopCamera());
        document.getElementById('captureBtn').addEventListener('click', () => this.captureAndProcess());
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
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx.drawImage(this.video, 0, 0);
        
        const imageData = this.canvas.toDataURL('image/jpeg', 0.8);
        
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

    async processVIN(imageData) {
        const { data: { text } } = await Tesseract.recognize(imageData, 'eng', {
            logger: m => console.log(m)
        });
        
        const vinPattern = /[A-HJ-NPR-Z0-9]{17}/g;
        const matches = text.match(vinPattern);
        
        if (matches && matches.length > 0) {
            return this.cleanVIN(matches[0]);
        }
        
        return '';
    }

    cleanVIN(vin) {
        return vin.replace(/[^A-HJ-NPR-Z0-9]/g, '').substring(0, 17);
    }

    displayResult(detectedVIN) {
        document.getElementById('vinInput').value = detectedVIN;
        document.getElementById('vinResult').classList.remove('d-none');
        
        if (!detectedVIN) {
            alert('No VIN detected. Please enter manually or try again.');
        }
    }

    resetScan() {
        document.getElementById('vinResult').classList.add('d-none');
        document.getElementById('vinInput').value = '';
        document.getElementById('notesInput').value = '';
        document.getElementById('statusSelect').value = 'pending';
    }

    saveVehicle() {
        const vin = document.getElementById('vinInput').value.trim();
        const status = document.getElementById('statusSelect').value;
        const notes = document.getElementById('notesInput').value.trim();
        
        if (!vin || vin.length !== 17) {
            alert('Please enter a valid 17-character VIN.');
            return;
        }
        
        const existingIndex = this.vehicles.findIndex(v => v.vin === vin);
        const vehicle = {
            vin: vin,
            status: status,
            notes: notes,
            lastUpdated: new Date().toISOString(),
            dateAdded: existingIndex >= 0 ? this.vehicles[existingIndex].dateAdded : new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
            this.vehicles[existingIndex] = vehicle;
        } else {
            this.vehicles.push(vehicle);
        }
        
        localStorage.setItem('vehicles', JSON.stringify(this.vehicles));
        
        alert(existingIndex >= 0 ? 'Vehicle updated successfully!' : 'Vehicle saved successfully!');
        this.resetScan();
        this.loadVehicleList();
    }

    loadVehicleList() {
        const container = document.getElementById('vehicleList');
        container.innerHTML = '';
        
        if (this.vehicles.length === 0) {
            container.innerHTML = '<div class="col-12"><p class="text-muted text-center">No vehicles scanned yet.</p></div>';
            return;
        }
        
        this.vehicles
            .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
            .forEach(vehicle => {
                const card = this.createVehicleCard(vehicle);
                container.appendChild(card);
            });
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
                        <small class="text-muted">Updated: ${new Date(vehicle.lastUpdated).toLocaleDateString()}</small>
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

function deleteVehicle(vin) {
    if (confirm('Are you sure you want to delete this vehicle?')) {
        scanner.vehicles = scanner.vehicles.filter(v => v.vin !== vin);
        localStorage.setItem('vehicles', JSON.stringify(scanner.vehicles));
        scanner.loadVehicleList();
    }
}

function saveVehicle() {
    scanner.saveVehicle();
}

function resetScan() {
    scanner.resetScan();
}

const scanner = new VINScanner();