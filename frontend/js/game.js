/**
 * מודול משחק - מטפל ברינדור לוח שחמט ואינטראקציות משתמש
 * 
 * מושג בינה מלאכותית #3: ייצוג מצב
 * 
 * בשחמט, הלוח חייב להיות מיוצג בצורה שהמחשב יכול להבין.
 * ייצוגים נפוצים כוללים:
 * - מערך 8x8 (כמו שנשתמש)
 * - מחרוזת FEN (סטנדרט שחמט)
 * - ביט-בורד (ייצוג יעיל ברמת ביט)
 * 
 * היישום שלנו משתמש במערך 8x8 פנימי, שהוא קל יותר להבנה
 * ומתאים היטב ללמידה.
 */

const BOARD_SIZE = 8;
const WHITE = 'white';
const BLACK = 'black';

/**
 * יצירת לוח שחמט ריק
 * מחזירה מערך 8x8 שבו כל תא הוא null או אובייקט של כלי
 */
function createEmptyBoard() {
    const board = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
        board.push(new Array(BOARD_SIZE).fill(null));
    }

    return board;
}

/**
 * איתחול לוח שחמט סטנדרטי
 * כלים לבניםית, כלים שחורים בראש
 */
function initializeBoard() {
    const board = createEmptyBoard();

    // מיקום כלים שחורים בראש
    board[0][0] = { type: 'rook', color: BLACK };
    board[0][1] = { type: 'knight', color: BLACK };
    board[0][2] = { type: 'bishop', color: BLACK };
    board[0][3] = { type: 'queen', color: BLACK };
    board[0][4] = { type: 'king', color: BLACK };
    board[0][5] = { type: 'bishop', color: BLACK };
    board[0][6] = { type: 'knight', color: BLACK };
    board[0][7] = { type: 'rook', color: BLACK };

    for (let col = 0; col < BOARD_SIZE; col++) {
        board[1][col] = { type: 'pawn', color: BLACK };
        board[6][col] = { type: 'pawn', color: WHITE };
    }

    // מיקום כלים לבניםית
    board[7][0] = { type: 'rook', color: WHITE };
    board[7][1] = { type: 'knight', color: WHITE };
    board[7][2] = { type: 'bishop', color: WHITE };
    board[7][3] = { type: 'queen', color: WHITE };
    board[7][4] = { type: 'king', color: WHITE };
    board[7][5] = { type: 'bishop', color: WHITE };
    board[7][6] = { type: 'knight', color: WHITE };
    board[7][7] = { type: 'rook', color: WHITE };

    return board;
}

/**
 * המרת מערך לוח למחרוזת FEN
 * FEN היא הסטנדרט לתיאור עמדות שחמט
 */
function boardToFen(board) {
    let fen = '';

    for (let row = 0; row < BOARD_SIZE; row++) {
        let emptyCount = 0;

        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = board[row][col];

            if (piece) {
                if (emptyCount > 0) {
                    fen += emptyCount;
                    emptyCount = 0;
                }

                fen += piece.type === 'king' ? (piece.color === WHITE ? 'K' : 'k') :
                       piece.type === 'queen' ? (piece.color === WHITE ? 'Q' : 'q') :
                       piece.type === 'rook' ? (piece.color === WHITE ? 'R' : 'r') :
                       piece.type === 'bishop' ? (piece.color === WHITE ? 'B' : 'b') :
                       piece.type === 'knight' ? (piece.color === WHITE ? 'N' : 'n') :
                       piece.color === WHITE ? 'P' : 'p';
            } else {
                emptyCount++;
            }
        }

        if (emptyCount > 0) {
            fen += emptyCount;
        }

        if (row < BOARD_SIZE - 1) {
            fen += '/';
        }
    }

    return fen;
}

/**
 * המרת מחרוזת FEN למערך לוח
 */
function fenToBoard(fen) {
    const board = createEmptyBoard();
    const rows = fen.split('/');

    for (let row = 0; row < BOARD_SIZE; row++) {
        let col = 0;

        for (const char of rows[row]) {
            if (/\d/.test(char)) {
                col += parseInt(char, 10);
            } else {
                const isWhite = char === char.toUpperCase();
                const pieceType = char.toLowerCase() === 'p' ? 'pawn' : char.toLowerCase();
                board[row][col] = { type: pieceType, color: isWhite ? WHITE : BLACK };
                col++;
            }
        }
    }

    return board;
}

/**
 * המרת קואורדינטות לוח לניסוח שחמט
 * דוגמה: שורה 6, עמודה 4 -> 'e4'
 */
function squareToNotation(row, col) {
    return String.fromCharCode(97 + col) + (8 - row);
}

/**
 * המרת ניסוח שחמט לקואורדינטות לוח
 * דוגמה: 'e4' -> שורה 6, עמודה 4
 */
function notationToSquare(notation) {
    const col = notation.charCodeAt(0) - 97;
    const row = 8 - parseInt(notation[1], 10);

    return { row, col };
}

/**
 * בדיקה אם מהלך תקף עבור כלי ספציפי
 * זהו הליבה של אימות חוקי שחמט
 */
function isValidMove(board, from, to, piece) {
    const { row: fromRow, col: fromCol } = from;
    const { row: toRow, col: toCol } = to;

    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;
    const absRowDiff = Math.abs(rowDiff);
    const absColDiff = Math.abs(colDiff);
    const target = board[toRow][toCol];

    // לא יכול לנוע לריבוע תפוס על ידי כלי משלנו
    if (target && target.color === piece.color) {
        return false;
    }

    switch (piece.type) {
        case 'pawn':
            return isValidPawnMove(board, from, to, piece);
        case 'rook':
            return isValidStraightMove(board, from, to);
        case 'knight':
            return (absRowDiff === 2 && absColDiff === 1) || (absRowDiff === 1 && absColDiff === 2);
        case 'bishop':
            return isValidDiagonalMove(board, from, to);
        case 'queen':
            return isValidStraightMove(board, from, to) || isValidDiagonalMove(board, from, to);
        case 'king':
            return absRowDiff <= 1 && absColDiff <= 1;
        default:
            return false;
    }
}

