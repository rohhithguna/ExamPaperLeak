# SECURE MANAGEMENT OF COMPETITIVE EXAMINATION QUESTION PAPERS
**A Cryptographically Secure, Distributed Framework for High-Stakes Examination Generation**

---

## 1. PROJECT OVERVIEW

The Secure Examination Platform is a web-based, highly concurrent application designed to manage the entire lifecycle of high-stakes competitive examination question-paper generation. 

In modern academic and professional ecosystems, the security of question papers is paramount. Conventional systems rely on localized trust, manual sharing of plaintext documents, and centralized compilation, leading to inevitable vulnerabilities. This platform completely isolates the question generation phase from the final selection, enforces cryptographic randomness (CSPRNG) to assemble the final paper, and ensures the artifact exists solely as AES-256-GCM ciphertext until a strict, server-enforced release time. 

The system strictly compartments three user roles: **Administrators** who oversee approvals, **Organizations** who configure exam parameters but cannot see questions, and **Question Setters** who contribute blindly to a dynamic candidate pool. By decentralizing contributions and encrypting the final output, the platform eliminates the single points of failure that cause paper leaks.

---

## 2. PROBLEM STATEMENT

Conventional examination paper generation introduces severe operational and security risks:
- **Dependence on Individual Setters:** Relying on one or two setters exposes the entire paper to targeted coercion or bribery.
- **Uncontrolled Data Flow:** Questions are frequently transmitted over insecure channels (email, messaging apps) leaving plaintext digital footprints.
- **Premature Access:** Central administrators often have complete access to finalized papers weeks before an exam.
- **Lack of Redundancy:** Hardcoded papers provide no fallback if questions are exposed or compromised.
- **Data Integrity:** No cryptographic mechanisms exist to prove a paper has not been tampered with post-compilation.

---

## 3. OBJECTIVES

This project implements the following core objectives:
- **Controlled Question Collection:** Distribute question generation across blinded setters.
- **Role-Based Access Control:** Strict authorization boundaries between Admins, Orgs, and Setters.
- **Candidate-Question Redundancy:** Enforce a dynamic candidate pool larger than the final examination requirement.
- **Secure Final Selection:** Utilize cryptographically secure pseudo-randomness for final assembly.
- **Encrypted Paper Storage:** Ensure zero plaintext persistence via symmetric authenticated encryption.
- **Release-Time Protection:** Strictly enforce UTC timestamp boundaries for decryption.
- **Auditability:** Maintain a strict ledger of security-critical actions.

---

## 4. KEY FEATURES

- **Admin Approval Workflow:** Complete oversight over Setter registration and Org examination requests.
- **Organization Request Creation:** Parameterized generation requests defining scale and constraints.
- **Setter Slot Claiming:** Concurrent transactional slot claiming on a first-come, first-served basis.
- **Dynamic Questions-per-Setter:** Flexible, non-hardcoded contribution limits validated via the backend.
- **Duplicate Protection:** Deterministic exact-text matching to prevent redundant pool submissions.
- **CSPRNG-Based Final Selection:** Fisher-Yates shuffle guaranteeing statistically sound, unpredictable selections.
- **PDF Generation:** In-memory MinimalPDF rendering.
- **AES-256-GCM Encryption:** Authenticated symmetric encryption neutralizing padding oracle attacks.
- **SHA-256 Integrity Verification:** Post-generation hashing to detect ciphertext tampering.
- **Concurrent Setter-Claim Protection:** PostgreSQL row-level locking (`SELECT FOR UPDATE`) prevents over-claiming.
- **Audit Logging:** Database-level tracking of authentications, selections, and access requests.

---

## 5. USER ROLES

| Role | Responsibility | Main Actions |
|---|---|---|
| **ADMIN** | Platform governance | Approves/rejects Setters and drafted Exams. Cannot view final papers or question text. |
| **ORGANIZATION** | Examination board | Creates exam configurations, triggers CSPRNG selection, generates encrypted artifacts, and downloads the decrypted paper *only* after release time. |
| **QUESTION SETTER** | Subject matter experts | Claims approved exams, fulfills dynamic question quotas into a blinded candidate pool. Cannot see the final paper or other setters' questions. |

---

## 6. COMPLETE SYSTEM WORKFLOW

