
import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import path from "path"; 
import { fileURLToPath } from 'url'; 
import { dirname } from 'path';  
import session from "express-session";   
import multer from 'multer';
import QRCode from "qrcode";
import fs from "fs";
import Tesseract from "tesseract.js";
import { createRequire } from "module";
import Groq from "groq-sdk";

const groq = new Groq({
    apiKey: "-----"
});

const require = createRequire(import.meta.url);

const pdf = require("pdf-parse");

dotenv.config();

// Used by /analyze-transcript and QR code generation.
const baseUrl = process.env.BASE_URL;

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const upload = multer({ dest: 'public/uploads/' });

const app = express();
const port = 3000;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10), 
    max: 20, 
    idleTimeoutMillis: 30000,
});

pool.connect()
    .then(() => console.log('✅ PostgreSQL Pool connected successfully.'))
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1); 
    });

// Lightweight schema bootstrapping for analytics/session tracking.
// Keeps the app working even when the DB is missing newer columns/tables.
async function ensureAnalyticsSchema() {
    // Patients: created_at is needed for registration trends.
    await pool.query(`
        ALTER TABLE patients
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    // Consultation/transcription sessions. Kept FK-free to tolerate schema drift.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS consultation_sessions (
            sessionid BIGSERIAL PRIMARY KEY,
            patientid BIGINT,
            doctor_userid BIGINT,
            appointmentid BIGINT,
            status TEXT NOT NULL DEFAULT 'Recording',
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ,
            transcript TEXT,
            analysis_json JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // In case the table already existed before analysis_json was added.
    await pool.query(`
        ALTER TABLE consultation_sessions
        ADD COLUMN IF NOT EXISTS analysis_json JSONB
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultation_sessions_created_at ON consultation_sessions (created_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultation_sessions_doctor_userid ON consultation_sessions (doctor_userid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultation_sessions_status ON consultation_sessions (status)`);
}

ensureAnalyticsSchema()
    .then(() => console.log("✅ Analytics schema ensured."))
    .catch(err => console.error("❌ Failed to ensure analytics schema:", err.message));

// Detect whether the DB is using the legacy Clinicians table or the new single Users table.
// This lets the app work with either schema while you transition.
const dbModePromise = (async () => {
    const mode = {
        hasCliniciansTable: false,
        // Legacy: clinicianid (points to clinicians.clinicianid)
        // New ERD: userid / doctor_userid (points to users.userid)
        appointmentsDoctorColumn: "clinicianid",
        // Columns on users that hold doctor metadata (varies by migration).
        userDoctorColumns: [],
    };

    try {
        await pool.query("SELECT 1 FROM clinicians LIMIT 1");
        mode.hasCliniciansTable = true;
    } catch {
        mode.hasCliniciansTable = false;
    }

    try {
        const colRes = await pool.query(
            `
            SELECT LOWER(column_name) AS column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'appointments'
              AND LOWER(column_name) IN ('userid', 'doctor_userid', 'clinicianid')
            `
        );
        const cols = new Set(colRes.rows.map(r => r.column_name));
        if (cols.has("doctor_userid")) mode.appointmentsDoctorColumn = "doctor_userid";
        else if (cols.has("userid")) mode.appointmentsDoctorColumn = "userid";
        else if (cols.has("clinicianid")) mode.appointmentsDoctorColumn = "clinicianid";
    } catch {
        // If we can't introspect, keep safe legacy default.
    }

    try {
        const userColRes = await pool.query(
            `
            SELECT LOWER(column_name) AS column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND LOWER(column_name) IN ('licensenumber', 'specialty', 'specialization', 'license_number')
            `
        );
        mode.userDoctorColumns = userColRes.rows
            .map(r => r.column_name)
            .filter(c => typeof c === "string" && /^[a-z_]+$/.test(c));
    } catch {
        mode.userDoctorColumns = [];
    }

    return mode;
})();

async function getDbMode() {
    return dbModePromise;
}

async function getSessionUser(req) {
    const currentUserId = req.session?.userId;
    if (!currentUserId) return null;

    const mode = await getDbMode();
    const baseCols = ["userid", "userrole", "firstname", "lastname", "email", "phonenumber"];
    const extraCols = Array.isArray(mode.userDoctorColumns) ? mode.userDoctorColumns : [];
    const selectCols = [...baseCols, ...extraCols];
    const selectList = selectCols.map(c => `"${c}"`).join(", ");

    const userRes = await pool.query(`SELECT ${selectList} FROM users WHERE userid = $1`, [currentUserId]);
    return userRes.rows[0] || null;
}

async function getDoctorFkValueForUserId(currentUserId) {
    const mode = await getDbMode();

    let doctorFkValue = currentUserId;
    if (mode.appointmentsDoctorColumn === "clinicianid") {
        const clinicianRes = await pool.query("SELECT clinicianid FROM clinicians WHERE userid = $1", [currentUserId]);
        if (clinicianRes.rows.length === 0) {
            const err = new Error("This doctor is not registered in the clinicians table.");
            err.code = "DOCTOR_NOT_IN_CLINICIANS";
            throw err;
        }
        doctorFkValue = clinicianRes.rows[0].clinicianid;
    }

    return { mode, doctorFkValue };
}

function requireLogin(req, res, next) {
    if (!req.session?.userId) return res.redirect("/login");
    return next();
}

function requireRole(requiredRole) {
    const required = requiredRole.toLowerCase();
    return async (req, res, next) => {
        try {
            const user = await getSessionUser(req);
            if (!user) return res.redirect("/login");
            const actualRole = String(user.userrole || "").toLowerCase();
            if (actualRole !== required) return res.status(403).send("Forbidden");
            req.currentUser = user;
            return next();
        } catch (err) {
            console.error("Auth error:", err.message);
            return res.status(500).send("Internal Server Error");
        }
    };
}

app.use(session({
    secret: 'secretsecret1234secret1234',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } 
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(express.static(path.join(__dirname, "public")));


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const STATS_TTL_MS = 5 * 60 * 1000;
let statsCache = { expiresAt: 0, value: null };

async function computeStatsSnapshot() {
    const [
        totalPatientsRes,
        totalSessionsRes,
        activeSessionsRes,
        completedSessionsRes,
        sessionsTodayRes,
        sessionsWeekRes,
        sessionsMonthRes,
        sessionsYearRes,
        avgDurationRes,
        newPatientsTodayRes,
        newPatientsWeekRes,
        newPatientsMonthRes,
    ] = await Promise.all([
        pool.query(`SELECT COUNT(*)::bigint AS total FROM patients`),
        pool.query(`SELECT COUNT(*)::bigint AS total FROM consultation_sessions`),
        pool.query(`
            SELECT COUNT(*)::bigint AS total
            FROM consultation_sessions
            WHERE ended_at IS NULL
              AND LOWER(status) IN ('recording', 'processing')
        `),
        pool.query(`
            SELECT COUNT(*)::bigint AS total
            FROM consultation_sessions
            WHERE ended_at IS NOT NULL OR LOWER(status) = 'completed'
        `),
        pool.query(`SELECT COUNT(*)::bigint AS total FROM consultation_sessions WHERE created_at::date = CURRENT_DATE`),
        pool.query(`SELECT COUNT(*)::bigint AS total FROM consultation_sessions WHERE created_at >= date_trunc('week', NOW())`),
        pool.query(`SELECT COUNT(*)::bigint AS total FROM consultation_sessions WHERE created_at >= date_trunc('month', NOW())`),
        pool.query(`SELECT COUNT(*)::bigint AS total FROM consultation_sessions WHERE created_at >= date_trunc('year', NOW())`),
        pool.query(`
            SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (ended_at - started_at))), 0)::double precision AS avg_seconds
            FROM consultation_sessions
            WHERE ended_at IS NOT NULL
        `),
        pool.query(`SELECT COUNT(*)::bigint AS total FROM patients WHERE created_at >= NOW() - INTERVAL '24 hours'`),
        pool.query(`SELECT COUNT(*)::bigint AS total FROM patients WHERE created_at >= date_trunc('week', NOW())`),
        pool.query(`SELECT COUNT(*)::bigint AS total FROM patients WHERE created_at >= date_trunc('month', NOW())`),
    ]);

    const totalSessions = Number(totalSessionsRes.rows[0]?.total || 0);
    const completedSessions = Number(completedSessionsRes.rows[0]?.total || 0);
    const completionRate = totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0;

    return {
        generatedAt: new Date().toISOString(),
        patients: {
            total: Number(totalPatientsRes.rows[0]?.total || 0),
            newToday: Number(newPatientsTodayRes.rows[0]?.total || 0),
            newThisWeek: Number(newPatientsWeekRes.rows[0]?.total || 0),
            newThisMonth: Number(newPatientsMonthRes.rows[0]?.total || 0),
        },
        sessions: {
            total: totalSessions,
            active: Number(activeSessionsRes.rows[0]?.total || 0),
            completed: completedSessions,
            created: {
                today: Number(sessionsTodayRes.rows[0]?.total || 0),
                thisWeek: Number(sessionsWeekRes.rows[0]?.total || 0),
                thisMonth: Number(sessionsMonthRes.rows[0]?.total || 0),
                thisYear: Number(sessionsYearRes.rows[0]?.total || 0),
            },
            avgDurationSeconds: Number(avgDurationRes.rows[0]?.avg_seconds || 0),
            completionRatePct: completionRate,
        }
    };
}

app.get("/api/stats", requireLogin, async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: "Unauthorized" });

        const now = Date.now();
        if (!statsCache.value || statsCache.expiresAt <= now) {
            const snapshot = await computeStatsSnapshot();
            statsCache = { value: snapshot, expiresAt: now + STATS_TTL_MS };
        }

        const role = String(user.userrole || "").toLowerCase();
        if (role === "assistant") {
            return res.json({
                role,
                generatedAt: statsCache.value.generatedAt,
                patients: statsCache.value.patients,
                sessions: {
                    total: statsCache.value.sessions.total,
                    active: statsCache.value.sessions.active,
                    completed: statsCache.value.sessions.completed,
                    created: statsCache.value.sessions.created,
                    avgDurationSeconds: statsCache.value.sessions.avgDurationSeconds,
                    completionRatePct: statsCache.value.sessions.completionRatePct,
                },
                canViewTranscripts: false
            });
        }

        return res.json({ role, ...statsCache.value, canViewTranscripts: role === "doctor" });
    } catch (err) {
        console.error("Stats error:", err.message);
        return res.status(500).json({ error: "Failed to compute stats" });
    }
});

// Doctor-only consultation session lifecycle + transcript storage.
app.post("/api/sessions/start", requireLogin, requireRole("doctor"), async (req, res) => {
    try {
        const { patientId, appointmentId } = req.body || {};
        if (!patientId) return res.status(400).json({ error: "patientId is required" });
        const patientIdStr = String(patientId);
        if (!/^\d+$/.test(patientIdStr)) return res.status(400).json({ error: "patientId must be numeric" });

        const doctorUserId = req.currentUser.userid;
        const insertRes = await pool.query(
            `
            INSERT INTO consultation_sessions (patientid, doctor_userid, appointmentid, status)
            VALUES ($1, $2, $3, 'Recording')
            RETURNING sessionid, started_at
            `,
            [patientIdStr, doctorUserId, appointmentId || null]
        );

        return res.json({ sessionId: insertRes.rows[0].sessionid, startedAt: insertRes.rows[0].started_at });
    } catch (err) {
        console.error("Start session error:", err.message);
        return res.status(500).json({ error: "Failed to start session" });
    }
});

app.post("/api/sessions/:sessionId/transcript", requireLogin, requireRole("doctor"), async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const { transcript, status } = req.body || {};
        if (typeof transcript !== "string") return res.status(400).json({ error: "transcript must be a string" });

        const doctorUserId = req.currentUser.userid;
        const newStatus = typeof status === "string" && status.trim() ? status.trim() : null;

        const updateRes = await pool.query(
            `
            UPDATE consultation_sessions
            SET transcript = $1,
                status = COALESCE($2, status),
                updated_at = NOW()
            WHERE sessionid = $3
              AND doctor_userid = $4
            `,
            [transcript, newStatus, sessionId, doctorUserId]
        );

        if (updateRes.rowCount === 0) return res.status(404).json({ error: "Session not found" });
        return res.json({ success: true });
    } catch (err) {
        console.error("Update transcript error:", err.message);
        return res.status(500).json({ error: "Failed to update transcript" });
    }
});

app.post("/api/sessions/:sessionId/end", requireLogin, requireRole("doctor"), async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const doctorUserId = req.currentUser.userid;

        const endRes = await pool.query(
            `
            UPDATE consultation_sessions
            SET ended_at = NOW(),
                status = 'Completed',
                updated_at = NOW()
            WHERE sessionid = $1
              AND doctor_userid = $2
            RETURNING started_at, ended_at
            `,
            [sessionId, doctorUserId]
        );

        if (endRes.rowCount === 0) return res.status(404).json({ error: "Session not found" });

        const startedAt = new Date(endRes.rows[0].started_at);
        const endedAt = new Date(endRes.rows[0].ended_at);
        const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));

        return res.json({ success: true, durationSeconds });
    } catch (err) {
        console.error("End session error:", err.message);
        return res.status(500).json({ error: "Failed to end session" });
    }
});

app.post("/api/sessions/:sessionId/analysis", requireLogin, requireRole("doctor"), async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const { analysis } = req.body || {};
        if (analysis === undefined) {
            return res.status(400).json({ error: "analysis is required" });
        }

        const doctorUserId = req.currentUser.userid;
        const updateRes = await pool.query(
            `
            UPDATE consultation_sessions
            SET analysis_json = $1,
                updated_at = NOW()
            WHERE sessionid = $2
              AND doctor_userid = $3
            `,
            [analysis, sessionId, doctorUserId]
        );

        if (updateRes.rowCount === 0) return res.status(404).json({ error: "Session not found" });
        return res.json({ success: true });
    } catch (err) {
        console.error("Update analysis error:", err.message);
        return res.status(500).json({ error: "Failed to update analysis" });
    }
});

app.get("/api/sessions/recent", requireLogin, requireRole("doctor"), async (req, res) => {
    try {
        const doctorUserId = req.currentUser.userid;
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));

        const recentRes = await pool.query(
            `
            SELECT sessionid, patientid, status, started_at, ended_at, created_at
            FROM consultation_sessions
            WHERE doctor_userid = $1
            ORDER BY created_at DESC
            LIMIT $2
            `,
            [doctorUserId, limit]
        );

        return res.json({ sessions: recentRes.rows });
    } catch (err) {
        console.error("Recent sessions error:", err.message);
        return res.status(500).json({ error: "Failed to load sessions" });
    }
});

app.get("/api/sessions/:sessionId", requireLogin, requireRole("doctor"), async (req, res) => {
    try {
        const doctorUserId = req.currentUser.userid;
        const sessionId = req.params.sessionId;

        const sessionRes = await pool.query(
            `
            SELECT sessionid, patientid, status, started_at, ended_at, transcript, analysis_json, created_at, updated_at
            FROM consultation_sessions
            WHERE sessionid = $1
              AND doctor_userid = $2
            `,
            [sessionId, doctorUserId]
        );

        if (sessionRes.rows.length === 0) return res.status(404).json({ error: "Session not found" });
        return res.json({ session: sessionRes.rows[0] });
    } catch (err) {
        console.error("Get session error:", err.message);
        return res.status(500).json({ error: "Failed to load session" });
    }
});

app.get('/login', (req, res) => {
 res.render('login', { error: req.query?.error });
});


app.post('/login', async (req, res) => {
    const { loginEmail, loginPassword, loginRole } = req.body; 
    
    try {
        
        const result = await pool.query(
            'SELECT "userid", "userrole", "passwordhash" FROM "users" WHERE "email" = $1 AND "userrole" = $2',
            [loginEmail, loginRole]
        );
        
        if (result.rows.length === 0) {
            return res.render('login', { error: 'Invalid email, password, or role selection.' });
        }

        const user = result.rows[0];

        if (user.passwordhash !== loginPassword) { 
            return res.render('login', { error: 'Invalid email, password, or role selection.' });
        }

        req.session.userId = user.userid;
        const userRole = String(user.userrole || "").toLowerCase();
        req.session.userRole = userRole;
        
        console.log(`Login successful for ${loginEmail}. Role: ${userRole}.`);

        if (userRole === "admin") {
            return res.redirect("/admin");
        }
        return res.redirect(`/home/${userRole}`);

    } catch (error) {
        console.error('Login error:', error.message);
        return res.render('login', { error: 'A server error occurred during login. Please try again later.' });
    }
});



app.get('/signup', (req, res) => {
    // Legacy route: self-signup is disabled per PRD.
    res.redirect('/contact-administrator');
});

app.post('/signup', async (req, res) => {
    // Legacy route: self-signup is disabled per PRD.
    res.redirect('/contact-administrator');
});

app.get('/contact-administrator', (req, res) => {
    res.render('contact_admin');
});

app.get('/admin', requireLogin, requireRole("admin"), (req, res) => {
    res.render('home_admin', { userRole: "admin", currentPage: "admin" });
});

app.get('/admin/appoint-user', requireLogin, requireRole("admin"), (req, res) => {
    res.render('admin_appoint_user', { userRole: "admin", currentPage: "admin", error: null, success: null });
});

app.post('/admin/appoint-user', requireLogin, requireRole("admin"), async (req, res) => {
    const {
        fullName,
        email,
        phoneNumber,
        password,
        role,
        licenseNumber,
        specialization,
        specialty, // allow either name
    } = req.body;

    const normalizedRole = String(role || "").toLowerCase();
    if (!fullName || !email || !phoneNumber || !password || !normalizedRole) {
        return res.status(400).render('admin_appoint_user', {
            userRole: "admin",
            currentPage: "admin",
            error: "Please fill all required fields.",
            success: null
        });
    }

    if (!["doctor", "assistant"].includes(normalizedRole)) {
        return res.status(400).render('admin_appoint_user', {
            userRole: "admin",
            currentPage: "admin",
            error: "Role must be Doctor or Assistant.",
            success: null
        });
    }

    const docSpecialization = specialization || specialty || null;
    const docLicense = licenseNumber || null;
    if (normalizedRole === "doctor") {
        if (!docLicense || !docSpecialization) {
            return res.status(400).render('admin_appoint_user', {
                userRole: "admin",
                currentPage: "admin",
                error: "Doctor users require both Medical License # and Specialization.",
                success: null
            });
        }
    }

    const nameParts = String(fullName).trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    try {
        const mode = await getDbMode();
        let newUserId;

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            if (Array.isArray(mode.userDoctorColumns) && mode.userDoctorColumns.length > 0) {
                const baseCols = ["firstname", "lastname", "email", "passwordhash", "userrole", "phonenumber"];
                const cols = [...baseCols, ...mode.userDoctorColumns];

                const values = [
                    firstName,
                    lastName,
                    email,
                    password,
                    normalizedRole,
                    phoneNumber,
                ];

                for (const col of mode.userDoctorColumns) {
                    if (col === "specialty" || col === "specialization") {
                        values.push(normalizedRole === "doctor" ? docSpecialization : null);
                    } else if (col === "licensenumber" || col === "license_number") {
                        values.push(normalizedRole === "doctor" ? docLicense : null);
                    } else {
                        // Unknown doctor metadata column: keep it NULL.
                        values.push(null);
                    }
                }

                const colList = cols.map(c => `"${c}"`).join(", ");
                const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
                const insertUserQuery = `INSERT INTO users (${colList}) VALUES (${placeholders}) RETURNING userid`;

                const userRes = await client.query(insertUserQuery, values);
                newUserId = userRes.rows[0]?.userid;
            } else {
                const userRes = await client.query(
                    "INSERT INTO users (firstname, lastname, email, passwordhash, userrole, phonenumber) VALUES ($1,$2,$3,$4,$5,$6) RETURNING userid",
                    [firstName, lastName, email, password, normalizedRole, phoneNumber]
                );
                newUserId = userRes.rows[0]?.userid;

                if (normalizedRole === "doctor" && mode.hasCliniciansTable) {
                    await client.query(
                        "INSERT INTO clinicians (userid, specialty, licensenumber) VALUES ($1,$2,$3)",
                        [newUserId, docSpecialization, docLicense]
                    );
                }
            }

            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

        return res.render('admin_appoint_user', {
            userRole: "admin",
            currentPage: "admin",
            error: null,
            success: `User created successfully (User_ID: ${newUserId}).`
        });
    } catch (err) {
        console.error("Appoint user error:", err.message);
        return res.status(500).render('admin_appoint_user', {
            userRole: "admin",
            currentPage: "admin",
            error: "Server error while creating the user. (If the email already exists, choose a different email.)",
            success: null
        });
    }
});



app.get('/home/:role', async (req, res) => {
    const currentUserId = req.session.userId;
    
    if (!currentUserId) {
        return res.redirect('/login');
    }

    try {
        const userRes = await pool.query(
            "SELECT userid, userrole, firstname, lastname FROM users WHERE userid = $1",
            [currentUserId]
        );
        if (userRes.rows.length === 0) return res.redirect("/login");

        const actualRole = String(userRes.rows[0].userrole || "").toLowerCase();

        // Prevent role spoofing via URL.
        if (req.params.role && req.params.role.toLowerCase() !== actualRole) {
            return res.redirect(actualRole === "admin" ? "/admin" : `/home/${actualRole}`);
        }

        const mode = await getDbMode();

        if (actualRole === 'assistant') {
            const queueQuery = `
                SELECT p.firstname || ' ' || p.lastname as patient_name, p.patientid as patient_id, 
                TO_CHAR(a."appointmentdatetime", 'HH12:MI AM') as appointment_time
                FROM appointments a
                JOIN patients p ON a."patientid" = p.patientid
                WHERE a."appointmentdatetime"::date = CURRENT_DATE
                ORDER BY a."appointmentdatetime" ASC`;
            
            // Doctor list for appointment creation:
            // Legacy schema uses clinicians.clinicianid, new schema uses users.userid.
            const doctorsQuery =
                mode.hasCliniciansTable && mode.appointmentsDoctorColumn === "clinicianid"
                    ? `
                        SELECT u.firstname, u.lastname, c.clinicianid AS doctor_id
                        FROM users u
                        JOIN clinicians c ON u.userid = c.userid
                        WHERE LOWER(u.userrole) = 'doctor'
                      `
                    : `
                        SELECT firstname, lastname, userid AS doctor_id
                        FROM users
                        WHERE LOWER(userrole) = 'doctor'
                      `;

            const doctorsResult = await pool.query(doctorsQuery);
            const queue = await pool.query(queueQuery);
            
            return res.render('home_assistant', { 
                userRole: 'assistant', 
                currentPage: 'home', 
                appointments: queue.rows,
                doctors: doctorsResult.rows 
            });

        } else if (actualRole === 'doctor') {
            const doctor = userRes.rows[0];
            const doctorName = `${doctor.firstname} ${doctor.lastname}`;

            let doctorFkValue = currentUserId;
            if (mode.appointmentsDoctorColumn === "clinicianid") {
                const clinicianRes = await pool.query("SELECT clinicianid FROM clinicians WHERE userid = $1", [currentUserId]);
                if (clinicianRes.rows.length === 0) {
                    return res.status(403).send("This doctor is not registered in the clinicians table.");
                }
                doctorFkValue = clinicianRes.rows[0].clinicianid;
            }

            const todayCountQuery = `
                SELECT COUNT(*) as total 
                FROM appointments 
                WHERE "${mode.appointmentsDoctorColumn}" = $1 
                AND appointmentdatetime::date = CURRENT_DATE;
            `;

            const pendingCountQuery = `
                SELECT COUNT(*) as total 
                FROM appointments 
                WHERE "${mode.appointmentsDoctorColumn}" = $1 
                AND status IN ('Scheduled', 'Active')
                AND appointmentdatetime::date = CURRENT_DATE;
            `;

            const [todayRes, pendingRes] = await Promise.all([
                pool.query(todayCountQuery, [doctorFkValue]),
                pool.query(pendingCountQuery, [doctorFkValue])
            ]);

            const appointmentStats = {
                today: todayRes.rows[0].total,
                pending: pendingRes.rows[0].total
            };

            const appointmentQuery = `
                SELECT 
                    a."appointmentid",
                    p.patientid,
                    p.firstname,
                    p.lastname,
                    a."status",
                    TO_CHAR(a."appointmentdatetime", 'HH12:MI AM') AS "Time"
                FROM appointments a
                JOIN patients p ON a."patientid" = p.patientid
                WHERE a."${mode.appointmentsDoctorColumn}" = $1
                  AND a."appointmentdatetime"::date = CURRENT_DATE
                  AND a."status" IN ('Scheduled', 'Active')
                ORDER BY a."appointmentdatetime" ASC
                LIMIT 1;
            `;
            const appointmentResult = await pool.query(appointmentQuery, [doctorFkValue]);
            const nextAppointment = appointmentResult.rows[0];

            return res.render('home_doctor', { 
                userRole: 'doctor', 
                currentPage: 'home', 
                doctorName,
                nextAppointment,
                appointmentStats
            });
        } else if (actualRole === "admin") {
            return res.redirect("/admin");
        }

        return res.status(403).send("Forbidden");
    } catch (error) {
        console.error('Error fetching home data:', error.message);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/api/doctor/next-appointment", requireLogin, requireRole("doctor"), async (req, res) => {
    try {
        const currentUserId = req.currentUser?.userid || req.session?.userId;
        if (!currentUserId) return res.status(401).json({ error: "Unauthorized" });

        const { mode, doctorFkValue } = await getDoctorFkValueForUserId(currentUserId);

        const appointmentQuery = `
            SELECT
                a."appointmentid",
                p.patientid,
                p.firstname,
                p.lastname,
                a."status",
                TO_CHAR(a."appointmentdatetime", 'HH12:MI AM') AS "Time"
            FROM appointments a
            JOIN patients p ON a."patientid" = p.patientid
            WHERE a."${mode.appointmentsDoctorColumn}" = $1
              AND a."appointmentdatetime"::date = CURRENT_DATE
              AND a."status" IN ('Scheduled', 'Active')
            ORDER BY a."appointmentdatetime" ASC
            LIMIT 1;
        `;

        const appointmentResult = await pool.query(appointmentQuery, [doctorFkValue]);
        const nextAppointment = appointmentResult.rows[0] || null;

        return res.json({ nextAppointment });
    } catch (err) {
        if (err && err.code === "DOCTOR_NOT_IN_CLINICIANS") {
            return res.status(403).json({ error: err.message });
        }
        console.error("Next appointment API error:", err.message);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

// Doctors only: assistants must be blocked from transcript-related endpoints (PRD).
app.post("/analyze-transcript", requireLogin, requireRole("doctor"), async (req, res) => {

  try {
    if (!baseUrl) {
      return res.status(500).json({ error: "BASE_URL is not configured on the server." });
    }

    const transcript = req.body.transcript;

    console.log("Transcript received:", transcript);

    const response = await fetch(`${baseUrl}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        transcript: transcript
       })
    });

    //const data = await response.json();
    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
        console.log("API response:", data);
    } catch (err) {
        console.error("Server returned non-JSON:", text);
        return res.status(500).json({ error: "Python API returned invalid response" });
    }

    console.log("Colab returned:", JSON.stringify(data, null, 2));

    res.json(data);

  } catch (error) {

    console.error("Analyze error:", error);

    res.status(500).json({ error: "Analysis failed" });
  }

});

