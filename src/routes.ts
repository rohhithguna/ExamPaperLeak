import { Router } from 'express';
import bcrypt from 'bcrypt';
import db, { logAudit } from './db';
import { generateToken, authMiddleware, requireRole, AuthRequest } from './auth';
const router = Router();
router.post('/auth/register', async (req: AuthRequest, res: any) => {
  const { name, email, password, role, expertise } = req.body;
  if (!name || !email || !password || !['ORG', 'SETTER'].includes(role)) {
    return res.status(400).json({ error: 'Invalid input. Role must be ORG or SETTER.' });
  }
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const status = (role === 'SETTER') ? 'PENDING' : 'APPROVED';
    const result = await db.query(
      'INSERT INTO users (name, email, password_hash, role, status, expertise) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [name, email, password_hash, role, status, expertise || null]
    );
    const newId = result.rows[0].id;
    await logAudit('REGISTRATION_SUCCESS', newId, 'SUCCESS');
    res.json({ id: newId, email, role, status });
  } catch (err: any) {
    await logAudit('REGISTRATION_FAILURE', null, 'FAILURE');
    res.status(400).json({ error: err.message });
  }
});
router.post('/auth/login', async (req: AuthRequest, res: any) => {
  const { email, password } = req.body;
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    await logAudit('LOGIN_FAILURE', user ? user.id : null, 'FAILURE');
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  await logAudit('LOGIN_SUCCESS', user.id, 'SUCCESS');
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } });
});
router.post('/auth/logout', authMiddleware, async (req: AuthRequest, res) => {
  await logAudit('LOGOUT', req.user!.id, 'SUCCESS');
  res.json({ success: true });
});
router.get('/auth/me', authMiddleware, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});
router.get('/admin/setters', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: any) => {
  const { rows } = await db.query("SELECT id, name, email, expertise, status, created_at FROM users WHERE role = 'SETTER'");
  res.json(rows);
});
router.post('/admin/setters/:id/approve', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: any) => {
  await db.query("UPDATE users SET status = 'APPROVED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
  await logAudit('SETTER_APPROVED', req.user!.id, `Target ID: ${req.params.id}`);
  res.json({ success: true });
});
router.post('/admin/setters/:id/reject', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: any) => {
  await db.query("UPDATE users SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
  await logAudit('SETTER_REJECTED', req.user!.id, `Target ID: ${req.params.id}`);
  res.json({ success: true });
});
router.get('/admin/exams', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: any) => {
  const { rows } = await db.query(`
    SELECT e.id, e.examination_name, e.subject, e.required_question_count, e.security_multiplier, 
           e.candidate_question_count, e.questions_per_setter, e.required_setter_count, e.status, 
           e.release_at, e.created_at, u.name as organization_name,
           (SELECT COUNT(*) FROM questions q WHERE q.examination_id = e.id AND q.status = 'SUBMITTED') as current_valid_question_count
    FROM examinations e
    JOIN users u ON e.organization_id = u.id
    ORDER BY e.created_at DESC
  `);
  res.json(rows);
});
router.post('/admin/exams/:id/approve', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: any) => {
  const { rows } = await db.query('SELECT * FROM examinations WHERE id = $1', [req.params.id]);
  const exam = rows[0];
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  if (exam.status !== 'DRAFT') return res.status(400).json({ error: 'Exam is not in DRAFT status' });
  await db.query("UPDATE examinations SET status = 'APPROVED' WHERE id = $1", [exam.id]);
  await logAudit('EXAM_APPROVED', req.user!.id, `Exam ID: ${exam.id}`);
  res.json({ success: true });
});
router.post('/exams', authMiddleware, requireRole('ORG'), async (req: AuthRequest, res: any) => {
  const { examination_name, description, subject, required_question_count, security_multiplier, questions_per_setter, examination_date, blueprint, release_at } = req.body;
  if (!examination_name || !subject || !required_question_count || !security_multiplier || !questions_per_setter) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (security_multiplier < 1.5 || security_multiplier > 10 || required_question_count <= 0 || required_question_count > 1000 || questions_per_setter <= 0 || questions_per_setter > 100) {
    await logAudit('INVALID_EXAM_CREATION', req.user!.id, 'Failed validation constraints');
    return res.status(400).json({ error: 'Invalid calculation inputs or limits exceeded' });
  }
  const candidate_question_count = Math.ceil(required_question_count * security_multiplier);
  const required_setter_count = Math.ceil(candidate_question_count / questions_per_setter);
  let blueprintJson = null;
  if (blueprint) {
    try {
      const parsedBlueprint = typeof blueprint === 'string' ? JSON.parse(blueprint) : blueprint;
      blueprintJson = JSON.stringify(parsedBlueprint);
      if (blueprintJson.length > 5000) {
        throw new Error('Blueprint JSON exceeds maximum size');
      }
    } catch(e) {
      return res.status(400).json({ error: 'Invalid blueprint JSON format or size' });
    }
  }
  try {
    const result = await db.query(`
      INSERT INTO examinations (organization_id, examination_name, description, subject, required_question_count, security_multiplier, candidate_question_count, questions_per_setter, required_setter_count, examination_date, blueprint, release_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id
    `, [req.user!.id, examination_name, description || null, subject, required_question_count, security_multiplier, candidate_question_count, questions_per_setter, required_setter_count, examination_date || null, blueprintJson, release_at || null]);
    const newId = result.rows[0].id;
    await logAudit('EXAM_CREATED', req.user!.id, `Exam ID: ${newId}`);
    res.json({ id: newId, candidate_question_count, required_setter_count });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Database error' });
  }
});
router.get('/exams', authMiddleware, requireRole('ORG'), async (req: AuthRequest, res: any) => {
  const { rows } = await db.query('SELECT * FROM examinations WHERE organization_id = $1 ORDER BY created_at DESC', [req.user!.id]);
  res.json(rows);
});
router.get('/exams/:id', authMiddleware, requireRole('ORG'), async (req: AuthRequest, res: any) => {
  const { rows } = await db.query('SELECT * FROM examinations WHERE id = $1', [req.params.id]);
  const exam = rows[0];
  if (!exam) {
    return res.status(404).json({ error: 'Examination not found' });
  }
  if (exam.organization_id !== req.user!.id) {
    await logAudit('UNAUTHORIZED_EXAM_ACCESS', req.user!.id, `Exam ID: ${req.params.id}`);
    return res.status(403).json({ error: 'Access denied' });
  }
  res.json(exam);
});
router.get('/exams/:id/progress', authMiddleware, requireRole('ORG'), async (req: AuthRequest, res: any) => {
  const { rows: examRows } = await db.query('SELECT * FROM examinations WHERE id = $1 AND organization_id = $2', [req.params.id, req.user!.id]);
  const exam = examRows[0];
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const { rows: assignRows } = await db.query('SELECT COUNT(*) as total, SUM(questions_submitted) as total_submitted FROM setter_assignments WHERE examination_id = $1', [exam.id]);
  const assignments = assignRows[0];
  res.json({
    exam,
    assigned_setters: parseInt(assignments.total) || 0,
    submitted_questions: parseInt(assignments.total_submitted) || 0
  });
});
router.get('/setter/exams', authMiddleware, requireRole('SETTER'), async (req: AuthRequest, res: any) => {
  const { rows: userRows } = await db.query('SELECT status FROM users WHERE id = $1', [req.user!.id]);
  const liveUser = userRows[0];
  if (!liveUser || liveUser.status !== 'APPROVED') {
    return res.status(403).json({ error: 'Access denied: Setter not approved' });
  }
  const { rows: availableExams } = await db.query(`
    SELECT e.id, e.examination_name, e.subject, e.required_question_count, e.questions_per_setter, e.required_setter_count,
           (e.required_setter_count - (SELECT COUNT(*) FROM setter_assignments sa WHERE sa.examination_id = e.id)) as remaining_slots
    FROM examinations e
    WHERE e.status IN ('APPROVED', 'COLLECTING')
  `);
  res.json(availableExams.filter((e: any) => parseInt(e.remaining_slots) > 0));
});
router.post('/setter/exams/:id/claim', authMiddleware, requireRole('SETTER'), async (req: AuthRequest, res: any) => {
  const { rows: userRows } = await db.query('SELECT status FROM users WHERE id = $1', [req.user!.id]);
  const liveUser = userRows[0];
  if (!liveUser || liveUser.status !== 'APPROVED') {
    return res.status(403).json({ error: 'Access denied: Setter not approved' });
  }
  const examId = req.params.id;
  const setterId = req.user!.id;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: examRows } = await client.query('SELECT * FROM examinations WHERE id = $1 FOR UPDATE', [examId]);
    const exam = examRows[0];
    if (!exam || !['APPROVED', 'COLLECTING'].includes(exam.status)) {
      throw new Error('Exam not available for claiming');
    }
    const { rows: existRows } = await client.query('SELECT * FROM setter_assignments WHERE examination_id = $1 AND setter_id = $2', [examId, setterId]);
    if (existRows.length > 0) {
      throw new Error('You have already claimed an assignment for this examination');
    }
    const { rows: countRows } = await client.query('SELECT COUNT(*) as c FROM setter_assignments WHERE examination_id = $1', [examId]);
    if (parseInt(countRows[0].c) >= exam.required_setter_count) {
      throw new Error('No remaining slots for this examination');
    }
    await client.query(`
      INSERT INTO setter_assignments (examination_id, setter_id, questions_required)
      VALUES ($1, $2, $3)
    `, [examId, setterId, exam.questions_per_setter]);
    if (exam.status === 'APPROVED') {
      await client.query("UPDATE examinations SET status = 'COLLECTING' WHERE id = $1", [examId]);
    }
    await client.query('COMMIT');
    await logAudit('SETTER_CLAIMED_EXAM', setterId, `Exam ID: ${examId}`);
    res.json({ success: true });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});