**Organization**  
↓  
Creates Examination Request  
↓  
**DRAFT** Status  
↓  
**Admin** Reviews Request  
↓  
**Admin** Approves Examination  
↓  
Exam Broadcast to Approved **Setters**  
↓  
Setters Concurrently Claim Contribution Slots  
↓  
Setters Submit Dynamic Question Quotas  
↓  
Questions accumulate in the **Candidate Question Pool**  
↓  
Target Reached → **CSPRNG** Final Selection triggered by Organization  
↓  
In-Memory **PDF Generation**  
↓  
**AES-256-GCM Encryption** of the PDF  
↓  
**SHA-256 Integrity** hash generated and stored  
↓  
Strict **Release Time** enforcement by server  
↓  
Authorized Organization Access (Decryption & Download)

---

## 7. EXAMINATION CONFIGURATION

The system dynamically computes the required resources for every examination to ensure sufficient entropy and load distribution. The parameters include:

- `final_question_count`
- `security_multiplier`
- `questions_per_setter`
- `release_at`

**Dynamic Calculations:**
```text
candidate_question_count = ceil(final_question_count × security_multiplier)
required_setter_count = ceil(candidate_question_count / questions_per_setter)
```

The system uses more candidate questions than the final paper requires to ensure the selection algorithm can introduce cryptographic unpredictability. If the candidate pool matched the final paper exactly, a setter might easily deduce the entire final paper.

---

## 8. SAMPLE INPUT AND OUTPUT

### Sample Input
- **Exam Name:** Competitive Examination 2026
- **Final Questions:** 100
- **Security Multiplier:** 1.5
- **Questions per Setter:** 4
- **Release Time:** Configured future release time

### Processing
- **Candidate Questions:** `ceil(100 × 1.5) = 150`
- **Required Setters:** `ceil(150 / 4) = 38`

### Sample Output
- **Candidate Question Pool:** 150 questions
- **Required Setter Contributions:** 38 individual setters
- **Questions per Setter:** 4 exactly (dynamically enforced input fields)
- **Final Selected Questions:** 100
- **Final Paper:** Generated PDF
- **Storage:** AES-256-GCM encrypted binary artifact in `/storage/`
- **Integrity:** SHA-256 hash stored in PostgreSQL
- **Access:** Available strictly to the configuring organization after the UTC release time.

---

## 9. SECURITY ARCHITECTURE

### Authentication
User sessions are secured using JWT (JSON Web Tokens) signed with a robust `JWT_SECRET`. Passwords are irreversibly hashed via `bcrypt` (10 rounds).

### Authorization
Role-based middleware validates the token payload against the requested route. Ownership checks ensure an organization cannot request another organization's examination data.

### Setter Isolation
Setters are granted strict boundary access. They cannot query the global question pool, they cannot view the identities of other setters, and they are completely blocked from viewing the final PDF artifact.

### Organization Isolation
Organization route parameters (`:id`) are rigorously verified against the authenticated `req.user.id`, neutralizing Cross-Organization IDOR (Insecure Direct Object Reference) vulnerabilities.

### Concurrent Claim Protection
To prevent race conditions where 50 setters attempt to claim the final available slot simultaneously, the application uses PostgreSQL atomic transactions (`BEGIN` → `SELECT FOR UPDATE` → `COMMIT`) to serialize allocations.

### CSPRNG Selection
The Fisher-Yates shuffle is implemented using Node's `crypto.randomInt`. Standard `Math.random()` is avoided because pseudo-random generators are predictable. CSPRNG guarantees cryptographic unpredictability for final blueprint assembly.

### Encryption
The generated PDF is immediately encrypted using **AES-256-GCM**.
- **256-bit Key**: Supplied securely via environment variables (`ENCRYPTION_KEY`).
- **Random 12-byte IV**: Guarantees uniqueness for every encryption pass.
- **Authentication Tag**: A 16-byte tag appended to the ciphertext to prevent tampering.
- **Zero Plaintext**: The unencrypted PDF exists only transiently in RAM.

### Integrity
A **SHA-256** hash of the fully assembled encrypted artifact is saved to the database. During the download process, this hash is recomputed to verify that the storage disk has not suffered bit-rot or malicious tampering.

### Release Protection
Server-side business logic strictly compares the current `Date.now()` against the examination's `release_at` timestamp. Attempting to download the paper early yields a cryptographic hard-stop (`403 Forbidden`).

---

## 10. TECHNOLOGY STACK

