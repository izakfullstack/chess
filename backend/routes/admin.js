const express = require('express');
const crypto = require('crypto');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const db = require('../database');
const { hashToken, readCookie, setHttpOnlyCookie, clearHttpOnlyCookie, isSameOriginRequest } = require('../auth-middleware');

const router = express.Router();
const scryptAsync = promisify(crypto.scrypt);
const sessions = new Map();
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_COOKIE = 'chess_admin_session';
const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const ADMIN_SESSION_MAX_AGE_MS = ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
const SESSIONS_FILE = path.join(__dirname, '..', '..', '.admin_sessions.json');

// טוענים רק hash-ים של אסימונים שטרם פגו; אסימונים ישנים בקובץ אינם תקפים.
try {
    if (fs.existsSync(SESSIONS_FILE)) {
        const saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        if (Array.isArray(saved)) {
            for (const [tokenHash, data] of saved) {
                if (/^[a-f0-9]{64}$/.test(tokenHash)
                    && data && data.id != null && typeof data.username === 'string'
                    && Number.isFinite(data?.createdAt)
                    && Date.now() - data.createdAt < ADMIN_SESSION_MAX_AGE_MS) {
                    sessions.set(tokenHash, data);
                }
            }
            persistSessions();
        }
    }
} catch (error) {
    console.error('Failed to load admin sessions:', error.message);
}

