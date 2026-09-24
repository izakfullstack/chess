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
let selectedSquare = null;
let boardControlsBound = false;
let invitationPollingTimer = null;
let knownInvitationIds = new Set();
let previewAccountNumber = null;
let historicalGameView = false;
let playerHistoryOffset = 0;
let playerPreviewCloseTimer = null;
let playerPreviewOpenTimer = null;
let playerPreviewPointerX = 0;
let playerPreviewPointerY = 0;
let activePlayerPreviewCard = null;
let activeHistoryAccount = null;
let historyLoading = false;
let historyFinished = false;
let previousScreenBeforeHistory = 'games';
const screenHistory = [];
let pendingLeaveScreen = null;
let leaveConfirmationInProgress = false;
let gamePollTimer = null;
let sentInvitePollTimer = null;
let sentInvitePollInitialized = false;
let handledAcceptedInvites = new Set();
let opponentResignationNoticeShown = false;
let accountSettingsMessageTimer = null;
let accountSettingsDirty = false;
const BOARD_DEFAULT_PAN_Y = '-3rem';
const BOARD_DEFAULT_TILT = '30deg';
const BOARD_DEFAULT_TOP_OFFSET = '-4rem';
const BOARD_MAX_TILT = 38;

function getUserStateKey(name) {
    return auth.currentUser ? `chess_${auth.currentUser.accountNumber}_${name}` : null;
}

function setUserState(name, value) {
    const key = getUserStateKey(name);
    if (key) localStorage.setItem(key, String(value));
}

function removeUserState(name) {
    const key = getUserStateKey(name);
    if (key) localStorage.removeItem(key);
}

function clearPersistedGameState() {
    removeUserState('last_game_id');
    removeUserState('last_game_historical');
}

function restoreLastScreen() {
    if (!auth.currentUser) return;

    const lastGameId = localStorage.getItem(getUserStateKey('last_game_id'));
    if (lastGameId) {
        const historical = localStorage.getItem(getUserStateKey('last_game_historical')) === '1';
        applyScreen('game');
        loadGame(lastGameId, historical);
        return;
    }

    const lastScreen = localStorage.getItem(getUserStateKey('last_screen'));
    if (lastScreen === 'player-history') {
        const account = localStorage.getItem(getUserStateKey('history_account'));
        if (account) {
            activeHistoryAccount = account;
            applyScreen('player-history');
            loadPlayerHistoryPage(account, false);
            return;
        }
    }

    const allowedScreens = ['home', 'games', 'dashboard', 'account-settings'];
    applyScreen(allowedScreens.includes(lastScreen) ? lastScreen : 'home');
}

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
    setupBoardControls();

    // החזרת זהות המנהל מהאחסון המקומי (שם + אותיות)
    applyAdminIdentity(localStorage.getItem('admin_username'));

    if (window.location.pathname === '/admin') {
        showScreen('admin-login');
    } else {
        restoreLastScreen();
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
    // מסך השחקנים נטען כאשר נכנסים אליו דרך showScreen('games').

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
    document.addEventListener('mousemove', event => {
        playerPreviewPointerX = event.clientX;
        playerPreviewPointerY = event.clientY;
        if (activePlayerPreviewCard && !isPointerInsideActivePlayerCard()) closePlayerPreview();
        positionPlayerPreviewAtPointer();
    }, { passive: true });
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
        });
    }

    document.getElementById('back-to-ranking')?.addEventListener('click', goBack);

    document.getElementById('back-from-players')?.addEventListener('click', goBack);
    document.getElementById('back-from-auth')?.addEventListener('click', goBack);
    document.getElementById('back-from-dashboard')?.addEventListener('click', goBack);
    document.getElementById('back-from-game')?.addEventListener('click', goBack);
    document.getElementById('center-board-global')?.addEventListener('click', resetBoardView);
    document.getElementById('back-from-admin-login')?.addEventListener('click', goBack);
    document.getElementById('back-from-admin')?.addEventListener('click', goBack);
    document.getElementById('profile-settings')?.addEventListener('click', () => {
        document.getElementById('profile-menu')?.classList.add('hidden');
        if (auth.requireAuth('יש להתחבר כדי לפתוח הגדרות חשבון')) {
            showScreen('account-settings');
        }
    });
    document.getElementById('back-from-account-settings')?.addEventListener('click', goBack);
    const showFullNameToggle = document.getElementById('show-full-name');
    if (showFullNameToggle) showFullNameToggle.addEventListener('change', markAccountSettingsDirty);
    document.getElementById('save-account-settings')?.addEventListener('click', saveAccountSettings);

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
    document.getElementById('close-sent-invitation')?.addEventListener('click', () => {
        document.getElementById('sent-invitation-dialog')?.classList.add('hidden');
    });
    document.getElementById('opponent-resignation-leave')?.addEventListener('click', () => {
        document.getElementById('opponent-resignation-dialog')?.classList.add('hidden');
        goBack();
    });

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

}

