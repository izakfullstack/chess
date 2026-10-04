/**
 * User routes - registration, login, and profile management
 * 
 * AI/ML Concept #2: Data representation
 * 
 * In AI systems, how you structure your data is crucial.
 * Notice how we're using:
 * - A 6-digit account number (simple identifier)
 * - A rating system (numerical representation of skill)
 * - Separate tables for different types of information
 * 
 * This is called "feature engineering" in ML - choosing
 * how to represent information so machines can work with it.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const crypto = require('crypto');
const { promisify } = require('util');
const nodemailer = require('nodemailer');

const scryptAsync = promisify(crypto.scrypt);
const APP_URL = process.env.APP_URL || 'http://localhost:3001';
const PLATFORM_NAME = process.env.PLATFORM_NAME || 'פלטפורמת משחקי שחמט מקוונת';
const verificationSessions = new Map();

function getMailer() {
    const hasPlaceholderCredentials = [
        process.env.SMTP_USER,
        process.env.SMTP_PASSWORD,
        process.env.SMTP_FROM
    ].some(value => !value || value.startsWith('your_'));

    if (!process.env.SMTP_HOST || hasPlaceholderCredentials) {
        return null;
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD.replace(/\s+/g, '')
        }
    });
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await scryptAsync(password, salt, 64);
    return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, key] = storedHash.split(':');
    const derivedKey = await scryptAsync(password, salt, 64);
    const expected = Buffer.from(key, 'hex');
    return expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey);
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function ensureSeedUsers() {
    try {
        const total = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM users', (err, row) => {
                if (err) reject(err);
                else resolve(Number(row?.count || 0));
            });
        });

        if (total > 0) return;

        const demoUsers = [
            { firstName: 'אבי', lastName: 'כהן', idNumber: '111111111', city: 'תל אביב', phone: '0501111111', email: 'avi1@example.com', password: 'Pass1234' },
            { firstName: 'רועי', lastName: 'לוי', idNumber: '222222222', city: 'חיפה', phone: '0502222222', email: 'roi2@example.com', password: 'Pass1234' },
            { firstName: 'מיה', lastName: 'פרץ', idNumber: '333333333', city: 'ירושלים', phone: '0503333333', email: 'mia3@example.com', password: 'Pass1234' },
            { firstName: 'יואב', lastName: 'שטרן', idNumber: '444444444', city: 'באר שבע', phone: '0504444444', email: 'yoav4@example.com', password: 'Pass1234' },
            { firstName: 'נועה', lastName: 'ברק', idNumber: '555555555', city: 'פתח תקווה', phone: '0505555555', email: 'noa5@example.com', password: 'Pass1234' }
        ];

        for (const user of demoUsers) {
            let accountNumber = '';
            while (accountNumber.length !== 6) {
                accountNumber = String(Math.floor(100000 + Math.random() * 900000));
                const same = await dbGet('SELECT id FROM users WHERE account_number = ?', [accountNumber]);
                if (!same) break;
                accountNumber = '';
            }

            const firstName = user.firstName.trim();
            const lastName = user.lastName.trim();
            const passwordHash = await hashPassword(user.password);
            const fullName = `${firstName} ${lastName}`;
            const created = await dbRun(
                `INSERT INTO users
                    (account_number, full_name, id_number, date_of_birth, first_name, last_name,
                     city, phone, email, password_hash, email_verified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [accountNumber, fullName, user.idNumber, '1990-01-01', firstName, lastName, user.city, user.phone, user.email, passwordHash]
            );

            await dbRun('INSERT INTO ratings (user_id, rating, games_played, wins, losses) VALUES (?, 1200, 0, 0, 0) RETURNING user_id', [created.lastID]);
        }
    } catch (error) {
        console.error('Seed users failed:', error.message);
    }
}

ensureSeedUsers().catch((error) => console.error('Initial user seed error:', error.message));

/**
 * יצירת מספר חשבון אקראי בן 6 ספרות שאינו קיים במסד הנתונים
 */
function generateAccountNumber(callback) {
    const accountNumber = Math.floor(100000 + Math.random() * 900000).toString();

    db.get('SELECT id FROM users WHERE account_number = ?', [accountNumber], (err, row) => {
        if (err || row) {
            generateAccountNumber(callback);
            return;
        }

        callback(accountNumber);
    });
}

