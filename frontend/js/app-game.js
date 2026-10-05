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

/**
 * ציור לוח שחמט
 */
function resetBoardView() {
    // בתצוגה התạ-ממדית "מרכוז לוח" מחזיר את המצלמה לנקודת ההתחלה.
    if (board3d) {
        board3d.resetView();
        return;
    }
    const stage = document.getElementById('chess-board-stage');
    const board = document.getElementById('game-board');
    if (!stage) return;

    stage.style.setProperty('--board-pan-x', '0px');
    stage.style.top = BOARD_DEFAULT_STAGE_TOP;
    stage.style.setProperty('--board-pan-y', BOARD_DEFAULT_PAN_Y);
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
        if (event?.pointerId != null && stage.hasPointerCapture?.(event.pointerId)) {
            stage.releasePointerCapture(event.pointerId);
        }
    };

    stage.addEventListener('contextmenu', event => event.preventDefault());

    /**
     * בודק אם הנקודה שנלחצה נמצאת על הלוח המוצג בפועל.
     * כשהלוח מוטה, שולי התיבה המרובעת חופשיים מהלוח עצמו,
     * ולכן אין להתחיל גרירה או סיבוב מעבר לו.
     * הבדיקה מסתמכת על מה שהדפדפן באמת צייר בנקודה הזו.
     */
    const isOnBoard = event => {
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        if (!hit) return false;
        return board.contains(hit) || hit === board;
    };

    stage.addEventListener('pointerdown', event => {
        if (event.button !== 0 && event.button !== 2) return;
        // הלחיצה לא נפלה על הלוח המוצג. מבטלים את ברירת המחדל של הדפדפן
        // כדי שלא יופיע סימון גרירה או תפריט לחיצה ימנית על ריק.
        if (!isOnBoard(event)) {
            event.preventDefault();
            return;
        }
        // הסיבוב מתחיל בלחיצה שמאלית וההזזה בלחיצה ימנית, בכל נקודה על הלוח.
        // לחיצה פשוטה ללא תנועה עדיין מגיעה לבחירת הכלי דרך ה-click.
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
        // הכברת ברירת המחדל גם כאן, כדי שאין סימון גרירת תמונה גם בתוך הלוח.
        event.preventDefault();
    });

    // הלחיצה הימנית מועברת לעכבר הימני במקום לפתוח תפריט מערכת.
    stage.addEventListener('mousedown', event => {
        if (event.button === 2) event.preventDefault();
    });

    // מאזינים גלוביים מאפשרים להמשיך לגרור גם אם העכבר יצא מגבולות הלוח.
    window.addEventListener('pointermove', event => {
        if (event.pointerId !== pointerId) return;
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        if (!pointerCaptured && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
            event.preventDefault();
            try {
                stage.setPointerCapture(pointerId);
            } catch (error) {
                // Pointer Capture אינו תמיד זמין, למשל בדפדפן נייד; המאזינים הגלוביים ממשיכים לעבוד.
                console.debug('Pointer capture unavailable; using window listeners.', error);
            }
            pointerCaptured = true;
        }
        if (!pointerCaptured) return;
        event.preventDefault();

        if (mode === 'pan') {
            stage.style.setProperty('--board-pan-x', `${startPanX + deltaX}px`);
            stage.style.setProperty('--board-pan-y', `${startPanY + deltaY}px`);
            return;
        }

        const nextRotation = startRotate - deltaX * 0.22;
        board.style.setProperty('--board-rotate', `${nextRotation}deg`);
        const nextTilt = Math.max(0, Math.min(BOARD_MAX_TILT, startTilt - deltaY * 0.25));
        board.style.setProperty('--board-tilt-x', `${nextTilt}deg`);
    }, { passive: false });

    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
}
/**
 * כיוון הלוח.
 * כמו בכל אפליקציית שחמט, כל שחקן רואה את הכלים שלו בתחתית הלוח:
 * הלבן רואה לבן למטה, והשחור רואה שחור למטה (הלוח מהפוך עבורו).
 */
