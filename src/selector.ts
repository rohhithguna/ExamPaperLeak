import crypto from 'crypto';
import db from './db';
export class SecureQuestionSelector {
    private static secureShuffle<T>(array: T[]): T[] {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = crypto.randomInt(0, i + 1);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
    public static async generate(examId: number): Promise<any> {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const { rows: examRows } = await client.query('SELECT * FROM examinations WHERE id = $1 FOR UPDATE', [examId]);
            const exam = examRows[0];
            if (!exam) throw new Error('Examination not found');
            if (exam.status !== 'READY_FOR_SELECTION') {
                throw new Error('Examination is not ready for selection');
            }
            const { rows: candidates } = await client.query("SELECT * FROM questions WHERE examination_id = $1 AND status = 'SUBMITTED'", [exam.id]);
            if (candidates.length < exam.required_question_count) {
                throw new Error('Insufficient validated questions in candidate pool');
            }
            let blueprint = null;
            if (exam.blueprint) {
                try { blueprint = JSON.parse(exam.blueprint); } catch(e) {}
            }
            const shuffledPool = this.secureShuffle(candidates);
            const selectedIds: number[] = [];
            const difficultyCounts: Record<string, number> = {};
            for (const q of shuffledPool) {
                if (selectedIds.length >= exam.required_question_count) break;
                if (blueprint && blueprint.difficulty) {
                    const diff = q.difficulty || 'Medium';
                    const target = blueprint.difficulty[diff] || 0;
                    const current = difficultyCounts[diff] || 0;
                    if (current < target) {
                        selectedIds.push(q.id);
                        difficultyCounts[diff] = current + 1;
                    }
                } else {
                    selectedIds.push(q.id);
                }
            }
            if (selectedIds.length < exam.required_question_count) {
                const missing = Object.entries(blueprint?.difficulty || {})
                    .map(([diff, target]: [string, any]) => {
                        const got = difficultyCounts[diff] || 0;
                        return got < target ? `${diff}: needed ${target}, got ${got}` : null;
                    })
                    .filter(Boolean)
                    .join('; ');
                throw new Error(`Selection could not satisfy blueprint constraints. Undersupplied categories: ${missing || 'unknown'}.`);
            }
            const finalSelectionOrder = this.secureShuffle(selectedIds);
            await client.query(`
                INSERT INTO final_selections (examination_id, selected_question_ids, blueprint_status, algorithm_version)
                VALUES ($1, $2, $3, $4)
            `, [exam.id, JSON.stringify(finalSelectionOrder), 'Satisfied', 'CSPRNG-v1']);
            await client.query("UPDATE examinations SET status = 'READY_FOR_PAPER_GENERATION' WHERE id = $1", [exam.id]);
            await client.query('COMMIT');
            return {
                success: true,
                examination_id: exam.id,
                selected_count: finalSelectionOrder.length,
                candidate_pool_count: candidates.length,
                blueprint_status: 'Satisfied',
                algorithm_version: 'CSPRNG-v1'
            };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}
