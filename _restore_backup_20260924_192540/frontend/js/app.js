/**
 * לוגיקה ראשית של היישום - מתאם את כל רכיבי הממשק
 * 
 * מושג בינה מלאכותית #6: תזמור מודלים
 * 
 * במערכות בינה מלאכותית, לעיתים קרובות יש מספר מודלים שעובדים יחד:
 * - מודל אחד לתפיסה (זיהוי מצב הלוח)
 * - מודל אחד לקבלת החלטות (בחירת מהלכים)
 * - מודל אחד להערכה (הערכת עמדות)
 * 
 * הממשק שלנו עוקב אחר אותו דפוס:
 * - auth.js: מטפל באימות משתמש (כמו תפיסה)
 * - game.js: מצייר את הלוח ומטפל במהלכים (כמו קבלת החלטות)
 * - rating.js: מציג דירוגים וטבלאות (כמו הערכה)
 * - app.js: מתאם הכל (כמו הבקר הראשי)
 */

let currentScreen = 'home';
let currentGame = null;
let moveHistory = [];
let currentMoveIndex = -1;
let invitationPollingTimer = null;
let knownInvitationIds = new Set();
let previewAccountNumber = null;
let historicalGameView = false;
let playerHistoryOffset = 0;
let playerPreviewCloseTimer = null;
let rankingOffset = 0;
let rankingLoading = false;
let rankingFinished = false;
let activeHistoryAccount = null;
let historyLoading = false;
let historyFinished = false;
let previousScreenBeforeHistory = 'games';
let pendingLeaveScreen = null;
let gamePollTimer = null;
let sentInvitePollTimer = null;
let sentInvitePollInitialized = false;
let handledAcceptedInvites = new Set();

/**
 * אתחול היישום
 */
function initApp() {
    // אתחול מודול אימות
    auth.initAuth();

    // הגדרת ניווט
    setupNavigation();

    // הגדרת מאזיני אירועים גלובליים
    setupGlobalEvents();

    // החזרת זהות המנהל מהאחסון המקומי (שם + אותיות)
    applyAdminIdentity(localStorage.getItem('admin_username'));

    if (window.location.pathname === '/admin') {
        showScreen('admin-login');
    }

    const verificationStatus = new URLSearchParams(window.location.search).get('verified');
    const verificationSession = new URLSearchParams(window.location.search).get('verificationSession');
    if (verificationSession) {
        fetch(`/api/users/verification-session/${encodeURIComponent(verificationSession)}`)
            .then(response => response.json())
            .then(data => {
                if (!data.error) {
                    auth.currentUser = data;
                    localStorage.setItem('chess_user', JSON.stringify(data));
                    auth.updateUIForUser();
                }
            })
            .catch(error => console.error('שגיאה בכניסה לאחר אימות:', error));
    }
    if (verificationStatus === '1') {
        const verificationMessage = document.getElementById('verification-message');
        verificationMessage.classList.remove('hidden');
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => verificationMessage.classList.add('hidden'), 2000);
    }

    // טעינת נתונים ראשוניים
    loadRanking();

    // מעקב בזמן אמת אחר אישור הזמנות ששלח המשתמש (פתיחת המשחק אצל המזמין)
    startSentInvitePolling();

    // בדיקת פרמטרים בכתובת לגישה ישירה למשחק
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('game');
    if (gameId) {
        loadGame(gameId);
    }
}

/**
 * הגדרת ניווט בין מסכים
 */
function setupNavigation() {
    // כפתורי ניווט
    document.querySelectorAll('.nav-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const screen = e.currentTarget.dataset.screen;
            showScreen(screen);
        });
    });

    // ניווט ממסך אימות
    document.querySelectorAll('[id^="home-"]').forEach(button => {
        button.addEventListener('click', (e) => {
            const action = e.currentTarget.id.split('-')[1];
            if (action === 'register') {
                document.getElementById('auth-title').textContent = 'רישום';
                document.getElementById('auth-description').textContent = 'הזן את הפרטים שלך ליצירת חשבון';
            } else {
                document.getElementById('auth-title').textContent = 'כניסה';
                document.getElementById('auth-description').textContent = 'הזן את מספר החשבון שלך';
            }
        });
    });
}

/**
 * הגדרת מאזיני אירועים גלובליים
 */