/**
 * הצגת מסך ספציפי.
 * אם השחקן באמצע משחק פעיל — כל יציאה עוברת תחילה באזהרת כניעה.
 */
function showScreen(screenName) {
    // דף הדירוג מוזג לתוך דף "שחקנים"
    if (screenName === 'ranking') screenName = 'games';
    if (screenName === currentScreen) return;

    if (shouldWarnBeforeLeavingGame(screenName)) {
        pendingLeaveScreen = screenName;
        leaveConfirmationInProgress = false;
        const confirmButton = document.getElementById('leave-game-yes');
        if (confirmButton) confirmButton.disabled = false;
        document.getElementById('leave-game-dialog').classList.remove('hidden');
        return;
    }

    if (currentScreen) screenHistory.push(currentScreen);
    applyScreen(screenName);
}

function goBack(fallback = 'home') {
    const previousScreen = screenHistory[screenHistory.length - 1] || fallback;
    if (shouldWarnBeforeLeavingGame(previousScreen)) {
        pendingLeaveScreen = previousScreen;
        leaveConfirmationInProgress = false;
        const confirmButton = document.getElementById('leave-game-yes');
        if (confirmButton) confirmButton.disabled = false;
        document.getElementById('leave-game-dialog').classList.remove('hidden');
        return;
    }
    screenHistory.pop();
    applyScreen(previousScreen);
}

/**
 * הצגת המסך בפועל (ללא בדיקת אזהרת יציאה)
 */
function applyScreen(screenName) {
    // עצירת רענון המשחק כשעוזבים את מסך המשחק
    if (screenName !== 'game') {
        stopGamePolling();
        if (currentGame) clearPersistedGameState();
        document.getElementById('game-loading')?.classList.add('hidden');
    }

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
    document.body.classList.toggle('game-screen-active', screenName === 'game');
    if (auth.currentUser && screenName !== 'auth') setUserState('last_screen', screenName);

    // טיפול בלוגיקה ספציפית למסך
    switch (screenName) {
        case 'dashboard':
            if (!auth.requireAuth()) return;
            loadDashboardData();
            break;
        case 'account-settings':
            if (!auth.requireAuth('יש להתחבר כדי לפתוח הגדרות חשבון')) return;
            loadAccountSettings();
            break;
        case 'games':
            if (!auth.requireAuth()) return;
            loadMatchmakingPlayers();
            loadIncomingInvitations();
            startInvitationPolling();
            break;
        case 'game':
            if (!auth.requireAuth()) return;
            resetBoardView();
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
    leaveConfirmationInProgress = false;
    const confirmButton = document.getElementById('leave-game-yes');
    if (confirmButton) confirmButton.disabled = false;
    document.getElementById('leave-game-dialog').classList.add('hidden');
}

/**
 * אישור יציאה: המשחק הופך לכניעה (היריב מנצח) ثم ניווט למסך היעד
 */
function confirmLeaveGame() {
    if (leaveConfirmationInProgress) return;
    leaveConfirmationInProgress = true;
    const confirmButton = document.getElementById('leave-game-yes');
    if (confirmButton) confirmButton.disabled = true;
    document.getElementById('leave-game-dialog').classList.add('hidden');
    const target = pendingLeaveScreen;
    pendingLeaveScreen = null;

    const gameId = currentGame?.id;
    const myId = Number(auth.currentUser?.id);
    const winnerId = Number(currentGame?.player1Id) === myId ? currentGame.player2Id : currentGame.player1Id;

    stopGamePolling();

    const finish = () => {
        clearPersistedGameState();
        if (screenHistory[screenHistory.length - 1] === target) screenHistory.pop();
        if (target === '__logout__') {
            auth.currentUser = null;
            localStorage.removeItem('chess_user');
            if (typeof auth.updateUIForUser === 'function') auth.updateUIForUser();
            applyScreen('home');
            return;
        }
        if (target) applyScreen(target);
    };

    if (currentGame && String(currentGame.id) === String(gameId)) {
        currentGame.status = 'completed';
        currentGame.winnerId = winnerId;
    }
    leaveConfirmationInProgress = false;

    if (gameId && winnerId !== undefined && winnerId !== null && auth.currentUser) {
        // הניווט מתבצע מיד; הכניעה נשלחת ברקע גם אם הדפדפן נסגר מיד אחר כך.
        finish();
        fetch(`/api/games/${gameId}/complete`, {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winnerId })
        }).catch(error => console.error('הכניעה לא נשמרה בשרת:', error));
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
    const cards = document.querySelectorAll('#available-players-list .player-match-card');
    let visible = 0;

    cards.forEach(card => {
        const account = (card.dataset.playerAccount || card.querySelector('.player-card-account')?.textContent || '').replace(/\D/g, '');
        const matches = !query || account.includes(query.replace(/\D/g, ''));
        card.hidden = !matches;
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
        fetch(`/api/games/${gameId}?accountNumber=${encodeURIComponent(auth.currentUser?.accountNumber || '')}`)
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
                if (previous?.status === 'active' && latest.status === 'completed'
                    && latest.winnerId != null && String(latest.winnerId) === String(auth.currentUser?.id)
                    && !opponentResignationNoticeShown) {
                    opponentResignationNoticeShown = true;
                    showOpponentResignationNotice();
                }
            })
            .catch(() => { /* רענון שקט */ });
    }, 2500);
}

