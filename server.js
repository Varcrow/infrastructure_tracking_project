import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT;

// Middleware
app.use(cors());
app.use(express.json());

const dbConfig = {
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
};

const pool = mysql.createPool(dbConfig);

async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('Connected to MySQL database!');
        connection.release();
    } catch (error) {
        console.error('Database connection error:', error);
    }
}

testConnection();

async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();

        await connection.query(`
            CREATE TABLE IF NOT EXISTS projects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            budget DECIMAL(15, 2) NOT NULL,
            status ENUM('planning', 'in-progress', 'completed', 'on-hold') NOT NULL,
            province VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
    `);

        console.log('Database table initialized');
        connection.release();
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

initializeDatabase();

// Get all projects
app.get('/api/projects', (req, res) => {
    const sql = 'SELECT * FROM projects';
    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// Get project by ID
app.get('/api/projects/:id', (req, res) => {
    const sql = 'SELECT * FROM projects WHERE id = ?';
    db.query(sql, [req.params.id], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(results[0]);
    });
});

// Get projects by province
app.get('/api/projects/province/:province', (req, res) => {
    const sql = 'SELECT * FROM projects WHERE province = ?';
    db.query(sql, [req.params.province], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// Get projects by status
app.get('/api/projects/status/:status', (req, res) => {
    const sql = 'SELECT * FROM projects WHERE status = ?';
    db.query(sql, [req.params.status], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// Get projects with budget filters
app.get('/api/projects/budget/range', (req, res) => {
    const { min, max } = req.query;
    const sql = 'SELECT * FROM projects WHERE budget BETWEEN ? AND ?';
    db.query(sql, [min || 0, max || 999999999], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// Create new project
app.post('/api/projects', (req, res) => {
    const { name, budget, status, province } = req.body;
    const sql = 'INSERT INTO projects (name, budget, status, province) VALUES (?, ?, ?, ?)';

    db.query(sql, [name, budget, status, province], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({
            id: result.insertId,
            name,
            budget,
            status,
            province
        });
    });
});

// Update project
app.put('/api/projects/:id', (req, res) => {
    const { name, budget, status, province } = req.body;
    const sql = 'UPDATE projects SET name = ?, budget = ?, status = ?, province = ? WHERE id = ?';

    db.query(sql, [name, budget, status, province, req.params.id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json({ message: 'Project updated successfully' });
    });
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
    const sql = 'DELETE FROM projects WHERE id = ?';

    db.query(sql, [req.params.id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json({ message: 'Project deleted successfully' });
    });
});

// Get summary statistics
app.get('/api/stats', (req, res) => {
    const sql = `
    SELECT 
      COUNT(*) as total_projects,
      SUM(budget) as total_budget,
      AVG(budget) as average_budget,
      province,
      status
    FROM projects
    GROUP BY province, status
  `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

app.listen(PORT, () => {
    console.log(`Infrastructure API listening on port ${PORT}`);
});
