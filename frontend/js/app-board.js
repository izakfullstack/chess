/**
 * Chessboard rendering, visual controls, and 3D board initialization.
 */

let board3dReadyPromise = Promise.resolve(false);
let board3dProgress = { loadedBytes: 0, totalBytes: null, complete: false };

/**
 * ציור לוח שחמט
 */
function resetBoardView() {
    const stage = document.getElementById('chess-board-stage');
    if (!stage) return;

    const floating = Boolean(board3d?.isAvailable());
    stage.classList.toggle('board-floating', floating);
    stage.style.setProperty('--board-pan-x', floating ? '8px' : '0px');
    stage.style.setProperty('--board-pan-y', '0px');
    if (board3d?.isAvailable()) {
        board3d.resize();
        board3d.resetView();
    }
}

function setupBoardControls() {
    const stage = document.getElementById('chess-board-stage');
    if (!stage || boardControlsBound) return;
    boardControlsBound = true;

    let mode = null;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let horizontalRotationDirection = 1;
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
        return Boolean(board3d?.isAvailable()
            && board3d.isBoardPoint(event.clientX, event.clientY));
    };

    stage.addEventListener('pointerdown', event => {
        if (event.button !== 0 && event.button !== 2) return;
        if (!board3d?.isAvailable()) {
            event.preventDefault();
            return;
        }
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
        lastX = startX;
        lastY = startY;
        startPanX = numberOn(stage, '--board-pan-x');
        startPanY = numberOn(stage, '--board-pan-y');
        if (mode === 'rotate') {
            horizontalRotationDirection = board3d.horizontalRotationDirection(startY);
        }
        // מבטל את ברירת המחדל כדי שלא תיגרר תמונה ולא ייפתח תפריט העכבר.
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
            stage.classList.add('board-floating');
            stage.style.setProperty('--board-pan-x', `${startPanX + deltaX}px`);
            stage.style.setProperty('--board-pan-y', `${startPanY + deltaY}px`);
            return;
        }

        board3d.rotateBy(
            (event.clientX - lastX) * horizontalRotationDirection,
            lastY - event.clientY
        );
        lastX = event.clientX;
        lastY = event.clientY;
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
    const scale = document.getElementById('material-scale');
    if (!scale) return;

    // ערך הכלי - המלך הכי חשוב למעלה, החייל הכי נמוך למטה
    const PIECE_WEIGHT = { king: 6, queen: 5, rook: 4, bishop: 3, knight: 3, pawn: 1 };
    const PIECE_ORDER = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

    // קיבוץ הכלים שנאכלו לפי סוג וצבע, כדי להציג קבוצה שלמה בשורה אחת
    const allCapturedPieces = [...captured.white, ...captured.black];
    const groupByType = color => {
        const groups = {};
        allCapturedPieces
            .filter(piece => piece.color === color)
            .forEach(piece => {
            const type = normalizePieceType(piece.type);
            (groups[type] = groups[type] || []).push(piece.color);
        });
        return groups;
    };
    const whiteGroups = groupByType('white');
    const blackGroups = groupByType('black');

    scale.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'material-scale-header';
    header.innerHTML = '<span class="move-color white" role="img" aria-label="כלים לבנים"></span><span class="move-color black" role="img" aria-label="כלים שחורים"></span>';
    scale.appendChild(header);

    PIECE_ORDER.forEach(type => {
        const whitePieces = whiteGroups[type] || [];
        const blackPieces = blackGroups[type] || [];

        const row = document.createElement('div');
        row.className = 'material-row';
        row.dataset.weight = String(PIECE_WEIGHT[type]);
        row.setAttribute('aria-label', `${getPieceTypeName(type)} שנאכלו: ${whitePieces.length} לבנים, ${blackPieces.length} שחורים`);

        const appendGroup = (pieces, color) => {
            const side = document.createElement('div');
            side.className = `material-side ${color}`;
            pieces.forEach(() => {
                const slot = document.createElement('span');
                slot.className = `material-slot ${color}`;
                const thumbnail = board3d?.getPieceThumbnail(color, type);
                if (!thumbnail) throw new Error(`חסרה תמונת תלת־ממד לכלי ${color}-${type}.`);
                const image = document.createElement('img');
                image.className = 'material-piece-3d';
                image.src = thumbnail;
                image.alt = '';
                image.setAttribute('aria-hidden', 'true');
                slot.appendChild(image);
                side.appendChild(slot);
            });
            row.appendChild(side);
        };

        appendGroup(whitePieces, 'white');
        appendGroup(blackPieces, 'black');

        scale.appendChild(row);
    });

    const boardWithCaptures = document.getElementById('board-with-captures');
    if (boardWithCaptures) {
        const viewerColor = getCurrentPlayerColor();
        boardWithCaptures.classList.toggle('viewer-white', viewerColor === 'white');
        boardWithCaptures.classList.toggle('viewer-black', viewerColor === 'black');
    }
}

