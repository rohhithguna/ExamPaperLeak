import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from './db';
class MinimalPDF {
    static generate(content: string): Buffer {
        return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`);
    }
}
export class PaperGenerator {
    public static async generateFinalPaper(examId: number): Promise<any> {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const { rows: examRows } = await client.query('SELECT * FROM examinations WHERE id = $1 FOR UPDATE', [examId]);
            const exam = examRows[0];
            if (!exam) throw new Error('Examination not found');
            if (exam.status !== 'READY_FOR_PAPER_GENERATION') {
                throw new Error('Examination is not ready for paper generation');
            }
            const { rows: selRows } = await client.query('SELECT * FROM final_selections WHERE examination_id = $1', [exam.id]);
            const selection = selRows[0];
            if (!selection) throw new Error('Selection not found');
            const existingPaper = await client.query('SELECT id FROM final_papers WHERE examination_id = $1', [exam.id]);
            if (existingPaper.rows.length > 0) {
                throw new Error('Paper already generated for this examination');
            }
            const selectedIds: number[] = JSON.parse(selection.selected_question_ids);
            const questionMap = new Map<number, any>();
            const { rows: qRows } = await client.query('SELECT * FROM questions WHERE id = ANY($1::int[])', [selectedIds]);
            for (const q of qRows) {
                questionMap.set(q.id, q);
            }
            let textContent = `EXAMINATION: ${exam.examination_name}\nSUBJECT: ${exam.subject}\n\n`;
            let qNum = 1;
            for (const qId of selectedIds) {
                const q = questionMap.get(qId);
                if (q) {
                    textContent += `Q${qNum}. ${q.question_text}\n`;
                    textContent += `A) ${q.option_a}\nB) ${q.option_b}\nC) ${q.option_c}\nD) ${q.option_d}\n\n`;
                    qNum++;
                }
            }
            const pdfBuffer = MinimalPDF.generate(textContent);
            const keyHex = process.env.ENCRYPTION_KEY;
            if (!keyHex || keyHex.length !== 64) {
                throw new Error('Server misconfiguration: Encryption key unavailable');
            }
            const key = Buffer.from(keyHex, 'hex');
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            const encryptedBody = Buffer.concat([cipher.update(pdfBuffer), cipher.final()]);
            const authTag = cipher.getAuthTag();
            const finalArtifact = Buffer.concat([iv, authTag, encryptedBody]);
            const integrityHash = crypto.createHash('sha256').update(finalArtifact).digest('hex');
            const storageDir = path.join(__dirname, '..', 'storage');
            if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
            const filename = `paper_${exam.id}_${crypto.randomBytes(8).toString('hex')}.enc`;
            const filePath = path.join(storageDir, filename);
            fs.writeFileSync(filePath, finalArtifact);
            const releaseAt = exam.release_at || new Date().toISOString();
            await client.query(`
                INSERT INTO final_papers (examination_id, artifact_reference, integrity_hash)
                VALUES ($1, $2, $3)
            `, [exam.id, filename, integrityHash]);
            await client.query("UPDATE examinations SET status = 'LOCKED' WHERE id = $1", [exam.id]);
            await client.query('COMMIT');
            return {
                success: true,
                examination_id: exam.id,
                artifact_reference: filename,
                integrity_hash: integrityHash,
                algorithm: 'AES-256-GCM'
            };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}