function shouldFlipBoard() {
    if (!currentGame || !auth.currentUser) return false;
    const account = String(auth.currentUser.accountNumber);
    if (account === String(currentGame.player1Account)) {
        return currentGame.player1Color === 'black';
    }
    if (account === String(currentGame.player2Account)) {
        return currentGame.player2Color === 'black';
    }
    return false;
}

function getCurrentPlayerColor() {
    if (!currentGame || !auth.currentUser) return 'white';
    if (String(auth.currentUser.accountNumber) === String(currentGame.player1Account)) {
        return currentGame.player1Color || 'white';
    }
    if (String(auth.currentUser.accountNumber) === String(currentGame.player2Account)) {
        return currentGame.player2Color || 'black';
    }
    return 'white';
}

function getCapturedPiecesByPlayer() {
    const captured = { white: [], black: [] };
    const history = currentGame?.moveHistory || [];
    if (!history.length) return captured;

    let board = game.initializeBoard();
    history.forEach(move => {
        // כאן נמצא המצב המדויק שקדם למהלך הנוכחי.
        // כך גם מהלכים מיוחדים כמו טיול או החלפת רגליים לא משבשים את זיהוי האכילות.
        const from = game.notationToSquare(move.from);
        const to = game.notationToSquare(move.to);
        const movingPiece = board[from.row]?.[from.col];
        const targetPiece = board[to.row]?.[to.col];
        let capturedPiece = targetPiece && targetPiece.color !== move.color ? targetPiece : null;

        // אכילת רגל בדרך־עקיפה: הרגל נאכל מהריבוע לצד היעד ולא מריבוע היעד עצמו.
        if (!capturedPiece && move.piece === 'pawn' && from.col !== to.col) {
            const enPassantPiece = board[from.row]?.[to.col];
            if (enPassantPiece && enPassantPiece.type === 'pawn' && enPassantPiece.color !== move.color) {
                capturedPiece = enPassantPiece;
            }
        }

        if (capturedPiece && move.color === 'white') captured.white.push(capturedPiece);
        if (capturedPiece && move.color === 'black') captured.black.push(capturedPiece);

        if (capturedPiece && move.piece === 'pawn' && !targetPiece) {
            board[from.row][to.col] = null;
        }
        if (movingPiece) {
            board[from.row][from.col] = null;
            board[to.row][to.col] = { ...movingPiece, type: move.promotion || movingPiece.type };
        }
        if (move.fen) board = game.fenToBoard(move.fen);
    });

    return captured;
}

function renderCapturedPieces() {
    const captured = getCapturedPiecesByPlayer();
    const viewerColor = getCurrentPlayerColor();
    const scale = document.getElementById('material-scale');
    if (!scale) return;

    const opponentColor = viewerColor === 'white' ? 'black' : 'white';

    // ערך הכלי - המלך הכי חשוב למעלה, החייל הכי נמוך למטה
    const PIECE_WEIGHT = { king: 6, queen: 5, rook: 4, bishop: 3, knight: 3, pawn: 1 };
    const PIECE_ORDER = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

    // קיבוץ הכלים שנאכלו לפי סוג וצבע, כדי להציג קבוצה שלמה בשורה אחת
    const groupByType = color => {
        const groups = {};
        captured[color].forEach(piece => {
            (groups[piece.type] = groups[piece.type] || []).push(piece.color);
        });
        return groups;
    };
    const enemyGroups = groupByType(opponentColor);
    const viewerGroups = groupByType(viewerColor);

    scale.innerHTML = '';

    PIECE_ORDER.forEach(type => {
        const enemyPieces = enemyGroups[type] || [];
        const viewerPieces = viewerGroups[type] || [];
        if (!enemyPieces.length && !viewerPieces.length) return;

        const row = document.createElement('div');
        row.className = 'material-row';
        row.dataset.weight = String(PIECE_WEIGHT[type]);
        row.setAttribute('aria-label', `${getPieceTypeName(type)}: ${enemyPieces.length} אצל היריב, ${viewerPieces.length} אצל השחקן`);

        // כל כלי שנאכל מוצג בפועל. צד שאין לו כלים פשוט לא מוצג - הפער בעצמו מראה את החוסרון.
        const appendGroup = (pieces, color) => {
            pieces.forEach(() => {
                const slot = document.createElement('span');
                slot.className = `material-slot ${color}`;
                slot.innerHTML = getPieceSvg(type, color);
                row.appendChild(slot);
            });
        };

        // כלי היריב משמאל, כלי השחקן מימין - ושניהם צמודים כמו במשוואה
        appendGroup(enemyPieces, opponentColor);
        appendGroup(viewerPieces, viewerColor);

        scale.appendChild(row);
    });

    const boardWithCaptures = document.getElementById('board-with-captures');
    if (boardWithCaptures) {
        boardWithCaptures.classList.toggle('viewer-white', viewerColor === 'white');
        boardWithCaptures.classList.toggle('viewer-black', viewerColor === 'black');
    }
}

