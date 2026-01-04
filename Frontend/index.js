import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import path from "path"; 
import { fileURLToPath } from 'url'; 
import { dirname } from 'path';  
import session from "express-session";   
import multer from 'multer';

dotenv.config();

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

app.get('/login', (req, res) => {
 res.render('login');
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
        const userRole = user.userrole.toLowerCase();
        
        console.log(`Login successful for ${loginEmail}. Role: ${userRole}.`);
        
        return res.redirect(`/home/${userRole}`);

    } catch (error) {
        console.error('Login error:', error.message);
        return res.render('login', { error: 'A server error occurred during login. Please try again later.' });
    }
});



app.get('/signup', (req, res) => {
     res.render('signup');
});

app.post('/signup', async (req, res) => {
    const { firstName, lastName, specialty, licenseNumber, signupEmail, signupPhone, signupPassword, signupRole } = req.body; 
    const passwordHash = signupPassword; 
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const userRes = await client.query(
             'INSERT INTO "users" ("firstname", "lastname", "email", "passwordhash", "userrole", "phonenumber") VALUES ($1, $2, $3, $4, $5, $6) RETURNING "userid"',
            [firstName, lastName, signupEmail, passwordHash, signupRole, signupPhone]
        );
        const newUserId = userRes.rows[0].userid;

        if (signupRole.toLowerCase() === 'doctor') {
            if (!specialty || !licenseNumber) {
                throw new Error("Doctor sign-up requires specialty and license number.");
            }
            await client.query(
                'INSERT INTO "clinicians" ("userid", "specialty", "licensenumber") VALUES ($1, $2, $3)',
                [newUserId, specialty, licenseNumber]
            );
        }
        await client.query('COMMIT');
        console.log(`User ${firstName} ${lastName} created successfully (userid: ${newUserId}).`);
        res.redirect('/login?signup=success');

    } catch (error) {
        console.error('Signup error:', error.message);
        if (client) await client.query('ROLLBACK'); 
        const errorMessage = error.message.includes('unique constraint') ? 'Email already exists.' : 'Server error during signup.';
        res.redirect(`/signup?error=${encodeURIComponent(errorMessage)}`);
    } finally {
        if (client) client.release();
    }
});



app.get('/home/:role', async (req, res) => {
    const role = req.params.role;
    const currentUserId = req.session.userId;
    
    // 1. Only block if the user is NOT logged in at all
    if (!currentUserId) {
        return res.redirect('/login');
    }

    let doctorName = 'User';
    let nextAppointment = null;
    let appointmentStats = { today: 0, pending: 0 }; 

    try {
        if (role === 'assistant') {
            
            const queueQuery = `
                SELECT p.firstname || ' ' || p.lastname as patient_name, p.patientid as patient_id, 
                TO_CHAR(a."appointmentdatetime", 'HH12:MI AM') as appointment_time
                FROM appointments a
                JOIN patients p ON a."patientid" = p.patientid
                WHERE a."appointmentdatetime"::date = CURRENT_DATE
                ORDER BY a."appointmentdatetime" ASC`;
            
            const doctorsQuery = `
                SELECT u.firstname, u.lastname, c.clinicianid 
                FROM users u 
                JOIN clinicians c ON u.userid = c.userid 
                WHERE u.userrole = 'doctor'`;

            const doctorsResult = await pool.query(doctorsQuery);
            const queue = await pool.query(queueQuery);
            
            return res.render('home_assistant', { 
                userRole: 'assistant', 
                currentPage: 'home', 
                appointments: queue.rows,
                doctors: doctorsResult.rows 
            });

        } else if (role === 'doctor') {
            
            const doctorDataQuery = `
                SELECT u.firstname, u.lastname, c.clinicianid
                FROM users u
                JOIN clinicians c ON u.userid = c.userid
                WHERE u.userid = $1;
            `;
            const doctorResult = await pool.query(doctorDataQuery, [currentUserId]);
            const doctor = doctorResult.rows[0];

            if (doctor) {
                doctorName = `${doctor.firstname} ${doctor.lastname}`; 
                const clinicianId = doctor.clinicianid;

                const todayCountQuery = `
                    SELECT COUNT(*) as total 
                    FROM appointments 
                    WHERE clinicianid = $1 
                    AND appointmentdatetime::date = CURRENT_DATE;
                `;

                const pendingCountQuery = `
                    SELECT COUNT(*) as total 
                    FROM appointments 
                    WHERE clinicianid = $1 
                    AND status != 'Completed'
                    AND appointmentdatetime::date = CURRENT_DATE;
                `;

                const [todayRes, pendingRes] = await Promise.all([
                    pool.query(todayCountQuery, [clinicianId]),
                    pool.query(pendingCountQuery, [clinicianId])
                ]);

                appointmentStats = {
                    today: todayRes.rows[0].total,
                    pending: pendingRes.rows[0].total
                };

                const appointmentQuery = `
                    SELECT 
                        a."appointmentid",
                        p.patientid,
                        p.firstname,
                        p.lastname,
                        TO_CHAR(a."appointmentdatetime", 'HH12:MI AM') AS "Time"
                    FROM appointments a
                    JOIN patients p ON a."patientid" = p.patientid
                    WHERE a."clinicianid" = $1 AND a."status" = 'Scheduled'
                    ORDER BY a."appointmentdatetime" ASC
                    LIMIT 1;
                `;
                const appointmentResult = await pool.query(appointmentQuery, [clinicianId]);
                nextAppointment = appointmentResult.rows[0];
            }

            return res.render('home_doctor', { 
                userRole: 'doctor', 
                currentPage: 'home', 
                doctorName, 
                nextAppointment, 
                appointmentStats 
            });
        }

    } catch (error) {
        console.error('Error fetching home data:', error.message);
        res.status(500).send("Internal Server Error");
    }
});

