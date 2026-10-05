/**
 * Administrator screens, profile management, and analytics controls.
 */

function setupAdminEvents() {
    document.getElementById('admin-logout')?.addEventListener('click', () => {
        closeAdminProfile();
        closeManagersDialog();
        adminRequest('/api/admin/logout', { method: 'POST' })
            .catch(error => console.error('שגיאה ביציאה מניהול:', error));
        localStorage.removeItem('admin_username');
        showScreen('admin-login');
    });
    document.getElementById('admin-profile-open')?.addEventListener('click', openAdminProfile);
    document.getElementById('admin-profile-close')?.addEventListener('click', closeAdminProfile);
    document.getElementById('profile-edit-toggle')?.addEventListener('click', enterProfileEdit);
    document.getElementById('profile-edit-cancel')?.addEventListener('click', leaveProfileEdit);
    document.getElementById('admin-profile-form')?.addEventListener('submit', saveAdminProfile);
    document.getElementById('open-managers-btn')?.addEventListener('click', openManagersDialog);
    document.getElementById('managers-back')?.addEventListener('click', backToProfileFromManagers);
    document.getElementById('manager-add-open')?.addEventListener('click', () => toggleManagerAddForm(true));
    document.getElementById('manager-add-cancel')?.addEventListener('click', () => toggleManagerAddForm(false));
    document.getElementById('manager-add-form')?.addEventListener('submit', addManagerSubmit);
    document.getElementById('delete-confirm-no')?.addEventListener('click', closeDeleteConfirm);
    document.getElementById('delete-confirm-yes')?.addEventListener('click', confirmDeleteManager);
    document.querySelectorAll('.admin-tab').forEach(tab => tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(item => item.classList.remove('active'));
        tab.classList.add('active');
        const analytics = tab.dataset.adminTab === 'analytics';
        document.getElementById('admin-analytics-panel').classList.toggle('hidden', !analytics);
        document.getElementById('admin-users-panel').classList.toggle('hidden', analytics);
        if (analytics) loadAdminAnalytics(); else loadAdminUsers();
    }));
    document.getElementById('analytics-range')?.addEventListener('change', loadAdminAnalytics);
    document.getElementById('refresh-admin-users')?.addEventListener('click', loadAdminUsers);
}

function adminRequest(url, options = {}) {
    return fetch(url, options).then(async response => {
        let data = {};
        try { data = await response.json(); } catch (e) { /* ללא גוף JSON */ }
        if (response.status === 401) {
            // המושב פקע — ניקוי וחזרה למסך הכניסה לניהול
            closeAdminProfile();
            closeManagersDialog();
            showScreen('admin-login');
            const message = document.getElementById('admin-login-message');
            if (message) {
                message.textContent = 'המושב פג — התחבר מחדש לניהול';
                message.className = 'form-message error';
            }
            throw new Error('נדרשת התחברות מחדש');
        }
        if (!response.ok) throw new Error(data.error || 'פעולת ניהול נכשלה');
        return data;
    });
}

/**
 * אותיות שם המנהל (לדוגמה: itzhak cohen -> IC)
 */