function renderChessBoard(fen, currentTurn) {
    const boardElement = document.getElementById('game-board');
    if (!boardElement) return;

    const board = game.fenToBoard(fen);

    // הלוח התלת-ממדי: אם המודול זמין, הוא מצייר; אחרת ממשיכים
    // במסירת ה-SVG הוותיקה שמתחת - ללא שינוי בהתנהגות המשחק.
    if (board3d) {
        board3d.sync(board);
        board3d.setFlip(shouldFlipBoard());

        // סימוני בחירה, מהלכים חוקיים ומהלך אחרון - ישירות לשכבת התלת-ממד.
        const legalMoves = currentGame?.legalMoves || [];
        const targets = selectedSquare
            ? legalMoves
                .filter(move => Number(move.from?.row) === selectedSquare.row
                    && Number(move.from?.col) === selectedSquare.col)
                .map(move => ({ row: Number(move.to.row), col: Number(move.to.col) }))
            : [];
        const history = currentGame?.moveHistory || [];
        const lastIndex = currentMoveIndex > 0 && currentMoveIndex <= history.length
            ? currentMoveIndex - 1
            : -1;
        const lastEntry = lastIndex >= 0 ? history[lastIndex] : null;
        const lastMove = lastEntry
            ? { from: game.notationToSquare(lastEntry.from), to: game.notationToSquare(lastEntry.to) }
            : null;
        board3d.setMarks({ selected: selectedSquare, legalMoves: targets, lastMove });

        renderCapturedPieces();
        return;
    }

    boardElement.innerHTML = '';

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
            const canMoveTo = selectedPiece && (
                legalMoves.some(move =>
                    move.from.row === selectedPiece.row && move.from.col === selectedPiece.col &&
                    move.to.row === row && move.to.col === col)
                || (selectedSquare && game.isValidMove(
                    board,
                    { row: selectedSquare.row, col: selectedSquare.col },
                    { row, col },
                    board[selectedSquare.row]?.[selectedSquare.col]
                ))
            );
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
                pieceElement.innerHTML = getPieceSvg(piece.type, piece.color);
                pieceElement.setAttribute('aria-label', `${piece.color === 'white' ? 'כלי לבן' : 'כלי שחור'} ${getPieceTypeName(piece.type)}`);
                pieceElement.draggable = false;
                pieceElement.style.userSelect = 'none';
                pieceElement.style.webkitUserDrag = 'none';
                pieceElement.dataset.row = row;
                pieceElement.dataset.col = col;
                pieceElement.dataset.piece = piece.type;
                pieceElement.dataset.color = piece.color;
                pieceElement.addEventListener('click', event => {
                    event.stopPropagation();
                    handleSquareClick(row, col);
                });

                // הגרירה הוסרה: תנועת הכלים מתבצעת בלחיצה על כלי ולאחר מכן על משבצת היעד.
                square.appendChild(pieceElement);
            }

            boardElement.appendChild(square);
        }
    }

    renderCapturedPieces();

    // מאזין יחיד ויציב: אין להוסיף מאזין נוסף בכל רינדור.
    boardElement.onclick = event => {
        const square = event.target.closest('.square');
        if (!square || !boardElement.contains(square)) return;
        const row = Number.parseInt(square.dataset.row, 10);
        const col = Number.parseInt(square.dataset.col, 10);
        if (Number.isInteger(row) && Number.isInteger(col)) handleSquareClick(row, col);
    };
    // נטרלת גרירת תמונה: הלוח משתמש רק בקליק ובבקרת העכבר.
    boardElement.ondragstart = event => event.preventDefault();
    boardElement.ondragover = event => event.preventDefault();
    boardElement.ondrop = event => event.preventDefault();
    boardElement.ondragend = event => event.preventDefault();
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
    return symbols[normalizePieceType(type)] || '';
}

