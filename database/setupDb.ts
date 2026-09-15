import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
dotenv.config();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
async function setup() {
    console.log('Connecting to PostgreSQL...');
    const client = await pool.connect();
    try {
        console.log('Creating schema...');
        await client.query('BEGIN');
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                status VARCHAR(50) DEFAULT 'PENDING',
                expertise TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS examinations (
                id SERIAL PRIMARY KEY,
                organization_id INTEGER REFERENCES users(id),
                examination_name VARCHAR(255) NOT NULL,
                description TEXT,
                subject VARCHAR(100) NOT NULL,
                required_question_count INTEGER NOT NULL,
                security_multiplier NUMERIC NOT NULL,
                candidate_question_count INTEGER NOT NULL,
                questions_per_setter INTEGER NOT NULL,
                required_setter_count INTEGER NOT NULL,
                examination_date TIMESTAMP,
                blueprint TEXT,
                release_at TIMESTAMP,
                status VARCHAR(50) DEFAULT 'DRAFT',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS setter_assignments (
                id SERIAL PRIMARY KEY,
                examination_id INTEGER REFERENCES examinations(id),
                setter_id INTEGER REFERENCES users(id),
                questions_required INTEGER NOT NULL,
                questions_submitted INTEGER DEFAULT 0,
                status VARCHAR(50) DEFAULT 'PENDING',
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                UNIQUE(examination_id, setter_id)
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS questions (
                id SERIAL PRIMARY KEY,
                examination_id INTEGER REFERENCES examinations(id),
                setter_assignment_id INTEGER REFERENCES setter_assignments(id),
                question_text TEXT NOT NULL,
                option_a TEXT NOT NULL,
                option_b TEXT NOT NULL,
                option_c TEXT NOT NULL,
                option_d TEXT NOT NULL,
                correct_option VARCHAR(1) NOT NULL,
                difficulty VARCHAR(20) DEFAULT 'Medium',
                category VARCHAR(100),
                status VARCHAR(50) DEFAULT 'SUBMITTED',
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS final_selections (
                id SERIAL PRIMARY KEY,
                examination_id INTEGER REFERENCES examinations(id) UNIQUE,
                selected_question_ids TEXT NOT NULL,
                blueprint_status TEXT,
                algorithm_version VARCHAR(50) NOT NULL,
                selected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS final_papers (
                id SERIAL PRIMARY KEY,
                examination_id INTEGER REFERENCES examinations(id) UNIQUE,
                artifact_reference VARCHAR(255) NOT NULL,
                encryption_key_reference VARCHAR(255),
                integrity_hash VARCHAR(255) NOT NULL,
                generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id SERIAL PRIMARY KEY,
                event VARCHAR(255) NOT NULL,
                user_id INTEGER,
                status TEXT,
                ip_address VARCHAR(45),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query('COMMIT');
        console.log('Schema created successfully.');
        console.log('Seeding demo accounts...');
        const demoPassword = 'demo_password_2026';
        const hash = await bcrypt.hash(demoPassword, 10);
        const accounts = [
            { name: 'Admin User', email: 'admin@gmail.com', role: 'ADMIN' },
            { name: 'Demo Organization', email: 'organization@gmail.com', role: 'ORG' },
            { name: 'Setter 1', email: 'setter1@gmail.com', role: 'SETTER' },
            { name: 'Setter 2', email: 'setter2@gmail.com', role: 'SETTER' },
            { name: 'Setter 3', email: 'setter3@gmail.com', role: 'SETTER' },
            { name: 'Setter 4', email: 'setter4@gmail.com', role: 'SETTER' },
            { name: 'Setter 5', email: 'setter5@gmail.com', role: 'SETTER' }
        ];
        for (const acc of accounts) {
            await client.query(`
                INSERT INTO users (name, email, password_hash, role, status)
                VALUES ($1, $2, $3, $4, 'APPROVED')
                ON CONFLICT (email) DO NOTHING
            `, [acc.name, acc.email, hash, acc.role]);
        }
        console.log('Demo accounts seeded successfully.');
        console.log('Setup complete!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Setup failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}
setup();