let checkNoticeTimer = null;
let announcedCheckSquare = null;
let announcedCheckGameId = null;

function renderChessBoard(fen, currentTurn) {
    const board = game.fenToBoard(fen);
    if (!board3d?.isAvailable()) return;

    const gameId = currentGame?.id ?? null;
    if (gameId !== announcedCheckGameId) {
        announcedCheckGameId = gameId;
        announcedCheckSquare = null;
        clearTimeout(checkNoticeTimer);
        const message = document.getElementById('game-message');
        if (message?.classList.contains('check-notice')) {
            message.textContent = '';
            message.className = 'form-message';
        }
    }

    board3d.sync(board);
    board3d.setFlip(shouldFlipBoard());

    const checkSquare = game.isKingInCheck(board, currentTurn)
        ? board.reduce((found, row, rowIndex) => found || row.reduce((king, piece, colIndex) =>
            king || (piece?.type === 'king' && piece.color === currentTurn
                ? { row: rowIndex, col: colIndex }
                : null), null), null)
        : null;
    const checkKey = checkSquare ? `${checkSquare.row},${checkSquare.col}` : null;
    if (checkKey && checkKey !== announcedCheckSquare) {
        showCheckNotice();
    }
    announcedCheckSquare = checkKey;

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
    board3d.setMarks({ selected: selectedSquare, legalMoves: targets, lastMove, checkSquare });
    renderCapturedPieces();
}

function showCheckNotice() {
    const message = document.getElementById('game-message');
    if (!message) return;

    message.textContent = 'שח';
    message.className = 'form-message check-notice';
    clearTimeout(checkNoticeTimer);
    checkNoticeTimer = setTimeout(() => {
        if (message.classList.contains('check-notice')) {
            message.textContent = '';
            message.className = 'form-message';
        }
    }, 2000);
}

function getPieceTypeName(type) {
    return {
        king: 'מלך',
        queen: 'מלכה',
        rook: 'צריח',
        bishop: 'רץ',
        knight: 'סוס',
        pawn: 'חייל'
    }[normalizePieceType(type)] || 'כלי';
}

// fenToBoard מחזיר סוגים בקיצורי FEN (r/n/b/q/k) חוץ מ-pawn.
const PIECE_TYPE_ALIASES = { r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king', p: 'pawn' };

function normalizePieceType(type) {
    return PIECE_TYPE_ALIASES[type] || type;
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

/** טוען את הלוח והמודלים לפני שמסך המשחק מוצג. */
function setupBoard3D() {
    const host = document.getElementById('chess-board-stage');
    if (!host) return;
    host.classList.add('board3d-loading');

    board3dReadyPromise = import('./board3d.js?v=20261006-inward-knights-wood-frame')
        .then(async module => {
            const ready = await module.init(host, progress => {
                board3dProgress = { ...progress, complete: false };
                window.dispatchEvent(new CustomEvent('board3dprogress', { detail: board3dProgress }));
            });
            if (!ready) throw new Error('מודול הלוח התלת־ממדי לא הצליח לאתחל.');

            board3d = module;
            host.classList.add('board-floating');
            host.classList.add('board3d-ready');
            host.classList.remove('board3d-loading');
            host.style.setProperty('--board-pan-x', '8px');
            host.style.setProperty('--board-pan-y', '0px');
            module.resize();
            module.onSquareClick((row, col) => handleSquareClick(row, col));
            board3dProgress = { ...board3dProgress, complete: true };
            window.dispatchEvent(new CustomEvent('board3dprogress', { detail: board3dProgress }));
            // ציור מחדש מיד עם המיקום הנוכחי, אם כבר יש משחק פתוח
            if (currentGame) renderChessBoard(currentGame.board, currentGame.currentTurn);
            return true;
        })
        .catch(error => {
            window.dispatchEvent(new CustomEvent('board3dprogress', { detail: board3dProgress }));
            console.error('[app] לוח התלת־ממד לא נטען:', error);
            const message = document.getElementById('game-message');
            if (message) {
                message.textContent = 'הלוח התלת־ממדי לא נטען. רענן את הדף או נסה בדפדפן התומך ב־WebGL.';
                message.classList.add('error');
            }
            return false;
        });
}