function getPieceTypeName(type) {
    return {
        king: 'מלך',
        queen: 'מלכה',
        rook: 'רוכב',
        bishop: 'פרש',
        knight: 'סוס',
        pawn: 'חייל'
    }[normalizePieceType(type)] || 'כלי';
}

/**
 * כלים תלת־ממדיים על לוח ה־2D - מחליפים רק את תמונות הכלים;
 * שאר הממשק (לוח, הדגשות, קליקים) לא משתנה כלל.
 *
 * PIECES_3D_ENABLED = true טוען את מודלי ה־GLB ומאפיין אותם לספרייטים
 * עם רקע שקוף, המוחלפים במקום ה־SVG. אם הטעינה נכשלת - ממשיכים ב־SVG.
 */
const PIECES_3D_ENABLED = true;
let pieces3dSprites = null;

// fenToBoard מחזיר סוגים בקיצורי FEN (r/n/b/q/k) חוץ מ-pawn.
// שכבת ההצגה (SVG וספרייטים תלת-ממדיים) משתמשת בשמות המלאים.
const PIECE_TYPE_ALIASES = { r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king', p: 'pawn' };

function normalizePieceType(type) {
    return PIECE_TYPE_ALIASES[type] || type;
}

function getPieceSprite(color, type) {
    if (!pieces3dSprites || !color || !type) return null;
    return pieces3dSprites[`${color}-${type}`] || null;
}

function setupPieces3D() {
    if (!PIECES_3D_ENABLED) return;

    import('./pieces3d.js')
        .then(module => module.bakeSprites())
        .then(sprites => {
            if (!sprites || !Object.keys(sprites).length) return;
            pieces3dSprites = sprites;
            document.body.classList.add('pieces3d-active');
            // ציור מחדש כדי להחליף את ה־SVG שכבר הוצג בזמן האפייה
            if (currentGame) renderChessBoard(currentGame.board, currentGame.currentTurn);
        })
        .catch(error => {
            console.info('[app] ספרייטים תלת־ממדיים לא נטענים, ממשיכים עם הכלים הוותיקים:', error);
        });
}

/**
 * יצירת כלי שחמט: ספרייט תלת־ממד אם מוכן, אחרת SVG מלא ללא תלות בגופני Unicode.
 */
function getPieceSvg(type, color) {
    const normalizedType = normalizePieceType(type);
    const sprite = getPieceSprite(color, normalizedType);
    if (sprite) {
        return `<img class="piece-3d" src="${sprite}" alt="" aria-hidden="true" draggable="false" />`;
    }
    const sharedBase = '<path class="piece-base" d="M23 78h54l6 8H17z"/><path class="piece-stem" d="M34 66h32l4 12H30z"/>';
    const pieces = {
        king: `<path class="piece-fill" d="M46 8h8v9h9v8h-9v11h-8V25h-9v-8h9z"/><path class="piece-fill" d="M50 34c-8 0-14 7-14 15 0 6 3 10 8 13l-7 8h26l-7-8c5-3 8-7 8-13 0-8-6-15-14-15z"/>${sharedBase}`,
        queen: `<circle class="piece-fill" cx="22" cy="20" r="6"/><circle class="piece-fill" cx="35" cy="13" r="6"/><circle class="piece-fill" cx="50" cy="10" r="6"/><circle class="piece-fill" cx="65" cy="13" r="6"/><circle class="piece-fill" cx="78" cy="20" r="6"/><path class="piece-fill" d="M20 23l9 28h42l9-28-16 14-14-20-14 20z"/><path class="piece-fill" d="M31 51h38l-4 17H35z"/>${sharedBase}`,
        rook: `<path class="piece-fill" d="M19 15h13v10h12V15h12v10h12V15h13v27H19z"/><path class="piece-fill" d="M28 42h44l-5 25H33z"/>${sharedBase}`,
        bishop: `<path class="piece-fill" d="M50 9c9 0 16 7 16 16 0 8-5 14-12 17l5 8-9 9 8 10H42l8-10-9-9 5-8c-7-3-12-9-12-17 0-9 7-16 16-16z"/><path class="piece-detail" d="M38 26l24 9"/>${sharedBase}`,
        knight: `<path class="piece-fill" d="M29 70l5-24-13-12 10-8 5-13 13 8 18 4c10 3 13 12 8 20l-8 13 5 12z"/><path class="piece-detail" d="M39 31l9 7-10 5"/><circle class="piece-detail-dot" cx="66" cy="34" r="3"/>${sharedBase}`,
        pawn: `<circle class="piece-fill" cx="50" cy="25" r="15"/><path class="piece-fill" d="M40 38c0 8-8 12-8 20 0 6 4 10 9 12H59c5-2 9-6 9-12 0-8-8-12-8-20z"/>${sharedBase}`
    };
    return `<svg class="piece-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${pieces[normalizedType] || pieces.pawn}</svg>`;
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

function findLegalMove(from, to) {
    const legalMoves = currentGame?.legalMoves || [];
    return legalMoves.find(item =>
        Number(item.from?.row) === Number(from.row) &&
        Number(item.from?.col) === Number(from.col) &&
        Number(item.to?.row) === Number(to.row) &&
        Number(item.to?.col) === Number(to.col)
    ) || null;
}

/**
 * טוען את מודול הלוח התלת-ממדי ומחבר אותו למסך המשחק.
 *
 * BOARD_3D_ENABLED = true: הכלים מוצגים כמודלי GLB עומדים על לוח תלת-ממד
 * עם שליטת מצלמה (סיבוב/זום) - אפשר לראות את הכלים מכל כיוון.
 * לוח ברירת המחדל (2D + ספרייטים) ממשיך לשמש גם אם הטעינה נכשלת.
 *
 * אם הטעינה נכשלת (אין אינטרנט, אין WebGL, קבצי הכלים חסרים)
 * המשתנה board3d נשאר null והלוח הוותיק ממשיך להוצג כמו קודם.
 */
const BOARD_3D_ENABLED = true;

function setupBoard3D() {
    if (!BOARD_3D_ENABLED) return;

    const host = document.getElementById('chess-board-stage');
    if (!host) return;

    import('./board3d.js')
        .then(async module => {
            const ready = await module.init(host);
            if (!ready) return;

            board3d = module;
            module.onSquareClick((row, col) => handleSquareClick(row, col));
            document.body.classList.add('board3d-active');
            // ציור מחדש מיד עם המיקום הנוכחי, אם כבר יש משחק פתוח
            if (currentGame) renderChessBoard(currentGame.board, currentGame.currentTurn);
        })
        .catch(error => {
            console.info('[app] לוח תלת-ממדי לא נטען, ממשיכים עם הלוח הדו-ממדי:', error);
        });
}

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

