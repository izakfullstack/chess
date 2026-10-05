/**
 * Application core: Shared state, session bootstrap, navigation, and global game flow.
 */

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
 * - app-core.js: מתאם בין מודולי הממשק
 */

let currentScreen = 'home';
let currentGame = null;
let moveHistory = [];
let currentMoveIndex = -1;
let selectedSquare = null;
let board3d = null;
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
let gameEntryHistory = null;
let lastNonGameScreen = 'home';
const screenHistory = [];
let pendingLeaveScreen = null;
let leaveConfirmationInProgress = false;
let gamePollTimer = null;
let sentInvitePollTimer = null;
let sentInvitePollInitialized = false;
let handledAcceptedInvites = new Set();
// חותך מועד שבו הדף נטען. הזמנות שאושרו לפני החותך נחשבות לישנות ולא יפתחו משחק אוטומטית.
const PAGE_LOADED_AT = Date.now();
let opponentResignationNoticeShown = false;
let accountSettingsMessageTimer = null;
let accountSettingsDirty = false;
const BOARD_DEFAULT_PAN_Y = '0px';
const BOARD_DEFAULT_STAGE_TOP = '-2rem';
const BOARD_DEFAULT_TILT = '30deg';
const BOARD_DEFAULT_TOP_OFFSET = '-4rem';
const BOARD_MAX_TILT = 50;

const VALID_SCREENS = new Set([
    'home', 'auth', 'games', 'dashboard', 'account-settings', 'game',
    'player-history', 'admin-login', 'admin'
]);

function getPreviousScreen(fallback = 'home') {
    while (screenHistory.length) {
        const candidate = screenHistory[screenHistory.length - 1];
        if (VALID_SCREENS.has(candidate)) return candidate;
        screenHistory.pop();
    }
    return VALID_SCREENS.has(fallback) ? fallback : 'home';
}

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
    removeUserState('game_entry_screen');
}