function showOpponentResignationNotice() {
    const dialog = document.getElementById('opponent-resignation-dialog');
    if (!dialog) return;
    dialog.classList.remove('hidden');
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
            // לוח השחקנים: משבצות עם כל הפרטים (דירוג, מספר שחקן, ניקוד, משחקים, ניצחונות, הפסדים)
            // ריחוף = חלון תצוגה מקדימה, לחיצה = דף היסטוריית השחקן
            list.innerHTML = players.length ? players.map(player => `
                <article class="player-match-card" data-player-account="${player.accountNumber}" tabindex="0"
                    onmouseenter="cancelPlayerPreviewClose(); openPlayerPreview('${player.accountNumber}', this, event)"
                    onmouseleave="schedulePlayerPreviewClose()"
                    onclick="openPlayerHistory('${player.accountNumber}')"
                    onkeydown="if (event.key === 'Enter') openPlayerHistory('${player.accountNumber}')">
                    <div class="player-card-head">
                        <strong class="player-card-name ${player.fullName ? '' : 'hidden'}">${escapeHtml(player.fullName || '')}</strong>
                        <span class="availability-status ${player.isAvailable ? 'online' : ''}">${player.isAvailable ? 'זמין' : 'לא זמין'}</span>
                    </div>
                    <div class="player-card-meta-line">
                        <span class="player-card-account">מספר שחקן ${player.accountNumber}</span>
                        <span class="player-card-rank">דירוג ${player.rank || '-'}</span>
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
            filterRankingRows();
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
        const message = document.getElementById('sent-invitation-message');
        const title = document.getElementById('sent-invitation-title');
        const dialog = document.getElementById('sent-invitation-dialog');
        dialog?.classList.remove('hidden');
        if (data.error) {
            if (title) title.textContent = 'לא ניתן לשלוח את ההזמנה';
            if (message) message.textContent = data.error;
        } else {
            if (title) title.textContent = 'ההזמנה נשלחה';
            if (message) message.textContent = `ההזמנה נשלחה לשחקן ${receiverAccount}.`;
        }
    }).catch(error => console.error('שגיאה בשליחת הזמנה:', error));
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
    const loading = document.getElementById('game-loading');
    const loadingBar = loading?.querySelector('span');
    if (accepted && loading) {
        loading.classList.remove('hidden');
        if (loadingBar) {
            loadingBar.style.transform = 'scaleX(0)';
            setTimeout(() => { loadingBar.style.transform = 'scaleX(0.35)'; }, 100);
        }
    }
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
        } else {
            loading?.classList.add('hidden');
        }
    }).catch(error => {
        console.error('שגיאה באישור הזמנה:', error);
        loading?.classList.add('hidden');
        const message = document.getElementById('invitation-dialog-message');
        if (message) message.textContent = 'לא ניתן לאשר את ההזמנה. נסה שוב.';
    });
}

function loadAccountSettings() {
    if (!auth.currentUser) return;
    const toggle = document.getElementById('show-full-name');
    const label = document.getElementById('show-full-name-label');
    const message = document.getElementById('account-settings-message');
    const saveButton = document.getElementById('save-account-settings');
    if (message) message.textContent = '';
    accountSettingsDirty = false;
    if (saveButton) saveButton.disabled = true;
    fetch(`/api/users/settings?accountNumber=${encodeURIComponent(auth.currentUser.accountNumber)}`)
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) throw new Error(data.error || 'נכשלה טעינת ההגדרות');
            const showFullName = data.showFullName === true;
            if (toggle) toggle.checked = showFullName;
            if (label) label.textContent = showFullName ? 'כן' : 'לא';
            auth.currentUser.showFullName = showFullName;
            localStorage.setItem('chess_user', JSON.stringify(auth.currentUser));
        })
        .catch(error => {
            if (message) {
                message.textContent = error.message || 'נכשלה טעינת ההגדרות';
                message.className = 'form-message error';
            }
        });
}

function markAccountSettingsDirty(event) {
    const toggle = event.currentTarget;
    const label = document.getElementById('show-full-name-label');
    const message = document.getElementById('account-settings-message');
    const saveButton = document.getElementById('save-account-settings');
    const showFullName = toggle.checked;
    accountSettingsDirty = true;
    if (label) label.textContent = showFullName ? 'כן' : 'לא';
    if (saveButton) saveButton.disabled = false;
    if (message) {
        message.textContent = '';
        message.className = 'form-message';
    }
}

function saveAccountSettings() {
    if (!auth.currentUser || !accountSettingsDirty) return;
    const toggle = document.getElementById('show-full-name');
    const label = document.getElementById('show-full-name-label');
    const message = document.getElementById('account-settings-message');
    const saveButton = document.getElementById('save-account-settings');
    if (!toggle || !saveButton) return;
    const showFullName = toggle.checked;
    saveButton.disabled = true;
    if (message) {
        message.textContent = 'שומר...';
        message.className = 'form-message';
    }
    fetch('/api/users/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber: auth.currentUser.accountNumber, showFullName })
    })
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) throw new Error(data.error || 'נכשלה שמירת ההגדרות');
            accountSettingsDirty = false;
            auth.currentUser.showFullName = showFullName;
            localStorage.setItem('chess_user', JSON.stringify(auth.currentUser));
            if (label) label.textContent = showFullName ? 'כן' : 'לא';
            if (message) {
                message.textContent = 'ההגדרות נשמרו בהצלחה';
                message.className = 'form-message success';
                clearTimeout(accountSettingsMessageTimer);
                accountSettingsMessageTimer = setTimeout(() => {
                    if (message.textContent === 'ההגדרות נשמרו בהצלחה') {
                        message.textContent = '';
                        message.className = 'form-message';
                    }
                }, 2000);
            }
        })
        .catch(error => {
            accountSettingsDirty = true;
            saveButton.disabled = false;
            if (message) {
                message.textContent = error.message || 'נכשלה שמירת ההגדרות';
                message.className = 'form-message error';
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
    if (!silent) resetBoardView();
    const loading = document.getElementById('game-loading');
    const loadingBar = loading?.querySelector('.game-loading-bar span');
    const loadingText = loading?.querySelector('strong');
    let loadingVisible = false;
    let loadingPercent = 0;
    let loadingHideTimer = null;

    const setLoadingProgress = percent => {
        if (silent || !loading) return;
        if (!loadingVisible) {
            loadingVisible = true;
            loading.classList.remove('hidden');
        }
        loadingPercent = Math.max(loadingPercent, Math.min(100, Math.round(percent)));
        if (loadingBar) loadingBar.style.transform = `scaleX(${loadingPercent / 100})`;
        if (loadingText) loadingText.textContent = `טוען.. ${loadingPercent}%`;
    };

    if (!silent) {
        loadingPercent = 0;
        if (loadingBar) loadingBar.style.transform = 'scaleX(0)';
        if (loadingText) loadingText.textContent = 'טוען.. 0%';
        loading.classList.remove('hidden');
        loadingVisible = true;
    }

    const accountQuery = encodeURIComponent(auth.currentUser?.accountNumber || '');
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/api/games/${gameId}?accountNumber=${accountQuery}`);

    xhr.onprogress = event => {
        if (!silent && event.lengthComputable && event.total > 0) {
            // עד 99% בזמן ההעברה; 100% יוגדר רק לאחר קבלת תשובה תקינה
            setLoadingProgress((event.loaded / event.total) * 99);
        }
    };

    xhr.onload = () => {
        try {
            if (xhr.status < 200 || xhr.status >= 300) {
                throw new Error(`HTTP ${xhr.status}`);
            }
            const game = typeof xhr.response === 'string' ? JSON.parse(xhr.response) : xhr.response;
            if (!game) throw new Error('תשובת משחק ריקה');

            currentGame = game;
            setUserState('last_game_id', game.id);
            setUserState('last_game_historical', historical ? '1' : '0');
            if (!silent) {
                setLoadingProgress(100);
                clearTimeout(loadingHideTimer);
                loadingHideTimer = setTimeout(() => {
                    loading?.classList.add('hidden');
                    loadingVisible = false;
                }, 280);
            }

            setTimeout(() => {
            // עדכון מסך המשחק רק לאחר שהתקבלו הנתונים המלאים
            document.getElementById('game-title').textContent = `משחק ${game.id}: שחקן ${game.player1Account} מול שחקן ${game.player2Account}`;

            // הצגת ניווט היסטוריה רק כאשר נפתח משחק היסטורי
            const gameControls = document.querySelector('.game-controls');
            if (gameControls) gameControls.style.display = historical ? 'flex' : 'none';

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
            gameStatus.style.display = !historical && game.status === 'active' ? 'inline-block' : 'none';

            // המשחק מתבצע באמצעות לחיצה ישירה על ריבועי הלוח.
            // הפעלת רענון בזמן אמת למשחק פעיל (כדי ששני השחקנים יראו כל מהלך)
            if (game.status === 'active' && !historical) startGamePolling(game.id);
            else stopGamePolling();
        }, 0);
        } catch (error) {
            if (silent) return;
            clearTimeout(loadingHideTimer);
            loadingVisible = false;
            console.error('שגיאה בטעינת משחק:', error);
            document.getElementById('game-message').textContent = 'נכשל בטעינת המשחק';
            document.getElementById('game-message').className = 'form-message error';
            loading?.classList.add('hidden');
        }
    };

    xhr.onerror = () => {
        if (silent) return;
        clearTimeout(loadingHideTimer);
        loadingVisible = false;
        console.error('שגיאת רשת בטעינת המשחק');
        document.getElementById('game-message').textContent = 'נכשל בטעינת המשחק';
        document.getElementById('game-message').className = 'form-message error';
        loading?.classList.add('hidden');
    };

    xhr.send();
}