function setupGlobalEvents() {
    setupAdminEvents();
    setupMobileMenu();
    window.addEventListener('scroll', handleInfiniteListsScroll, { passive: true });
    const homeStart = document.getElementById('home-start');
    if (homeStart) {
        homeStart.addEventListener('click', () => {
            if (!auth.requireAuth('הירשם או התחבר כדי לשחק')) return;
            showScreen('games');
        });
    }

    const playersButton = document.querySelector('.players-button');
    if (playersButton) {
        playersButton.addEventListener('click', () => {
            showScreen('games');
            loadRanking();
        });
    }

    document.getElementById('back-to-ranking')?.addEventListener('click', () => showScreen(previousScreenBeforeHistory));

    document.getElementById('back-from-players')?.addEventListener('click', () => showScreen('home'));
    document.getElementById('back-from-auth')?.addEventListener('click', () => showScreen('home'));
    document.getElementById('back-from-dashboard')?.addEventListener('click', () => showScreen('home'));
    document.getElementById('back-from-game')?.addEventListener('click', () => showScreen('games'));
    document.getElementById('back-from-admin-login')?.addEventListener('click', () => showScreen('home'));
    document.getElementById('back-from-admin')?.addEventListener('click', () => showScreen('home'));

    // כפתור רענון משחקים
    const refreshGames = document.getElementById('refresh-games');
    if (refreshGames) {
        refreshGames.addEventListener('click', loadGames);
    }

    const refreshPlayers = document.getElementById('refresh-players');
    if (refreshPlayers) refreshPlayers.addEventListener('click', loadMatchmakingPlayers);

    const availabilityToggle = document.getElementById('availability-toggle');
    if (availabilityToggle) availabilityToggle.addEventListener('change', updateAvailability);
    document.getElementById('preferred-color')?.addEventListener('change', (event) => {
        if (!auth.currentUser) return;
        fetch('/api/games/matchmaking/preferred-color', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountNumber: auth.currentUser.accountNumber, preferredColor: event.target.value }) });
    });
    window.addEventListener('pagehide', () => setAvailability(false, false));
    window.addEventListener('beforeunload', () => setAvailability(false, false));

    document.getElementById('accept-invitation')?.addEventListener('click', () => respondToInvitation(true));
    document.getElementById('decline-invitation')?.addEventListener('click', () => respondToInvitation(false));

    // אזהרת יציאה באמצע משחק (כניעה)
    document.getElementById('leave-game-yes')?.addEventListener('click', confirmLeaveGame);
    document.getElementById('leave-game-no')?.addEventListener('click', cancelLeaveGame);

    // חיפוש שחקן בלוח השחקנים
    document.getElementById('player-search')?.addEventListener('input', filterRankingRows);

    // טופס משחק חדש
    const newGameForm = document.getElementById('new-game-form');
    if (newGameForm) {
        newGameForm.addEventListener('submit', handleNewGameSubmit);
    }

    // ניווט משחק
    const gamePrev = document.getElementById('game-prev');
    const gameNext = document.getElementById('game-next');
    if (gamePrev) gamePrev.addEventListener('click', () => navigateMove(-1));
    if (gameNext) gameNext.addEventListener('click', () => navigateMove(1));

    // שליחת מהלך
    const submitMove = document.getElementById('submit-move');
    if (submitMove) {
        submitMove.addEventListener('click', submitMoveToServer);
    }

    // קלט מהלך (אפשר מקש Enter)
    const moveFrom = document.getElementById('move-from');
    const moveTo = document.getElementById('move-to');
    if (moveFrom && moveTo) {
        moveFrom.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitMoveToServer();
            }
        });
        moveTo.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitMoveToServer();
            }
        });
    }
}

/**
 * הצגת מסך ספציפי.
 * אם השחקן באמצע משחק פעיל — כל יציאה עוברת תחילה באזהרת כניעה.
 */
function showScreen(screenName) {
    // דף הדירוג מוזג לתוך דף "שחקנים"
    if (screenName === 'ranking') screenName = 'games';

    if (shouldWarnBeforeLeavingGame(screenName)) {
        pendingLeaveScreen = screenName;
        document.getElementById('leave-game-dialog').classList.remove('hidden');
        return;
    }

    applyScreen(screenName);
}

/**
 * הצגת המסך בפועל (ללא בדיקת אזהרת יציאה)
 */
function applyScreen(screenName) {
    // עצירת רענון המשחק כשעוזבים את מסך המשחק
    if (screenName !== 'game') stopGamePolling();

    // הסתרת כל המסכים
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });

    // הצגת מסך יעד
    const targetScreen = document.getElementById(`screen-${screenName}`);
    if (targetScreen) {
        targetScreen.classList.add('active');
    }

    // עדכון מסך נוכחי
    currentScreen = screenName;
    document.body.classList.toggle('admin-mode', screenName === 'admin' || screenName === 'admin-login');

    // טיפול בלוגיקה ספציפית למסך
    switch (screenName) {
        case 'dashboard':
            if (!auth.requireAuth()) return;
            loadDashboardData();
            break;
        case 'games':
            if (!auth.requireAuth()) return;
            loadMatchmakingPlayers();
            loadIncomingInvitations();
            startInvitationPolling();
            break;
        case 'game':
            if (!auth.requireAuth()) return;
            // המשחק יטען דרך פרמטר בכתובת או בחירת משחק
            break;
        case 'player-history':
            break;
        case 'admin':
            if (!localStorage.getItem('admin_token')) {
                showScreen('admin-login');
                return;
            }
            loadAdminAnalytics();
            break;
    }
}

/**
 * האם יש להציג אזהרת כניעה לפני יציאה ממסך המשחק
 */
function shouldWarnBeforeLeavingGame(targetScreen) {
    if (currentScreen !== 'game' || targetScreen === 'game') return false;
    if (!currentGame || currentGame.status !== 'active') return false;
    if (historicalGameView) return false;
    if (!auth.currentUser) return false;
    const myId = Number(auth.currentUser.id);
    return Number(currentGame.player1Id) === myId || Number(currentGame.player2Id) === myId;
}

function cancelLeaveGame() {
    pendingLeaveScreen = null;
    document.getElementById('leave-game-dialog').classList.add('hidden');
}

/**
 * אישור יציאה: המשחק הופך לכניעה (היריב מנצח) ثم ניווט למסך היעד
 */
