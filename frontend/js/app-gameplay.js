/**
 * Chess move selection, history navigation, and game actions.
 */

function handleSquareClick(row, col) {
    if (!currentGame || currentGame.status !== 'active' || historicalGameView) return;

    const board = game.fenToBoard(currentGame.board);
    const pieceOnSquare = board[row]?.[col] || null;

    if (selectedSquare) {
        if (!isCurrentPlayerTurn()) {
            selectedSquare = null;
            renderChessBoard(currentGame.board, currentGame.currentTurn);
            return;
        }
        const selectedPiece = board[selectedSquare.row]?.[selectedSquare.col];
        const legalMove = findLegalMove(selectedSquare, { row, col });

        // משתמש ברשימת השרת כמקור הראשי. אם היא זמינה אך ריקה
        // (למשל בזמן polling), בדיקת הלקוח מאפשרת לנסות את המהלך; השרת
        // עדיין מאמת ודוחה כל מהלך לא חוקי לפני השמירה.
        const clientMoveIsLegal = Boolean(selectedPiece && pieceOnSquare?.color !== selectedPiece.color && game.isValidMove(
            board,
            { row: selectedSquare.row, col: selectedSquare.col },
            { row, col },
            selectedPiece
        ));

        if ((legalMove || clientMoveIsLegal)
            && selectedPiece?.color === currentGame.currentTurn) {
            const move = legalMove || {
                from: selectedSquare,
                to: { row, col },
                promotion: selectedPiece.type === 'pawn' && (row === 0 || row === 7) ? 'queen' : null
            };
            selectedSquare = null;
            submitMoveToServer(notationFromSquare(move.from), notationFromSquare(move.to), move.promotion);
            return;
        }
    }

    const canSelect = Boolean(
        pieceOnSquare &&
        pieceOnSquare.color === currentGame.currentTurn
    );

    selectedSquare = canSelect ? { row, col } : null;
    renderChessBoard(currentGame.board, currentGame.currentTurn);
}

function notationFromSquare(square) {
    return game.squareToNotation(square.row, square.col);
}

/**
 * הגרירה אינה חלק מהמשחק; כל התנועה מתבצעת בלחיצה על הכלי ועל משבצת היעד.
 */

/**
 * עדכון תצוגת היסטוריית מהלכים
 */
function updateMoveHistory(moveHistory) {
    const moveHistoryElement = document.getElementById('move-history');
    if (!moveHistoryElement) return;

    // הרשימה נחשפת רק כשיש מהלכים להציג, כדי לא להשאיר ריק מיותר
    moveHistoryElement.hidden = !moveHistory.length;
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