/**
 * בדיקה אם מהלך תקף עבור כלי
 */
function isValidPawnMove(board, from, to, piece) {
    const { row: fromRow, col: fromCol } = from;
    const { row: toRow, col: toCol } = to;

    const direction = piece.color === WHITE ? -1 : 1;
    const startRow = piece.color === WHITE ? 6 : 1;
    const target = board[toRow][toCol];

    // תנועה קדימה ריבוע אחד
    if (fromCol === toCol && toRow === fromRow + direction && !target) {
        return true;
    }

    // תנועה קדימה שני ריבועים מעמדת ההתחלה
    if (
        fromCol === toCol &&
        fromRow === startRow &&
        toRow === fromRow + 2 * direction &&
        !board[fromRow + direction][fromCol] &&
        !target
    ) {
        return true;
    }

    // לכידה אלכסונית
    if (
        Math.abs(fromCol - toCol) === 1 &&
        toRow === fromRow + direction &&
        target &&
        target.color !== piece.color
    ) {
        return true;
    }

    return false;
}

/**
 * בדיקה אם תנועה ישרה תקפה (רץ, מלכה)
 */
function isValidStraightMove(board, from, to) {
    const { row: fromRow, col: fromCol } = from;
    const { row: toRow, col: toCol } = to;
    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;

    if (rowDiff !== 0 && colDiff !== 0) {
        return false;
    }

    // בדיקה אם הנתיב פנוי
    const rowStep = rowDiff === 0 ? 0 : Math.sign(rowDiff);
    const colStep = colDiff === 0 ? 0 : Math.sign(colDiff);

    let row = fromRow + rowStep;
    let col = fromCol + colStep;

    while (row !== toRow || col !== toCol) {
        if (board[row][col]) {
            return false;
        }
        row += rowStep;
        col += colStep;
    }

    return true;
}

/**
 * בדיקה אם תנועה אלכסונית תקפה (בישופ, מלכה)
 */
function isValidDiagonalMove(board, from, to) {
    const { row: fromRow, col: fromCol } = from;
    const { row: toRow, col: toCol } = to;
    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;

    if (Math.abs(rowDiff) !== Math.abs(colDiff) || rowDiff === 0) {
        return false;
    }

    // בדיקה אם הנתיב פנוי
    const rowStep = Math.sign(rowDiff);
    const colStep = Math.sign(colDiff);

    let row = fromRow + rowStep;
    let col = fromCol + colStep;

    while (row !== toRow || col !== toCol) {
        if (board[row][col]) {
            return false;
        }
        row += rowStep;
        col += colStep;
    }

    return true;
}

/**
 * ביצוע מהלך על הלוח
 * מחזיר את הלוח המעודכן
 */
function makeMove(board, from, to) {
    const newBoard = board.map(row => row.map(piece => piece ? { ...piece } : null));
    const piece = newBoard[from.row][from.col];

    newBoard[from.row][from.col] = null;
    newBoard[to.row][to.col] = piece;

    return newBoard;
}

/**
 * בדיקה אם מלך נמצא במצור
 */
function isKingInCheck(board, kingColor) {
    // מציאת מיקום המלך
    let kingPosition = null;

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = board[row][col];
            if (piece && piece.type === 'king' && piece.color === kingColor) {
                kingPosition = { row, col };
                break;
            }
        }

        if (kingPosition) break;
    }

    if (!kingPosition) return false;

    // בדיקה אם כלי יריב יכול לתקוף את המלך
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = board[row][col];
            if (!piece || piece.color === kingColor) continue;

            if (isValidMove(board, { row, col }, kingPosition, piece)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * בדיקה אם לשחקן יש מהלכים תקפים (לצורך זיהוי מט/פטיש)
 */
function hasValidMoves(board, color) {
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = board[row][col];
            if (!piece || piece.color !== color) continue;

            for (let toRow = 0; toRow < BOARD_SIZE; toRow++) {
                for (let toCol = 0; toCol < BOARD_SIZE; toCol++) {
                    if (isValidMove(board, { row, col }, { row: toRow, col: toCol }, piece)) {
                        return true;
                    }
                }
            }
        }
    }

    return false;
}

/**
 * קביעת מצב המשחק (מט, פטיש, פעיל)
 */
function getGameState(board, currentPlayer) {
    if (isKingInCheck(board, currentPlayer)) {
        if (!hasValidMoves(board, currentPlayer)) {
            return 'checkmate';
        }
    }

    if (!hasValidMoves(board, currentPlayer)) {
        return 'stalemate';
    }

    return 'active';
}

const game = {
    BOARD_SIZE,
    WHITE,
    BLACK,
    createEmptyBoard,
    initializeBoard,
    boardToFen,
    fenToBoard,
    squareToNotation,
    notationToSquare,
    isValidMove,
    isValidPawnMove,
    isValidStraightMove,
    isValidDiagonalMove,
    makeMove,
    isKingInCheck,
    hasValidMoves,
    getGameState
};

window.game = game;

if (typeof module !== 'undefined') {
    module.exports = {
        createEmptyBoard,
        initializeBoard,
        boardToFen,
        fenToBoard,
        squareToNotation,
        notationToSquare,
        isValidMove,
        makeMove,
        isKingInCheck,
        hasValidMoves,
        getGameState
    };
}