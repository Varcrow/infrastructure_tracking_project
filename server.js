import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import xml2js from 'xml2js';
import { Filter } from 'bad-words';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
// For censoring thy gamer words
const filter = new Filter();

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
            CREATE TABLE IF NOT EXISTS assignments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                project_id INT NOT NULL,
                company_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (project_id) REFERENCES projects(id)
                ON DELETE CASCADE ON UPDATE CASCADE,

                FOREIGN KEY (company_id) REFERENCES companies(id)
                ON DELETE CASCADE ON UPDATE CASCADE,

                UNIQUE KEY unique_project_company (project_id, company_id)
            )
        `);

        console.log("Database tables initialized.");
    } catch (error) {
        console.error("Error initializing database:", error);
    } finally {
        if (conn) conn.release();
    }
}

initializeDatabase();

// === Import section ===

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/json', 'text/xml', 'application/xml'];
        const allowedExtensions = ['.json', '.xml'];

        const fileExtension = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));

        if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JSON and XML files are allowed.'));
        }
    }
});

// Parse JSON
function parseJSONProjects(content) {
    const data = JSON.parse(content);
    const projectsArray = Array.isArray(data) ? data : (data.projects || []);

    return projectsArray.map(project => ({
        name: project.name,
        budget: parseFloat(project.budget),
        status: project.status,
        province: project.province,
        city: project.city,
        longitude: project.longitude,
        latitude: project.latitude
    }));
}

// Parse XML
async function parseXMLProjects(content) {
    const parser = new xml2js.Parser({
        explicitArray: false,
        trim: true
    });

    try {
        const result = await parser.parseStringPromise(content);

        let projectsArray = [];
        if (result.projects && result.projects.project) {
            projectsArray = Array.isArray(result.projects.project)
                ? result.projects.project
                : [result.projects.project];
        }

        return projectsArray.map(project => ({
            name: project.name,
            budget: parseFloat(project.budget),
            status: project.status,
            province: project.province,
            city: project.city,
            longitude: project.longitude,
            latitude: project.latitude
        }));
    } catch (error) {
        throw new Error('Invalid XML format: ' + error.message);
    }
}

// Validate project data
function validateProject(project) {
    const validStatuses = ['planning', 'in-progress', 'completed', 'on-hold'];
    const validProvinces = [
        'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick',
        'Newfoundland and Labrador', 'Nova Scotia', 'Ontario',
        'Prince Edward Island', 'Quebec', 'Saskatchewan'
    ];

    const errors = [];

    if (!project.name || project.name.trim() === '') {
        errors.push('Project name is required');
    }

    if (!project.budget || isNaN(project.budget) || project.budget <= 0) {
        errors.push('Valid budget is required');
    }

    if (!validStatuses.includes(project.status)) {
        errors.push(`Status must be one of: ${validStatuses.join(', ')}`);
    }

    if (!validProvinces.includes(project.province)) {
        errors.push('Invalid province');
    }

    if (!project.city || project.city.trim() === '') {
        errors.push('City is required');
    }

    return errors;
}

// Import projects endpoint
app.post('/api/projects/import', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const fileContent = req.file.buffer.toString('utf-8');
        const fileExtension = req.file.originalname.toLowerCase().slice(req.file.originalname.lastIndexOf('.'));

        let projects = [];

        // Parse based on file type
        if (fileExtension === '.json') {
            projects = parseJSONProjects(fileContent);
        } else if (fileExtension === '.xml') {
            projects = await parseXMLProjects(fileContent);
        } else {
            return res.status(400).json({ error: 'Unsupported file format' });
        }

        if (projects.length === 0) {
            return res.status(400).json({ error: 'No valid projects found in file' });
        }

        // Process each project
        const results = {
            successful: [],
            failed: []
        };

        for (const project of projects) {
            try {
                // Validate project
                const validationErrors = validateProject(project);
                if (validationErrors.length > 0) {
                    results.failed.push({
                        project: project.name || 'Unknown',
                        errors: validationErrors
                    });
                    continue;
                }

                // Insert into database
                const [result] = await db.query(
                    `INSERT INTO projects (name, budget, status, province, city, latitude, longitude) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        filter.clean(project.name),
                        project.budget,
                        project.status,
                        project.province,
                        project.city,
                        project.latitude,
                        project.longitude
                    ]
                );

                results.successful.push({
                    id: result.insertId,
                    name: project.name
                });

            } catch (error) {
                results.failed.push({
                    project: project.name || 'Unknown',
                    errors: [error.message]
                });
            }
        }

        res.json({
            message: 'Import completed',
            total: projects.length,
            successful: results.successful.length,
            failed: results.failed.length,
            details: results
        });

    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({
            error: 'Failed to process import',
            message: error.message
        });
    }
});

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

// ~~~ table manip ~~~

app.post('/api/projects', async (req, res) => {
    const { name, budget, status, province, city, latitude, longitude } = req.body;

    try {
        const [result] = await db.query(
            `INSERT INTO projects (name, budget, status, province, city, latitude, longitude) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [filter.clean(name), budget, status, province, city, latitude, longitude]
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
                AVG(budget) AS average_budget
            FROM projects
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

// === Table 3: Assignments ===

// ~~~ queries ~~~

// Get all assignments with some project and company data
app.get('/api/assignments', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                assignments.id,
                assignments.project_id,
                assignments.company_id,
                assignments.created_at,
                projects.name AS project_name,
                projects.status AS project_status,
                projects.province AS project_province,
                projects.city AS project_city,
                companies.name AS company_name
            FROM assignments
            JOIN projects ON assignments.project_id = projects.id
            JOIN companies ON assignments.company_id = companies.id
            ORDER BY assignments.created_at DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ~~~ table manip ~~~

// Create new assignment
app.post('/api/assignments', async (req, res) => {
    const { project_id, company_id } = req.body;

    try {
        // Check if project exists
        const [projectCheck] = await db.query("SELECT id FROM projects WHERE id = ?", [project_id]);
        if (projectCheck.length === 0) {
            return res.status(404).json({ error: "Project not found" });
        }

        // Check if company exists
        const [companyCheck] = await db.query("SELECT id FROM companies WHERE id = ?", [company_id]);
        if (companyCheck.length === 0) {
            return res.status(404).json({ error: "Company not found" });
        }

        // Create assignment
        const [result] = await db.query(
            `INSERT INTO assignments (project_id, company_id) VALUES (?, ?)`,
            [project_id, company_id]
        );

        res.status(201).json({
            id: result.insertId,
            project_id,
            company_id,
            message: "Assignment created successfully"
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: "This company is already assigned to this project" });
        }
        res.status(500).json({ error: err.message });
    }
});

// Delete assignment
app.delete('/api/assignments/:id', async (req, res) => {
    try {
        const [result] = await db.query("DELETE FROM assignments WHERE id = ?", [req.params.id]);

        if (result.affectedRows === 0)
            return res.status(404).json({ error: "Assignment not found" });

        res.json({ message: "Assignment deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Enable server ===
app.listen(port, () => {
    console.log(`Infrastructure API listening on port ${port}`);
});
