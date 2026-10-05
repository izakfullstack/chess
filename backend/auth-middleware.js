/**
 * auth-middleware.js — אימות זהות המשתמש על פי אסימן חתום.
 *
 * ── הבעיה שהקובץ הזה פותר ─────────────────────────────────────────────
 * עד כה הנתיבים קיבלו את זהות המשתמש מ- req.query.accountNumber או מ- req.body.
 * אבל אלה ערכים שהדפדפן שולח - וכל אחד יכול לשנות אותם בקלות.
 * מספר חשבון אינו סוד: הוא מופיע בכל בקשת API וניתן לנחש או להעתיק.
 *
 * ── הפתרון ────────────────────────────────────────────────────────────
 * בכניסה מוחק אסימן אקראי, נשמר רק ה-hash שלו במסד הנתונים, והמשתמש שולח
 * אותו בכל בקשה:
 *
 *     Authorization: Bearer <token>
 *
 * השרת מחשב את ה-hash של מה שהתקבל ומחפש במסד. אסימון שלא נמצא = 401.
 * לכן זיוי זהות אפשרי רק בהרשאה לאסימון זר.
 *
 * ── מה ה-middleware מספק ──────────────────────────────────────────────
 *   req.user = { id, accountNumber }
 *
 * הנתיבים משתמשים ב-req.user.accountNumber בלבד ולעולם לא ב-accountNumber
 * שנשלח מהגוף או מה-query.
 */

const crypto = require('crypto');
const db = require('./database');

/** אורך החיים של סשן: 30 יום. */
const SESSION_DAYS = 30;

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * עטיפת Promise סביב db.get.
 *
 * ב-database.js שיטת get תמיד דורשת callback ולא מחזירה Promise - בעוד ש-run
 * מחזירה Promise. כדי שה-middleware יוכל להשתמש ב-await, אנו עוטפים אותה כאן.
 */
function getRow(sql, params) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
    });
}

/** יוצר סשן חדש ומחזיר את האסימון הגלם (הפעם היחידה שהוא נשמר). */
async function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);

    // שני הערות חשובות לגבי שאילתה זו:
    //
    // 1. db.run מוסיף אוטומטית "RETURNING id" לכל INSERT. לטבלת
    //    user_sessions אין עמודת id - המפתח שלה הוא token_hash - ולכן
    //    חייב לציין RETURNING בעצמנו, אחרת PostgreSQL יזרוק
    //    "column id does not exist".
    //
    // 2. אין לכתוב $1/$2 ידנית: database.js ממיר את סימני ? למספרים
    //    וסופר אותם בנפרד, וכתיבה ידנית תיגע בספירה.
    await db.run(
        `INSERT INTO user_sessions (token_hash, user_id, expires_at)
         VALUES (?, ?, ?) RETURNING token_hash`,
        [hashToken(token), userId, expiresAt]
    );
    return token;
}

/** מוחק סשן - נקרא ביציאה מהחשבון. */
async function destroySession(token) {
    if (!token) return;
    await db.run('DELETE FROM user_sessions WHERE token_hash = ?', [hashToken(token)]);
}

/** קורא את האסימון מכותרת Authorization. */
function readToken(req) {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * אימות חובה. אם האסימון תקף - ממלא את req.user וממשיך.
 * אחרת מחזיר 401 ולא מגיע ל-handler.
 */
async function requireAuth(req, res, next) {
    try {
        const token = readToken(req);
        if (!token) {
            return res.status(401).json({ error: 'חסר אסימון גישה - יש להתחבר מחדש' });
        }

        const row = await getRow(
            `SELECT u.id, u.account_number
               FROM user_sessions s
               JOIN users u ON u.id = s.user_id
              WHERE s.token_hash = ? AND s.expires_at::timestamp > CURRENT_TIMESTAMP
                AND u.email_verified = 1`,
            [hashToken(token)]
        );

        if (!row) {
            return res.status(401).json({ error: 'האסימון אינו תקין או שפג תקופתו - יש להתחבר מחדש' });
        }

        // זהו המקור היחיד ממנו נגזרת זהות בכל הנתיבים המוגנים.
        req.user = { id: row.id, accountNumber: row.account_number };
        req.sessionToken = token;
        next();
    } catch (error) {
        console.error('requireAuth failed:', error.message);
        res.status(500).json({ error: 'שגיאה באימות' });
    }
}

/** מנקה סשנים שפג תוקפם - נקרא פעם בהעלאת השרת. */
async function purgeExpiredSessions() {
    try {
        await db.run("DELETE FROM user_sessions WHERE expires_at::timestamp <= CURRENT_TIMESTAMP");
    } catch (error) {
        console.error('purgeExpiredSessions failed:', error.message);
    }
}

module.exports = { requireAuth, createSession, destroySession, hashToken, purgeExpiredSessions };