| Technology | Purpose |
|---|---|
| **Node.js** | Backend runtime environment |
| **Express** | REST API framework and routing |
| **TypeScript** | Static typing and structural integrity |
| **PostgreSQL** | Primary relational database |
| **pg** | Non-blocking PostgreSQL client for Node.js |
| **Vanilla HTML/CSS/JS** | Lightweight Single Page Application frontend |
| **Node.js crypto** | CSPRNG, AES-256-GCM, and SHA-256 implementations |
| **bcrypt** | Password hashing |
| **jsonwebtoken** | Stateless session authentication |

---

## 11. SYSTEM ARCHITECTURE

```text
       User
         ↓
      Frontend (SPA)
         ↓
  Express / Node.js Backend
         ↓
Authentication + Authorization (JWT)
         ↓
  PostgreSQL (Transactions)
         ↓
Question Pool / CSPRNG Selection
         ↓
 In-Memory PDF Generation
         ↓
AES-256-GCM Authenticated Encryption
         ↓
Encrypted Artifact Storage (/storage)
```

---

## 12. DATABASE

The application strictly uses **PostgreSQL**. No SQLite functionality remains.

| Table | Purpose |
|---|---|
| `users` | Stores authenticated identities, bcrypt password hashes, and roles. |
| `examinations` | Stores organization constraints, parameters, status, and release times. |
| `setter_assignments` | Maps setter claims to exams. Uses `UNIQUE(examination_id, setter_id)` constraint. |
| `questions` | The global candidate pool mapping individual questions to assignments. |
| `final_selections` | Stores the CSPRNG immutable shuffled array of selected question IDs. |
| `final_papers` | Stores the encrypted file reference and the SHA-256 integrity hash. |
| `audit_log` | Immutable ledger of critical state changes and access events. |

---

## 13. PROJECT STRUCTURE

```text
project/
├── database/
│   └── setupDb.ts           # PostgreSQL schema generation and demo user seeding
├── public/
│   └── index.html           # Vanilla Frontend application
├── src/
│   ├── auth.ts              # JWT Authentication and Role Middleware
│   ├── db.ts                # PostgreSQL connection pool configuration
│   ├── index.ts             # Express server entry point
│   ├── paperGenerator.ts    # Minimal PDF Generation and AES Encryption
│   ├── routes.ts            # Application API endpoints and workflow logic
│   └── selector.ts          # Fisher-Yates CSPRNG final question selection
├── storage/
│   └── .gitkeep             # Directory for AES-encrypted artifacts
├── tests/
│   ├── test_dynamic_qps.js  # Dynamic questions-per-setter verification
│   └── test_phaseG.js       # Complete E2E workflow verification
├── .env.example
├── .gitignore
├── package-lock.json
├── package.json
└── tsconfig.json
```

---

## 14. INSTALLATION AND SETUP

### Prerequisites
- Node.js (v18 or higher)
- PostgreSQL (v14 or higher) running locally or via remote connection
- `npm`

### Clone
```bash
git clone <repository-url>
cd <repository-directory>
```

### Install Dependencies
```bash
npm install
```

### Environment Configuration
Copy the template and provide valid credentials. Do not use quotes unless required by your shell.
```bash
cp .env.example .env
```
Ensure the following variables in `.env` are configured:
- `DATABASE_URL`: Valid PostgreSQL connection string (e.g., `postgresql://user:pass@localhost/dbname`).
- `JWT_SECRET`: A strong random string for session tokens.
- `ENCRYPTION_KEY`: A 64-character hex string representing a 256-bit symmetric key.

### Database Setup
Generates the schema and provisions the demo accounts:
```bash
npm run db:setup
```

### Start Application
```bash
npm run build
npm start
```
*(For development with live-reloading: `npm run dev`)*

---

## 15. DEMO LOGIN

The `db:setup` script automatically provisions the following **DEMONSTRATION** accounts for testing the workflow.

**Demo Password (All Accounts):** `demo_password_2026`

- **Admin:** `admin@gmail.com`
- **Organization:** `organization@gmail.com`
- **Setter 1:** `setter1@gmail.com`
- **Setter 2:** `setter2@gmail.com`
- **Setter 3:** `setter3@gmail.com`
- **Setter 4:** `setter4@gmail.com`
- **Setter 5:** `setter5@gmail.com`

*Note: These credentials must never be deployed to production.*

---

## 16. HOW TO USE THE SYSTEM