app.get('/appointment', async (req, res) => {
    const currentUserId = req.session.userId;
    if (!currentUserId) return res.redirect('/login');

    const requestedDate = req.query.date;
    const dateForDisplay = requestedDate ? new Date(requestedDate) : new Date();
    const displayDate = dateForDisplay.toLocaleDateString('en-US', { 
        month: 'short', day: 'numeric', year: 'numeric' 
    });

    try {
        const userRes = await pool.query('SELECT userrole FROM users WHERE userid = $1', [currentUserId]);
        const actualRole = userRes.rows[0].userrole.toLowerCase();

        const dbDateFilter = requestedDate ? `'${requestedDate}'` : 'CURRENT_DATE';
        const appointmentsQuery = `
            SELECT a.appointmentid, p.patientid, p.firstname, p.lastname,
            TO_CHAR(a.appointmentdatetime, 'HH12:MI AM') AS "Time", a.status
            FROM appointments a
            JOIN patients p ON a.patientid = p.patientid
            WHERE a.appointmentdatetime::date = ${dbDateFilter}
            ORDER BY a.appointmentdatetime ASC;`;
            
        const result = await pool.query(appointmentsQuery);
        const activeAppointments = result.rows.map(row => ({
            id: row.patientid, 
            name: `${row.firstname} ${row.lastname}`, 
            time: row.Time, 
            status: row.status
        }));

        res.render('appointment', { 
            currentPage: 'appointment', 
            userRole: actualRole, 
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

app.get('/history', (req, res) => {
    res.render('history', { currentPage: 'history', userRole: 'doctor' });
});

app.get('/profile', async (req, res) => {
    const currentUserId = req.session.userId;
    if (!currentUserId) return res.redirect('/login');

    try {
        // Fetch common user data
        const userRes = await pool.query(
            'SELECT firstname, lastname, email, userrole, phonenumber FROM users WHERE userid = $1',
            [currentUserId]
        );
                
        let userData = userRes.rows[0];
        const userRole = userData.userrole.toLowerCase();

        // If Doctor, get extra details
        if (userRole === 'doctor') {
            const docRes = await pool.query(
                'SELECT specialty, licensenumber FROM clinicians WHERE userid = $1',
                [currentUserId]
            );
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

app.get('/transcribe', (req, res) => {
    const patientId = req.query.patientId || 'UNKNOWN';
    
    res.render('transcribe', { 
        currentPage: 'transcribe', 
        userRole: 'doctor',
        patientId: patientId 
    });
});

app.post('/complete-appointment', async (req, res) => {
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

app.post('/api/appointments', async (req, res) => {
    // Debug: Check your terminal to see if data arrives
    console.log("Form submitted. Body:", req.body); 

    const { patName, patAge, patGender, patPhone, patAddress, apptDate, doctorId } = req.body;

    try {
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

        // Ensure these columns are also lowercase in your appointments table
        await pool.query(
            `INSERT INTO appointments (patientid, clinicianid, appointmentdatetime, status) 
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

app.post('/api/schedule-next', async (req, res) => {
    const { patientId, nextDateTime } = req.body;
    const currentUserId = req.session.userId; // The ID from your users table

    if (!currentUserId) {
        return res.status(401).json({ success: false, message: "Session expired" });
    }

    try {
        // 1. Look up the Clinician ID that belongs to this User
        // Note: Change 'userid' to whatever your link column is named in the clinicians table
        const clinicianRes = await pool.query(
            'SELECT clinicianid FROM clinicians WHERE userid = $1', 
            [currentUserId]
        );

        if (clinicianRes.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                message: "This user is not registered in the clinicians table." 
            });
        }

        const actualClinicianId = clinicianRes.rows[0].clinicianid;

        // 2. Perform the insert using the REAL clinician ID
        await pool.query(
            `INSERT INTO appointments (patientid, clinicianid, appointmentdatetime, status) 
             VALUES ($1, $2, $3, 'Scheduled')`,
            [patientId, actualClinicianId, nextDateTime]
        );

        res.json({ success: true });
    } catch (error) {
        console.error("Database Error:", error.message);
        res.status(500).json({ success: false, message: "Server error: " + error.message });
    }
});

app.post('/upload-image', upload.single('patientImage'), async (req, res) => {
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

app.get('/', (req, res) => {
     res.redirect('/login');
});


app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});