function persistSessions() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...sessions]));
    } catch (error) {
        console.error('Failed to persist admin sessions:', error.message);
    }
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(error) {
            if (error) reject(error); else resolve(this);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const key = await scryptAsync(password, salt, 64);
    return `${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, key] = stored.split(':');
    const derived = await scryptAsync(password, salt, 64);
    const expected = Buffer.from(key, 'hex');
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

// יצירה בלבד: מנהל קיים אינו מאופס — שינויים בפרופיל/SISMA נשמרים בין אתחולים
async function ensureAdmin() {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12
        || /^(your_|replace-with)/i.test(ADMIN_PASSWORD)) {
        console.error('Admin seeding skipped: configure ADMIN_USERNAME and a non-placeholder ADMIN_PASSWORD of at least 12 characters.');
        return;
    }
    const existing = await dbGet('SELECT id FROM admin_users WHERE username = ?', [ADMIN_USERNAME]);
    if (!existing) {
        await dbRun('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', [ADMIN_USERNAME, await hashPassword(ADMIN_PASSWORD)]);
    }
}

ensureAdmin().catch((error) => console.error('Admin seed failed:', error.message));

function requireAdmin(req, res, next) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isSameOriginRequest(req)) {
        return res.status(403).json({ error: 'בקשה ממקור חיצוני נדחתה' });
    }

    const token = readCookie(req, ADMIN_SESSION_COOKIE);
    const tokenHash = token ? hashToken(token) : '';
    const session = sessions.get(tokenHash);
    if (!session || Date.now() - session.createdAt >= ADMIN_SESSION_MAX_AGE_MS) {
        if (session) {
            sessions.delete(tokenHash);
            persistSessions();
        }
        return res.status(401).json({ error: 'נדרשת הרשאת מנהל' });
    }
    req.admin = session;
    next();
}

router.post('/logout', requireAdmin, (req, res) => {
    const token = readCookie(req, ADMIN_SESSION_COOKIE);
    sessions.delete(hashToken(token));
    persistSessions();
    clearHttpOnlyCookie(res, ADMIN_SESSION_COOKIE);
    res.json({ success: true });
});

router.get('/profile', requireAdmin, async (req, res) => {
    const admin = await dbGet('SELECT id, username, last_login_at AS "lastLoginAt" FROM admin_users WHERE id = ?', [req.admin.id]);
    res.json(admin);
});

router.patch('/profile', requireAdmin, async (req, res) => {
    try {
        const username = String(req.body.username || '').trim();
        if (username.length < 3) return res.status(400).json({ error: 'שם מנהל קצר מדי' });
        if (req.body.password && String(req.body.password).length < 8) return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים' });
        await dbRun('UPDATE admin_users SET username = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?', [username, req.body.password ? await hashPassword(req.body.password) : null, req.admin.id]);
        req.admin.username = username;
        // עדכון המושב הפעיל כדי שהשם המעודכן יישמר
        for (const [, data] of sessions) {
            if (data.id === req.admin.id) data.username = username;
        }
        persistSessions();
        res.json({ username });
    } catch (error) {
        if (error && error.code === '23505') {
            return res.status(409).json({ error: 'שם המשתמש כבר קיים למנהל אחר' });
        }
        console.error('Admin profile save error:', error);
        res.status(500).json({ error: 'נכשלה שמירת פרופיל המנהל' });
    }
});

/**
 * רשימת מנהלים
 * GET /api/admin/managers
 */
router.get('/managers', requireAdmin, async (req, res) => {
    try {
        const managers = await dbAll('SELECT id, username, last_login_at AS "lastLoginAt" FROM admin_users ORDER BY id');
        res.json(managers.map(m => ({ ...m, isSelf: m.id === req.admin.id })));
    } catch (error) {
        console.error('Managers list error:', error);
        res.status(500).json({ error: 'נכשלה טעינת המנהלים' });
    }
});

/**
 * שינוי שם/סיסמה של מנהל
 * PATCH /api/admin/managers/:id
 */
router.patch('/managers/:id', requireAdmin, async (req, res) => {
    try {
        const managerId = Number(req.params.id);
        const isAdminSelf = managerId === Number(req.admin.id);
        const existing = await dbGet('SELECT id, username FROM admin_users WHERE id = ?', [managerId]);
        if (!existing) return res.status(404).json({ error: 'המנהל לא נמצא' });

        const username = req.body.username !== undefined ? String(req.body.username || '').trim() : null;
        const password = req.body.password ? String(req.body.password) : null;

        if (username !== null) {
            if (username.length < 3) return res.status(400).json({ error: 'שם מנהל קצר מדי' });
        }
        if (password !== null && password.length < 8) {
            return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים' });
        }
        if (username === null && password === null) {
            return res.status(400).json({ error: 'לא נשלחו שינויים' });
        }

        await dbRun(
            'UPDATE admin_users SET username = COALESCE(?, username), password_hash = COALESCE(?, password_hash) WHERE id = ?',
            [username, password ? await hashPassword(password) : null, managerId]
        );

        if (username !== null && isAdminSelf) {
            for (const [, data] of sessions) {
                if (Number(data.id) === managerId) data.username = username;
            }
            req.admin.username = username;
            persistSessions();
        }

        res.json({ id: managerId, username: username !== null ? username : existing.username });
    } catch (error) {
        if (error && error.code === '23505') {
            return res.status(409).json({ error: 'שם המשתמש כבר קיים למנהל אחר' });
        }
        console.error('Manager update error:', error);
        res.status(500).json({ error: 'נכשלה עדכון המנהל' });
    }
});

/**
 * מחיקת מנהל
 * DELETE /api/admin/managers/:id
 */
router.delete('/managers/:id', requireAdmin, async (req, res) => {
    try {
        const managerId = Number(req.params.id);
        // השוואה מספרית: req.admin.id מגיע מה-DB כמחרוזת
        if (managerId === Number(req.admin.id)) {
            return res.status(400).json({ error: 'אי אפשר למחוק את החשבון של המנהל הנוכחי' });
        }
        const existing = await dbGet('SELECT id, username FROM admin_users WHERE id = ?', [managerId]);
        if (!existing) return res.status(404).json({ error: 'המנהל לא נמצא' });

        await dbRun('DELETE FROM admin_users WHERE id = ?', [managerId]);

        // ניקוי מושבים של המנהל שנמחק
        let removedSessions = false;
        for (const [token, data] of sessions) {
            if (Number(data.id) === managerId) {
                sessions.delete(token);
                removedSessions = true;
            }
        }
        if (removedSessions) persistSessions();

        res.json({ id: managerId, username: existing.username, message: 'המנהל נמחק' });
    } catch (error) {
        console.error('Manager delete error:', error);
        res.status(500).json({ error: 'נכשלה מחיקת המנהל' });
    }
});

router.post('/managers', requireAdmin, async (req, res) => {
    try {
        const username = String(req.body.username || '').trim();
        const password = String(req.body.password || '');
        if (username.length < 3 || password.length < 8) return res.status(400).json({ error: 'יש להזין שם משתמש וסיסמה תקינים' });
        await dbRun('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', [username, await hashPassword(password)]);
        res.status(201).json({ username });
    } catch (error) {
        res.status(409).json({ error: 'מנהל עם השם הזה כבר קיים' });
    }
});

router.post('/login', async (req, res) => {
    try {
        if (!isSameOriginRequest(req)) return res.status(403).json({ error: 'בקשה ממקור חיצוני נדחתה' });
        if (typeof req.body.username !== 'string' || req.body.username.length > 128
            || typeof req.body.password !== 'string' || req.body.password.length < 1 || req.body.password.length > 128) {
            return res.status(400).json({ error: 'שם המשתמש או הסיסמה אינם תקינים' });
        }
        const admin = await dbGet('SELECT * FROM admin_users WHERE username = ?', [req.body.username]);
        if (!admin || !(await verifyPassword(req.body.password || '', admin.password_hash))) {
            return res.status(401).json({ error: 'שם המשתמש או הסיסמה שגויים' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(hashToken(token), { id: admin.id, username: admin.username, createdAt: Date.now() });
        persistSessions();
        await dbRun('UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);
        setHttpOnlyCookie(res, ADMIN_SESSION_COOKIE, token, ADMIN_SESSION_MAX_AGE_SECONDS);
        res.json({ username: admin.username });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'נכשלה כניסת המנהל' });
    }
});

router.get('/users', requireAdmin, async (req, res) => {
    try {
        const users = await dbAll(`SELECT u.id, u.account_number AS "accountNumber", u.full_name AS "fullName",
            u.first_name AS "firstName", u.last_name AS "lastName", u.id_number AS "idNumber",
            u.date_of_birth AS "dateOfBirth", u.city, u.phone, u.email,
            u.email_verified AS "emailVerified", u.created_at AS "createdAt",
            r.rating, r.games_played AS "gamesPlayed", r.wins, r.losses,
            (SELECT COUNT(*) FROM games g WHERE g.player1_id = u.id OR g.player2_id = u.id) AS "gamesCount",
            (SELECT COUNT(*) FROM analytics_events a WHERE a.visitor_id = u.account_number) AS "visitsCount",
            (SELECT MAX(a.created_at) FROM analytics_events a WHERE a.visitor_id = u.account_number) AS "lastVisitAt",
            (SELECT COUNT(*) FROM analytics_events a WHERE a.event_type = 'login' AND a.visitor_id = u.account_number) AS "loginCount",
            (SELECT MAX(a.created_at) FROM analytics_events a WHERE a.event_type = 'login' AND a.visitor_id = u.account_number) AS "lastLoginAt",
            (SELECT MAX(g.created_at) FROM games g WHERE g.player1_id = u.id OR g.player2_id = u.id) AS "lastGameAt"
            FROM users u LEFT JOIN ratings r ON r.user_id = u.id ORDER BY u.created_at DESC`);
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'נכשלה טעינת המשתמשים' });
    }
});

router.get('/users/:id/history', requireAdmin, async (req, res) => {
    try {
        const user = await dbGet('SELECT id, account_number AS "accountNumber" FROM users WHERE id = ?', [req.params.id]);
        if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
        const games = await dbAll(`SELECT g.id, g.status, g.created_at AS "createdAt",
            u1.account_number AS "player1Account", u2.account_number AS "player2Account",
            winner.account_number AS "winnerAccount", COUNT(m.id) AS "moveCount"
            FROM games g JOIN users u1 ON u1.id = g.player1_id JOIN users u2 ON u2.id = g.player2_id
            LEFT JOIN users winner ON winner.id = g.winner_id LEFT JOIN moves m ON m.game_id = g.id
            WHERE g.player1_id = ? OR g.player2_id = ?
            GROUP BY g.id, u1.account_number, u2.account_number, winner.account_number ORDER BY g.created_at DESC`, [user.id, user.id]);
        res.json(games.map(game => ({ ...game, moveCount: Number(game.moveCount || 0) })));
    } catch (error) {
        res.status(500).json({ error: 'נכשלה טעינת היסטוריית המשתמש' });
    }
});

router.post('/analytics/events', async (req, res) => {
    try {
        const { eventType, page, visitorId, deviceType, country, durationSeconds } = req.body;
        if (!eventType) return res.status(400).json({ error: 'eventType is required' });
        await dbRun(`INSERT INTO analytics_events
            (event_type, page, visitor_id, device_type, country, duration_seconds)
            VALUES (?, ?, ?, ?, ?, ?)`, [eventType, page || null, visitorId || null, deviceType || null, country || null, Number(durationSeconds) || 0]);
        res.status(201).json({ recorded: true });
    } catch (error) {
        res.status(500).json({ error: 'נכשלה שמירת אנליטיקס' });
    }
});

router.get('/analytics', requireAdmin, async (req, res) => {
    try {
        const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
        const suffix = String(days);
        const [summary, pages, devices, countries, timeline] = await Promise.all([
            dbGet(`SELECT COUNT(DISTINCT visitor_id) AS visitors, COUNT(DISTINCT CASE WHEN event_type = 'login' THEN visitor_id END) AS logins, COALESCE(AVG(duration_seconds), 0) AS "avgDuration" FROM analytics_events WHERE created_at::timestamp >= NOW() - (? || ' days')::interval`, [suffix]),
            dbAll(`SELECT page, COUNT(*) AS views FROM analytics_events WHERE event_type = 'page_view' AND created_at::timestamp >= NOW() - (? || ' days')::interval GROUP BY page ORDER BY views DESC`, [suffix]),
            dbAll(`SELECT device_type AS device, COUNT(*) AS "count" FROM analytics_events WHERE created_at::timestamp >= NOW() - (? || ' days')::interval GROUP BY device_type ORDER BY "count" DESC`, [suffix]),
            dbAll(`SELECT country, COUNT(*) AS "count" FROM analytics_events WHERE created_at::timestamp >= NOW() - (? || ' days')::interval GROUP BY country ORDER BY "count" DESC`, [suffix]),
            dbAll(`SELECT created_at::date AS "date", COUNT(*) AS events FROM analytics_events WHERE created_at::timestamp >= NOW() - (? || ' days')::interval GROUP BY created_at::date ORDER BY "date"`, [suffix])
        ]);
        res.json({ days, summary, pages, devices, countries, timeline });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: 'נכשלה טעינת האנליטיקס' });
    }
});

module.exports = router;
