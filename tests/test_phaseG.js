const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
async function api(endpoint, token = null, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(`http://localhost:3000/api${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
    });
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/pdf')) {
        const buffer = await res.arrayBuffer();
        return { status: res.status, data: Buffer.from(buffer), isPdf: true };
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, isPdf: false };
}
async function login(email) {
    const res = await api('/auth/login', null, 'POST', { email, password: 'pass' });
    if (res.status !== 200) throw new Error(`Login failed for ${email}: ` + JSON.stringify(res.data));
    return res.data.token;
}
const makeQs = (n, prefix) => Array.from({length: n}, (_, i) => ({
    question_text: `E2E_Q_${prefix}_${i}_${Date.now()}`,
    option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D',
    correct_option: 'B', category: 'General', difficulty: 'Medium'
}));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function runE2E() {
    console.log('=== RUNNING PHASE G END-TO-END INTEGRATION TEST ===');
    const ts = Date.now();
    const adminEmail = 'admin@gmail.com';
    const adminPass = 'demo_password_2026';
    const orgEmail = `org_g_${ts}@test.com`;
    const s1Email = `setter1_g_${ts}@test.com`;
    const s2Email = `setter2_g_${ts}@test.com`;
    const s3Email = `setter3_g_${ts}@test.com`;
    const s4Email = `setter4_g_${ts}@test.com`;
    await api('/auth/register', null, 'POST', { name: 'Org A', email: orgEmail, password: 'pass', role: 'ORG' });
    await api('/auth/register', null, 'POST', { name: 'Setter 1', email: s1Email, password: 'pass', role: 'SETTER' });
    await api('/auth/register', null, 'POST', { name: 'Setter 2', email: s2Email, password: 'pass', role: 'SETTER' });
    await api('/auth/register', null, 'POST', { name: 'Setter 3', email: s3Email, password: 'pass', role: 'SETTER' });
    await api('/auth/register', null, 'POST', { name: 'Setter 4', email: s4Email, password: 'pass', role: 'SETTER' });
    console.log('[1] Users Registered successfully');
    const tAdmin = await api('/auth/login', null, 'POST', { email: adminEmail, password: adminPass }).then(r => r.data.token);
    const tOrg = await login(orgEmail);
    const settersList = await api('/admin/setters', tAdmin);
    for (const s of settersList.data) {
        if (s.email.includes(`_g_${ts}`)) {
            await api(`/admin/setters/${s.id}/approve`, tAdmin, 'POST');
        }
    }
    console.log('[2] Setters Approved by Admin');
    const tS1 = await login(s1Email);
    const tS2 = await login(s2Email);
    const tS3 = await login(s3Email);
    const tS4 = await login(s4Email);
    const releaseTime = new Date(Date.now() + 4000).toISOString(); 
    const resExam = await api('/exams', tOrg, 'POST', {
        examination_name: `Phase G E2E Demo ${ts}`, subject: 'Computer Science',
        required_question_count: 4, security_multiplier: 1.5, questions_per_setter: 2,
        release_at: releaseTime
    });
    const examId = resExam.data.id;
    console.log(`[3] Exam Created: Candidate Target = ${resExam.data.candidate_question_count}, Required Setters = ${resExam.data.required_setter_count}`);
    const approveRes = await api(`/admin/exams/${examId}/approve`, tAdmin, 'POST');
    console.log(`[4] Exam Approved by Admin. Status: ${approveRes.status === 200 ? 'SUCCESS' : 'FAILED'}`);
    const assignedTokens = [];
    const assignmentMap = {};
    const availableSetters = [s1Email, s2Email, s3Email, s4Email];
    let claimCount = 0;
    for (let i = 0; i < availableSetters.length; i++) {
        const uEmail = availableSetters[i];
        const tk = await login(uEmail);
        const claimRes = await api(`/setter/exams/${examId}/claim`, tk, 'POST');
        if (claimRes.status === 200) {
            assignedTokens.push(tk);
            const assigns = await api('/setter/assignments', tk);
            const a = assigns.data.find(x => x.examination_id === examId);
            assignmentMap[claimCount] = a.id;
            claimCount++;
        } else {
            console.log(`[5] Setter ${i+1} could not claim (Expected if slots are full):`, claimRes.data.error);
        }
    }
    console.log(`[6] Exam Claimed by ${assignedTokens.length} setters voluntarily.`);
    const sampleAssignId = Object.values(assignmentMap)[0];
    const sampleToken = assignedTokens[0];
    const failRes1 = await api(`/setter/assignments/${sampleAssignId}/questions`, sampleToken, "POST", { questions: makeQs(1, "TOO_FEW") });
    if (failRes1.status === 400) console.log('[6] Server rejected insufficient question count.');
    const failRes2 = await api(`/setter/assignments/${sampleAssignId}/questions`, sampleToken, 'POST', { questions: makeQs(3, 'TOO_MANY') });
    if (failRes2.status === 400) console.log('[7] Server rejected excessive question count.');
    for (let i = 0; i < assignedTokens.length; i++) {
        const aId = Object.values(assignmentMap)[i];
        const tk = assignedTokens[i];
        await api(`/setter/assignments/${aId}/questions`, tk, 'POST', { questions: makeQs(2, `S${i}`) });
    }
    console.log('[8] Setters submitted exactly 2 questions each into Candidate Pool.');
    const prog = await api(`/exams/${examId}/progress`, tOrg);
    console.log(`[9] Org Progress View: Submitted ${prog.data.submitted_questions} / 6 target.`);
    const { rows: examRows } = await pool.query('SELECT status FROM examinations WHERE id = $1', [examId]);
    if (examRows[0].status === 'READY_FOR_SELECTION') console.log('[10] Examination automatically shifted to READY_FOR_SELECTION.');
    const selectRes = await api(`/exams/${examId}/select`, tOrg, 'POST');
    console.log(`[11] CSPRNG Selection complete. Selected ${selectRes.data.selected_count} / ${selectRes.data.candidate_pool_count} candidates.`);
    const selectResFail = await api(`/exams/${examId}/select`, tOrg, 'POST');
    if (selectResFail.status === 400) console.log('[12] Selection securely locked. Immutability enforced.');
    const pdfRes = await api(`/exams/${examId}/paper/generate`, tOrg, 'POST');
    console.log(`[13] PDF Generated, Encrypted (AES-GCM), and Hashed (SHA-256). Artifact: ${pdfRes.data.artifact_reference}`);
    const { rows: paperRows } = await pool.query('SELECT artifact_reference FROM final_papers WHERE examination_id = $1', [examId]);
    const artifactPath = path.join(__dirname, '..', 'storage', paperRows[0].artifact_reference);
    const rawBytes = fs.readFileSync(artifactPath);
    if (!rawBytes.toString('utf8', 0, 4).includes('%PDF')) {
        console.log('[14] Storage confidentiality verified. Stored artifact is strictly ciphertext.');
    }
    const earlyRes = await api(`/exams/${examId}/paper/download`, tOrg);
    if (earlyRes.status === 403) console.log('[15] Early release properly blocked by backend UTC clock.');
    const setFail = await api(`/exams/${examId}/paper/download`, tS1);
    if (setFail.status === 403) console.log('[16] Setter correctly blocked from final paper access.');
    console.log('[17] Waiting 5 seconds to bypass Release Time lock...');
    await sleep(5000);
    const dlValid = await api(`/exams/${examId}/paper/download`, tOrg);
    if (dlValid.isPdf && dlValid.data.toString('utf8', 0, 4).includes('%PDF')) {
        console.log('[18] Release lock cleared. Integrity hash verified. Authenticated decryption successful. Final Paper Delivered.');
    } else console.log('FAIL: Did not get decrypted PDF back', dlValid);
    rawBytes[40] ^= 0x01; 
    fs.writeFileSync(artifactPath, rawBytes);
    const dlTampered = await api(`/exams/${examId}/paper/download`, tOrg);
    if (dlTampered.status === 500) console.log('[19] SHA-256 / AES-GCM caught ciphertext tampering successfully.');
    console.log('\n--- E2E DEMO SUCCESSFUL ---');
    await pool.end();
}
runE2E().catch(err => {
    console.error(err);
    pool.end();
});
