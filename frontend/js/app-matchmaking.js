/**
 * Player matching, invitations, and account settings.
 */

function startInvitationPolling() {
    if (invitationPollingTimer) return;
    invitationPollingTimer = setInterval(() => {
        if (!auth.currentUser) return;
        // אם השחקן כבר במשחק פעיל, לא נפתחים לו חלונות הזמנה מתנגשים.
        const inActiveGame = currentScreen === 'game'
            && currentGame && currentGame.status === 'active' && !historicalGameView;
        if (inActiveGame) return;
        loadIncomingInvitations(true);
    }, 5000);
}

function loadMatchmakingPlayers() {
    if (!auth.currentUser) return;
    fetch('/api/games/matchmaking/players')
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
        body: JSON.stringify({ isAvailable })
    }).then(response => response.json()).then(data => {
        const availabilityLabel = document.getElementById('availability-label');
        if (availabilityLabel) availabilityLabel.textContent = data.isAvailable ? 'זמין' : 'לא זמין';
        loadMatchmakingPlayers();
    }).catch(() => { if (updateControl && control) control.checked = !isAvailable; });
}

window.sendGameInvitation = function(receiverAccount) {
    fetch('/api/games/matchmaking/invitations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverAccount })
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
    fetch('/api/games/matchmaking/invitations')
        .then(response => response.json()).then(invitations => {
            if (!Array.isArray(invitations)) return;

            // הרשימה מתעדכנת רק אם היא קיימת ב-DOM, אבל זיהוי ההזמנה החדשה
            // חייב להתרחש בכל מקרה - גם כשהשחקן אינו במסך "שחקנים".
            const list = document.getElementById('incoming-invitations');
            if (list) {
                list.innerHTML = invitations.length ? invitations.map(invitation => `
                    <button class="invitation-card" type="button" onclick="openInvitationDialog(${invitation.id}, '${invitation.senderAccount}')">
                        קיבלת הזמנה למשחק מחשבון ${invitation.senderAccount}
                    </button>
                `).join('') : '';
            }

            const newInvitation = invitations.find(invitation => !knownInvitationIds.has(invitation.id));
            if (openNewDialog && newInvitation) {
                openInvitationDialog(newInvitation.id, newInvitation.senderAccount);
            }
            knownInvitationIds = new Set(invitations.map(invitation => invitation.id));
        })
        .catch(() => { /* מעקב שקט */ });
}

window.openInvitationDialog = function(invitationId, senderAccount) {
    window.activeInvitationId = invitationId;
    document.getElementById('invitation-dialog-message').textContent = `קיבלת הזמנה למשחק מהשחקן ${senderAccount}`;
    document.getElementById('invitation-dialog').classList.remove('hidden');
};

function respondToInvitation(accepted) {
    if (!window.activeInvitationId || !auth.currentUser) return;
    const loading = document.getElementById('game-loading');
    if (accepted && loading) {
        loading.classList.remove('hidden');
        loading.querySelector('.game-loading-bar')?.classList.add('indeterminate');
        loading.querySelector('strong').textContent = 'מאשר הזמנה…';
    }
    fetch(`/api/games/matchmaking/invitations/${window.activeInvitationId}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted })
    }).then(response => response.json()).then(data => {
        document.getElementById('invitation-dialog').classList.add('hidden');
        window.activeInvitationId = null;
        loadIncomingInvitations();
        if (data.gameId) {
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
    fetch('/api/users/settings')
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
        body: JSON.stringify({ showFullName })
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