/**
 * ציור לוח שחמט
 */
function resetBoardView() {
    const stage = document.getElementById('chess-board-stage');
    const board = document.getElementById('game-board');
    if (!stage) return;

    stage.style.setProperty('--board-pan-x', '0px');
    stage.style.top = '-5rem';
    stage.style.setProperty('--board-pan-y', '0px');
    board?.style.setProperty('--board-rotate', '0deg');
    board?.style.setProperty('--board-tilt-x', BOARD_DEFAULT_TILT);
    stage.classList.remove('panning', 'rotating');
}

function setupBoardControls() {
    const stage = document.getElementById('chess-board-stage');
    const board = document.getElementById('game-board');
    if (!stage || !board || boardControlsBound) return;
    boardControlsBound = true;

    let mode = null;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let startRotate = 0;
    let startTilt = 0;
    let pointerCaptured = false;

    const DRAG_THRESHOLD = 4;
    const numberOn = (element, property) => {
        const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(property));
        return Number.isFinite(value) ? value : 0;
    };

    const stop = event => {
        if (mode === null) return;
        mode = null;
        pointerId = null;
        pointerCaptured = false;
        stage.classList.remove('panning', 'rotating');
        if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    };

    stage.addEventListener('contextmenu', event => event.preventDefault());

    stage.addEventListener('pointerdown', event => {
        if (event.button !== 0 && event.button !== 2) return;
        mode = event.button === 2 ? 'pan' : 'rotate';
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        startPanX = numberOn(stage, '--board-pan-x');
        startPanY = numberOn(stage, '--board-pan-y');
        startRotate = numberOn(board, '--board-rotate');
        startTilt = numberOn(board, '--board-tilt-x');
        stage.classList.toggle('panning', mode === 'pan');
        stage.classList.toggle('rotating', mode === 'rotate');
    });

    stage.addEventListener('pointermove', event => {
        if (event.pointerId !== pointerId) return;
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        if (!pointerCaptured && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
            event.preventDefault();
            stage.setPointerCapture(pointerId);
            pointerCaptured = true;
        }
        if (!pointerCaptured) return;

        if (mode === 'pan') {
            stage.style.setProperty('--board-pan-x', `${startPanX + deltaX}px`);
            stage.style.setProperty('--board-pan-y', `${startPanY + deltaY}px`);
            return;
        }

        const nextRotation = startRotate - deltaX * 0.22;
        board.style.setProperty('--board-rotate', `${nextRotation}deg`);
        const nextTilt = Math.max(0, Math.min(BOARD_MAX_TILT, startTilt - deltaY * 0.25));
        board.style.setProperty('--board-tilt-x', `${nextTilt}deg`);
    });

    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);
    stage.addEventListener('lostpointercapture', event => {
        if (event.pointerId === pointerId) stop(event);
    });
}
function shouldFlipBoard() {
    if (!currentGame || !auth.currentUser) return false;
    if (String(auth.currentUser.accountNumber) === String(currentGame.player1Account)) {
        return currentGame.player1Color === 'black';
    }
    if (String(auth.currentUser.accountNumber) === String(currentGame.player2Account)) {
        return currentGame.player2Color === 'black';
    }
    return false;
}