/**
 * ולידציה של פרטי משתמש לרישום
 */
function validateRegistration(body) {
    const errors = [];
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    const idNumber = typeof body.idNumber === 'string' ? body.idNumber.replace(/[\s-]/g, '') : '';
    const dateOfBirth = typeof body.dateOfBirth === 'string' ? body.dateOfBirth : '';
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.replace(/[\s-]/g, '') : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!/^[\p{L}][\p{L}\s'-]{1,39}$/u.test(firstName)) {
        errors.push('שם פרטי תקין נדרש');
    }

    if (!/^\d{9}$/.test(idNumber) || /^([0-9])\1{8}$/.test(idNumber)) {
        errors.push('מספר תעודת זהות חייב להכיל 9 ספרות תקינות');
    }

    if (!/^[\p{L}][\p{L}\s'-]{1,39}$/u.test(lastName)) {
        errors.push('שם משפחה תקין נדרש');
    }

    const parsedBirthDate = Date.parse(dateOfBirth);
    if (!dateOfBirth || Number.isNaN(parsedBirthDate) || new Date(parsedBirthDate) > new Date()) {
        errors.push('יש להזין תאריך לידה תקין שאינו בעתיד');
    }

    if (!/^[\p{L}\s'-]{2,50}$/u.test(city)) errors.push('עיר מגורים תקינה נדרשת');
    if (!/^05\d{8}$/.test(phone)) errors.push('מספר טלפון נייד חייב להכיל 10 ספרות ולהתחיל ב-05');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push('כתובת מייל תקינה נדרשת');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128 ||
        !/[A-Za-z]/.test(body.password) || !/\d/.test(body.password)) {
        errors.push('סיסמה חייבת להכיל 8-128 תווים, לפחות אות אחת ולפחות ספרה אחת');
    }

    return errors;
}

/**
 * רישום משתמש חדש
 * POST /api/users/register
 */
router.post('/register', async (req, res) => {
    const errors = validateRegistration(req.body);

    if (errors.length > 0) {
        return res.status(400).json({ error: errors[0] });
    }

    try {
        const existingEmail = await dbGet('SELECT id FROM users WHERE email = ?', [req.body.email.trim().toLowerCase()]);
        if (existingEmail) return res.status(409).json({ error: 'כתובת המייל כבר רשומה במערכת' });

        generateAccountNumber(async (accountNumber) => {
            try {
                const firstName = req.body.firstName.trim();
                const lastName = req.body.lastName.trim();
                const fullName = `${firstName} ${lastName}`;
                const idNumber = req.body.idNumber.trim();
                const email = req.body.email.trim().toLowerCase();
                const passwordHash = await hashPassword(req.body.password);
                const verificationToken = crypto.randomBytes(32).toString('hex');
                const verificationHash = crypto.createHash('sha256').update(verificationToken).digest('hex');
                const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
                    .toISOString()
                    .slice(0, 19)
                    .replace('T', ' ');

                const result = await dbRun(
                    `INSERT INTO users
                        (account_number, full_name, id_number, date_of_birth, first_name, last_name,
                         city, phone, email, password_hash, verification_token_hash, verification_expires_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [accountNumber, fullName, idNumber, req.body.dateOfBirth, firstName, lastName,
                        req.body.city.trim(), req.body.phone.replace(/[\s-]/g, ''), email, passwordHash, verificationHash, expiresAt]
                );

                await dbRun('INSERT INTO ratings (user_id) VALUES (?) RETURNING user_id', [result.lastID]);

                const verificationUrl = `${APP_URL}/api/users/verify/${verificationToken}`;
                const mailer = getMailer();
                let emailSent = false;
                if (mailer) {
                    try {
                        await mailer.sendMail({
                            from: process.env.SMTP_FROM || process.env.SMTP_USER,
                            to: email,
                            subject: `${PLATFORM_NAME}: אישור משתמש`,
                            text: `שלום ${fullName}!\n\nברכות על יצירת חשבון המשתמש בפלטפורמת משחקי השחמט המקוונת של ${PLATFORM_NAME}.\n\nלשם אימות הפרטים שהוזנו בתהליך הרישום, אנא אשרו את חשבונכם החדש באמצעות כניסה לקישור הבא:\n\n${verificationUrl}\n\nפרטי החשבון שלכם:\nשם מלא: ${fullName}\nמספר חשבון: ${accountNumber}\n\nלאחר אישור החשבון תוכלו להתחבר לאתר באמצעות הסיסמה שבחרתם ומספר החשבון בן 6 הספרות שנוצר עבורכם. מספר החשבון הוא הפרט שישמש אתכם להתחברות למערכת.\n\nשאר הפרטים שהוזנו בתהליך הרישום לא יוצגו באתר.\n\nבברכה,\nצוות ${PLATFORM_NAME}\nפלטפורמת שחמט מקוונת.`,
                            html: `<div dir="rtl" style="direction:rtl;text-align:right;font-family:Arial,sans-serif;line-height:1.8"><h2>${PLATFORM_NAME}: אישור משתמש</h2><p>שלום ${fullName}!</p><p>ברכות על יצירת חשבון המשתמש בפלטפורמת משחקי השחמט המקוונת של ${PLATFORM_NAME}.</p><p>לשם אימות הפרטים שהוזנו בתהליך הרישום, אנא אשרו את חשבונכם החדש באמצעות כניסה לקישור הבא:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p><strong>פרטי החשבון שלכם:</strong><br>שם מלא: ${fullName}<br>מספר חשבון: ${accountNumber}</p><p>לאחר אישור החשבון תוכלו להתחבר לאתר באמצעות הסיסמה שבחרתם ומספר החשבון בן 6 הספרות שנוצר עבורכם. מספר החשבון הוא הפרט שישמש אתכם להתחברות למערכת.</p><p>שאר הפרטים שהוזנו בתהליך הרישום לא יוצגו באתר.</p><p>בברכה,<br>צוות ${PLATFORM_NAME}<br>פלטפורמת שחמט מקוונת.</p></div>`
                        });
                        emailSent = true;
                    } catch (mailError) {
                        console.error('Email delivery failed:', mailError.message);
                    }
                } else {
                    // SMTP אינו שלוח — מספר החשבון נשמר במסד ונשלח בהודעת האימות הבאה.
                    // הקישור עצמו אינו מודפס: הוא נושא את הטוקן, והדפסתו ליוג חושפת גישה לחשבון.
                    console.warn(`שלוח היישר לא הצליח עכשיו (${email}). יש לוודא שהגדרות SMTP תקינות.`);
                }

                res.status(201).json({
                    accountNumber,
                    emailSent,
                    message: emailSent
                        ? 'החשבון נוצר. יש לאמת אותו דרך הקישור שנשלח למייל.'
                        : 'החשבון נוצר, אבל שליחת המייל עדיין לא מוגדרת. יש להגדיר SMTP ב-.env.'
                });
            } catch (err) {
                console.error('Error creating user:', err);
                res.status(500).json({ error: 'נכשל ביצירת חשבון' });
            }
        });
    } catch (err) {
        console.error('Error checking registration:', err);
        res.status(500).json({ error: 'נכשלה בדיקת פרטי ההרשמה' });
    }
});

/**
 * כניסה עם מספר חשבון
 * POST /api/users/login
 */
router.post('/login', async (req, res) => {
    const { accountNumber, password } = req.body;

    if (!accountNumber || !/^\d{6}$/.test(accountNumber) || !password) {
        return res.status(400).json({ error: 'מספר חשבון חייב להיות בדיוק 6 ספרות' });
    }

    try {
        const row = await dbGet(
            `SELECT u.id, u.account_number, u.full_name, u.password_hash, u.email_verified,
                    u.show_full_name, r.rating, r.games_played, r.wins, r.losses
             FROM users u LEFT JOIN ratings r ON u.id = r.user_id
             WHERE u.account_number = ?`, [accountNumber]
        );
        if (!row || !(await verifyPassword(password, row.password_hash))) {
            return res.status(401).json({ error: 'שם המשתמש או הסיסמה שגויים' });
        }
        if (!row.email_verified) return res.status(403).json({ error: 'יש לאמת את החשבון דרך המייל לפני הכניסה' });

        res.json({
            id: row.id, accountNumber: row.account_number, fullName: row.full_name,
            showFullName: Boolean(row.show_full_name),
            rating: row.rating || 1200, gamesPlayed: row.games_played || 0,
            wins: row.wins || 0, losses: row.losses || 0, message: 'כניסה הצליחה'
        });
    } catch (err) {
        console.error('Error logging in:', err);
        res.status(500).json({ error: 'נכשלה כניסה למערכת' });
    }
});

router.get('/verify/:token', async (req, res) => {
    const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
    try {
        const user = await dbGet(
            'SELECT id FROM users WHERE verification_token_hash = ? AND verification_expires_at::timestamp > CURRENT_TIMESTAMP',
            [tokenHash]
        );
        if (!user) return res.status(400).send('קישור האימות אינו תקף או שפג תוקפו.');
        await dbRun('UPDATE users SET email_verified = 1, verification_token_hash = NULL, verification_expires_at = NULL WHERE id = ?', [user.id]);
        const sessionToken = crypto.randomBytes(32).toString('hex');
        verificationSessions.set(sessionToken, { userId: user.id, expiresAt: Date.now() + 5 * 60 * 1000 });
        res.redirect(`${APP_URL}/?verified=1&verificationSession=${sessionToken}`);
    } catch (err) {
        console.error('Error verifying email:', err);
        res.status(500).send('אירעה שגיאה באימות החשבון.');
    }
});

router.get('/verification-session/:token', async (req, res) => {
    const session = verificationSessions.get(req.params.token);
    verificationSessions.delete(req.params.token);
    if (!session || session.expiresAt < Date.now()) return res.status(401).json({ error: 'אימות ההתחברות פג' });
    try {
        const row = await dbGet(`SELECT u.id, u.account_number, u.full_name, u.show_full_name,
            r.rating, r.games_played, r.wins, r.losses
            FROM users u LEFT JOIN ratings r ON r.user_id = u.id WHERE u.id = ? AND u.email_verified = 1`, [session.userId]);
        if (!row) return res.status(404).json({ error: 'המשתמש לא נמצא' });
        res.json({ id: row.id, accountNumber: row.account_number, fullName: row.full_name,
            showFullName: Boolean(row.show_full_name), rating: row.rating || 1200, gamesPlayed: row.games_played || 0, wins: row.wins || 0, losses: row.losses || 0 });
    } catch (error) {
        res.status(500).json({ error: 'נכשלה התחברות האימות' });
    }
});

/**
 * קבלת פרופיל משתמש עם דירוג
 * GET /api/users/:id
 */
router.get('/settings', async (req, res) => {
    const accountNumber = String(req.query.accountNumber || '');
    if (!/^\d{6}$/.test(accountNumber)) return res.status(400).json({ error: 'מספר שחקן חייב להיות בדיוק 6 ספרות' });
    try {
        const user = await dbGet('SELECT id, show_full_name FROM users WHERE account_number = ? AND email_verified = 1', [accountNumber]);
        if (!user) return res.status(404).json({ error: 'המשתמש לא נמצא' });
        res.json({ showFullName: Boolean(user.show_full_name) });
    } catch (error) {
        console.error('Error loading account settings:', error);
        res.status(500).json({ error: 'נכשלה טעינת הגדרות החשבון' });
    }
});

router.patch('/settings', async (req, res) => {
    const accountNumber = String(req.body.accountNumber || '');
    const showFullName = req.body.showFullName === true;
    if (!/^\d{6}$/.test(accountNumber)) return res.status(400).json({ error: 'מספר שחקן חייב להיות בדיוק 6 ספרות' });
    if (typeof req.body.showFullName !== 'boolean') return res.status(400).json({ error: 'ערך העדפת הצגת השם אינו תקין' });
    try {
        const user = await dbGet('SELECT id FROM users WHERE account_number = ? AND email_verified = 1', [accountNumber]);
        if (!user) return res.status(404).json({ error: 'המשתמש לא נמצא' });
        await dbRun('UPDATE users SET show_full_name = ? WHERE id = ?', [showFullName ? 1 : 0, user.id]);
        res.json({ showFullName });
    } catch (error) {
        console.error('Error saving account settings:', error);
        res.status(500).json({ error: 'נכשלה שמירת הגדרות החשבון' });
    }
});

router.get('/player/:accountNumber/history', (req, res) => {
    const accountNumber = String(req.params.accountNumber);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 25);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    db.get('SELECT id FROM users WHERE account_number = ? AND email_verified = 1', [accountNumber], (userError, user) => {
        if (userError) return res.status(500).json({ error: 'נכשלה טעינת השחקן' });
        if (!user) return res.status(404).json({ error: 'השחקן אינו רשום או אינו מאומת' });

        db.all(`SELECT g.id, g.status, g.created_at AS "createdAt", g.completed_at AS "completedAt",
                u1.account_number AS "player1Account", u2.account_number AS "player2Account",
                winner.account_number AS "winnerAccount", COUNT(m.id) AS "moveCount"
                FROM games g JOIN users u1 ON u1.id = g.player1_id JOIN users u2 ON u2.id = g.player2_id
                LEFT JOIN users winner ON winner.id = g.winner_id LEFT JOIN moves m ON m.game_id = g.id
                WHERE (g.player1_id = ? OR g.player2_id = ?)
                GROUP BY g.id, u1.account_number, u2.account_number, winner.account_number
                ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
            [user.id, user.id, limit, offset],
            (gamesError, games) => {
                if (gamesError) return res.status(500).json({ error: 'נכשלה טעינת היסטוריית המשחקים' });
                res.json(games.map(game => ({ ...game, moveCount: Number(game.moveCount || 0), opponentAccount: game.player1Account === accountNumber ? game.player2Account : game.player1Account, result: game.winnerAccount ? (game.winnerAccount === accountNumber ? 'ניצחון' : 'הפסד') : 'תיקו' })));
            });
    });
});

router.get('/:id', (req, res) => {
    const userId = parseInt(req.params.id);

    db.get(
        `SELECT u.id, u.account_number, u.full_name, u.gender,
                r.rating, r.games_played, r.wins, r.losses
         FROM users u
         LEFT JOIN ratings r ON u.id = r.user_id
         WHERE u.id = ?`,
        [userId],
        (err, row) => {
            if (err) {
                console.error('Error getting user:', err);
                return res.status(500).json({ error: 'נכשל בקבלת המשתמש' });
            }

            if (!row) {
                return res.status(404).json({ error: 'משתמש לא נמצא' });
            }

            res.json({
                id: row.id,
                accountNumber: row.account_number,
                fullName: row.full_name,
                gender: row.gender,
                rating: row.rating || 1200,
                gamesPlayed: row.games_played || 0,
                wins: row.wins || 0,
                losses: row.losses || 0
            });
        }
    );
});

/**
 * קבלת כל המשתמשים עם דירוגים (לטבלת דירוג ציבורית)
 * GET /api/users
 */
router.get('/', async (req, res) => {
    try {
        await ensureSeedUsers();
    } catch (error) {
        console.error('Ensure seed users failed on GET /api/users:', error.message);
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 25);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    db.all(
        `SELECT u.id, u.account_number, r.rating, r.games_played, r.wins, r.losses
         FROM users u
         LEFT JOIN ratings r ON u.id = r.user_id
         WHERE u.email_verified = 1
         ORDER BY r.rating DESC
         LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, rows) => {
            if (err) {
                console.error('Error getting users:', err);
                return res.status(500).json({ error: 'נכשל בקבלת משתמשים' });
            }

            const safeRows = rows && rows.length ? rows : [
                { id: 1, account_number: '123456', rating: 1500, games_played: 0, wins: 0, losses: 0 },
                { id: 2, account_number: '234567', rating: 1480, games_played: 0, wins: 0, losses: 0 },
                { id: 3, account_number: '345678', rating: 1460, games_played: 0, wins: 0, losses: 0 },
                { id: 4, account_number: '456789', rating: 1420, games_played: 0, wins: 0, losses: 0 },
                { id: 5, account_number: '567890', rating: 1390, games_played: 0, wins: 0, losses: 0 }
            ];

            res.json(safeRows.map((row, index) => ({
                id: row.id,
                accountNumber: row.account_number,
                rating: row.rating || 1200,
                gamesPlayed: row.games_played || 0,
                wins: row.wins || 0,
                losses: row.losses || 0,
                rank: offset + index + 1
            })));
        }
    );
});

module.exports = router;
