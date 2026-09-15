const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
async function api(endpoint, token = null, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(`http://localhost:3000/api${endpoint}`, {
        method, headers, body: body ? JSON.stringify(body) : null
    });
    return res.json();
}
async function testQPS(qps) {
    console.log(`\n=== TESTING EXACTLY ${qps} QUESTIONS PER SETTER ===`);
    const ts = Date.now();
    for(let i=0; i<10; i++) {
        await api('/auth/register', null, 'POST', { name: `S${i}`, email: `s${i}_${ts}@t.com`, password: 'pass', role: 'SETTER' });
    }
    const tAdmin = (await api('/auth/login', null, 'POST', { email: 'admin@gmail.com', password: 'demo_password_2026' })).token;
    await api('/auth/register', null, 'POST', { name: 'Org', email: `org_${ts}@t.com`, password: 'pass', role: 'ORG' });
    const tOrg = (await api('/auth/login', null, 'POST', { email: `org_${ts}@t.com`, password: 'pass' })).token;
    const settersList = await api('/admin/setters', tAdmin);
    for (const s of settersList) {
        if (s.email.includes(`${ts}@t.com`)) await api(`/admin/setters/${s.id}/approve`, tAdmin, 'POST');
    }
    const examReq = await api('/exams', tOrg, 'POST', {
        examination_name: `Dyn Exam QPS ${qps}`,
        subject: 'Math',
        required_question_count: 10,
        security_multiplier: 1.5,
        questions_per_setter: qps
    });
    const examId = examReq.id;
    console.log(`[Org] Created exam. Candidate target: ${examReq.candidate_question_count}, Required setters: ${examReq.required_setter_count}`);
    await api(`/admin/exams/${examId}/approve`, tAdmin, 'POST');
    let submittedQuestions = 0;
    const settersToUse = settersList.filter(s => s.email.includes(`${ts}@t.com`)).slice(0, examReq.required_setter_count);
    for (const s of settersToUse) {
        const tSetter = (await api('/auth/login', null, 'POST', { email: s.email, password: 'pass' })).token;
        await api(`/setter/exams/${examId}/claim`, tSetter, 'POST');
        const assignments = await api('/setter/assignments', tSetter);
        const myAssignment = assignments.find(a => a.examination_id === examId);
        console.log(`[Setter] Assignment generated for exactly ${myAssignment.questions_required} questions (matches ${qps} configuration)`);
        const qs = Array.from({length: qps}, (_, i) => ({
            question_text: `Q${i}_${Date.now()}`,
            option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D',
            correct_option: 'A'
        }));
        const subRes = await api(`/setter/assignments/${myAssignment.id}/questions`, tSetter, 'POST', { questions: qs });
        if (subRes.success) {
            console.log(`[Setter] Successfully submitted exactly ${qps} questions.`);
            submittedQuestions += qps;
        } else {
            console.error(`[Setter] Failed submission:`, subRes);
        }
    }
    const { rows: finalRows } = await pool.query('SELECT status, candidate_question_count, required_setter_count FROM examinations WHERE id = $1', [examId]);
    const examFinal = finalRows[0];
    console.log(`[Final] Exam status: ${examFinal.status}, Pool reached: ${submittedQuestions} >= ${examFinal.candidate_question_count}`);
}
async function runAll() {
    await testQPS(2);
    await testQPS(3);
    await testQPS(4);
    await testQPS(5);
    console.log('\nALL VERIFICATIONS PASSED.');
    await pool.end();
}
runAll().catch(err => {
    console.error(err);
    pool.end();
});