app.get('/appointment', requireLogin, requireRole("doctor"), async (req, res) => {
    const currentUserId = req.session.userId;

    const requestedDate = req.query.date;
    const dateForDisplay = requestedDate ? new Date(requestedDate) : new Date();
    const displayDate = dateForDisplay.toLocaleDateString('en-US', { 
        month: 'short', day: 'numeric', year: 'numeric' 
    });

    try {
        const mode = await getDbMode();
        let doctorFkValue = currentUserId;
        if (mode.appointmentsDoctorColumn === "clinicianid") {
            const clinicianRes = await pool.query("SELECT clinicianid FROM clinicians WHERE userid = $1", [currentUserId]);
            if (clinicianRes.rows.length === 0) return res.status(403).send("This doctor is not registered in the clinicians table.");
            doctorFkValue = clinicianRes.rows[0].clinicianid;
        }

        const params = [doctorFkValue];
        let dateClause = "a.appointmentdatetime::date = CURRENT_DATE";
        if (requestedDate) {
            params.push(requestedDate);
            dateClause = "a.appointmentdatetime::date = $2::date";
        }

        const appointmentsQuery = `
            SELECT a.appointmentid, p.patientid, p.firstname, p.lastname,
            TO_CHAR(a.appointmentdatetime, 'HH12:MI AM') AS "Time", a.status
            FROM appointments a
            JOIN patients p ON a.patientid = p.patientid
            WHERE a."${mode.appointmentsDoctorColumn}" = $1
              AND ${dateClause}
            ORDER BY a.appointmentdatetime ASC;`;
            
        const result = await pool.query(appointmentsQuery, params);
        const activeAppointments = result.rows.map(row => ({
            id: row.patientid, 
            name: `${row.firstname} ${row.lastname}`, 
            time: row.Time, 
            status: row.status
        }));

        res.render('appointment', { 
            currentPage: 'appointment', 
            userRole: 'doctor', 
            displayDate: displayDate, 
            requestedDate: requestedDate,
            appointments: activeAppointments 
        });
    } catch (error) {
        console.error('Error:', error.message);
        res.render('appointment', { 
            currentPage: 'appointment', 
            userRole: 'doctor',
            displayDate: displayDate, 
            appointments: [] 
        });
    }
});