router.get('/setter/assignments', authMiddleware, requireRole('SETTER'), async (req: AuthRequest, res: any) => {
  const { rows: userRows } = await db.query('SELECT status FROM users WHERE id = $1', [req.user!.id]);
  const liveUser = userRows[0];
  if (!liveUser || liveUser.status !== 'APPROVED') {
    return res.status(403).json({ error: 'Access denied: Setter not approved' });
  }
  const { rows } = await db.query(`
    SELECT sa.id, sa.examination_id, sa.questions_required, sa.questions_submitted, sa.status, e.examination_name, e.subject 
    FROM setter_assignments sa
    JOIN examinations e ON sa.examination_id = e.id
    WHERE sa.setter_id = $1
  `, [req.user!.id]);
  res.json(rows);
});
router.post('/setter/assignments/:id/questions', authMiddleware, requireRole('SETTER'), async (req: AuthRequest, res: any) => {
  const { rows: userRows } = await db.query('SELECT status FROM users WHERE id = $1', [req.user!.id]);
  const liveUser = userRows[0];
  if (!liveUser || liveUser.status !== 'APPROVED') {
    return res.status(403).json({ error: 'Access denied: Setter not approved' });
  }
  const assignmentId = req.params.id;
  const { rows: assignmentRows } = await db.query('SELECT * FROM setter_assignments WHERE id = $1 AND setter_id = $2', [assignmentId, req.user!.id]);
  const assignment = assignmentRows[0];
  if (!assignment) {
    await logAudit('UNAUTHORIZED_ASSIGNMENT_ACCESS', req.user!.id, `Assignment ID: ${assignmentId}`);
    return res.status(403).json({ error: 'Access denied' });
  }
  if (assignment.status === 'COMPLETED' || assignment.questions_submitted >= assignment.questions_required) {
    return res.status(400).json({ error: 'Quota reached. Assignment locked.' });
  }
  const { questions } = req.body;
  if (!Array.isArray(questions)) {
    return res.status(400).json({ error: 'Expected an array of questions' });
  }
  if (questions.length !== assignment.questions_required) {
    return res.status(400).json({ error: `Must submit exactly ${assignment.questions_required} questions. You submitted ${questions.length}.` });
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.question_text || !q.option_a || !q.option_b || !q.option_c || !q.option_d || !q.correct_option) {
      return res.status(400).json({ error: `Missing required fields in question ${i + 1}` });
    }
    if (!['A', 'B', 'C', 'D'].includes(q.correct_option)) {
      return res.status(400).json({ error: `Correct option must be A, B, C, or D in question ${i + 1}` });
    }
    const normalizedText = String(q.question_text).trim().replace(/\s+/g, ' ').toLowerCase();
    const { rows: dupRows } = await db.query("SELECT id FROM questions WHERE examination_id = $1 AND LOWER(TRIM(REPLACE(question_text, CHR(10), ' '))) = $2", [assignment.examination_id, normalizedText]);
    if (dupRows.length > 0) {
      await logAudit('DUPLICATE_QUESTION_REJECTED', req.user!.id, `Assignment ID: ${assignmentId}`);
      return res.status(400).json({ error: `Duplicate question detected at question ${i + 1}.` });
    }
    for (let j = 0; j < i; j++) {
        const prevNormalized = String(questions[j].question_text).trim().replace(/\s+/g, ' ').toLowerCase();
        if (normalizedText === prevNormalized) {
            return res.status(400).json({ error: `Duplicate question detected within submission at question ${i + 1} and ${j + 1}.` });
        }
    }
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const q of questions) {
        await client.query(`
          INSERT INTO questions (examination_id, setter_assignment_id, question_text, option_a, option_b, option_c, option_d, correct_option, category, difficulty)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [assignment.examination_id, assignmentId, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.category || null, q.difficulty || null]);
    }
    await client.query('UPDATE setter_assignments SET questions_submitted = $1, status = $2, completed_at = CURRENT_TIMESTAMP WHERE id = $3', [questions.length, 'COMPLETED', assignmentId]);
    await client.query('COMMIT');
    await logAudit('QUESTIONS_SUBMITTED_BATCH', req.user!.id, `Assignment ID: ${assignmentId}`);
    const { rows: examRows } = await db.query('SELECT * FROM examinations WHERE id = $1', [assignment.examination_id]);
    const exam = examRows[0];
    const { rows: poolRows } = await db.query("SELECT COUNT(*) as c FROM questions WHERE examination_id = $1 AND status = 'SUBMITTED'", [exam.id]);
    if (parseInt(poolRows[0].c) >= exam.candidate_question_count && exam.status === 'COLLECTING') {
      await db.query("UPDATE examinations SET status = 'READY_FOR_SELECTION' WHERE id = $1", [exam.id]);
    }
    res.json({ success: true, submitted: questions.length });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error(err); res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});
import { SecureQuestionSelector } from './selector';
router.post('/exams/:id/select', authMiddleware, requireRole('ORG'), async (req: AuthRequest, res: any) => {
  const { rows: examRows } = await db.query('SELECT * FROM examinations WHERE id = $1 AND organization_id = $2', [req.params.id, req.user!.id]);
  const exam = examRows[0];
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  if (exam.status !== 'READY_FOR_SELECTION') {
    return res.status(400).json({ error: 'Exam is not in READY_FOR_SELECTION state' });
  }
  const { rows: existRows } = await db.query('SELECT id FROM final_selections WHERE examination_id = $1', [exam.id]);
  if (existRows.length > 0) {
    return res.status(400).json({ error: 'Selection already generated for this examination' });
  }
  try {
    const result = await SecureQuestionSelector.generate(exam.id);
    await logAudit('SELECTION_GENERATED', req.user!.id, `Exam ID: ${exam.id}`);
    res.json(result);
  } catch (err: any) {
    await logAudit('SELECTION_FAILED', req.user!.id, err.message);
    res.status(400).json({ error: err.message });
  }
});
router.get('/exams/:id/selection', authMiddleware, requireRole('ORG'), async (req: AuthRequest, res: any) => {
  const { rows: examRows } = await db.query('SELECT * FROM examinations WHERE id = $1 AND organization_id = $2', [req.params.id, req.user!.id]);
  const exam = examRows[0];
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const { rows: selRows } = await db.query('SELECT examination_id, blueprint_status, algorithm_version, selected_at FROM final_selections WHERE examination_id = $1', [exam.id]);
  const selection = selRows[0];
  if (!selection) return res.status(404).json({ error: 'No selection found' });
  res.json(selection);
});
import { PaperGenerator } from './paperGenerator';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
router.post('/exams/:id/paper/generate', authMiddleware, requireRole('ORG'), async (req: AuthRequest, res: any) => {
  const { rows: examRows } = await db.query('SELECT id, organization_id FROM examinations WHERE id = $1 AND organization_id = $2', [req.params.id, req.user!.id]);
  const exam = examRows[0];
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  try {
    const result = await PaperGenerator.generateFinalPaper(exam.id);
    await logAudit('FINAL_PAPER_GENERATED', req.user!.id, `Exam ID: ${exam.id}`);
    await logAudit('FINAL_PAPER_ENCRYPTED', req.user!.id, `Exam ID: ${exam.id}`);
    await logAudit('FINAL_PAPER_INTEGRITY_HASH_CREATED', req.user!.id, `Exam ID: ${exam.id}`);
    res.json(result);
  } catch (err: any) {
    await logAudit('FINAL_PAPER_GENERATION_FAILED', req.user!.id, err.message);
    res.status(400).json({ error: err.message });
  }
});
router.get('/exams/:id/paper/status', authMiddleware, async (req: AuthRequest, res: any) => {
  if (req.user!.role !== 'ORG' && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.user!.role === 'ORG') {
    const { rows: examRows } = await db.query('SELECT id FROM examinations WHERE id = $1 AND organization_id = $2', [req.params.id, req.user!.id]);
    if (examRows.length === 0) return res.status(404).json({ error: 'Exam not found' });
  }
  const { rows: paperRows } = await db.query(`
    SELECT e.status as exam_status, f.integrity_hash as artifact_hash, e.release_at, 
           (CASE WHEN e.status = 'RELEASED' THEN f.generated_at ELSE NULL END) as released_at
    FROM final_papers f 
    JOIN examinations e ON f.examination_id = e.id 
    WHERE f.examination_id = $1
  `, [req.params.id]);
  const paper = paperRows[0];
  if (!paper) return res.status(404).json({ error: 'Paper not generated' });
  res.json({
    status: paper.exam_status,
    artifact_hash: paper.artifact_hash,
    release_at: paper.release_at,
    released_at: paper.released_at
  });
});
router.get('/exams/:id/paper/download', authMiddleware, requireRole('ORG'), async (req: AuthRequest, res: any) => {
  const { rows: examRows } = await db.query('SELECT id FROM examinations WHERE id = $1 AND organization_id = $2', [req.params.id, req.user!.id]);
  const exam = examRows[0];
  if (!exam) {
    await logAudit('UNAUTHORIZED_FINAL_PAPER_ACCESS', req.user!.id, `Attempted cross-tenant access for Exam ID: ${req.params.id}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { rows: paperRows } = await db.query('SELECT p.*, e.status as exam_status, e.release_at FROM final_papers p JOIN examinations e ON p.examination_id = e.id WHERE p.examination_id = $1', [exam.id]);
  const paper = paperRows[0];
  if (!paper) return res.status(404).json({ error: 'Final paper not found' });
  const now = new Date();
  const releaseTime = new Date(paper.release_at);
  if (now < releaseTime) {
    await logAudit('FINAL_PAPER_RELEASE_BLOCKED', req.user!.id, `Attempt to download before release_at. Exam ID: ${exam.id}`);
    return res.status(403).json({ error: 'Paper is locked until release time' });
  }
  const artifactPath = path.join(__dirname, '..', 'storage', paper.artifact_reference);
  if (!fs.existsSync(artifactPath)) {
    await logAudit('FINAL_PAPER_MISSING', req.user!.id, `Artifact missing for Exam ID: ${exam.id}`);
    return res.status(500).json({ error: 'Artifact missing from storage' });
  }
  const encryptedData = fs.readFileSync(artifactPath);
  const currentHash = crypto.createHash('sha256').update(encryptedData).digest('hex');
  if (currentHash !== paper.integrity_hash) {
    await logAudit('FINAL_PAPER_INTEGRITY_FAILURE', req.user!.id, `Hash mismatch for Exam ID: ${exam.id}`);
    return res.status(500).json({ error: 'Artifact integrity validation failed. Tampering detected.' });
  }
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    await logAudit('FINAL_PAPER_DECRYPTION_FAILED', req.user!.id, `Missing valid ENCRYPTION_KEY. Exam ID: ${exam.id}`);
    return res.status(500).json({ error: 'Server misconfiguration: Encryption key unavailable' });
  }
  const key = Buffer.from(keyHex, 'hex');
  try {
    const iv = encryptedData.subarray(0, 12);
    const authTag = encryptedData.subarray(12, 28);
    const ciphertext = encryptedData.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decryptedBody = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (paper.exam_status === 'LOCKED') {
        await db.query("UPDATE examinations SET status = 'RELEASED' WHERE id = $1", [paper.examination_id]);
        await logAudit('FINAL_PAPER_RELEASED', req.user!.id, `Exam ID: ${exam.id}`);
    }
    await logAudit('FINAL_PAPER_DOWNLOADED', req.user!.id, `Exam ID: ${exam.id}`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="final_paper_${exam.id}.pdf"`);
    res.send(decryptedBody);
  } catch (err: any) {
    await logAudit('FINAL_PAPER_DECRYPTION_FAILED', req.user!.id, err.message);
    return res.status(500).json({ error: 'Decryption failed. Potential tampering.' });
  }
});
router.get('/admin/exams/:id/assignments', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: any) => {
  const { rows: examRows } = await db.query('SELECT * FROM examinations WHERE id = $1', [req.params.id]);
  const exam = examRows[0];
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const { rows: assignments } = await db.query(`
    SELECT sa.id, sa.status, sa.questions_required, sa.questions_submitted, u.name as setter_name
    FROM setter_assignments sa
    JOIN users u ON sa.setter_id = u.id
    WHERE sa.examination_id = $1
  `, [exam.id]);
  res.json({ exam, assignments });
});
export default router;
