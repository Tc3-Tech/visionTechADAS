const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'vehicles.db');

// Middleware
app.use(helmet());
// Note: CORS handled by reverse proxy (Caddy)
app.use(express.json());

// Rate limiting - more generous for development/testing
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // increased from 100 to 500 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use('/api/', limiter);

// Database setup
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

function initDatabase() {
  // Create customers table first
  const createCustomersTable = `
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT
    )
  `;
  
  // Create technicians table
  const createTechniciansTable = `
    CREATE TABLE IF NOT EXISTS technicians (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT
    )
  `;
  
  db.run(createCustomersTable, (err) => {
    if (err) {
      console.error('Error creating customers table:', err.message);
    } else {
      console.log('Customers table ready');
    }
  });
  
  db.run(createTechniciansTable, (err) => {
    if (err) {
      console.error('Error creating technicians table:', err.message);
    } else {
      console.log('Technicians table ready');
      
      // Check if we need to migrate existing vehicles table
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='vehicles'", (err, row) => {
        if (err) {
          console.error('Error checking vehicles table:', err.message);
          return;
        }
        
        if (row) {
          // Table exists, check if it has customer_id column
          db.get("PRAGMA table_info(vehicles)", (err, info) => {
            if (err) {
              console.error('Error checking vehicles schema:', err.message);
              return;
            }
            
            // Get all column info
            db.all("PRAGMA table_info(vehicles)", (err, columns) => {
              if (err) {
                console.error('Error getting column info:', err.message);
                return;
              }
              
              const hasCustomerId = columns.some(col => col.name === 'customer_id');
              const hasRepairOrder = columns.some(col => col.name === 'repair_order');
              const hasTechnicianId = columns.some(col => col.name === 'technician_id');
              
              if (!hasCustomerId || !hasRepairOrder || !hasTechnicianId) {
                console.log('Migrating existing vehicles table...');
                migrateVehiclesTable();
              } else {
                console.log('Vehicles table schema is up to date');
              }
            });
          });
        } else {
          // No vehicles table exists, create new one
          createNewVehiclesTable();
        }
      });
    }
  });
}

function migrateVehiclesTable() {
  // Create default customer and technician for existing vehicles
  const defaultCustomerName = 'Legacy Customer';
  const defaultTechnicianName = 'Unknown Technician';
  
  db.run('INSERT OR IGNORE INTO customers (name, created_by) VALUES (?, ?)', 
    [defaultCustomerName, 'migration'], 
    function(err) {
      if (err) {
        console.error('Error creating default customer:', err.message);
        return;
      }
      
      // Create default technician
      db.run('INSERT OR IGNORE INTO technicians (name, created_by) VALUES (?, ?)', 
        [defaultTechnicianName, 'migration'], 
        function(err) {
          if (err) {
            console.error('Error creating default technician:', err.message);
            return;
          }
          
          // Get the default customer and technician IDs
          db.get('SELECT id FROM customers WHERE name = ?', [defaultCustomerName], (err, customer) => {
            if (err) {
              console.error('Error getting default customer:', err.message);
              return;
            }
            
            db.get('SELECT id FROM technicians WHERE name = ?', [defaultTechnicianName], (err, technician) => {
              if (err) {
                console.error('Error getting default technician:', err.message);
                return;
              }
              
              const defaultCustomerId = customer.id;
              const defaultTechnicianId = technician.id;
              console.log('Default customer ID:', defaultCustomerId);
              console.log('Default technician ID:', defaultTechnicianId);
              
              // Rename old table and create new one
              db.serialize(() => {
                db.run('ALTER TABLE vehicles RENAME TO vehicles_old', (err) => {
                  if (err) {
                    console.error('Error renaming old vehicles table:', err.message);
                    return;
                  }
                  
                  // Create new vehicles table
                  createNewVehiclesTable(() => {
                    // Migrate data from old table
                    db.all('SELECT * FROM vehicles_old', (err, oldVehicles) => {
                      if (err) {
                        console.error('Error reading old vehicles:', err.message);
                        return;
                      }
                      
                      console.log(`Migrating ${oldVehicles.length} vehicles...`);
                      
                      const stmt = db.prepare(`
                        INSERT INTO vehicles (vin, repair_order, customer_id, technician_id, status, notes, date_added, last_updated, created_by, updated_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      `);
                      
                      oldVehicles.forEach(vehicle => {
                        stmt.run(
                          vehicle.vin || null,
                          null, // No repair_order in old schema
                          defaultCustomerId,
                          defaultTechnicianId,
                          vehicle.status || 'pre-scan',
                          vehicle.notes || '',
                          vehicle.date_added || new Date().toISOString(),
                          vehicle.last_updated || vehicle.date_added || new Date().toISOString(),
                          vehicle.created_by || 'migration',
                          vehicle.updated_by || vehicle.created_by || 'migration'
                        );
                      });
                      
                      stmt.finalize((err) => {
                        if (err) {
                          console.error('Error migrating vehicles:', err.message);
                        } else {
                          console.log('Vehicle migration completed successfully');
                          // Drop old table
                          db.run('DROP TABLE vehicles_old', (err) => {
                            if (err) {
                              console.error('Error dropping old table:', err.message);
                            } else {
                              console.log('Old vehicles table cleaned up');
                            }
                          });
                        }
                      });
                    });
                  });
                });
              });
            });
          });
        });
  });
}

