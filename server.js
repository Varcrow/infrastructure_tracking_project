import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const db = mysql.createPool({
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

console.log("Attempting MySQL connection with:");
console.log("Host:", process.env.MYSQLHOST);
console.log("Port:", process.env.MYSQLPORT);
console.log("User:", process.env.MYSQLUSER);
console.log("Database:", process.env.MYSQLDATABASE);

(async () => {
    try {
        const conn = await db.getConnection();
        console.log("Connected to MySQL database successfully!");
        conn.release();
    } catch (err) {
        console.error("MySQL connection failed:", err);
    }
})();

async function initializeDatabase() {
    let conn;
    try {
        conn = await db.getConnection();

        // Check for and create projects table if needed
        await conn.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                budget DECIMAL(15, 2) NOT NULL,
                status ENUM('planning', 'in-progress', 'completed', 'on-hold') NOT NULL,
                province VARCHAR(100) NOT NULL,
                city VARCHAR(255) NOT NULL,
                latitude DECIMAL NOT NULL,
                longitude DECIMAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Check for and create companies table if needed
        await conn.query(`
            CREATE TABLE IF NOT EXISTS companies (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                province VARCHAR(100) NOT NULL,
                city VARCHAR(255) NOT NULL,
                email VARCHAR(100),
                number VARCHAR(100)
            )
        `);

        // Check for and create assignments table if needed
        await conn.query(`
            CREATE TABLE IF NOT EXISTS Assignments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                project_id INT NOT NULL,
                company_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
                FOREIGN KEY (project_id) REFERENCES projects(id)
                ON DELETE CASCADE ON UPDATE CASCADE,
    
                FOREIGN KEY (company_id) REFERENCES companies(id)
                ON DELETE CASCADE ON UPDATE CASCADE,

                UNIQUE KEY unique_project_company (project_id, company_id) -- prevents duplicates
        `);

        console.log("Database tables initialized.");
    } catch (error) {
        console.error("Error initializing database:", error);
    } finally {
        if (conn) conn.release();
    }
}

initializeDatabase();

// === Table 1: Projects ===

// ~~~ queries ~~~

// All projects
app.get('/api/projects', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM projects");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get project by id
app.get('/api/projects/:id', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM projects WHERE id = ?", [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: "Project not found" });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get projects by province
app.get('/api/projects/province/:province', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM projects WHERE province = ?", [req.params.province]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get projects by status
app.get('/api/projects/status/:status', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM projects WHERE status = ?", [req.params.status]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get projects between a certain budget range
app.get('/api/projects/budget/range', async (req, res) => {
    const { min = 0, max = 999999999 } = req.query;
    try {
        const [rows] = await db.query(
            "SELECT * FROM projects WHERE budget BETWEEN ? AND ?",
            [min, max]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ~~~ table manip ~~~

app.post('/api/projects', async (req, res) => {
    const { name, budget, status, province, city, latitude, longitude } = req.body;

    try {
        const [result] = await db.query(
            `INSERT INTO projects (name, budget, status, province, city, latitude, longitude) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, budget, status, province, city, latitude, longitude]
        );

        res.status(201).json({
            id: result.insertId,
            name,
            budget,
            status,
            province,
            city,
            latitude,
            longitude
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/:id', async (req, res) => {
    try {
        const [result] = await db.query("DELETE FROM projects WHERE id = ?", [req.params.id]);

        if (result.affectedRows === 0)
            return res.status(404).json({ error: "Project not found" });

        res.json({ message: "Project deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                COUNT(*) AS total_projects,
                SUM(budget) AS total_budget,
                AVG(budget) AS average_budget,
                province,
                status
            FROM projects
            GROUP BY province, status
        `);

        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Table 2: Companies ===

// ~~~ queries ~~~

// All companies
app.get('/api/companies', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM companies");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get company by id
app.get('/api/company/:id', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM companies WHERE id = ?", [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: "Company not found" });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get company by province
app.get('/api/company/province/:province', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM companies WHERE province = ?", [req.params.province]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ~~~ table manip ~~~

app.post('/api/companies', async (req, res) => {
    const { name, province, city, email, number } = req.body;

    try {
        const [result] = await db.query(
            `INSERT INTO companies (name, province, city, email, number) 
             VALUES (?, ?, ?, ?, ?)`,
            [name, province, city, email, number]
        );

        res.status(201).json({
            id: result.insertId,
            name,
            province,
            city,
            email,
            number,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/companies/:id', async (req, res) => {
    try {
        const [result] = await db.query("DELETE FROM companies WHERE id = ?", [req.params.id]);

        if (result.affectedRows === 0)
            return res.status(404).json({ error: "Company not found" });

        res.json({ message: "Company deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Enable server ===
app.listen(port, () => {
    console.log(`Infrastructure API listening on port ${port}`);
});
