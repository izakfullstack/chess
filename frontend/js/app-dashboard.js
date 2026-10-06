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

let activeGameLoadId = 0;
let activeGameLoadRequest = null;
let activeGameLoadProgress = null;

function renderGameLoadingProgress() {
    const progress = activeGameLoadProgress;
    if (!progress) return;

    const loading = document.getElementById('game-loading');
    const bar = loading?.querySelector('.game-loading-bar');
    const fill = bar?.querySelector('span');
    const label = loading?.querySelector('strong');
    if (!loading || !fill || !label) return;

    const loaded = progress.game.loadedBytes + (board3dProgress.loadedBytes || 0);
    const knownTotal = Number.isFinite(progress.game.totalBytes)
        && Number.isFinite(board3dProgress.totalBytes)
        ? progress.game.totalBytes + board3dProgress.totalBytes
        : null;
    const ready = progress.game.complete && board3dProgress.complete;
    const percent = ready
        ? 100
        : knownTotal > 0
            ? Math.min(99, Math.floor((loaded / knownTotal) * 100))
            : null;

    fill.style.transform = `scaleX(${percent === null ? 0 : percent / 100})`;
    bar.classList.remove('indeterminate');
    label.textContent = percent === null ? 'טוען...' : `טוען... ${percent} %`;
    bar.setAttribute('aria-valuenow', String(percent ?? 0));
}

window.addEventListener('board3dprogress', () => {
    if (activeGameLoadProgress) renderGameLoadingProgress();
});

function showGameLoadError(error, gameLoadId) {
    if (gameLoadId !== activeGameLoadId) return;
    console.error('שגיאה בטעינת המשחק:', error);
    activeGameLoadProgress = null;
    activeGameLoadRequest = null;
    const loading = document.getElementById('game-loading');
    const label = loading?.querySelector('strong');
    loading?.classList.add('has-error');
    const closeButton = document.getElementById('game-loading-dismiss');
    if (label) label.textContent = 'טעינת המשחק נכשלה. בדוק את החיבור ונסה שוב.';
    closeButton?.classList.remove('hidden');
}

function loadGame(gameId, historical = false, silent = false) {
    historicalGameView = historical;
    const gameLoadId = silent ? activeGameLoadId : ++activeGameLoadId;
    if (!silent) {
        activeGameLoadRequest?.abort();
        activeGameLoadProgress = {
            game: { loadedBytes: 0, totalBytes: null, complete: false },
        };
        const loading = document.getElementById('game-loading');
        const bar = loading?.querySelector('.game-loading-bar');
        const dismiss = document.getElementById('game-loading-dismiss');
        loading?.classList.remove('hidden', 'has-error');
        bar?.classList.remove('indeterminate');
        if (bar) bar.setAttribute('aria-valuenow', '0');
        dismiss?.classList.add('hidden');
        window.scrollTo(0, 0);
        renderGameLoadingProgress();
    }

    const xhr = new XMLHttpRequest();
    if (!silent) activeGameLoadRequest = xhr;
    xhr.open('GET', `/api/games/${gameId}`);
    xhr.onprogress = event => {
        if (silent || gameLoadId !== activeGameLoadId) return;
        activeGameLoadProgress.game.loadedBytes = event.loaded;
        activeGameLoadProgress.game.totalBytes = event.lengthComputable ? event.total : null;
        renderGameLoadingProgress();
    };

    xhr.onload = async () => {
        if (!silent && gameLoadId !== activeGameLoadId) return;
        try {
            if (xhr.status < 200 || xhr.status >= 300) throw new Error(`HTTP ${xhr.status}`);
            const game = typeof xhr.response === 'string' ? JSON.parse(xhr.response) : xhr.response;
            if (!game) throw new Error('תשובת משחק ריקה');

            if (!silent) {
                if (Number.isFinite(activeGameLoadProgress.game.totalBytes)) {
                    activeGameLoadProgress.game.loadedBytes = activeGameLoadProgress.game.totalBytes;
                }
                const boardReady = await board3dReadyPromise;
                if (gameLoadId !== activeGameLoadId) return;
                if (!boardReady) throw new Error('הלוח או מודלי הכלים לא נטענו.');
                activeGameLoadProgress.game.complete = true;
                renderGameLoadingProgress();
            }

            currentGame = game;
            setUserState('last_game_id', game.id);
            setUserState('last_game_historical', historical ? '1' : '0');

            if (!silent && currentScreen !== 'game') showScreen('game');
            else if (!silent) resetBoardView();
            document.getElementById('game-title').textContent =
                `משחק ${game.id}: שחקן ${game.player1Account} מול שחקן ${game.player2Account}`;

            const gameControls = document.querySelector('.game-controls');
            if (gameControls) gameControls.style.display = historical ? 'flex' : 'none';
            currentMoveIndex = game.moveHistory.length;
            renderChessBoard(game.board, game.currentTurn);
            updateMoveHistory(game.moveHistory);
            document.getElementById('game-move-number').textContent = `מהלך ${currentMoveIndex}`;

            const gameStatus = document.getElementById('game-status');
            gameStatus.textContent = `סטטוס: ${getStatusText(game.status)}`;
            gameStatus.className = `game-status status-${game.status}`;
            gameStatus.style.display = !historical && game.status === 'active' ? 'inline-block' : 'none';

            if (game.status === 'active' && !historical) startGamePolling(game.id);
            else stopGamePolling();

            if (!silent) {
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                if (gameLoadId !== activeGameLoadId) return;
                setTimeout(() => {
                    if (gameLoadId !== activeGameLoadId) return;
                    document.getElementById('game-loading')?.classList.add('hidden');
                    activeGameLoadProgress = null;
                    activeGameLoadRequest = null;
                }, 320);
            }
        } catch (error) {
            if (!silent) showGameLoadError(error, gameLoadId);
            else console.error('שגיאה ברענון המשחק:', error);
        }
    };

    xhr.onerror = () => {
        if (silent) return;
        showGameLoadError(new Error('שגיאת רשת בטעינת המשחק'), gameLoadId);
    };

    xhr.send();
}

document.getElementById('game-loading-dismiss')?.addEventListener('click', () => {
    activeGameLoadRequest?.abort();
    activeGameLoadRequest = null;
    activeGameLoadProgress = null;
    document.getElementById('game-loading')?.classList.add('hidden');
});