app.get('/history', requireLogin, requireRole("doctor"), async (req, res) => {
    try {
        const doctorUserId = req.currentUser.userid;

        const recordsRes = await pool.query(
            `
            SELECT *
            FROM (
                SELECT DISTINCT ON (s.patientid)
                    s.sessionid,
                    s.patientid,
                    s.status,
                    s.started_at,
                    s.ended_at,
                    s.created_at,
                    s.analysis_json,
                    p.firstname,
                    p.lastname
                FROM consultation_sessions s
                JOIN patients p ON p.patientid = s.patientid
                WHERE s.doctor_userid = $1
                ORDER BY s.patientid, s.created_at DESC
            ) latest
            ORDER BY latest.created_at DESC
            `,
            [doctorUserId]
        );

        return res.render('history', {
            currentPage: 'history',
            userRole: 'doctor',
            records: recordsRes.rows
        });
    } catch (err) {
        console.error("History load error:", err.message);
        return res.render('history', { currentPage: 'history', userRole: 'doctor', records: [] });
    }
});

// Sessions pages intentionally removed: keep old URLs from breaking navigation.
app.get('/sessions', requireLogin, requireRole("doctor"), (req, res) => {
    return res.redirect('/history');
});
app.get('/sessions/:sessionId', requireLogin, requireRole("doctor"), (req, res) => {
    return res.redirect('/history');
});