function createNewVehiclesTable(callback) {
  const createVehiclesTable = `
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vin TEXT,
      repair_order TEXT,
      customer_id INTEGER NOT NULL,
      technician_id INTEGER,
      status TEXT NOT NULL CHECK(status IN ('pre-scan', 'post-scan', 'calibration', 'completed')),
      notes TEXT,
      date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      updated_by TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers (id),
      FOREIGN KEY (technician_id) REFERENCES technicians (id),
      CHECK (vin IS NOT NULL OR repair_order IS NOT NULL),
      UNIQUE(vin, customer_id),
      UNIQUE(repair_order, customer_id)
    )
  `;
  
  db.run(createVehiclesTable, (err) => {
    if (err) {
      console.error('Error creating vehicles table:', err.message);
    } else {
      console.log('Vehicles table ready');
    }
    if (callback) callback(err);
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Customer endpoints
app.get('/api/customers', (req, res) => {
  const query = `
    SELECT id, name, date_added, created_by 
    FROM customers 
    ORDER BY name ASC
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error fetching customers:', err.message);
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/customers', (req, res) => {
  const { name, user } = req.body;
  
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Customer name is required' });
  }
  
  const cleanName = name.trim();
  const currentTime = new Date().toISOString();
  
  const insertQuery = `
    INSERT INTO customers (name, date_added, created_by)
    VALUES (?, ?, ?)
  `;
  
  db.run(insertQuery, [cleanName, currentTime, user || 'unknown'], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'Customer already exists' });
      } else {
        console.error('Error inserting customer:', err.message);
        res.status(500).json({ error: 'Database error' });
      }
    } else {
      res.status(201).json({ 
        id: this.lastID,
        name: cleanName,
        message: 'Customer added successfully'
      });
    }
  });
});

app.delete('/api/customers/:id', (req, res) => {
  const customerId = req.params.id;
  
  // Check if customer has vehicles
  db.get('SELECT COUNT(*) as count FROM vehicles WHERE customer_id = ?', [customerId], (err, row) => {
    if (err) {
      console.error('Error checking customer vehicles:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (row.count > 0) {
      return res.status(400).json({ error: 'Cannot delete customer with existing vehicles' });
    }
    
    // Delete customer
    db.run('DELETE FROM customers WHERE id = ?', [customerId], function(err) {
      if (err) {
        console.error('Error deleting customer:', err.message);
        res.status(500).json({ error: 'Database error' });
      } else if (this.changes === 0) {
        res.status(404).json({ error: 'Customer not found' });
      } else {
        res.json({ message: 'Customer deleted successfully' });
      }
    });
  });
});

// Technician endpoints
app.get('/api/technicians', (req, res) => {
  const query = `
    SELECT id, name, date_added, created_by 
    FROM technicians 
    ORDER BY name ASC
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error fetching technicians:', err.message);
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/technicians', (req, res) => {
  const { name, user } = req.body;
  
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Technician name is required' });
  }
  
  const cleanName = name.trim();
  const currentTime = new Date().toISOString();
  
  const insertQuery = `
    INSERT INTO technicians (name, date_added, created_by)
    VALUES (?, ?, ?)
  `;
  
  db.run(insertQuery, [cleanName, currentTime, user || 'unknown'], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'Technician already exists' });
      } else {
        console.error('Error inserting technician:', err.message);
        res.status(500).json({ error: 'Database error' });
      }
    } else {
      res.status(201).json({ 
        id: this.lastID,
        name: cleanName,
        message: 'Technician added successfully'
      });
    }
  });
});

