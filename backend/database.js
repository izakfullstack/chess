/** Database connection and schema initialization (PostgreSQL only). */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('PostgreSQL is not configured. Set DATABASE_URL (or PGHOST/PGDATABASE/PGUSER) in .env');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: Number(process.env.PGPOOL_MAX || 20),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error));

function translatePlaceholders(sql) {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
}

function run(sql, params = [], callback) {
    if (typeof params === 'function') {
        callback = params;
        params = [];
    }

    const normalizedSql = sql.trim().replace(/;\s*$/, '');
    const query = /^INSERT\s/i.test(normalizedSql) && !/RETURNING\s/i.test(normalizedSql)
        ? `${normalizedSql} RETURNING id`
        : normalizedSql;

    const request = pool.query(translatePlaceholders(query), params).then((result) => ({
        lastID: result.rows[0]?.id,
        rowCount: result.rowCount,
        rows: result.rows
    }));

    if (callback) {
        request.then((result) => callback.call({ lastID: result.lastID }, null))
            .catch((error) => callback.call({ lastID: undefined }, error));
        return;
    }

    return request;
}

function get(sql, params = [], callback) {
    if (typeof params === 'function') {
        callback = params;
        params = [];
    }

    pool.query(translatePlaceholders(sql), params)
        .then((result) => callback(null, result.rows[0]))
        .catch((error) => callback(error));
}

function all(sql, params = [], callback) {
    if (typeof params === 'function') {
        callback = params;
        params = [];
    }

    pool.query(translatePlaceholders(sql), params)
        .then((result) => callback(null, result.rows))
        .catch((error) => callback(error));
}

async function initializeTables() {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY, account_number VARCHAR(6) UNIQUE NOT NULL,
        full_name TEXT, id_number VARCHAR(9), gender TEXT, date_of_birth DATE,
        first_name TEXT, last_name TEXT, city TEXT, phone TEXT, email TEXT UNIQUE,
        password_hash TEXT, preferred_color TEXT NOT NULL DEFAULT 'random',
        show_full_name SMALLINT NOT NULL DEFAULT 0,
        email_verified SMALLINT NOT NULL DEFAULT 0,
        verification_token_hash TEXT, verification_expires_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS show_full_name SMALLINT NOT NULL DEFAULT 0');
    await pool.query(`CREATE TABLE IF NOT EXISTS games (
        id BIGSERIAL PRIMARY KEY, player1_id BIGINT NOT NULL REFERENCES users(id),
        player2_id BIGINT NOT NULL REFERENCES users(id), winner_id BIGINT REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'completed')),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP,
        player1_color TEXT, player2_color TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS moves (
        id BIGSERIAL PRIMARY KEY, game_id BIGINT NOT NULL REFERENCES games(id), move_number INTEGER NOT NULL,
        from_square TEXT NOT NULL, to_square TEXT NOT NULL, piece TEXT NOT NULL, promotion TEXT,
        color TEXT NOT NULL CHECK(color IN ('white', 'black')), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query('ALTER TABLE moves ADD COLUMN IF NOT EXISTS promotion TEXT');
    await pool.query(`CREATE TABLE IF NOT EXISTS ratings (
        user_id BIGINT PRIMARY KEY REFERENCES users(id), rating INTEGER NOT NULL DEFAULT 1200,
        games_played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS player_availability (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        is_available SMALLINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS game_invitations (
        id BIGSERIAL PRIMARY KEY, sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined')),
        game_id BIGINT REFERENCES games(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, responded_at TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_users (
        id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_login_at TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY, event_type TEXT NOT NULL, page TEXT, visitor_id TEXT,
        device_type TEXT, country TEXT, duration_seconds INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

    // סשני משתמשים: נוצרים בהתחברות ומועברים לשרת בכל בקשה דרך Authorization: Bearer.
    // זהו המקור היחיד האמין לזהות המשתמש - לא מספר חשבון שנשלח מהדפדפן.
    await pool.query(`CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL)`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token_hash)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_games_created_at ON games(created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id, move_number)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_invitations_receiver_status ON game_invitations(receiver_id, status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at)');
    // מעקב אחר הזמנות שנשלחו מתבצע כל כמה שניות - הוא מסנן לפי השולח
    await pool.query('CREATE INDEX IF NOT EXISTS idx_invitations_sender ON game_invitations(sender_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_games_players ON games(player1_id, player2_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_games_status ON games(status)');
    console.log('PostgreSQL tables ready');
}

initializeTables().catch((error) => console.error('PostgreSQL initialization failed:', error.message));

module.exports = { run, get, all, pool };