app.get('/profile', requireLogin, async (req, res) => {
    try {
        const currentUserId = req.session.userId;
        const mode = await getDbMode();

        let userData = await getSessionUser(req);
        if (!userData) return res.redirect("/login");
        const userRole = String(userData.userrole || "").toLowerCase();

        // If doctor metadata is not stored on Users yet, fall back to legacy Clinicians table.
        if (userRole === "doctor" && (!Array.isArray(mode.userDoctorColumns) || mode.userDoctorColumns.length === 0)) {
            if (mode.hasCliniciansTable) {
                const docRes = await pool.query("SELECT specialty, licensenumber FROM clinicians WHERE userid = $1", [currentUserId]);
                if (docRes.rows[0]) {
                    userData = { ...userData, ...docRes.rows[0] };
                }
            }
        }

        res.render('profile', {
            userData: userData,
            userRole: userRole,
            currentPage: 'profile'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

app.get('/transcribe', requireLogin, requireRole("doctor"), (req, res) => {
    const patientId = req.query.patientId || 'UNKNOWN';
    
    res.render('transcribe', { 
        currentPage: 'transcribe', 
        userRole: 'doctor',
        patientId: patientId 
    });
});

app.post('/complete-appointment', requireLogin, requireRole("doctor"), async (req, res) => {
    const { patientId } = req.body;

    try {
        const result = await pool.query(
            `UPDATE appointments 
             SET status = 'Completed' 
             WHERE patientid = $1 AND status = 'Scheduled'
             RETURNING appointmentid`,
            [patientId]
        );

        if (result.rowCount > 0) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'No active appointment found' });
        }
    } catch (error) {
        console.error('Error updating appointment:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/appointments', requireLogin, requireRole("assistant"), async (req, res) => {
    // Debug: Check your terminal to see if data arrives
    console.log("Form submitted. Body:", req.body); 

    const { patName, patAge, patGender, patPhone, patAddress, apptDate, doctorId } = req.body;

    try {
        const mode = await getDbMode();

        const nameParts = patName.trim().split(' ');
        const fName = nameParts[0];
        const lName = nameParts.slice(1).join(' ') || '';

        // Match your table: patientid, firstname, lastname, gender, phonenumber, address, age
        const patientRes = await pool.query(
            `INSERT INTO patients (firstname, lastname, age, gender, phonenumber, address) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING patientid`,
            [fName, lName, patAge, patGender, patPhone, patAddress]
        );
        
        const newPatientId = patientRes.rows[0].patientid;

        await pool.query(
            `INSERT INTO appointments (patientid, "${mode.appointmentsDoctorColumn}", appointmentdatetime, status) 
             VALUES ($1, $2, $3, 'Scheduled')`,
            [newPatientId, doctorId, apptDate]
        );

        console.log("✅ Successfully saved to database");
        res.redirect('/home/assistant'); 

    } catch (error) {
        console.error('❌ Database Error:', error.message);
        res.status(500).send("Database Error: " + error.message);
    }
});

app.post('/api/schedule-next', requireLogin, requireRole("doctor"), async (req, res) => {
    const { patientId, nextDateTime } = req.body;
    const currentUserId = req.session.userId; // The ID from your users table

    try {
        const mode = await getDbMode();

        let doctorFkValue = currentUserId;
        if (mode.appointmentsDoctorColumn === "clinicianid") {
            const clinicianRes = await pool.query("SELECT clinicianid FROM clinicians WHERE userid = $1", [currentUserId]);
            if (clinicianRes.rows.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: "This user is not registered in the clinicians table."
                });
            }
            doctorFkValue = clinicianRes.rows[0].clinicianid;
        }

        await pool.query(
            `INSERT INTO appointments (patientid, "${mode.appointmentsDoctorColumn}", appointmentdatetime, status) 
             VALUES ($1, $2, $3, 'Scheduled')`,
            [patientId, doctorFkValue, nextDateTime]
        );

        res.json({ success: true });
    } catch (error) {
        console.error("Database Error:", error.message);
        res.status(500).json({ success: false, message: "Server error: " + error.message });
    }
});

app.post('/upload-image', requireLogin, requireRole("assistant"), upload.single('patientImage'), async (req, res) => {
    const { patientId } = req.body;
    const filePath = req.file.path;
    try {
        // Store the file path in your database linked to the patient
        await pool.query('UPDATE patients SET image_path = $1 WHERE patientid = $2', [filePath, patientId]);
        res.redirect('/home/assistant');
    } catch (err) {
        console.error(err);
        res.status(500).send("Upload failed");
    }
});

async function analyzeReport(text) {

    const prompt = `
You are a medical report analyzer.

Extract the following from the report:

1. Report name
2. Test names
3. Test values

Return ONLY valid JSON in this format:

{
 "report_name": "name of report",
 "tests": [
    {
      "test_name": "test name",
      "value": "value with unit"
    }
 ]
}

Ignore hospital address, doctor notes and patient details.

Report Text:
${text}
`;

    const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        messages: [{ role: "user", content: prompt }]
    });

    let result = response.choices[0].message.content;

    // Extract JSON
    const jsonMatch = result.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
        throw new Error("No JSON found in LLM response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Convert to your existing format
    const structured = parsed.tests.map(t => {

        const valueMatch = t.value.match(/[\d.]+/);
        const unitMatch = t.value.match(/[a-zA-Z\/µ]+/);

        return {
            testName: t.test_name,
            value: valueMatch ? parseFloat(valueMatch[0]) : null,
            unit: unitMatch ? unitMatch[0] : ""
        };
    });

    return structured;
}
app.post('/upload-report', upload.single('file'), async (req, res) => {
    try {
        const { patientId } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        let extractedText = "";

        if (file.mimetype === "application/pdf") {
            const dataBuffer = fs.readFileSync(file.path);
            const pdfData = await pdf(dataBuffer);
            extractedText = pdfData.text;
        }

        else if (file.mimetype.startsWith("image/")) {
            const result = await Tesseract.recognize(file.path, 'eng');
            extractedText = result.data.text;
        }

        else {
            return res.status(400).json({ error: "Unsupported file type" });
        }

        // 🔥 CLEAN OCR TEXT HERE
        extractedText = extractedText
        .replace(/([a-zA-Z])(\d)/g, "$1 $2")
        .replace(/ngimL/gi, "ng/mL")
        .replace(/mgidL/gi, "mg/dL")
        .replace(/D4n40mUmL/gi, "µIU/mL")
        .replace(/[^\x00-\x7F]/g, "")   

        console.log("Cleaned Extracted Text:", extractedText);

        // 🔥 THEN analyze
        const structuredData = await analyzeReport(extractedText);
        console.log("STRUCTURED DATA:", structuredData);

        await pool.query(
            `INSERT INTO diagnostic_files 
            (patientid, filename, filelocationpath, extracted_text, dateuploaded)
            VALUES ($1, $2, $3, $4, NOW())`,
            [patientId, file.originalname, file.path, extractedText]
        );

        res.json({
        success: true,
        tests: structuredData
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Extraction failed" });
    }
});

// Generate a QR code that points to the patient-facing upload page
app.get('/generate-qr', async (req, res) => {
    const patientId = req.query.patientId || 'UNKNOWN';

    const baseUrl = process.env.BASE_URL;
    const link = `${baseUrl}/qr-upload/${encodeURIComponent(patientId)}`;
    try {
        const dataUrl = await QRCode.toDataURL(link);
        res.json({ dataUrl, link });
    } catch (err) {
        console.error('QR generation error:', err.message);
        res.status(500).json({ error: 'QR generation failed' });
    }
});

// Patient-facing upload page (scanned via QR)
app.get('/qr-upload/:patientId', (req, res) => {
    const patientId = req.params.patientId;
    res.render('qr_upload', { patientId });
});

app.post('/qr-upload/:patientId', upload.single('report'), async (req, res) => {
    const patientId = req.params.patientId;
    const file = req.file;
    if (!file) return res.status(400).send('No file uploaded');

    try {
        const filename = file.originalname;
        const filepath = file.path;
        const filetype = file.mimetype;

        await pool.query(
            `INSERT INTO diagnostic_files (patientid, filename, filepath, filetype, uploaded_at) VALUES ($1,$2,$3,$4,NOW())`,
            [patientId, filename, filepath, filetype]
        );

        res.send('<h3>Upload successful</h3><p>Thank you — the report was uploaded.</p>');
    } catch (err) {
        console.error('qr-upload error:', err.message);
        res.status(500).send('Server error during upload');
    }
});

app.get('/', (req, res) => {
     res.redirect('/login');
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});


app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
}
)