app.delete('/api/technicians/:id', (req, res) => {
  const technicianId = req.params.id;
  
  // Check if technician has vehicles
  db.get('SELECT COUNT(*) as count FROM vehicles WHERE technician_id = ?', [technicianId], (err, row) => {
    if (err) {
      console.error('Error checking technician vehicles:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (row.count > 0) {
      return res.status(400).json({ error: 'Cannot delete technician with existing vehicles' });
    }
    
    // Delete technician
    db.run('DELETE FROM technicians WHERE id = ?', [technicianId], function(err) {
      if (err) {
        console.error('Error deleting technician:', err.message);
        res.status(500).json({ error: 'Database error' });
      } else if (this.changes === 0) {
        res.status(404).json({ error: 'Technician not found' });
      } else {
        res.json({ message: 'Technician deleted successfully' });
      }
    });
  });
});

// Get all vehicles with customer info
app.get('/api/vehicles', (req, res) => {
  const { customer_id, date_start, date_end } = req.query;
  
  let query = `
    SELECT v.id, v.vin, v.repair_order, v.status, v.notes, 
           v.date_added, v.last_updated, v.created_by, v.updated_by,
           c.name as customer_name, c.id as customer_id,
           t.name as technician_name, t.id as technician_id
    FROM vehicles v
    JOIN customers c ON v.customer_id = c.id
    LEFT JOIN technicians t ON v.technician_id = t.id
  `;
  
  const params = [];
  const conditions = [];
  
  if (customer_id) {
    conditions.push('v.customer_id = ?');
    params.push(customer_id);
  }
  
  if (date_start) {
    conditions.push('DATE(v.date_added) >= DATE(?)');
    params.push(date_start);
  }
  
  if (date_end) {
    conditions.push('DATE(v.date_added) <= DATE(?)');
    params.push(date_end);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY v.last_updated DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching vehicles:', err.message);
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json(rows);
    }
  });
});

// Search vehicle by VIN or RO
app.get('/api/vehicles/search/:identifier', (req, res) => {
  const identifier = req.params.identifier.toUpperCase();
  
  const query = `
    SELECT v.id, v.vin, v.repair_order, v.status, v.notes, 
           v.date_added, v.last_updated, v.created_by, v.updated_by,
           c.name as customer_name, c.id as customer_id,
           t.name as technician_name, t.id as technician_id
    FROM vehicles v
    JOIN customers c ON v.customer_id = c.id
    LEFT JOIN technicians t ON v.technician_id = t.id
    WHERE UPPER(v.vin) = ? OR UPPER(v.repair_order) = ?
  `;
  
  db.get(query, [identifier, identifier], (err, row) => {
    if (err) {
      console.error('Error fetching vehicle:', err.message);
      res.status(500).json({ error: 'Database error' });
    } else if (row) {
      res.json(row);
    } else {
      res.status(404).json({ error: 'Vehicle not found' });
    }
  });
});

// Get specific vehicle by ID
app.get('/api/vehicles/id/:id', (req, res) => {
  const vehicleId = req.params.id;
  
  const query = `
    SELECT v.id, v.vin, v.repair_order, v.status, v.notes, 
           v.date_added, v.last_updated, v.created_by, v.updated_by,
           c.name as customer_name, c.id as customer_id,
           t.name as technician_name, t.id as technician_id
    FROM vehicles v
    JOIN customers c ON v.customer_id = c.id
    LEFT JOIN technicians t ON v.technician_id = t.id
    WHERE v.id = ?
  `;
  
  db.get(query, [vehicleId], (err, row) => {
    if (err) {
      console.error('Error fetching vehicle:', err.message);
      res.status(500).json({ error: 'Database error' });
    } else if (row) {
      res.json(row);
    } else {
      res.status(404).json({ error: 'Vehicle not found' });
    }
  });
});