function adminInitials(username) {
    const parts = String(username || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return 'CM';
}

/**
 * עדכון שם המנהל והאותיות בסרגל הצד ובחלון הפרופיל
 */
function applyAdminIdentity(username) {
    if (!username) return;
    const nameElement = document.getElementById('admin-profile-name');
    if (nameElement) nameElement.textContent = username;
    const initials = adminInitials(username);
    const sidebarInitials = document.getElementById('admin-initials');
    if (sidebarInitials) sidebarInitials.textContent = initials;
    const dialogInitials = document.getElementById('admin-dialog-initials');
    if (dialogInitials) dialogInitials.textContent = initials;
}

function loadAdminAnalytics() {
    const days = document.getElementById('analytics-range')?.value || 30;
    adminRequest(`/api/admin/analytics?days=${days}`).then(data => {
        const summary = data.summary || {};
        document.getElementById('analytics-summary').innerHTML = `
            <div class="analytics-card"><strong>${summary.visitors || 0}</strong><span>מבקרים ייחודיים</span></div>
            <div class="analytics-card"><strong>${summary.logins || 0}</strong><span>כניסות</span></div>
            <div class="analytics-card"><strong>${Math.round(summary.avgDuration || 0)}s</strong><span>זמן ממוצע</span></div>`;
        renderAnalyticsList('analytics-pages', data.pages, row => `${row.page || 'לא ידוע'}: ${row.views}`);
        renderAnalyticsList('analytics-devices', data.devices, row => `${row.device || 'לא ידוע'}: ${row.count}`);
        renderAnalyticsList('analytics-countries', data.countries, row => `${row.country || 'לא ידוע'}: ${row.count}`);
        renderAnalyticsList('analytics-timeline', data.timeline, row => `${row.date}: ${row.events}`);
    }).catch(error => console.error('Analytics error:', error));
}

function renderAnalyticsList(elementId, rows, format) {
    const element = document.getElementById(elementId);
    if (element) element.innerHTML = rows?.length ? rows.map(row => `<p>${escapeHtml(format(row))}</p>`).join('') : '<p>אין נתונים בטווח שנבחר.</p>';
}

function loadAdminUsers() {
    adminRequest('/api/admin/users').then(users => {
        const body = document.getElementById('admin-users-body');
        body.innerHTML = users.map(user => `<tr class="admin-user-row" data-user-id="${escapeHtml(user.id)}">
            <td>${escapeHtml(user.accountNumber)}</td><td>${escapeHtml(user.fullName)}</td><td>${escapeHtml(user.email)}</td>
            <td>${escapeHtml(user.city)}</td><td>${user.emailVerified ? 'מאומת' : 'לא אומת'}</td>
            <td>${new Date(user.createdAt).toLocaleString('he-IL')}<small> ביקורים: ${user.visitsCount || 0}<br>אחרון: ${user.lastVisitAt ? new Date(user.lastVisitAt).toLocaleString('he-IL') : 'אין'}<br>כניסות: ${user.loginCount || 0}<br>התחבר לאחרונה: ${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('he-IL') : 'אין'}</small></td><td>${user.rating || 1200}<small> משחקים: ${user.gamesCount || 0}<br>משחק אחרון: ${user.lastGameAt ? new Date(user.lastGameAt).toLocaleString('he-IL') : 'אין'}</small></td>
        </tr><tr class="admin-user-history hidden" id="admin-user-history-${user.id}"><td colspan="7">טוען פרטים והיסטוריה...</td></tr>`).join('');
        body.querySelectorAll('.admin-user-row').forEach(row => row.addEventListener('click', () => toggleAdminUserHistory(row.dataset.userId)));
    }).catch(error => console.error('Admin users error:', error));
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&#38;')
        .replace(/</g, '&#60;')
        .replace(/>/g, '&#62;')
        .replace(/"/g, '&#34;')
        .replace(/'/g, '&#39;');
}

function setProfileMessage(text, type) {
    const message = document.getElementById('admin-profile-message');
    if (!message) return;
    message.textContent = text || '';
    message.className = type ? `form-message ${type}` : 'form-message';
}

function setManagersMessage(text, type) {
    const message = document.getElementById('managers-message');
    if (!message) return;
    message.textContent = text || '';
    message.className = type ? `form-message ${type}` : 'form-message';
}

function openAdminProfile() {
    adminRequest('/api/admin/profile').then(profile => {
        applyAdminIdentity(profile.username);
        document.getElementById('profile-display-name').textContent = profile.username || '—';
        leaveProfileEdit();
        setProfileMessage('');
        document.getElementById('admin-profile-dialog').classList.remove('hidden');
        document.body.classList.add('admin-profile-open');
    }).catch(error => console.error('Admin profile error:', error));
}

function closeAdminProfile() {
    document.getElementById('admin-profile-dialog').classList.add('hidden');
    document.body.classList.remove('admin-profile-open');
}

/**
 * מעבר למצב עריכה (בלחיצת "שינוי")
 */
function enterProfileEdit() {
    const displayName = document.getElementById('profile-display-name').textContent;
    document.getElementById('profile-name-input').value = displayName === '—' ? '' : displayName;
    document.getElementById('profile-password-input').value = '';
    setProfileMessage('');
    document.getElementById('profile-display').classList.add('hidden');
    document.getElementById('admin-profile-form').classList.remove('hidden');
    document.getElementById('profile-name-input').focus();
}

/**
 * חזרה למצב תצוגה (שמירה/ביטול)
 */
function leaveProfileEdit() {
    document.getElementById('admin-profile-form').classList.add('hidden');
    document.getElementById('profile-display').classList.remove('hidden');
    document.getElementById('profile-password-input').value = '';
}

function saveAdminProfile(event) {
    event.preventDefault();
    const username = document.getElementById('profile-name-input').value.trim();
    const password = document.getElementById('profile-password-input').value;
    adminRequest('/api/admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).then(profile => {
        applyAdminIdentity(profile.username);
        document.getElementById('profile-display-name').textContent = profile.username;
        localStorage.setItem('admin_username', profile.username);
        leaveProfileEdit();
        setProfileMessage('הפרופיל נשמר', 'success');
    }).catch(error => {
        setProfileMessage(error.message, 'error');
    });
}

/* ========== ניהול חשבונות מנהלים ========== */

let managersCache = [];
let pendingDeleteManagerId = null;

function closeManagersDialog() {
    document.getElementById('managers-dialog')?.classList.add('hidden');
}

function openManagersDialog() {
    document.getElementById('admin-profile-dialog').classList.add('hidden');
    document.getElementById('managers-dialog').classList.remove('hidden');
    setManagersMessage('');
    toggleManagerAddForm(false);
    document.querySelectorAll('.manager-row-form').forEach(form => form.classList.add('hidden'));
    loadManagersList();
}

function backToProfileFromManagers() {
    closeManagersDialog();
    openAdminProfile();
}

function toggleManagerAddForm(show) {
    const form = document.getElementById('manager-add-form');
    if (!form) return;
    form.classList.toggle('hidden', !show);
    if (show) document.getElementById('manager-add-username').focus();
}

function loadManagersList() {
    adminRequest('/api/admin/managers').then(managers => {
        managersCache = managers;
        const list = document.getElementById('managers-list');
        if (!list) return;

        if (!managers.length) {
            list.innerHTML = '<p class="empty-message">אין מנהלים.</p>';
            return;
        }

        list.innerHTML = managers.map(manager => `
            <div class="manager-row" data-id="${manager.id}">
                <strong class="manager-row-name">${escapeHtml(manager.username)}</strong>
                <div class="manager-row-actions">
                    <button class="btn btn-secondary" type="button" data-action="rename">שינוי שם</button>
                    <button class="btn btn-secondary" type="button" data-action="password">שינוי סיסמה</button>
                    <button class="btn btn-danger" type="button" data-action="delete"${manager.isSelf ? ' disabled title="לא ניתן למחוק את עצמך"' : ''}>מחק</button>
                </div>
            </div>
            <form class="manager-row-form hidden" data-type="rename" data-id="${manager.id}">
                <label>שם חדש</label>
                <input type="text" minlength="3" value="${escapeHtml(manager.username)}" required>
                <div class="manager-row-form-actions">
                    <button class="btn btn-primary" type="submit">שמירה</button>
                    <button class="btn btn-secondary manager-form-cancel" type="button">ביטול</button>
                </div>
            </form>
            <form class="manager-row-form hidden" data-type="password" data-id="${manager.id}">
                <label>סיסמה חדשה</label>
                <input type="password" minlength="8" placeholder="הזן סיסמה חדשה" required>
                <div class="manager-row-form-actions">
                    <button class="btn btn-primary" type="submit">שמירה</button>
                    <button class="btn btn-secondary manager-form-cancel" type="button">ביטול</button>
                </div>
            </form>
        `).join('');

        list.querySelectorAll('.manager-row').forEach(row => {
            row.querySelectorAll('button[data-action]').forEach(button => {
                button.addEventListener('click', () => handleManagerRowAction(row, button.dataset.action));
            });
        });
        list.querySelectorAll('.manager-row-form').forEach(form => {
            form.addEventListener('submit', handleManagerFormSubmit);
            form.querySelector('.manager-form-cancel')?.addEventListener('click', () => form.classList.add('hidden'));
        });

        // אם שינו את שם המנהל הנוכחי דרך הרשימה — עדכון הזהות והפרופיל
        const self = managers.find(manager => manager.isSelf);
        if (self) {
            applyAdminIdentity(self.username);
            const displayName = document.getElementById('profile-display-name');
            if (displayName) displayName.textContent = self.username;
            localStorage.setItem('admin_username', self.username);
        }
    }).catch(error => setManagersMessage(error.message, 'error'));
}

function handleManagerRowAction(row, action) {
    const managerId = Number(row.dataset.id);
    const manager = managersCache.find(item => Number(item.id) === managerId);
    if (!manager) return;

    if (action === 'delete') {
        pendingDeleteManagerId = managerId;
        document.getElementById('delete-confirm-text').textContent =
            `האם אתה בטוח שברצונך למחוק את חשבון המנהל "${manager.username}"?`;
        document.getElementById('delete-confirm-dialog').classList.remove('hidden');
        return;
    }

    // שינוי שם / סיסמה: פתיחת הטופס המתאים מתחת לשורה, שאר הטפסים נסגרים
    document.querySelectorAll('.manager-row-form').forEach(form => form.classList.add('hidden'));
    const form = row.parentElement.querySelector(`.manager-row-form[data-type="${action}"][data-id="${managerId}"]`);
    if (form) {
        form.classList.remove('hidden');
        form.querySelector('input')?.focus();
    }
}

function handleManagerFormSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const managerId = Number(form.dataset.id);
    const type = form.dataset.type;
    const input = form.querySelector('input');
    const payload = type === 'rename' ? { username: input.value.trim() } : { password: input.value };

    adminRequest(`/api/admin/managers/${managerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(() => {
        setManagersMessage(type === 'rename' ? 'שם המנהל נשמר' : 'הסיסמה נשמרה', 'success');
        loadManagersList();
    }).catch(error => setManagersMessage(error.message, 'error'));
}

function closeDeleteConfirm() {
    pendingDeleteManagerId = null;
    document.getElementById('delete-confirm-dialog').classList.add('hidden');
}

function confirmDeleteManager() {
    if (pendingDeleteManagerId == null) return;
    const managerId = pendingDeleteManagerId;
    adminRequest(`/api/admin/managers/${managerId}`, { method: 'DELETE' })
        .then(() => {
            closeDeleteConfirm();
            setManagersMessage('המנהל נמחק', 'success');
            loadManagersList();
        })
        .catch(error => {
            closeDeleteConfirm();
            setManagersMessage(error.message, 'error');
        });
}

function addManagerSubmit(event) {
    event.preventDefault();
    adminRequest('/api/admin/managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: document.getElementById('manager-add-username').value.trim(),
            password: document.getElementById('manager-add-password').value
        })
    }).then(() => {
        document.getElementById('manager-add-form').reset();
        toggleManagerAddForm(false);
        setManagersMessage('המנהל נוסף', 'success');
        loadManagersList();
    }).catch(error => setManagersMessage(error.message, 'error'));
}

function toggleAdminUserHistory(userId) {
    const row = document.getElementById(`admin-user-history-${userId}`);
    if (!row.classList.contains('hidden')) { row.classList.add('hidden'); return; }
    adminRequest(`/api/admin/users/${userId}/history`).then(games => {
        adminRequest('/api/admin/users').then(users => {
            const user = users.find(item => String(item.id) === String(userId));
            const details = user ? `<div class="admin-user-details">
                <div><strong>שם פרטי</strong><span>${escapeHtml(user.firstName)}</span></div>
                <div><strong>שם משפחה</strong><span>${escapeHtml(user.lastName)}</span></div>
                <div><strong>תעודת זהות</strong><span>${escapeHtml(user.idNumber)}</span></div>
                <div><strong>תאריך לידה</strong><span>${escapeHtml(user.dateOfBirth)}</span></div>
                <div><strong>טלפון</strong><span>${escapeHtml(user.phone)}</span></div>
                <div><strong>מייל</strong><span>${escapeHtml(user.email)}</span></div>
                <div><strong>עיר</strong><span>${escapeHtml(user.city)}</span></div>
                <div><strong>ביקורים</strong><span>${user.visitsCount || 0}</span></div>
                <div><strong>ביקור אחרון</strong><span>${user.lastVisitAt ? new Date(user.lastVisitAt).toLocaleString('he-IL') : 'אין'}</span></div>
                <div><strong>כניסות</strong><span>${user.loginCount || 0}</span></div>
                <div><strong>התחברות אחרונה</strong><span>${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('he-IL') : 'אין'}</span></div>
                <div><strong>משחק אחרון</strong><span>${user.lastGameAt ? new Date(user.lastGameAt).toLocaleString('he-IL') : 'אין'}</span></div>
            </div>` : '';
            const gamesMarkup = games.length ? games.map(game => `<span class="admin-history-line">משחק #${game.id}: ${game.player1Account} מול ${game.player2Account} | ${game.winnerAccount ? `ניצח ${game.winnerAccount}` : 'טרם הוכרע'} | ${game.moveCount} מהלכים</span>`).join('') : 'אין משחקים';
            row.firstElementChild.innerHTML = `${details}<div class="admin-history-games"><strong>היסטוריית משחקים</strong>${gamesMarkup}</div>`;
            row.classList.remove('hidden');
        });
    });
}

/**
 * מעקב אחר הזמנות נכנסות. פועל תמיד (לא רק במסך "שחקנים"), כדי שהשחקן
 * יקבל הזמנה גם אם הוא נמצא במסך אחר - ולא רק כשהוא יושב ברשימת השחקנים.
 */
