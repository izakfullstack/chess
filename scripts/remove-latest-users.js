const db = require('../backend/database');

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(error) {
            if (error) reject(error);
            else resolve(this);
        });
    });
}

(async () => {
    const users = await all(`
        SELECT id, account_number, email, email_verified, created_at
        FROM users
        ORDER BY id DESC
        LIMIT 2
    `);

    console.log('Deleting:', JSON.stringify(users));

    for (const user of users) {
        await run('DELETE FROM ratings WHERE user_id = ?', [user.id]);
        await run('DELETE FROM users WHERE id = ?', [user.id]);
    }

    const remaining = await all(`
        SELECT id, account_number, email, email_verified
        FROM users
        ORDER BY id DESC
        LIMIT 10
    `);
    console.log('Remaining:', JSON.stringify(remaining));
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