### Step 1 — Organization
Login as the Organization. Under "Create Examination", configure the final question count, security multiplier, and questions-per-setter constraints. Ensure the release time is set to the future.

### Step 2 — Admin
Logout, then login as Admin. Locate the newly drafted examination request on the dashboard and click "Approve".

### Step 3 — Setters
Login using a Setter account. You will see the approved examination under "Available Examinations". Click "Claim" to lock your slot. Complete the generated question fields and submit. Repeat with other Setter accounts until the required capacity is met.

### Step 4 — Finalization
Login again as the Organization. Once the candidate pool reaches the target capacity:
- Click **Trigger Secure Selection** (CSPRNG randomizes the blueprint).
- Click **Generate Encrypted Paper** (PDF is created, encrypted, and hashed).

### Step 5 — Release
Attempting to click **Download Decrypted Paper** before the release time will result in a server rejection. Once the release time has elapsed, clicking download will transparently decrypt the AES-GCM artifact and deliver the PDF.

---

## 17. TESTING AND VERIFICATION

The repository includes extensive native API tests covering concurrency, dynamic limits, and security constraints.

### Execution
```bash
node tests/test_phaseG.js
node tests/test_dynamic_qps.js
```

### Test Coverage Results

| Test Suite | Purpose | Result |
|---|---|---|
| **test_phaseG.js** | Core E2E Workflow (Auth → Exam → Selection → Encryption → Delivery) | **PASS** |
| **test_phaseG.js** | Concurrent Claim Protection (Full Capacity Rejection) | **PASS** |
| **test_phaseG.js** | Release-Time Enforcement & Decryption Validation | **PASS** |
| **test_phaseG.js** | SHA-256 Tampering Detection | **PASS** |
| **test_dynamic_qps.js** | Validates dynamic rendering of exactly 2, 3, 4, and 5 questions-per-setter constraints globally | **PASS** |

---

## 18. SECURITY TESTING

| Threat | Protection | Verification |
|---|---|---|
| Unauthorized assignment claiming | PostgreSQL `SELECT FOR UPDATE` transaction locking | Validated via `test_phaseG.js` capacity rejections |
| Predictable question selection | Fisher-Yates CSPRNG (`crypto.randomInt`) | Validated via randomized blueprint generation |
| Plaintext filesystem leakage | In-memory `PDFKit` + immediate AES-256-GCM | Validated via `/storage` binary inspection |
| Encrypted paper tampering | AES-GCM AuthTag + SHA-256 hashing | Validated via simulated bit-flipping in `test_phaseG.js` |
| Early organization access | Server-side UTC timestamp evaluation | Validated via 403 Forbidden assertions |

---

## 19. LIMITATIONS

- **Deterministic Duplicate Detection:** The system currently relies on normalized exact-text matching to detect duplicates. It cannot detect semantically identical questions phrased differently.
- **Local Artifact Storage:** While securely encrypted, the `.enc` artifacts are stored in the local `/storage` directory, limiting out-of-the-box distributed multi-node architecture without a shared volume.
- **Key Rotation:** The `ENCRYPTION_KEY` is statically provisioned via environment variables, requiring manual operational rotation.

---

## 20. FUTURE ENHANCEMENTS

- **AWS KMS Integration:** Seamless external key management to eliminate environment variable dependencies.
- **Scalable Object Storage:** Refactoring local storage logic to proxy encrypted uploads directly to Amazon S3.
- **Semantic Duplicate Analysis:** Integrating NLP algorithms (e.g., Levenshtein distance or LLM embedding checks) to evaluate semantic question similarity.
- **Institutional Authentication:** Integrating SAML/OAuth2 for native university or board Active Directory identity support.

---

## 21. AWS DEPLOYMENT READINESS

The application is fully prepared for cloud deployment. The target production database architecture relies on **Amazon RDS for PostgreSQL**. 

*Note: The application is currently implemented and tested locally. AWS deployment is the intended next operational phase.* 

To deploy:
1. Provision an Amazon RDS PostgreSQL instance.
2. Deploy the Express application to AWS Elastic Beanstalk or EC2.
3. Pass all `.env` requirements (`DATABASE_URL`, `ENCRYPTION_KEY`, `JWT_SECRET`) directly into the secure AWS environment variables console.

## 21.0 AWS CLOUD DEPLOYMENT

The Secure Management of Competitive Examination Question Papers platform has been deployed on Amazon Web Services (AWS) using a cloud-based architecture consisting of an Amazon EC2 application server and a private Amazon RDS PostgreSQL database.

