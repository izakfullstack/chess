/**
 * Dashboard data, game loading, and user game lists.
 */

/**
 * Dashboard, chessboard rendering, move history, and game actions.
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

function loadGame(gameId, historical = false, silent = false) {
    historicalGameView = historical;
    if (!silent) {
        resetBoardView();
        // שחזור משחק לא ישאיר את הדפדפן במיקום גלילה ישן מהמסך שממנו המשתמש יצא.
        window.scrollTo(0, 0);
    }
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

    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/api/games/${gameId}`);

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

            // עדכון ניווט מהלכים - לפני ציור הלוח, כך שסימון "מהלך אחרון"
            // בתצוגה התלת-ממדית יתבסס על האינדקס הנכון.
            currentMoveIndex = game.moveHistory.length;

            // ציור לוח שחמט
            renderChessBoard(game.board, game.currentTurn);

            // עדכון היסטוריית מהלכים
            updateMoveHistory(game.moveHistory);

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

