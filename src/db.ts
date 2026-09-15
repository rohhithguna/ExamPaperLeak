import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
export async function initDb() {
    try {
        const client = await pool.connect();
        client.release();
        console.log('PostgreSQL connected successfully.');
    } catch (e) {
        console.error('Failed to connect to PostgreSQL:', e);
        process.exit(1);
    }
}
export async function logAudit(event: string, user_id: number | null, status: string, client?: any) {
    const q = 'INSERT INTO audit_log (event, user_id, status) VALUES ($1, $2, $3)';
    const params = [event, user_id, status];
    if (client) {
        await client.query(q, params);
    } else {
        await pool.query(q, params);
    }
}
export default pool;