The AWS deployment preserves the same application architecture and security mechanisms implemented in the local version. No changes were made to the core examination workflow.

### 21.1 Live Application

The deployed application is accessible at:

Live Application: http://13.51.178.204:3000

GitHub Repository:
https://github.com/rohhithguna/ExamPaperLeak

The application is currently accessible through the EC2 public IP address. HTTPS and a domain name can be added as a future deployment enhancement using Nginx and SSL/TLS.

### 21.2 AWS Deployment Architecture

The deployed architecture follows a two-tier model:

Internet
   |
   v
Amazon EC2
(exampaper-server)
   |
   | PostgreSQL over SSL/TLS
   v
Amazon RDS
(exampaper-db)
   |
   v
PostgreSQL Database
(exampaper)

The EC2 instance hosts the Node.js/Express application, while Amazon RDS provides the PostgreSQL database service.

The RDS instance is not publicly accessible. Database access is restricted through AWS Security Groups.

### 21.3 AWS Region

The complete deployment was created in the AWS Europe (Stockholm) region.

AWS Region:
eu-north-1

This region contains both the EC2 application server and the RDS PostgreSQL database.

### 21.4 Amazon EC2 Application Server

The application is hosted on an Amazon EC2 instance with the following configuration:

Instance Name:
exampaper-server

Operating System:
Amazon Linux 2023

Node.js Version:
Node.js 22

Application Framework:
Node.js + Express + TypeScript

Application Directory:
~/ExamPaperLeak

The project repository was cloned from GitHub onto the EC2 server.

Application setup commands used:

    git clone https://github.com/rohhithguna/ExamPaperLeak.git
    cd ExamPaperLeak
    npm ci
    npm run build

The TypeScript source code is compiled into the `dist/` directory.

The application is started using:

    node dist/index.js

The compiled application entry point is:

    dist/index.js

### 21.5 Amazon RDS PostgreSQL Database

The application database is hosted using Amazon RDS.

RDS Instance Identifier:
exampaper-db

Database Name:
exampaper

Database Engine:
PostgreSQL

Database Port:
5432

RDS Public Accessibility:
No

RDS Endpoint:

    exampaper-db.clke4s8g6im9.eu-north-1.rds.amazonaws.com

The database is hosted privately and is not directly exposed to the public internet.

The application running on EC2 communicates with RDS using PostgreSQL over a secured connection.

### 21.6 AWS Security Groups

Two AWS Security Groups are used to control network access.

EC2 Security Group:
launch-wizard-1

RDS Security Group:
exampaper-rds-sg

The EC2 instance allows application traffic on TCP port 3000 for the currently deployed HTTP application.

The RDS security group allows PostgreSQL traffic on TCP port 5432 from the EC2 security group.

Therefore, the database is not opened to unrestricted internet access.

Network flow:

    Internet
       |
       | TCP 3000
       v
    EC2 Server
       |
       | TCP 5432
       | SSL/TLS
       v
    RDS PostgreSQL

### 21.7 Secure PostgreSQL Connection

The Node.js application connects to Amazon RDS using the PostgreSQL connection string stored in the environment configuration.

The application uses SSL/TLS for the PostgreSQL connection.

The database connection configuration includes:

    ssl: {
      rejectUnauthorized: false
    }

The connection uses the following environment variable:

    DATABASE_URL=postgresql://username:password@hostname:5432/exampaper

The database connection was tested successfully from the EC2 instance.

TCP connectivity to PostgreSQL was verified on port 5432.

The RDS connection was also verified using PostgreSQL client tools with SSL enabled.

The successful database connection used TLS 1.3 with the TLS_AES_256_GCM_SHA384 cipher.

### 21.8 Environment Variables and Secret Management

Sensitive configuration values are stored in the EC2 server's `.env` file.

The application uses the following environment variables:

    PORT=3000
    DATABASE_URL=postgresql://username:password@hostname:5432/exampaper
    ENCRYPTION_KEY=your_64_character_hex_key_here
    JWT_SECRET=your_jwt_secret_here

The `.env` file is excluded from Git using `.gitignore`.

Only `.env.example` is committed to the repository as a configuration template.

Sensitive values such as:

- PostgreSQL credentials
- AES-256-GCM encryption key
- JWT secret

are not stored in the GitHub repository.