function confirmLeaveGame() {
    document.getElementById('leave-game-dialog').classList.add('hidden');
    const target = pendingLeaveScreen;
    pendingLeaveScreen = null;

    const gameId = currentGame?.id;
    const myId = Number(auth.currentUser?.id);
    const winnerId = Number(currentGame?.player1Id) === myId ? currentGame.player2Id : currentGame.player1Id;

    stopGamePolling();

    const finish = () => {
        if (target === '__logout__') {
            auth.currentUser = null;
            localStorage.removeItem('chess_user');
            if (typeof auth.updateUIForUser === 'function') auth.updateUIForUser();
            applyScreen('home');
            return;
        }
        if (target) applyScreen(target);
    };

    if (gameId && winnerId !== undefined && winnerId !== null && auth.currentUser) {
        // יציאה במהלך משחק = כניעה: היריב מנצח
        fetch(`/api/games/${gameId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winnerId })
        })
            .then(response => response.json())
            .then(() => {
                if (currentGame && String(currentGame.id) === String(gameId)) {
                    currentGame.status = 'completed';
                    currentGame.winnerId = winnerId;
                }
            })
            .catch(error => console.error('הכניעה לא נשמרה בשרת:', error))
            .finally(finish);
    } else {
        finish();
    }
}

/**
 * סינון לוח השחקנים לפי מספר שחקן (חיפוש בזמן הקלדה)
 */
function filterRankingRows() {
    const input = document.getElementById('player-search');
    const query = (input?.value || '').trim();
    const rows = document.querySelectorAll('#ranking-body .player-row');
    let visible = 0;
    rows.forEach(row => {
        const account = (row.querySelector('.account')?.textContent || '').trim();
        const matches = !query || account.includes(query);
        row.style.display = matches ? '' : 'none';
        if (matches) visible += 1;
    });
    const empty = document.getElementById('player-search-empty');
    if (empty) empty.classList.toggle('hidden', !(query && visible === 0));
}

/**
 * רענון שקט של המשחק בזמן אמת (כדי ששני השחקנים יראו כל מהלך)
 */
function startGamePolling(gameId) {
    stopGamePolling();
    gamePollTimer = setInterval(() => {
        if (currentScreen !== 'game') {
            stopGamePolling();
            return;
        }
        fetch(`/api/games/${gameId}`)
            .then(response => response.json())
            .then(latest => {
                if (currentScreen !== 'game') return;
                const previous = currentGame;
                const changed = !previous
                    || String(previous.id) !== String(latest.id)
                    || (previous.moveHistory?.length || 0) !== (latest.moveHistory?.length || 0)
                    || previous.status !== latest.status;
                if (changed) {
                    loadGame(latest.id, historicalGameView, true);
                }
            })
            .catch(() => { /* רענון שקט */ });
    }, 2500);
}

function stopGamePolling() {
    if (gamePollTimer) {
        clearInterval(gamePollTimer);
        gamePollTimer = null;
    }
}

/**
 * מעקב אחר הזמנות ששלח המשתמש — ברגע אישור, לוח המשחק נפתח גם אצל המזמין
 */
function startSentInvitePolling() {
    if (sentInvitePollTimer) return;
    sentInvitePollTimer = setInterval(() => {
        if (!auth.currentUser) return;
        fetch(`/api/games/matchmaking/sent-invitations?accountNumber=${encodeURIComponent(auth.currentUser.accountNumber)}`)
            .then(response => response.json())
            .then(invitations => {
                if (!Array.isArray(invitations)) return;

                if (!sentInvitePollInitialized) {
                    // סבב ראשון: מסמנים אישורים קיימים כ"כבר טופלו" כדי לא לפתוח משחקים ישנים
                    invitations.forEach(invitation => {
                        if (invitation.status === 'accepted') handledAcceptedInvites.add(String(invitation.id));
                    });
                    sentInvitePollInitialized = true;
                    return;
                }

                for (const invitation of invitations) {
                    if (invitation.status !== 'accepted' || !invitation.gameId) continue;
                    const key = String(invitation.id);
                    if (handledAcceptedInvites.has(key)) continue;
                    handledAcceptedInvites.add(key);

                    const inActiveGame = currentScreen === 'game'
                        && currentGame && currentGame.status === 'active' && !historicalGameView;
                    if (!inActiveGame) {
                        // האישור התקבל — נפתח את לוח המשחק גם אצל המזמין
                        showScreen('game');
                        loadGame(invitation.gameId);
                    }
                    break; // משחק אחד לכל סבב
                }
            })
            .catch(() => { /* מעקב שקט */ });
    }, 4000);
}

function setupAdminEvents() {
    document.getElementById('admin-logout')?.addEventListener('click', () => {
        closeAdminProfile();
        closeManagersDialog();
        localStorage.removeItem('admin_token');
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
    return fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${localStorage.getItem('admin_token')}` }
    }).then(async response => {
        let data = {};
        try { data = await response.json(); } catch (e) { /* ללא גוף JSON */ }
        if (response.status === 401) {
            // המושב פקע — ניקוי וחזרה למסך הכניסה לניהול
            localStorage.removeItem('admin_token');
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
    if (element) element.innerHTML = rows?.length ? rows.map(row => `<p>${format(row)}</p>`).join('') : '<p>אין נתונים בטווח שנבחר.</p>';
}

function loadAdminUsers() {
    adminRequest('/api/admin/users').then(users => {
        const body = document.getElementById('admin-users-body');
        body.innerHTML = users.map(user => `<tr class="admin-user-row" data-user-id="${user.id}">
            <td>${user.accountNumber}</td><td>${user.fullName || ''}</td><td>${user.email || ''}</td>
            <td>${user.city || ''}</td><td>${user.emailVerified ? 'מאומת' : 'לא אומת'}</td>
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
                <div><strong>שם פרטי</strong><span>${user.firstName || ''}</span></div>
                <div><strong>שם משפחה</strong><span>${user.lastName || ''}</span></div>
                <div><strong>תעודת זהות</strong><span>${user.idNumber || ''}</span></div>
                <div><strong>תאריך לידה</strong><span>${user.dateOfBirth || ''}</span></div>
                <div><strong>טלפון</strong><span>${user.phone || ''}</span></div>
                <div><strong>מייל</strong><span>${user.email || ''}</span></div>
                <div><strong>עיר</strong><span>${user.city || ''}</span></div>
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

function startInvitationPolling() {
    if (invitationPollingTimer) return;
    invitationPollingTimer = setInterval(() => {
        if (currentScreen === 'games' && auth.currentUser) loadIncomingInvitations(true);
    }, 5000);
}

function loadMatchmakingPlayers() {
    if (!auth.currentUser) return;
    fetch(`/api/games/matchmaking/players?accountNumber=${encodeURIComponent(auth.currentUser.accountNumber)}`)
        .then(response => response.json())
        .then(players => {
            const list = document.getElementById('available-players-list');
            if (!list) return;
            // לוח השחקנים: משבצות עם כל הפרטים (דירוג, חשבון, ניקוד, משחקים, ניצחונות, הפסדים)
            // ריחוף = חלון תצוגה מקדימה, לחיצה = דף היסטוריית השחקן
            list.innerHTML = players.length ? players.map(player => `
                <article class="player-match-card" tabindex="0"
                    onmouseenter="cancelPlayerPreviewClose(); openPlayerPreview('${player.accountNumber}', this)"
                    onmouseleave="schedulePlayerPreviewClose()"
                    onclick="openPlayerHistory('${player.accountNumber}')"
                    onkeydown="if (event.key === 'Enter') openPlayerHistory('${player.accountNumber}')">
                    <div class="player-card-head">
                        <div class="player-card-id">
                            <strong>${escapeHtml(player.fullName || '')}</strong>
                            <span class="player-card-account">חשבון ${player.accountNumber}</span>
                        </div>
                        <span class="availability-status ${player.isAvailable ? 'online' : ''}">${player.isAvailable ? 'זמין' : 'לא זמין'}</span>
                    </div>
                    <div class="player-card-stats">
                        <span><small>ניקוד</small><strong>${player.rating}</strong></span>
                        <span><small>משחקים</small><strong>${player.gamesPlayed}</strong></span>
                        <span><small>ניצחונות</small><strong>${player.wins}</strong></span>
                        <span><small>הפסדים</small><strong>${player.losses}</strong></span>
                    </div>
                    <button class="btn btn-primary" type="button" onclick="event.stopPropagation();sendGameInvitation('${player.accountNumber}')">הזמן למשחק</button>
                </article>
            `).join('') : '<p class="empty-message">אין כרגע שחקנים רשומים אחרים.</p>';
        })
        .catch(error => console.error('שגיאה בטעינת שחקנים:', error));
}

function updateAvailability(event) {
    if (!auth.currentUser) return;
    const isAvailable = event.target.checked;
    setAvailability(isAvailable, true, event.target);
}

function setAvailability(isAvailable, updateControl = true, control = null) {
    if (!auth.currentUser) return;
    fetch('/api/games/matchmaking/availability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber: auth.currentUser.accountNumber, isAvailable })
    }).then(response => response.json()).then(data => {
        const availabilityLabel = document.getElementById('availability-label');
        if (availabilityLabel) availabilityLabel.textContent = data.isAvailable ? 'זמין' : 'לא זמין';
        loadMatchmakingPlayers();
    }).catch(() => { if (updateControl && control) control.checked = !isAvailable; });
}

window.sendGameInvitation = function(receiverAccount) {
    fetch('/api/games/matchmaking/invitations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderAccount: auth.currentUser.accountNumber, receiverAccount })
    }).then(response => response.json()).then(data => {
        alert(data.message || data.error);
    });
};

function loadIncomingInvitations(openNewDialog = false) {
    if (!auth.currentUser) return;
    fetch(`/api/games/matchmaking/invitations?accountNumber=${encodeURIComponent(auth.currentUser.accountNumber)}`)
        .then(response => response.json()).then(invitations => {
            const list = document.getElementById('incoming-invitations');
            if (!list) return;
            list.innerHTML = invitations.length ? invitations.map(invitation => `
                <button class="invitation-card" type="button" onclick="openInvitationDialog(${invitation.id}, '${invitation.senderAccount}')">
                    קיבלת הזמנה למשחק מחשבון ${invitation.senderAccount}
                </button>
            `).join('') : '';

            const newInvitation = invitations.find(invitation => !knownInvitationIds.has(invitation.id));
            if (openNewDialog && newInvitation) {
                openInvitationDialog(newInvitation.id, newInvitation.senderAccount);
            }
            knownInvitationIds = new Set(invitations.map(invitation => invitation.id));
        });
}

window.openInvitationDialog = function(invitationId, senderAccount) {
    window.activeInvitationId = invitationId;
    document.getElementById('invitation-dialog-message').textContent = `קיבלת הזמנה למשחק מהשחקן ${senderAccount}`;
    document.getElementById('invitation-dialog').classList.remove('hidden');
};

function respondToInvitation(accepted) {
    if (!window.activeInvitationId || !auth.currentUser) return;
    fetch(`/api/games/matchmaking/invitations/${window.activeInvitationId}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber: auth.currentUser.accountNumber, accepted })
    }).then(response => response.json()).then(data => {
        document.getElementById('invitation-dialog').classList.add('hidden');
        window.activeInvitationId = null;
        loadIncomingInvitations();
        if (data.gameId) {
            showScreen('game');
            loadGame(data.gameId);
        }
    });
}

/**
 * טעינת נתוני לוח בקרה
 */
function loadDashboardData() {
    if (!auth.currentUser) return;

    // עדכון פרטי משתמש
    document.getElementById('dashboard-account').textContent = auth.currentUser.accountNumber;
    document.getElementById('dashboard-rating').textContent = auth.currentUser.rating;
    document.getElementById('dashboard-games').textContent = auth.currentUser.gamesPlayed;
    document.getElementById('dashboard-wins').textContent = auth.currentUser.wins;
    document.getElementById('dashboard-losses').textContent = auth.currentUser.losses;

    // עדכון פרופיל
    document.getElementById('profile-rating').textContent = auth.currentUser.rating;
    document.getElementById('profile-games').textContent = auth.currentUser.gamesPlayed;
    document.getElementById('profile-wins').textContent = auth.currentUser.wins;
    document.getElementById('profile-losses').textContent = auth.currentUser.losses;

    // טעינת משחקי המשתמש
    loadMyGames();
}

/**
 * טעינת משחקי המשתמש
 */
function loadMyGames() {
    if (!auth.currentUser) return;

    fetch('/api/games')
    .then(response => response.json())
    .then(games => {
        const myGamesList = document.getElementById('my-games-list');
        if (!myGamesList) return;

        // סינון משחקים שבהם המשתמש הנוכחי משתתף
        const userGames = games.filter(game => 
            game.player1_id === auth.currentUser.id || 
            game.player2_id === auth.currentUser.id
        );

        if (userGames.length === 0) {
            myGamesList.innerHTML = '<p class="empty-message">אין עדיין משחקים. צור את המשחק הראשון שלך!</p>';
            return;
        }

        myGamesList.innerHTML = userGames.map(game => {
            const isPlayer1 = game.player1_id === auth.currentUser.id;
            const opponentNumber = isPlayer1 ? game.player2_number : game.player1_number;

            return `
                <div class="game-card" onclick="selectGame(${game.id})">
                    <div class="game-header">
                        <span>משחק #${game.id}</span>
                        <span class="game-status status-${game.status}">${getStatusText(game.status)}</span>
                    </div>
                    <p>מול חשבון: ${opponentNumber}</p>
                    <p>נוצר: ${new Date(game.created_at).toLocaleDateString()}</p>
                    ${game.status === 'completed' ? `<p>מנצח: חשבון ${game.winner_id === game.player1_id ? game.player1_number : game.player2_number}</p>` : ''}
                </div>
            `;
        }).join('');
    })
    .catch(error => {
        console.error('שגיאה בטעינת משחקים:', error);
    });
}

/**
 * טעינת כל המשחקים למסך המשחקים
 */
function loadGames() {
    if (!auth.currentUser) return;
    fetch('/api/games')
    .then(response => response.json())
    .then(games => {
        const gamesList = document.getElementById('all-games-list');
        if (!gamesList) return;

        gamesList.innerHTML = games.map(game => {
            const isPlayer = game.player1_id === auth.currentUser.id || game.player2_id === auth.currentUser.id;
            const opponentNumber = game.player1_id === auth.currentUser.id ? game.player2_number : game.player1_number;

            return `
                <div class="game-card ${isPlayer ? 'selected' : ''}" onclick="selectGame(${game.id})">
                    <div class="game-header">
                        <span>משחק #${game.id}</span>
                        <span class="game-status status-${game.status}">${getStatusText(game.status)}</span>
                    </div>
                    <p>שחקן 1: חשבון ${game.player1_number}</p>
                    <p>שחקן 2: חשבון ${game.player2_number}</p>
                    <p>נוצר: ${new Date(game.created_at).toLocaleDateString()}</p>
                    ${game.status === 'completed' ? `<p>מנצח: חשבון ${game.winner_id === game.player1_id ? game.player1_number : game.player2_number}</p>` : ''}
                </div>
            `;
        }).join('');
    })
    .catch(error => {
        console.error('שגיאה בטעינת משחקים:', error);
    });
}

/**
 * קבלת טקסט סטטוס בעברית
 */
function getStatusText(status) {
    switch (status) {
        case 'pending': return 'ממתין';
        case 'active': return 'פעיל';
        case 'completed': return 'הושלם';
        default: return status;
    }
}

/**
 * בחירת משחק לצפייה
 */
function selectGame(gameId) {
    historicalGameView = false;
    showScreen('game');
    loadGame(gameId);
}

/**
 * טעינת משחק ספציפי.
 * silent=true לרענון שקט בזמן אמת (ללא מסך טעינה)
 */
function loadGame(gameId, historical = false, silent = false) {
    historicalGameView = historical;
    const loading = document.getElementById('game-loading');
    if (loading && !silent) {
        loading.classList.remove('hidden');
        const loadingBar = loading.querySelector('span');
        if (loadingBar) {
            loadingBar.style.width = '0%';
            setTimeout(() => { loadingBar.style.width = '40%'; }, 100);
            setTimeout(() => { loadingBar.style.width = '70%'; }, 400);
        }
    }
    fetch(`/api/games/${gameId}`)
    .then(response => response.json())
    .then(game => {
        currentGame = game;
        if (!silent) {
            const loadingBar = loading?.querySelector('span');
            if (loadingBar) loadingBar.style.width = '100%';
        }

        setTimeout(() => {
            // עדכון כותרת משחק
            document.getElementById('game-title').textContent = `משחק #${game.id}: ${game.player1Account} מול ${game.player2Account}`;

            // עדכון פרטי שחקנים
            const playersCard = document.getElementById('game-players');
            playersCard.innerHTML = `
                <div class="player">
                    <div class="player-info">
                        <span class="player-account">שחקן ${game.player1Account} (${game.player1_color === 'white' ? 'לבן' : 'שחור'})</span>
                        <span class="player-rating">דירוג: ${game.player1_rating || 1200}</span>
                    </div>
                    <div class="player-winner">
                        ${game.winner_id === game.player1Id ? '🏆 מנצח' : ''}
                    </div>
                </div>
                <div class="player">
                    <div class="player-info">
                        <span class="player-account">שחקן ${game.player2Account} (${game.player2_color === 'white' ? 'לבן' : 'שחור'})</span>
                        <span class="player-rating">דירוג: ${game.player2_rating || 1200}</span>
                    </div>
                    <div class="player-winner">
                        ${game.winner_id === game.player2Id ? '🏆 מנצח' : ''}
                    </div>
                </div>
            `;

            // ציור לוח שחמט
            renderChessBoard(game.board, game.currentTurn);

            // עדכון היסטוריית מהלכים
            updateMoveHistory(game.moveHistory);

            // עדכון ניווט מהלכים
            currentMoveIndex = game.moveHistory.length;
            document.getElementById('game-move-number').textContent = `מהלך ${currentMoveIndex}`;

            // עדכון סטטוס משחק
            const gameStatus = document.getElementById('game-status');
            gameStatus.textContent = `סטטוס: ${getStatusText(game.status)}`;
            gameStatus.className = `game-status status-${game.status}`;

            // הצגה/הסתרה של קלט מהלך לפי סטטוס ותור
            const moveInput = document.getElementById('game-move-input');
            const isUserTurn = (game.currentTurn === 'white' && auth.currentUser.accountNumber === game.player1Account && game.player1_color === 'white') ||
                               (game.currentTurn === 'white' && auth.currentUser.accountNumber === game.player2Account && game.player2_color === 'white') ||
                               (game.currentTurn === 'black' && auth.currentUser.accountNumber === game.player1Account && game.player1_color === 'black') ||
                               (game.currentTurn === 'black' && auth.currentUser.accountNumber === game.player2Account && game.player2_color === 'black');

            if (!historical && game.status === 'active' && isUserTurn) {
                moveInput.style.display = 'flex';
            } else {
                moveInput.style.display = 'none';
            }

            // ניקוי קלט מהלך
            document.getElementById('move-from').value = '';
            document.getElementById('move-to').value = '';
            if (!silent) loading?.classList.add('hidden');

            // הפעלת רענון בזמן אמת למשחק פעיל (כדי ששני השחקנים יראו כל מהלך)
            if (game.status === 'active' && !historical) startGamePolling(game.id);
            else stopGamePolling();
        }, silent ? 0 : 800);
    })
    .catch(error => {
        if (silent) return; // רענון שקט נכשל — ננסה שוב בסבב הבא
        console.error('שגיאה בטעינת משחק:', error);
        document.getElementById('game-message').textContent = 'נכשל בטעינת המשחק';
        document.getElementById('game-message').className = 'form-message error';
        loading?.classList.add('hidden');
    });
}

/**
 * ציור לוח שחמט
 */
function renderChessBoard(fen, currentTurn) {
    const boardElement = document.getElementById('game-board');
    if (!boardElement) return;

    boardElement.innerHTML = '';

    const board = game.fenToBoard(fen);

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement('div');
            square.className = `square ${((row + col) % 2 === 0) ? 'light' : 'dark'}`;

            const piece = board[row][col];
            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece ${piece.color}`;
                pieceElement.innerHTML = getPieceSymbol(piece.type, piece.color);
                pieceElement.draggable = true;
                pieceElement.dataset.row = row;
                pieceElement.dataset.col = col;
                pieceElement.dataset.piece = piece.type;
                pieceElement.dataset.color = piece.color;

                // הוספת פונקציונליות גרירה ושחרור
                pieceElement.addEventListener('dragstart', handleDragStart);
                pieceElement.addEventListener('dragend', handleDragEnd);

                square.appendChild(pieceElement);
            }

            // הוספת מטפל לחיצה לבחירת ריבוע
            square.addEventListener('click', () => {
                handleSquareClick(row, col, board);
            });

            boardElement.appendChild(square);
        }
    }

    // הוספת מאזיני אירועים לאזור שחרור
    boardElement.addEventListener('dragover', handleDragOver);
    boardElement.addEventListener('drop', handleDrop);
}

/**
 * קבלת סמל כלי שחמט
 */
function getPieceSymbol(type, color) {
    const symbols = {
        'king': color === 'white' ? '♔' : '♚',
        'queen': color === 'white' ? '♕' : '♛',
        'rook': color === 'white' ? '♖' : '♜',
        'bishop': color === 'white' ? '♗' : '♝',
        'knight': color === 'white' ? '♘' : '♞',
        'pawn': color === 'white' ? '♙' : '♟'
    };
    return symbols[type] || '';
}

/**
 * טיפול בלחיצה על ריבוע לבחירת כלי
 */
function handleSquareClick(row, col, board) {
    // זה ייושם לבחירת לוח אינטראקטיבית
    // בינתיים נשתמש בקלט ניסוח אלגברי
    console.log(`ריבוע נלחץ: שורה ${row}, עמודה ${col}`);
}

/**
 * טיפול בתחילת גרירה
 */
function handleDragStart(e) {
    const piece = e.target;
    piece.classList.add('dragging');
    e.dataTransfer.setData('text/plain', `${piece.dataset.row},${piece.dataset.col}`);
}

/**
 * טיפול בסיום גרירה
 */
function handleDragEnd(e) {
    e.target.classList.remove('dragging');
}

/**
 * טיפול בגרירה מעל
 */
function handleDragOver(e) {
    e.preventDefault();
}

/**
 * טיפול בשחרור
 */
function handleDrop(e) {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    const [fromRow, fromCol] = data.split(',');
    const toElement = e.target.closest('.square');

    if (toElement && toElement !== e.target) {
        const toRow = parseInt(toElement.dataset.row);
        const toCol = parseInt(toElement.dataset.col);

        // המרה לניסוח אלגברי
        const fromSquare = game.squareToNotation(parseInt(fromRow), parseInt(fromCol));
        const toSquare = game.squareToNotation(toRow, toCol);

        // שליחת מהלך
        document.getElementById('move-from').value = fromSquare;
        document.getElementById('move-to').value = toSquare;
        submitMoveToServer();
    }
}

/**
 * עדכון תצוגת היסטוריית מהלכים
 */
function updateMoveHistory(moveHistory) {
    const moveHistoryElement = document.getElementById('move-history');
    if (!moveHistoryElement) return;

    moveHistoryElement.innerHTML = moveHistory.map(move => {
        return `
            <div class="move-history-item">
                <span class="move-number">${move.moveNumber}</span>
                <span class="move-details">
                    <span class="move-from">${move.from}</span>
                    <span class="move-piece">${getPieceSymbol(move.piece, move.color)}</span>
                    <span class="move-to">${move.to}</span>
                </span>
                <span class="move-color ${move.color}">${move.color === 'white' ? 'לבן' : 'שחור'}</span>
            </div>
        `;
    }).join('');
}

/**
 * ניווט בין מהלכים
 */
function navigateMove(direction) {
    if (!currentGame) return;

    currentMoveIndex += direction;

    if (currentMoveIndex < 0) {
        currentMoveIndex = 0;
        return;
    }

    if (currentMoveIndex > currentGame.moveHistory.length) {
        currentMoveIndex = currentGame.moveHistory.length;
        return;
    }

    if (currentMoveIndex === 0) {
        // הצגת לוח התחלתי
        renderChessBoard(game.boardToFen(game.initializeBoard()), currentGame.currentTurn);
    } else {
        // שחזור לוח עד מהלך זה
        let board = game.initializeBoard();
        for (let i = 0; i < currentMoveIndex; i++) {
            const move = currentGame.moveHistory[i];
            board = game.makeMove(board, game.notationToSquare(move.from), game.notationToSquare(move.to));
        }
        renderChessBoard(game.boardToFen(board), currentGame.currentTurn);
    }

    document.getElementById('game-move-number').textContent = `מהלך ${currentMoveIndex}`;
}

/**
 * טיפול בהגשת טופס משחק חדש
 */
function handleNewGameSubmit(e) {
    e.preventDefault();

    const player2Id = document.getElementById('player2-id').value.trim();
    const gameMessage = document.getElementById('game-message');

    if (!player2Id) {
        gameMessage.textContent = 'אנא הזן מספר חשבון של היריב';
        gameMessage.className = 'form-message error';
        return;
    }

    if (!/^\d{6}$/.test(player2Id)) {
        gameMessage.textContent = 'מספר חשבון חייב להיות בדיוק 6 ספרות';
        gameMessage.className = 'form-message error';
        return;
    }

    // יצירת משחק חדש
    fetch('/api/games', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            player1Account: auth.currentUser.accountNumber,
            player2Account: player2Id
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            gameMessage.textContent = data.error;
            gameMessage.className = 'form-message error';
            return;
        }

        gameMessage.textContent = `משחק נוצר בהצלחה! מזהה משחק: ${data.id}`;
        gameMessage.className = 'form-message success';

        // ניקוי טופס
        document.getElementById('new-game-form').reset();

        // טעינה מחדש של לוח הבקרה
        setTimeout(() => {
            loadDashboardData();
        }, 1500);
    })
    .catch(error => {
        console.error('שגיאה ביצירת משחק:', error);
        gameMessage.textContent = 'נכשל ביצירת משחק. אנא נסה שוב.';
        gameMessage.className = 'form-message error';
    });
}

/**
 * שליחת מהלך לשרת
 */
function submitMoveToServer() {
    if (!currentGame) return;

    const moveFrom = document.getElementById('move-from').value.trim().toLowerCase();
    const moveTo = document.getElementById('move-to').value.trim().toLowerCase();
    const gameMessage = document.getElementById('game-message');

    if (!moveFrom || !moveTo) {
        gameMessage.textContent = 'אנא הזן גם ריבוע מקור וגם ריבוע יעד';
        gameMessage.className = 'form-message error';
        return;
    }

    // אימות ניסוח אלגברי
    if (!/^[a-h][1-8]$/.test(moveFrom) || !/^[a-h][1-8]$/.test(moveTo)) {
        gameMessage.textContent = 'ניסוח ריבוע לא תקין. השתמש בפורמט כמו e2, e4';
        gameMessage.className = 'form-message error';
        return;
    }

    // שליחת מהלך
    fetch(`/api/games/${currentGame.id}/move`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            playerFrom: moveFrom,
            playerTo: moveTo
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            gameMessage.textContent = data.error;
            gameMessage.className = 'form-message error';
            return;
        }

        gameMessage.textContent = data.success ? 'מהלך נשלח בהצלחה!' : 'מהלך נכשל';
        gameMessage.className = data.success ? 'form-message success' : 'form-message error';

        if (data.success) {
            // טעינה מחדש של המשחק לקבלת מצב מעודכן
            setTimeout(() => {
                loadGame(currentGame.id);
            }, 1000);
        }
    })
    .catch(error => {
        console.error('שגיאה בשליחת מהלך:', error);
        gameMessage.textContent = 'נכשל בשליחת מהלך. אנא נסה שוב.';
        gameMessage.className = 'form-message error';
    });
}

/**
 * טעינת טבלת דירוג
 */
function loadRanking(append = false) {
    if (rankingLoading || (append && rankingFinished)) return;
    if (!append) {
        rankingOffset = 0;
        rankingFinished = false;
    }
    rankingLoading = true;
    fetch(`/api/users?limit=25&offset=${rankingOffset}`)
    .then(response => response.json())
    .then(users => {
        const rankingBody = document.getElementById('ranking-body');
        if (!rankingBody) return;

            const rows = users.map((user, index) => {
            const ratingClass = getRatingClass(user.rating);

            return `
                <tr class="player-row" tabindex="0" onmouseenter="cancelPlayerPreviewClose(); openPlayerPreview('${user.accountNumber}', this)" onmouseleave="schedulePlayerPreviewClose()" onclick="openPlayerHistory('${user.accountNumber}')" onkeydown="if (event.key === 'Enter') openPlayerHistory('${user.accountNumber}')">
                    <td><span class="rank">#${user.rank || rankingOffset + index + 1}</span></td>
                    <td><span class="account">${user.accountNumber}</span></td>
                    <td><span class="rating ${ratingClass}">${user.rating}</span></td>
                    <td>${user.gamesPlayed}</td>
                    <td>${user.wins}</td>
                    <td>${user.losses}</td>
                </tr>
            `;
            }).join('');
            if (append) rankingBody.insertAdjacentHTML('beforeend', rows);
            else rankingBody.innerHTML = rows;
            rankingOffset += users.length;
            rankingFinished = users.length < 25;
    })
    .catch(error => {
        console.error('שגיאה בטעינת דירוג:', error);
        })
        .finally(() => { rankingLoading = false; });
}

function handleInfiniteListsScroll() {
    if (window.innerHeight + window.scrollY < document.documentElement.scrollHeight - 240) return;
    if (currentScreen === 'ranking') loadRanking(true);
    if (currentScreen === 'player-history' && activeHistoryAccount) loadPlayerHistoryPage(activeHistoryAccount, true);
}

window.openPlayerPreview = function(accountNumber, rowElement) {
    previewAccountNumber = accountNumber;
    fetch(`/api/users/player/${accountNumber}/history`)
        .then(response => response.json())
        .then(games => {
            const preview = document.getElementById('player-preview');
            document.getElementById('player-preview-title').textContent = `היסטוריה: ${accountNumber}`;
            document.getElementById('player-preview-content').innerHTML = games.length
                ? games.slice(0, 3).map(game => `<button class="preview-game" type="button" onclick="openHistoricalGame(${game.id})">${accountNumber} מול ${game.opponentAccount}<small>${game.result} | ${game.moveCount} תורים</small></button>`).join('')
                : '<p>אין עדיין משחקים בהיסטוריה.</p>';
            preview.classList.remove('hidden');
            if (rowElement) {
                const row = rowElement.getBoundingClientRect();
                const table = rowElement.closest('table');
                const tableBounds = table ? table.getBoundingClientRect() : row;
                // עובד גם על שורות טבלה וגם על משבצות שחקנים (כרטיסים ללא tablol cells)
                const isTableCell = Boolean(rowElement.cells);
                const gamesColumn = isTableCell ? rowElement.cells[3]?.getBoundingClientRect() : null;
                const lossesColumn = isTableCell ? rowElement.cells[5]?.getBoundingClientRect() : null;
                const targetCenter = gamesColumn && lossesColumn
                    ? (gamesColumn.left + lossesColumn.right) / 2
                    : (isTableCell ? tableBounds.left + 42 : row.left + (row.width / 2));
                const centeredLeft = targetCenter - (preview.offsetWidth / 2);
                preview.style.left = `${Math.min(
                    Math.max(12, centeredLeft),
                    window.innerWidth - preview.offsetWidth - 12
                )}px`;
                preview.style.right = 'auto';
                const centeredTop = row.top + ((row.height - preview.offsetHeight) / 2);
                preview.style.top = `${Math.max(12, centeredTop)}px`;
            }
        });
};

function closePlayerPreview() {
    cancelPlayerPreviewClose();
    document.getElementById('player-preview')?.classList.add('hidden');
}

window.cancelPlayerPreviewClose = function() {
    if (playerPreviewCloseTimer) clearTimeout(playerPreviewCloseTimer);
    playerPreviewCloseTimer = null;
};

window.schedulePlayerPreviewClose = function() {
    cancelPlayerPreviewClose();
    playerPreviewCloseTimer = setTimeout(closePlayerPreview, 180);
};

window.openPreviewHistory = function() {
    if (!previewAccountNumber) return;
    openPlayerHistory(previewAccountNumber);
    closePlayerPreview();
};

window.openPlayerHistory = function(accountNumber) {
    previousScreenBeforeHistory = currentScreen;
    showScreen('player-history');
    playerHistoryOffset = 0;
    activeHistoryAccount = accountNumber;
    historyFinished = false;
    document.getElementById('player-history-title').textContent = `היסטוריית משחקים: ${accountNumber}`;
    loadPlayerHistoryPage(accountNumber, false);
};

function loadPlayerHistoryPage(accountNumber, append) {
    if (historyLoading || (append && historyFinished)) return;
    historyLoading = true;
    fetch(`/api/users/player/${accountNumber}/history?limit=25&offset=${playerHistoryOffset}`)
        .then(response => response.json())
        .then(games => {
            const list = document.getElementById('player-history-list');
            const cards = games.map(game => `
                <button class="history-game-card" type="button" onclick="openHistoricalGame(${game.id})">
                    <strong>${accountNumber} מול ${game.opponentAccount}</strong>
                    <span>${game.result} | ${game.moveCount} תורים | ${getStatusText(game.status)}</span>
                </button>
            `).join('');
            if (!append) list.innerHTML = cards || '<p class="empty-message">אין משחקים בהיסטוריה.</p>';
            else list.insertAdjacentHTML('beforeend', cards);
            if (games.length < 25) historyFinished = true;
            playerHistoryOffset += games.length;
        })
        .finally(() => { historyLoading = false; });
}

window.openHistoricalGame = function(gameId) {
    showScreen('game');
    loadGame(gameId, true);
};

/**
 * קבלת מחלקת CSS לרמת דירוג
 */
function getRatingClass(rating) {
    if (rating >= 2200) return 'rating-excellent';
    if (rating >= 1800) return 'rating-good';
    if (rating >= 1400) return 'rating-average';
    if (rating >= 1000) return 'rating-poor';
    return 'rating-terrible';
}

/**
 * אתחול היישום כשהדף מוכן
 */
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    trackAnalyticsEvent('page_view', window.location.pathname);
});

function trackAnalyticsEvent(eventType, page, userVisitorId = null) {
    let visitorId = localStorage.getItem('analytics_visitor_id');
    if (userVisitorId) visitorId = userVisitorId;
    if (!visitorId) {
        visitorId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        localStorage.setItem('analytics_visitor_id', visitorId);
    }
    const deviceType = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    fetch('/api/admin/analytics/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, page, visitorId, deviceType, country: 'unknown' })
    }).catch(() => {});
}

function setupMobileMenu() {
    const toggle = document.getElementById('mobile-menu-toggle');
    const menu = document.getElementById('mobile-menu');
    if (!toggle || !menu) return;

    const closeMenu = () => {
        menu.classList.remove('is-open');
        toggle.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = menu.classList.toggle('is-open');
        toggle.classList.toggle('is-open', isOpen);
        toggle.setAttribute('aria-expanded', String(isOpen));
    });

    menu.addEventListener('click', (event) => {
        if (event.target.closest('button')) closeMenu();
    });

    document.addEventListener('click', (event) => {
        if (!menu.contains(event.target) && !toggle.contains(event.target)) closeMenu();
    });
}