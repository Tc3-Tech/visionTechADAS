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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
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
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vin TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'in-progress', 'completed')),
      notes TEXT,
      date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      updated_by TEXT
    )
  `;
  
  db.run(createTableQuery, (err) => {
    if (err) {
      console.error('Error creating table:', err.message);
    } else {
      console.log('Vehicles table ready');
    }
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all vehicles
app.get('/api/vehicles', (req, res) => {
  const query = `
    SELECT vin, status, notes, date_added, last_updated, created_by, updated_by 
    FROM vehicles 
    ORDER BY last_updated DESC
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error fetching vehicles:', err.message);
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json(rows);
    }
  });
});

// Get specific vehicle by VIN
app.get('/api/vehicles/:vin', (req, res) => {
  const vin = req.params.vin.toUpperCase();
  
  const query = `
    SELECT vin, status, notes, date_added, last_updated, created_by, updated_by 
    FROM vehicles 
    WHERE vin = ?
  `;
  
  db.get(query, [vin], (err, row) => {
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
  const { vin, status, notes, user } = req.body;
  
  // Validation
  if (!vin || vin.length !== 17) {
    return res.status(400).json({ error: 'VIN must be exactly 17 characters' });
  }
  
  if (!['pending', 'in-progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  const cleanVin = vin.toUpperCase();
  const currentTime = new Date().toISOString();
  
  // Check if vehicle exists
  db.get('SELECT vin FROM vehicles WHERE vin = ?', [cleanVin], (err, row) => {
    if (err) {
      console.error('Error checking vehicle:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (row) {
      // Update existing vehicle
      const updateQuery = `
        UPDATE vehicles 
        SET status = ?, notes = ?, last_updated = ?, updated_by = ?
        WHERE vin = ?
      `;
      
      db.run(updateQuery, [status, notes || '', currentTime, user || 'unknown', cleanVin], function(err) {
        if (err) {
          console.error('Error updating vehicle:', err.message);
          res.status(500).json({ error: 'Database error' });
        } else {
          res.json({ 
            message: 'Vehicle updated successfully',
            vin: cleanVin,
            action: 'updated'
          });
        }
      });
    } else {
      // Insert new vehicle
      const insertQuery = `
        INSERT INTO vehicles (vin, status, notes, date_added, last_updated, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(insertQuery, [cleanVin, status, notes || '', currentTime, currentTime, user || 'unknown', user || 'unknown'], function(err) {
        if (err) {
          console.error('Error inserting vehicle:', err.message);
          res.status(500).json({ error: 'Database error' });
        } else {
          res.status(201).json({ 
            message: 'Vehicle added successfully',
            vin: cleanVin,
            action: 'created'
          });
        }
      });
    }
  });
});

// Delete vehicle
app.delete('/api/vehicles/:vin', (req, res) => {
  const vin = req.params.vin.toUpperCase();
  
  db.run('DELETE FROM vehicles WHERE vin = ?', [vin], function(err) {
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