### 21.9 Database Initialization

After establishing the RDS connection, the PostgreSQL database schema was initialized using the project's database setup script.

The following command was executed on EC2:

    npm run db:setup

The database initialization completed successfully.

The following tables were created:

- users
- examinations
- setter_assignments
- questions
- final_selections
- final_papers
- audit_log

Demo accounts were also seeded during database initialization for development and demonstration purposes.

The database was verified directly through PostgreSQL after setup.

### 21.10 Permanent Application Service

To ensure that the application continues running after the EC2 terminal session is closed or the server is restarted, a Linux systemd service was configured.

Service Name:

    exampaper.service

The service configuration uses:

    [Unit]
    Description=Secure Exam Paper Platform
    After=network.target

    [Service]
    Type=simple
    User=ec2-user
    WorkingDirectory=/home/ec2-user/ExamPaperLeak
    ExecStart=/usr/bin/node /home/ec2-user/ExamPaperLeak/dist/index.js
    Restart=always
    RestartSec=5
    Environment=NODE_ENV=production

    [Install]
    WantedBy=multi-user.target

The service was enabled using:

    sudo systemctl daemon-reload
    sudo systemctl enable exampaper
    sudo systemctl start exampaper

The service status was verified successfully:

    sudo systemctl status exampaper

The application service is currently active and running.

### 21.11 External Application Verification

After configuring the EC2 Security Group, the application was tested from outside the EC2 instance.

The following endpoint was tested:

    http://13.51.178.204:3000

The server returned:

    HTTP/1.1 200 OK

The Secure Exam Platform login/application page was successfully loaded through a web browser.

This confirmed the complete basic deployment path:

    Browser
       |
       v
    EC2 Public IP
       |
       v
    Node.js + Express
       |
       v
    PostgreSQL RDS

### 21.12 AWS Deployment Mapping to Project Components

The major project components are mapped to the AWS infrastructure as follows:

| Project Component | AWS Deployment Location |
|---|---|
| Frontend | Served by Node.js/Express on EC2 |
| Express Backend | Amazon EC2 |
| Authentication | EC2 application server |
| JWT Authentication | EC2 application server |
| Examination Management | EC2 application server |
| Setter Assignment | EC2 application server |
| Question Collection | EC2 application server |
| CSPRNG Selection | EC2 application server |
| PDF Generation | EC2 application server |
| AES-256-GCM Encryption | EC2 application server |
| SHA-256 Integrity Hashing | EC2 application server |
| PostgreSQL Database | Amazon RDS |
| Database Tables | Amazon RDS PostgreSQL |
| Encrypted Paper Artifacts | EC2 `storage/` directory |
| Environment Secrets | EC2 `.env` file |
| Application Process Management | Linux systemd |
| Network Access Control | AWS Security Groups |

The core application logic remains unchanged from the locally tested implementation. AWS provides the cloud infrastructure required to host the application and database.

### 21.13 Current AWS Deployment Status

The following deployment components have been successfully completed and verified:

| Component | Status |
|---|---|
| AWS Region Configuration | Completed |
| EC2 Instance Creation | Completed |
| Amazon Linux 2023 Setup | Completed |
| Node.js 22 Installation | Completed |
| Git Repository Deployment | Completed |
| npm Dependency Installation | Completed |
| TypeScript Build | Completed |
| Amazon RDS PostgreSQL Creation | Completed |
| PostgreSQL Database Creation | Completed |
| EC2 → RDS Connectivity | Verified |
| PostgreSQL SSL/TLS Connection | Verified |
| Database Schema Initialization | Completed |
| Demo Account Seeding | Completed |
| AWS Security Group Configuration | Completed |
| Express Application Deployment | Completed |
| External HTTP Access | Verified |
| systemd Service Configuration | Completed |
| Automatic Service Restart | Configured |
| Live Application Access | Verified |

The application is currently deployed and accessible through the EC2 public IP address.

Future infrastructure enhancements may include:

- Nginx reverse proxy
- HTTPS using SSL/TLS certificates
- Custom domain name
- AWS Route 53
- Amazon S3 for encrypted paper artifact storage
- AWS KMS for managed key protection
- CloudWatch monitoring and logging
- Automated CI/CD deployment using GitHub Actions

These enhancements are optional extensions and are not required for the core examination question-paper security workflow implemented in the project.
## 22. LICENSE

This project is licensed under the **ISC License**.