function renderChessBoard(fen, currentTurn) {
    const boardElement = document.getElementById('game-board');
    if (!boardElement) return;

    boardElement.innerHTML = '';

    const board = game.fenToBoard(fen);
    const flipped = shouldFlipBoard();

    for (let displayRow = 0; displayRow < 8; displayRow++) {
        for (let displayCol = 0; displayCol < 8; displayCol++) {
            const row = flipped ? 7 - displayRow : displayRow;
            const col = flipped ? 7 - displayCol : displayCol;
            const square = document.createElement('div');
            const piece = board[row][col];
            const legalMoves = currentGame?.legalMoves || [];
            const selectedPiece = selectedSquare && (
                legalMoves.some(move => move.from.row === selectedSquare.row && move.from.col === selectedSquare.col)
                || piece?.color === currentGame.currentTurn
            ) ? selectedSquare : null;
            const isSelectedSquare = selectedPiece && selectedPiece.row === row && selectedPiece.col === col;
            const canMoveTo = selectedPiece && legalMoves.some(move =>
                move.from.row === selectedPiece.row && move.from.col === selectedPiece.col &&
                move.to.row === row && move.to.col === col);
            const squareClasses = [`square`, (row + col) % 2 === 0 ? 'light' : 'dark'];
            const isCaptureTarget = Boolean(canMoveTo && piece && piece.color !== currentGame.currentTurn);
            if (isSelectedSquare) squareClasses.push('selected-square');
            if (canMoveTo) squareClasses.push('validmove');
            if (isCaptureTarget) squareClasses.push('capture-target');
            square.className = squareClasses.join(' ');
            square.dataset.row = row;
            square.dataset.col = col;
            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece ${piece.color}${isSelectedSquare ? ' selected-piece' : ''}`;
                const symbol = getPieceSymbol(piece.type, piece.color);
                pieceElement.dataset.symbol = symbol;
                pieceElement.innerHTML = getPieceSvg(piece.type);
                pieceElement.setAttribute('aria-label', `${piece.color === 'white' ? 'כלי לבן' : 'כלי שחור'} ${getPieceTypeName(piece.type)}`);
                pieceElement.draggable = false;
                pieceElement.dataset.row = row;
                pieceElement.dataset.col = col;
                pieceElement.dataset.piece = piece.type;
                pieceElement.dataset.color = piece.color;

                // הוספת פונקציונליות גרירה ושחרור
                pieceElement.addEventListener('dragstart', handleDragStart);
                pieceElement.addEventListener('dragend', handleDragEnd);

                square.appendChild(pieceElement);
            }

            boardElement.appendChild(square);
        }
    }

    // מאזין מרכזי לבחירת ריבוע; תפס גם לחיצה על SVG הכלי.
    boardElement.addEventListener('click', event => {
        const square = event.target.closest('.square');
        if (!square || !boardElement.contains(square)) return;
        const row = Number.parseInt(square.dataset.row, 10);
        const col = Number.parseInt(square.dataset.col, 10);
        if (Number.isInteger(row) && Number.isInteger(col)) {
            handleSquareClick(row, col);
        }
    });
    // הוספת מאזיני אירועים לאזור שחרור
    boardElement.addEventListener('dragover', handleDragOver);
    boardElement.addEventListener('drop', handleDrop);
}

/**
 * קבלת סמל כלי שחמט
 */
function getPieceSymbol(type, color) {
    // סמלי שחמט מלאים לשני הצבעים; הצבע נקבע מעיצוב ה-CSS.
    const symbols = {
        'king': '♚',
        'queen': '♛',
        'rook': '♜',
        'bishop': '♝',
        'knight': '♞',
        'pawn': '♟'
    };
    return symbols[type] || '';
}

function getPieceTypeName(type) {
    return {
        king: 'מלך',
        queen: 'מלכה',
        rook: 'רוכב',
        bishop: 'פרש',
        knight: 'סוס',
        pawn: 'חייל'
    }[type] || 'כלי';
}

/**
 * יצירת כלי שחמט כ־SVG מלא, ללא תלות בגופני Unicode.
 */
function getPieceSvg(type) {
    const sharedBase = '<path class="piece-base" d="M23 78h54l6 8H17z"/><path class="piece-stem" d="M34 66h32l4 12H30z"/>';
    const pieces = {
        king: `<path class="piece-fill" d="M46 8h8v9h9v8h-9v11h-8V25h-9v-8h9z"/><path class="piece-fill" d="M50 34c-8 0-14 7-14 15 0 6 3 10 8 13l-7 8h26l-7-8c5-3 8-7 8-13 0-8-6-15-14-15z"/>${sharedBase}`,
        queen: `<circle class="piece-fill" cx="22" cy="20" r="6"/><circle class="piece-fill" cx="35" cy="13" r="6"/><circle class="piece-fill" cx="50" cy="10" r="6"/><circle class="piece-fill" cx="65" cy="13" r="6"/><circle class="piece-fill" cx="78" cy="20" r="6"/><path class="piece-fill" d="M20 23l9 28h42l9-28-16 14-14-20-14 20z"/><path class="piece-fill" d="M31 51h38l-4 17H35z"/>${sharedBase}`,
        rook: `<path class="piece-fill" d="M19 15h13v10h12V15h12v10h12V15h13v27H19z"/><path class="piece-fill" d="M28 42h44l-5 25H33z"/>${sharedBase}`,
        bishop: `<path class="piece-fill" d="M50 9c9 0 16 7 16 16 0 8-5 14-12 17l5 8-9 9 8 10H42l8-10-9-9 5-8c-7-3-12-9-12-17 0-9 7-16 16-16z"/><path class="piece-detail" d="M38 26l24 9"/>${sharedBase}`,
        knight: `<path class="piece-fill" d="M29 70l5-24-13-12 10-8 5-13 13 8 18 4c10 3 13 12 8 20l-8 13 5 12z"/><path class="piece-detail" d="M39 31l9 7-10 5"/><circle class="piece-detail-dot" cx="66" cy="34" r="3"/>${sharedBase}`,
        pawn: `<circle class="piece-fill" cx="50" cy="25" r="15"/><path class="piece-fill" d="M40 38c0 8-8 12-8 20 0 6 4 10 9 12H59c5-2 9-6 9-12 0-8-8-12-8-20z"/>${sharedBase}`
    };
    return `<svg class="piece-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${pieces[type] || pieces.pawn}</svg>`;
}

/**
 * טיפול בלחיצה על ריבוע לבחירת כלי
 */
function isCurrentPlayerTurn() {
    if (!currentGame || !auth.currentUser || currentGame.status !== 'active') return false;
    const account = String(auth.currentUser.accountNumber);
    const player1 = String(currentGame.player1Account);
    const player2 = String(currentGame.player2Account);
    if (account === player1) return currentGame.currentTurn === (currentGame.player1Color || 'white');
    if (account === player2) return currentGame.currentTurn === (currentGame.player2Color || 'black');
    return false;
}

function handleSquareClick(row, col) {
    if (!currentGame || currentGame.status !== 'active' || historicalGameView || !isCurrentPlayerTurn()) return;
    const legalMoves = currentGame.legalMoves || [];
    const notation = game.squareToNotation(row, col);
    const board = game.fenToBoard(currentGame.board);
    const pieceOnSquare = board[row]?.[col] || null;

    if (selectedSquare) {
        const move = legalMoves.find(item =>
            item.from.row === selectedSquare.row && item.from.col === selectedSquare.col && item.to.row === row && item.to.col === col);
        if (move) {
            selectedSquare = null;
            submitMoveToServer(notationFromSquare(move.from), notationFromSquare(move.to), move.promotion);
            return;
        }

        // גיבוי למצב שבו רשימת המהלכים עוד לא הסתיימה להיטען: אכילה ישירה
        // עדיין נבדקת במלואה בשרת לפני שמירתה.
        const fromSquare = notationFromSquare(selectedSquare);
        const fromPiece = board[selectedSquare.row]?.[selectedSquare.col];
        if (fromPiece && pieceOnSquare && pieceOnSquare.color !== fromPiece.color) {
            selectedSquare = null;
            submitMoveToServer(fromSquare, notation);
            return;
        }
    }

    const canSelect = legalMoves.some(move => move.from.row === row && move.from.col === col)
        || (pieceOnSquare && pieceOnSquare.color === currentGame.currentTurn);
    selectedSquare = canSelect ? { row, col } : null;
    renderChessBoard(currentGame.board, currentGame.currentTurn);
}

function notationFromSquare(square) {
    return game.squareToNotation(square.row, square.col);
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

    if (toElement) {
        const toRow = parseInt(toElement.dataset.row);
        const toCol = parseInt(toElement.dataset.col);

        // המרה לניסוח אלגברי
        const fromSquare = game.squareToNotation(parseInt(fromRow), parseInt(fromCol));
        const toSquare = game.squareToNotation(toRow, toCol);

        // שליחת המהלך שנבחר ישירות מהלוח
        submitMoveToServer(fromSquare, toSquare);
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
    const gameMessage = document.getElementById('dashboard-game-message');

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
function submitMoveToServer(fromSquare, toSquare, promotion = null) {
    if (!currentGame) return;

    const moveFrom = String(fromSquare || '').trim().toLowerCase();
    const moveTo = String(toSquare || '').trim().toLowerCase();
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
            playerTo: moveTo,
            promotion,
            accountNumber: auth.currentUser?.accountNumber
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            gameMessage.textContent = data.error;
            gameMessage.className = 'form-message error';
            return;
        }

        gameMessage.textContent = '';
        gameMessage.className = 'form-message';

        if (data.success) {
            // טעינה מחדש של המשחק לקבלת מצב מעודכן
            setTimeout(() => {
                loadGame(currentGame.id, historicalGameView, true);
            }, 1000);
        }
    })
    .catch(error => {
        console.error('שגיאה בשליחת מהלך:', error);
        gameMessage.textContent = 'נכשל בשליחת מהלך. אנא נסה שוב.';
        gameMessage.className = 'form-message error';
    });
}

function handleInfiniteListsScroll() {
    if (window.innerHeight + window.scrollY < document.documentElement.scrollHeight - 240) return;
    if (currentScreen === 'player-history' && activeHistoryAccount) loadPlayerHistoryPage(activeHistoryAccount, true);
}

function isPointerInsideActivePlayerCard() {
    if (!activePlayerPreviewCard) return false;
    const bounds = activePlayerPreviewCard.getBoundingClientRect();
    return playerPreviewPointerX >= bounds.left
        && playerPreviewPointerX <= bounds.right
        && playerPreviewPointerY >= bounds.top
        && playerPreviewPointerY <= bounds.bottom;
}

function positionPlayerPreviewAtPointer() {
    const preview = document.getElementById('player-preview');
    if (!preview || preview.classList.contains('hidden')) return;

    const width = preview.offsetWidth;
    const height = preview.offsetHeight;
    const maxLeft = Math.max(12, window.innerWidth - width - 12);
    const maxTop = Math.max(12, window.innerHeight - height - 12);
    const pointerGap = 10;
    const left = Math.min(maxLeft, Math.max(12, playerPreviewPointerX - (width / 2)));
    const top = Math.min(maxTop, Math.max(12, playerPreviewPointerY - height - pointerGap));

    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    preview.style.right = 'auto';
}

window.openPlayerPreview = function(accountNumber, rowElement, pointerEvent) {
    if (pointerEvent) {
        playerPreviewPointerX = pointerEvent.clientX;
        playerPreviewPointerY = pointerEvent.clientY;
    }

    if (playerPreviewOpenTimer) clearTimeout(playerPreviewOpenTimer);
    document.getElementById('player-preview')?.classList.add('hidden');
    activePlayerPreviewCard = rowElement;
    previewAccountNumber = accountNumber;
    playerPreviewOpenTimer = setTimeout(() => {
        playerPreviewOpenTimer = null;
        if (previewAccountNumber !== accountNumber) return;

        fetch(`/api/users/player/${accountNumber}/history`)
            .then(response => response.json())
            .then(games => {
                const preview = document.getElementById('player-preview');
                if (!preview || previewAccountNumber !== accountNumber) return;
                if (!isPointerInsideActivePlayerCard()) {
                    closePlayerPreview();
                    return;
                }

                document.getElementById('player-preview-title').textContent = 'היסטוריית משחקים';
                const gameList = games.length
                    ? games.slice(0, 3).map(game => `<button class="preview-game" type="button" onclick="openHistoricalGame(${game.id})">${accountNumber} מול ${game.opponentAccount}<small>${game.result} | ${game.moveCount} תורים</small></button>`).join('')
                    : '<p class="player-preview-empty">אין עדיין משחקים בהיסטוריה.</p>';
                document.getElementById('player-preview-content').innerHTML = `${gameList}<span class="player-preview-full-history-hint">לחץ על משבצת השחקן להיסטוריית המשחקים המלאה</span>`;
                preview.classList.remove('hidden');
                positionPlayerPreviewAtPointer();
            });
    }, 2000);
};

function closePlayerPreview() {
    cancelPlayerPreviewClose();
    if (playerPreviewOpenTimer) clearTimeout(playerPreviewOpenTimer);
    playerPreviewOpenTimer = null;
    activePlayerPreviewCard = null;
    document.getElementById('player-preview')?.classList.add('hidden');
}

window.cancelPlayerPreviewClose = function() {
    if (playerPreviewCloseTimer) clearTimeout(playerPreviewCloseTimer);
    playerPreviewCloseTimer = null;
};

window.schedulePlayerPreviewClose = function() {
    closePlayerPreview();
};

window.openPreviewHistory = function() {
    if (!previewAccountNumber) return;
    openPlayerHistory(previewAccountNumber);
    closePlayerPreview();
};

window.openPlayerHistory = function(accountNumber) {
    setUserState('history_account', accountNumber);
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