function restoreLastScreen() {
    if (!auth.currentUser) return;

    const lastGameId = localStorage.getItem(getUserStateKey('last_game_id'));
    if (lastGameId) {
        const historical = localStorage.getItem(getUserStateKey('last_game_historical')) === '1';
        // שחזור המסך שממנו נכנסו למשחק, כדי שכפתור "חזור" יחזיר לשם
        // במקום לקפוץ ישירות לדף הראשי.
        const entryKey = getUserStateKey('game_entry_screen');
        const entryScreen = entryKey ? localStorage.getItem(entryKey) : null;
        if (entryScreen && VALID_SCREENS.has(entryScreen) && entryScreen !== 'game') {
            screenHistory.push(entryScreen);
            gameEntryHistory = screenHistory.slice();
            lastNonGameScreen = entryScreen;
        }
        // המחלקה מתווספת לפני הטעינה האסינכרונית, כדי שהדפדפן
        // יצר את פריסת מסך המשחק הנכונה כבר בטעינה הראשונה.
        applyScreen('game');
        suppressInitialScreenAnimation();
        loadGame(lastGameId, historical);
        return;
    }

    const lastScreen = localStorage.getItem(getUserStateKey('last_screen'));
    if (['home', 'games', 'dashboard', 'account-settings'].includes(lastScreen)) {
        lastNonGameScreen = lastScreen;
    }
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
    // טעינת האסימון לפני כל בקשת API - חייב להיות הראשון כדי שכל
    // הקריאות הבאות יישארו מוגנות.
    // אתחול מודול אימות
    auth.initAuth().then(() => {
    // הגדרת ניווט
    setupNavigation();

    // הגדרת מאזיני אירועים גלובליים
    setupGlobalEvents();
    setupBoardControls();
    setupBoard3D();
    setupPieces3D();

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
            .then(async response => {
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'אימות ההתחברות נכשל');
                return data;
            })
            .then(data => {
                auth.currentUser = data;
                auth.updateUIForUser();
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

    // מעקב אחר הזמנות שהתקבלו (פתיחת דיאלוג ההזמנה אצל הנמען).
    // מופעל מכאן ולא רק ממסך "שחקנים", כדי שההזמנה תגיע גם אם השחקן
    // נמצא במסך אחר (בית, לוח בקרה וכו').
    startInvitationPolling();

    // טעינה ראשונית: ההזמנות שכבר קיימות נרשמות כמותירות כדי שלא
    // ייפתחו חלונות דיאלוג מיידיים על הזמנות ישנות שהשחקן כבר ראה.
    loadIncomingInvitations(false);

    // גישה ישירה למשחק: חייבים לעבור למסך המשחק לפני loadGame, בדיוק כמו
    // ב-RestoreLastGame. בלי זה המשתמש נשאר במסך הקודם, ו-startGamePolling
    // יבטל את עצמו כבר בסבב הראשון (currentScreen !== 'game') - כך שהמעקב
    // אחרי כניעת היריב מעולם לא יעבוד בקישור ישיר.
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('game');
    if (gameId) {
        showScreen('game');
        loadGame(gameId);
    }
    });
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


    const refreshPlayers = document.getElementById('refresh-players');
    if (refreshPlayers) refreshPlayers.addEventListener('click', loadMatchmakingPlayers);

    const availabilityToggle = document.getElementById('availability-toggle');
    if (availabilityToggle) availabilityToggle.addEventListener('change', updateAvailability);
    document.getElementById('preferred-color')?.addEventListener('change', (event) => {
        if (!auth.currentUser) return;
        fetch('/api/games/matchmaking/preferred-color', { method: 'POST',         headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferredColor: event.target.value }) });
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
        opponentResignationNoticeShown = false;
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
    if (!VALID_SCREENS.has(screenName)) screenName = 'home';
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
    if (screenName === 'game') {
        gameEntryHistory = screenHistory.slice();
        // נשמר גם בזיכרון הקבוע, כדי שאחרי רענון הדף כפתור "חזור"
        // יחזיר את השחקן לאותו מסך שממנו נכנס למשחק.
        if (currentScreen) setUserState('game_entry_screen', currentScreen);
    }
    if (screenName !== 'game' && currentScreen !== 'game') lastNonGameScreen = screenName;
    applyScreen(screenName);
}

function goBack(fallback = lastNonGameScreen || 'home') {
    // אם יצאנו ממשחק וההיסטוריה בזיכרון ריקה (למשל אחרי רענון, או כשהמשחק
    // נפתח אוטומטית ממעקב הזמנות) - משתמשים במסך המקור שנשמר בזיכרון הקבוע,
    // כדי שכפתור "חזור" לא יקפוץ בטעות לדף הראשי.
    let previousScreen = getPreviousScreen(fallback);
    if (previousScreen === 'home' && currentScreen === 'game') {
        const entryKey = getUserStateKey('game_entry_screen');
        const entryScreen = entryKey ? localStorage.getItem(entryKey) : null;
        if (entryScreen && VALID_SCREENS.has(entryScreen) && entryScreen !== 'game') {
            previousScreen = entryScreen;
        }
    }
    if (shouldWarnBeforeLeavingGame(previousScreen)) {
        pendingLeaveScreen = previousScreen;
        leaveConfirmationInProgress = false;
        const confirmButton = document.getElementById('leave-game-yes');
        if (confirmButton) confirmButton.disabled = false;
        document.getElementById('leave-game-dialog').classList.remove('hidden');
        return;
    }
    if (screenHistory[screenHistory.length - 1] === previousScreen) screenHistory.pop();
    applyScreen(previousScreen);
}

/**
 * מבטל את אנימציית המעבר בין מסכים בטעינה הראשונה בלבד.
 * האנימציה גורמת למסך לקפוץ 10 פיקסלים כלפי מעלה בכל טעינה מחדש,
 * ולכן היא מושבתת רק בפעם הראשונה ואחר כך פועלת כרגיל במעברים ידניים.
 */
function suppressInitialScreenAnimation() {
    document.body.classList.add('no-screen-animation');
    requestAnimationFrame(() => requestAnimationFrame(() => {
        window.setTimeout(() => {
            document.body.classList.remove('no-screen-animation');
        }, 60);
    }));
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

    // עדכון מצב הגוף לפני הצגת המסך, כדי שכללי ה-CSS של מסך המשחק
    // יחולו כבר ברגע הראשון והפריסה לא תקפוץ אחרי הטעינה.
    currentScreen = screenName;
    if (screenName !== 'game') lastNonGameScreen = screenName;
    document.body.classList.toggle('admin-mode', screenName === 'admin' || screenName === 'admin-login');
    document.body.classList.toggle('game-screen-active', screenName === 'game');
    if (auth.currentUser && screenName !== 'auth') setUserState('last_screen', screenName);

    // הצגת מסך יעד
    const targetScreen = document.getElementById(`screen-${screenName}`);
    if (targetScreen) {
        targetScreen.classList.add('active');
    }

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
            if (!localStorage.getItem('admin_username')) {
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
 * אישור יציאה: המשחק הופך לכניעה (היריב מנצח) ומבוצע ניווט למסך היעד
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
        if (Array.isArray(gameEntryHistory)) {
            screenHistory.splice(0, screenHistory.length, ...gameEntryHistory);
            gameEntryHistory = null;
        }
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
        }).catch(error => console.error('הכניעה לא נשמרה בשרת:', error))
            .finally(() => {
                if (target === '__logout__') auth.logoutUser();
            });
    } else {
        finish();
        if (target === '__logout__') auth.logoutUser();
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
        fetch(`/api/games/${gameId}`)
            .then(response => response.json())
            .then(latest => {
                if (currentScreen !== 'game') return;
                const previous = currentGame;
                const movesChanged = !previous
                    || String(previous.id) !== String(latest.id)
                    || (previous.moveHistory?.length || 0) !== (latest.moveHistory?.length || 0);
                const statusChanged = !previous || previous.status !== latest.status;

                if (movesChanged) {
                    // שינוי בלוח או במהלכים - נדרשת רינדור מחדש מלאה
                    loadGame(latest.id, historicalGameView, true);
                } else if (statusChanged) {
                    // שינוי סטטוס בלבד (למשל היריב כנע) - מעדכנים רק את הכותרת,
                    // בלי לטעון את המשחק מחדש ולאפס את המעקב.
                    currentGame = { ...currentGame, ...latest };
                    const gameStatus = document.getElementById('game-status');
                    if (gameStatus) {
                        gameStatus.textContent = `סטטוס: ${getStatusText(latest.status)}`;
                        gameStatus.className = `game-status status-${latest.status}`;
                        gameStatus.style.display = !historicalGameView && latest.status === 'active' ? 'inline-block' : 'none';
                    }
                    if (latest.status !== 'active') stopGamePolling();
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
 * מעקב אחר הזמנות ששלח המשתמש — ברגע אישור, לוח המשחק נפתח גם אצל המזמין.
 *
 * חשוב: מגיבים רק על אישורים שקרו *בזמן שהדף הזה פתוח*. היסטוריית הזמנות
 * שאושרו בעבר (בסבבים קודמים של המעקב) כבר נצפתה אז, ופתיחתה שוב
 * הייתה מקפיצה את השחקן למשחק ישן כל כמה שניות.
 */
function startSentInvitePolling() {
    if (sentInvitePollTimer) return;
    sentInvitePollTimer = setInterval(() => {
        if (!auth.currentUser) return;
        fetch('/api/games/matchmaking/sent-invitations')
            .then(response => response.json())
            .then(invitations => {
                if (!Array.isArray(invitations)) return;
                // מסמנים שראינו את כל ההיסטוריה, כדי שהיא לא תיפתח שוב
                sentInvitePollInitialized = true;

                // רק ההזמנה שאושרה אחרי שהדף נטען רלוונטית כאן.
                // ההזמנות ישנות (respondedAt <= PAGE_LOADED_AT) כבר נפתחו או שהתעלמנו מהן.
                const freshAccepted = invitations.filter(invitation => {
                    if (invitation.status !== 'accepted' || !invitation.gameId) return false;
                    if (handledAcceptedInvites.has(String(invitation.id))) return false;
                    const respondedAt = Date.parse(invitation.respondedAt || '');
                    return !Number.isNaN(respondedAt) && respondedAt > PAGE_LOADED_AT;
                });

                if (freshAccepted.length === 0) return;

                // אם כבר נמצא משחק פעיל, לא נבלוג הזמנות - הן יישארו לסבב הבא.
                const inActiveGame = currentScreen === 'game'
                    && currentGame && currentGame.status === 'active' && !historicalGameView;
                if (inActiveGame) return;

                // רק ההזמנה האחרונה - כך לא נפתחים משחקים ישנים בזה אחר זה.
                const invitation = freshAccepted[0];
                const key = String(invitation.id);

                // showScreen עשויה להיחסם בדיאלוג אישור יציאה; אם כך קורה ההזמנה
                // לא נרשמת כטופלה ותיבדק שוב בסבב הבא, כדי שלא תיבלע לעולם.
                if (currentScreen !== 'game') {
                    showScreen('game');
                }
                if (currentScreen === 'game') {
                    handledAcceptedInvites.add(key);
                    loadGame(invitation.gameId);
                }
            })
            .catch(() => { /* מעקב שקט */ });
    }, 4000);
}