// Add or update vehicle
app.post('/api/vehicles', (req, res) => {
  const { vin, repair_order, customer_id, technician_id, status, notes, user } = req.body;
  
  // Validation
  if (!vin && !repair_order) {
    return res.status(400).json({ error: 'Either VIN or Repair Order is required' });
  }
  
  if (vin && vin.length !== 17) {
    return res.status(400).json({ error: 'VIN must be exactly 17 characters' });
  }
  
  if (!customer_id) {
    return res.status(400).json({ error: 'Customer is required' });
  }
  
  if (!['pre-scan', 'post-scan', 'calibration', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  const cleanVin = vin ? vin.toUpperCase() : null;
  const cleanRO = repair_order ? repair_order.trim() : null;
  const currentTime = new Date().toISOString();
  
  // Check if vehicle exists (by VIN or RO for this customer)
  const checkQuery = `
    SELECT id FROM vehicles 
    WHERE customer_id = ? AND (
      (? IS NOT NULL AND vin = ?) OR 
      (? IS NOT NULL AND repair_order = ?)
    )
  `;
  
  db.get(checkQuery, [customer_id, cleanVin, cleanVin, cleanRO, cleanRO], (err, row) => {
    if (err) {
      console.error('Error checking vehicle:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (row) {
      // Update existing vehicle
      const updateQuery = `
        UPDATE vehicles 
        SET vin = COALESCE(?, vin), 
            repair_order = COALESCE(?, repair_order),
            technician_id = ?, status = ?, notes = ?, last_updated = ?, updated_by = ?
        WHERE id = ?
      `;
      
      db.run(updateQuery, [cleanVin, cleanRO, technician_id || null, status, notes || '', currentTime, user || 'unknown', row.id], function(err) {
        if (err) {
          console.error('Error updating vehicle:', err.message);
          res.status(500).json({ error: 'Database error' });
        } else {
          res.json({ 
            message: 'Vehicle updated successfully',
            id: row.id,
            action: 'updated'
          });
        }
      });
    } else {
      // Insert new vehicle
      const insertQuery = `
        INSERT INTO vehicles (vin, repair_order, customer_id, technician_id, status, notes, date_added, last_updated, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(insertQuery, [cleanVin, cleanRO, customer_id, technician_id || null, status, notes || '', currentTime, currentTime, user || 'unknown', user || 'unknown'], function(err) {
        if (err) {
          console.error('Error inserting vehicle:', err.message);
          res.status(500).json({ error: 'Database error' });
        } else {
          res.status(201).json({ 
            message: 'Vehicle added successfully',
            id: this.lastID,
            action: 'created'
          });
        }
      });
    }
  });
});

// Delete vehicle by ID
app.delete('/api/vehicles/:id', (req, res) => {
  const vehicleId = req.params.id;
  
  db.run('DELETE FROM vehicles WHERE id = ?', [vehicleId], function(err) {
    if (err) {
      console.error('Error deleting vehicle:', err.message);
      res.status(500).json({ error: 'Database error' });
    } else if (this.changes === 0) {
      res.status(404).json({ error: 'Vehicle not found' });
    } else {
      res.json({ message: 'Vehicle deleted successfully' });
    }
  });
});

// Email export endpoint
app.post('/api/vehicles/export', (req, res) => {
  const { customer_id, date_start, date_end, email } = req.body;
  
  if (!customer_id) {
    return res.status(400).json({ error: 'Customer ID is required' });
  }
  
  // Get customer info and vehicles
  const customerQuery = 'SELECT name FROM customers WHERE id = ?';
  
  db.get(customerQuery, [customer_id], (err, customer) => {
    if (err || !customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    let vehiclesQuery = `
      SELECT v.vin, v.repair_order, v.status, v.notes, v.date_added, v.last_updated
      FROM vehicles v
      WHERE v.customer_id = ?
    `;
    
    const params = [customer_id];
    
    if (date_start) {
      vehiclesQuery += ' AND DATE(v.date_added) >= DATE(?)';
      params.push(date_start);
    }
    
    if (date_end) {
      vehiclesQuery += ' AND DATE(v.date_added) <= DATE(?)';
      params.push(date_end);
    }
    
    vehiclesQuery += ' ORDER BY v.date_added DESC';
    
    db.all(vehiclesQuery, params, (err, vehicles) => {
      if (err) {
        console.error('Error fetching vehicles for export:', err.message);
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Return data for email export (frontend will handle email generation)
      res.json({
        customer: customer.name,
        vehicles: vehicles,
        date_range: {
          start: date_start,
          end: date_end
        },
        generated_at: new Date().toISOString()
      });
    });
  });
});

// Get statistics
app.get('/api/stats', (req, res) => {
  const statsQuery = `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
      COUNT(CASE WHEN status = 'in-progress' THEN 1 END) as in_progress,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
    FROM vehicles
  `;
  
  db.get(statsQuery, [], (err, row) => {
    if (err) {
      console.error('Error fetching stats:', err.message);
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json(row);
    }
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VIN Scanner API server running on port ${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});