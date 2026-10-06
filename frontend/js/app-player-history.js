/**
 * Player previews, public history views, and rating presentation.
 */

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
