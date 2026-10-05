/**
 * Game routes - chess game management
 * 
 * AI/ML Concept #3: State representation
 * 
 * In chess AI, the board must be represented in a way the
 * computer can understand. Common representations:
 * - 8x8 array (like we'll use)
 * - FEN string (standard chess notation)
 * - Bitboards (efficient bit-level representation)
 * 
 * Our implementation uses an 8x8 array internally, which
 * is easier to understand and works well for learning.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireAuth } = require('../auth-middleware');

const BOARD_SIZE = 8;
const WHITE = 'white';
const BLACK = 'black';

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(error) {
            if (error) reject(error);
            else resolve(this);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

async function requireVerifiedUser(accountNumber) {
    return dbGet('SELECT id, account_number FROM users WHERE account_number = ? AND email_verified = 1', [accountNumber]);
}

router.get('/matchmaking/players', async (req, res) => {
    try {
        const accountNumber = String(req.query.accountNumber || '');
        const currentUser = await requireVerifiedUser(accountNumber);
        if (!currentUser) return res.status(403).json({ error: 'יש להתחבר עם חשבון מאומת' });

        // דירוג מחשב מעל כל המשתמשים המאומתים (כמו טבלת הדירוג), ורק אחר כך סינון-self
        const players = await dbAll(`
            SELECT * FROM (
                SELECT u.id, u.account_number AS "accountNumber", CASE WHEN u.show_full_name = 1 THEN u.full_name ELSE NULL END AS "fullName",
                       COALESCE(a.is_available, 0) AS "isAvailable",
                       r.rating, r.games_played AS "gamesPlayed", r.wins, r.losses,
                       ROW_NUMBER() OVER (ORDER BY COALESCE(r.wins, 0) DESC, COALESCE(r.rating, 1200) DESC, u.account_number) AS "rank"
                FROM users u
                LEFT JOIN player_availability a ON a.user_id = u.id
                LEFT JOIN ratings r ON r.user_id = u.id
                WHERE u.email_verified = 1
            ) ranked
            WHERE ranked.id != ?
            ORDER BY "isAvailable" DESC, COALESCE(wins, 0) DESC, COALESCE(rating, 1200) DESC, "accountNumber"`, [currentUser.id]);

        res.json(players.map(player => ({
            ...player,
            isAvailable: Boolean(player.isAvailable),
            rating: player.rating || 1200,
            gamesPlayed: Number(player.gamesPlayed || 0),
            wins: Number(player.wins || 0),
            losses: Number(player.losses || 0),
            rank: player.rank ? Number(player.rank) : null
        })));
    } catch (error) {
        console.error('Error loading matchmaking players:', error);
        res.status(500).json({ error: 'נכשלה טעינת השחקנים' });
    }
});

router.post('/matchmaking/availability', async (req, res) => {
    try {
        const user = await requireVerifiedUser(req.body.accountNumber);
        if (!user) return res.status(403).json({ error: 'יש להתחבר עם חשבון מאומת' });
        const isAvailable = Boolean(req.body.isAvailable);
        await dbRun(`
            INSERT INTO player_availability (user_id, is_available, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET is_available = excluded.is_available, updated_at = CURRENT_TIMESTAMP
            RETURNING user_id
        `, [user.id, isAvailable ? 1 : 0]);
        res.json({ isAvailable });
    } catch (error) {
        console.error('Error updating availability:', error);
        res.status(500).json({ error: 'נכשלה עדכון הזמינות' });
    }
});

router.post('/matchmaking/preferred-color', async (req, res) => {
    try {
        const user = await requireVerifiedUser(req.body.accountNumber);
        if (!user) return res.status(403).json({ error: 'יש להתחבר עם חשבון מאומת' });
        const preferredColor = ['white', 'black', 'random'].includes(req.body.preferredColor) ? req.body.preferredColor : 'random';
        await dbRun('UPDATE users SET preferred_color = ? WHERE id = ?', [preferredColor, user.id]);
        res.json({ preferredColor });
    } catch (error) {
        res.status(500).json({ error: 'נכשלה שמירת העדפת הצבע' });
    }
});

router.get('/matchmaking/invitations', async (req, res) => {
    try {
        const user = await requireVerifiedUser(req.query.accountNumber);
        if (!user) return res.status(403).json({ error: 'יש להתחבר עם חשבון מאומת' });
        const invitations = await dbAll(`
            SELECT i.id, i.status, i.created_at AS "createdAt", u.account_number AS "senderAccount"
            FROM game_invitations i JOIN users u ON u.id = i.sender_id
            WHERE i.receiver_id = ? AND i.status = 'pending'
            ORDER BY i.created_at DESC
        `, [user.id]);
        res.json(invitations);
    } catch (error) {
        res.status(500).json({ error: 'נכשלה טעינת ההזמנות' });
    }
});

/**
 * הזמנות ששלח המשתמש הנוכחי וסטטוס שלהן (לאיתור אישור בזמן אמת)
 * GET /api/games/matchmaking/sent-invitations?accountNumber=
 */
router.get('/matchmaking/sent-invitations', async (req, res) => {
    try {
        const user = await requireVerifiedUser(req.query.accountNumber);
        if (!user) return res.status(403).json({ error: 'יש להתחבר עם חשבון מאומת' });
        const invitations = await dbAll(`
            SELECT i.id, i.status, i.game_id AS "gameId", i.responded_at AS "respondedAt",
                   u.account_number AS "receiverAccount"
            FROM game_invitations i JOIN users u ON u.id = i.receiver_id
            WHERE i.sender_id = ?
            ORDER BY i.created_at DESC
            LIMIT 30
        `, [user.id]);
        res.json(invitations);
    } catch (error) {
        console.error('Sent invitations error:', error);
        res.status(500).json({ error: 'נכשלה טעינת ההזמנות שנשלחו' });
    }
});

router.post('/matchmaking/invitations', async (req, res) => {
    try {
        const sender = await requireVerifiedUser(req.body.senderAccount);
        const receiver = await requireVerifiedUser(req.body.receiverAccount);
        if (!sender || !receiver) return res.status(404).json({ error: 'השחקן אינו רשום או אינו מאומת' });
        if (sender.id === receiver.id) return res.status(400).json({ error: 'אי אפשר להזמין את עצמך' });

        const existing = await dbGet(`
            SELECT id FROM game_invitations
            WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'
        `, [sender.id, receiver.id]);
        if (existing) return res.status(409).json({ error: 'כבר נשלחה הזמנה לשחקן הזה' });

        const invitation = await dbRun(
            'INSERT INTO game_invitations (sender_id, receiver_id) VALUES (?, ?)',
            [sender.id, receiver.id]
        );
        res.status(201).json({ id: invitation.lastID, message: 'ההזמנה נשלחה' });
    } catch (error) {
        console.error('Error creating invitation:', error);
        res.status(500).json({ error: 'נכשלה שליחת ההזמנה' });
    }
});

router.post('/matchmaking/invitations/:id/respond', async (req, res) => {
    try {
        const receiver = await requireVerifiedUser(req.body.accountNumber);
        if (!receiver) return res.status(403).json({ error: 'יש להתחבר עם חשבון מאומת' });
        const invitation = await dbGet(`
            SELECT * FROM game_invitations WHERE id = ? AND receiver_id = ? AND status = 'pending'
        `, [req.params.id, receiver.id]);
        if (!invitation) return res.status(404).json({ error: 'ההזמנה לא נמצאה או שכבר טופלה' });

        if (req.body.accepted !== true) {
            await dbRun("UPDATE game_invitations SET status = 'declined', responded_at = CURRENT_TIMESTAMP WHERE id = ?", [invitation.id]);
            return res.json({ accepted: false, message: 'ההזמנה נדחתה' });
        }

        const preferences = await dbAll('SELECT id, preferred_color FROM users WHERE id IN (?, ?)', [invitation.sender_id, invitation.receiver_id]);
        const senderPreference = preferences.find(player => player.id === invitation.sender_id)?.preferred_color || 'random';
        const receiverPreference = preferences.find(player => player.id === invitation.receiver_id)?.preferred_color || 'random';
        let senderColor = senderPreference;
        let receiverColor = receiverPreference;
        if (senderPreference === 'white' && receiverPreference !== 'white') receiverColor = 'black';
        else if (senderPreference === 'black' && receiverPreference !== 'black') receiverColor = 'white';
        else if (receiverPreference === 'white' && senderPreference !== 'white') senderColor = 'black';
        else if (receiverPreference === 'black' && senderPreference !== 'black') senderColor = 'white';
        else if (senderPreference === receiverPreference) senderColor = Math.random() < 0.5 ? 'white' : 'black';
        if (senderColor === 'random') senderColor = Math.random() < 0.5 ? 'white' : 'black';
        if (receiverColor === 'random' || receiverColor === senderColor) receiverColor = senderColor === 'white' ? 'black' : 'white';

        const game = await dbRun(
            "INSERT INTO games (player1_id, player2_id, status, player1_color, player2_color) VALUES (?, ?, 'active', ?, ?)",
            [invitation.sender_id, invitation.receiver_id, senderColor, receiverColor]
        );
        await dbRun("UPDATE game_invitations SET status = 'accepted', game_id = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?", [game.lastID, invitation.id]);
        res.json({ accepted: true, gameId: game.lastID });
    } catch (error) {
        console.error('Error responding to invitation:', error);
        res.status(500).json({ error: 'נכשלה תשובת ההזמנה' });
    }
});

/**
 * Create an empty chess board
 * Returns an 8x8 array where each cell is null or a piece object
 */
function createEmptyBoard() {
    const board = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
        board.push(new Array(BOARD_SIZE).fill(null));
    }

    return board;
}

/**
 * Initialize a standard chess board setup
 * White pieces at bottom, black pieces at top
 */
function initializeBoard() {
    const board = createEmptyBoard();

    // Place black pieces on top rows
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

    // Place white pieces on bottom rows
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
 * Convert board array to FEN string
 * FEN is the standard notation for chess positions
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
 * Convert FEN string to board array
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
 * Convert board coordinates to chess notation
 * Example: row 6, col 4 -> 'e4'
 */
function squareToNotation(row, col) {
    return String.fromCharCode(97 + col) + (8 - row);
}

/**
 * Convert chess notation to board coordinates
 * Example: 'e4' -> row 6, col 4
 */
function notationToSquare(notation) {
    const col = notation.charCodeAt(0) - 97;
    const row = 8 - parseInt(notation[1], 10);

    return { row, col };
}

/**
 * Check if a move is valid for a specific piece
 * This is the core of chess rule validation
 */
function isValidMove(board, from, to, piece) {
    const { row: fromRow, col: fromCol } = from;
    const { row: toRow, col: toCol } = to;

    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;
    const absRowDiff = Math.abs(rowDiff);
    const absColDiff = Math.abs(colDiff);
    const target = board[toRow][toCol];

    // Cannot move to a square occupied by own piece
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
 * Check if a move is valid for a pawn
 */
function isValidPawnMove(board, from, to, piece) {
    const { row: fromRow, col: fromCol } = from;
    const { row: toRow, col: toCol } = to;

    const direction = piece.color === WHITE ? -1 : 1;
    const startRow = piece.color === WHITE ? 6 : 1;
    const target = board[toRow][toCol];

    // Moving forward one square
    if (fromCol === toCol && toRow === fromRow + direction && !target) {
        return true;
    }

    // Moving forward two squares from starting position
    if (
        fromCol === toCol &&
        fromRow === startRow &&
        toRow === fromRow + 2 * direction &&
        !board[fromRow + direction][fromCol] &&
        !target
    ) {
        return true;
    }

    // Capturing diagonally
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
 * Check if a straight-line move is valid (rook, queen)
 */
function isValidStraightMove(board, from, to) {
    const { row: fromRow, col: fromCol } = from;
    const { row: toRow, col: toCol } = to;
    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;

    if (rowDiff !== 0 && colDiff !== 0) {
        return false;
    }

    // Check path is clear
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
 * Check if a diagonal move is valid (bishop, queen)
 */
function isValidDiagonalMove(board, from, to) {
    const { row: fromRow, col: fromCol } = from;
    const { row: toRow, col: toCol } = to;
    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;

    if (Math.abs(rowDiff) !== Math.abs(colDiff) || rowDiff === 0) {
        return false;
    }

    // Check path is clear
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
 * Make a move on the board
 * Returns the updated board
 */
function makeMove(board, from, to) {
    const newBoard = board.map(row => row.map(piece => piece ? { ...piece } : null));
    const piece = newBoard[from.row][from.col];

    newBoard[from.row][from.col] = null;
    newBoard[to.row][to.col] = piece;

    return newBoard;
}

/**
 * Check if a king is in check
 */
function isKingInCheck(board, kingColor) {
    // Find king position
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

    // Check if any opponent piece can attack the king
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
 * Check if a player has any valid moves (for checkmate detection)
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
 * Determine if a game is in checkmate or stalemate
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

function cloneBoard(board) {
    return board.map(row => row.map(piece => piece ? { ...piece } : null));
}

function isSquareAttacked(board, row, col, attackingColor) {
    for (let fromRow = 0; fromRow < BOARD_SIZE; fromRow++) {
        for (let fromCol = 0; fromCol < BOARD_SIZE; fromCol++) {
            const piece = board[fromRow][fromCol];
            if (piece && piece.color === attackingColor && isValidMove(board, { row: fromRow, col: fromCol }, { row, col }, piece)) {
                return true;
            }
        }
    }
    return false;
}

function applySpecialMove(board, from, to, promotion = null, lastMove = null) {
    const next = cloneBoard(board);
    const piece = next[from.row][from.col];
    if (!piece) return next;

    // הכרזה
    if (piece.type === 'king' && Math.abs(to.col - from.col) === 2) {
        const rookFromCol = to.col > from.col ? 7 : 0;
        const rookToCol = to.col > from.col ? 5 : 3;
        next[from.row][rookToCol] = next[from.row][rookFromCol];
        next[from.row][rookFromCol] = null;
    }

    // אכיפה
    if (piece.type === 'pawn' && from.col !== to.col && !next[to.row][to.col] && lastMove
        && lastMove.piece === 'pawn' && Math.abs(Number(lastMove.toRow) - Number(lastMove.fromRow)) === 2
        && to.col === Number(lastMove.toCol) && to.row === (Number(lastMove.fromRow) + Number(lastMove.toRow)) / 2) {
        next[to.row][from.col] = null;
    }

    next[from.row][from.col] = null;
    next[to.row][to.col] = promotion ? { type: promotion, color: piece.color } : piece;
    return next;
}

function getCastlingMoves(board, color, lastMove, moveHistory = []) {
    const row = color === WHITE ? 7 : 0;
    const king = board[row][4];
    if (!king || king.type !== 'king' || king.color !== color || isSquareAttacked(board, row, 4, color === WHITE ? BLACK : WHITE)) return [];
    const history = moveHistory.map(move => String(move.from_square || move.from || '').toLowerCase());
    if (history.some(from => from === (color === WHITE ? 'e1' : 'e8') || from === (color === WHITE ? 'a1' : 'a8') || from === (color === WHITE ? 'h1' : 'h8'))) return [];
    const enemy = color === WHITE ? BLACK : WHITE;
    const moves = [];
    if (board[row][7]?.type === 'rook' && board[row][7]?.color === color && !board[row][5] && !board[row][6]
        && !isSquareAttacked(board, row, 5, enemy) && !isSquareAttacked(board, row, 6, enemy)) {
        moves.push({ from: { row, col: 4 }, to: { row, col: 6 }, notation: `${squareToNotation(row, 4)}${squareToNotation(row, 6)}` });
    }
    if (board[row][0]?.type === 'rook' && board[row][0]?.color === color && !board[row][1] && !board[row][2] && !board[row][3]
        && !isSquareAttacked(board, row, 3, enemy) && !isSquareAttacked(board, row, 2, enemy)) {
        moves.push({ from: { row, col: 4 }, to: { row, col: 2 }, notation: `${squareToNotation(row, 4)}${squareToNotation(row, 2)}` });
    }
    return moves;
}

function getLegalMoves(board, color, lastMove = null, moveHistory = []) {
    const moves = [];
    const enemy = color === WHITE ? BLACK : WHITE;
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const piece = board[row][col];
            if (!piece || piece.color !== color) continue;
            for (let toRow = 0; toRow < BOARD_SIZE; toRow++) {
                for (let toCol = 0; toCol < BOARD_SIZE; toCol++) {
                    const from = { row, col };
                    const to = { row: toRow, col: toCol };
                    if (board[toRow][toCol]?.type === 'king') continue;
                    let candidate = null;
                    if (isValidMove(board, from, to, piece)) candidate = { from, to, notation: `${squareToNotation(row, col)}${squareToNotation(toRow, toCol)}` };
                    if (piece.type === 'pawn' && from.col !== to.col && !board[toRow][toCol] && lastMove
                        && lastMove.piece === 'pawn' && Math.abs(Number(lastMove.toRow) - Number(lastMove.fromRow)) === 2
                        && toCol === Number(lastMove.toCol) && toRow === (Number(lastMove.fromRow) + Number(lastMove.toRow)) / 2) {
                        candidate = { from, to, notation: `${squareToNotation(row, col)}${squareToNotation(toRow, toCol)}` };
                    }
                    if (!candidate) continue;
                    if (isKingInCheck(applySpecialMove(board, from, to, null, lastMove), color)) continue;
                    if (piece.type === 'pawn' && (toRow === 0 || toRow === 7)) {
                        for (const promotion of ['queen', 'rook', 'bishop', 'knight']) {
                            moves.push({ ...candidate, promotion, notation: `${candidate.notation}${promotion[0]}` });
                        }
                    } else {
                        moves.push(candidate);
                    }
                }
            }
        }
    }
    return moves.concat(getCastlingMoves(board, color, lastMove, moveHistory).filter(move => !isKingInCheck(applySpecialMove(board, move.from, move.to, null, lastMove), color)));
}

function gameStateFromMoves(board, currentPlayer, lastMove = null, moveHistory = []) {
    if (isKingInCheck(board, currentPlayer) && getLegalMoves(board, currentPlayer, lastMove, moveHistory).length === 0) return 'checkmate';
    if (!isKingInCheck(board, currentPlayer) && getLegalMoves(board, currentPlayer, lastMove, moveHistory).length === 0) return 'stalemate';
    return 'active';
}


/**
 * יצירת משחק חדש.
 * POST /api/games
 *
 * ── אבטחה ─────────────────────────────────────────────────────────────
 * הנתיב מחובר ל-requireAuth, ולכן req.user מוגדר תמיד מאסימן שהשרת אימת.
 * המשתמש יכול ליצור משחק רק נגד עצמו - כלומר הוא תמיד player1,
 * והיריב (player2) נקבע מההזמנה שאותה היריב אישר בעצמו.
 * לפני התיקון אפשר היה לשלוח בקשה עם שני מספרי חשבון של אנשים אחרים
 * וליצור משחק בשמם, בלי שאחד מהם ידע.
 */
router.post('/', requireAuth, (req, res) => {
    const { player2Account } = req.body;
    const creatorAccount = req.user.accountNumber;

    if (!player2Account) {
        return res.status(400).json({ error: 'חשבון היריב חסר' });
    }

    if (player2Account === creatorAccount) {
        return res.status(400).json({ error: 'לא ניתן לשחק נגד עצמך' });
    }

    // Verify the opponent exists and is verified
    db.get('SELECT id FROM users WHERE account_number = ? AND email_verified = 1', [player2Account], (err, player2) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!player2) {
            return res.status(404).json({ error: 'היריב לא נמצא' });
        }

        const player1Color = WHITE;
        const player2Color = BLACK;
        db.run(
            'INSERT INTO games (player1_id, player2_id, status, player1_color, player2_color) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, player2.id, 'active', player1Color, player2Color],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to create game' });
                }

                res.json({
                    id: this.lastID,
                    player1Account: creatorAccount,
                    player2Account,
                    status: 'active',
                    message: 'Game created successfully'
                });
            }
        );
    });
});

/**
 * List all games
 * GET /api/games
 */
router.get('/', (req, res) => {
    db.all(
        `SELECT g.id, g.player1_id, g.player2_id, g.winner_id, g.status,
                g.created_at, g.completed_at,
                u1.account_number AS player1_number,
                u2.account_number AS player2_number,
                u1.full_name AS player1_name,
                u2.full_name AS player2_name
         FROM games g
         JOIN users u1 ON g.player1_id = u1.id
         JOIN users u2 ON g.player2_id = u2.id
         ORDER BY g.created_at DESC`,
        (err, rows) => {
            if (err) {
                console.error('Error getting games:', err);
                return res.status(500).json({ error: 'Failed to get games' });
            }

            res.json(rows);
        }
    );
});

/**
 * Get a single game with full details
 * GET /api/games/:id
 */
router.get('/:id', (req, res) => {
    const gameId = parseInt(req.params.id);
    const requesterAccount = String(req.query.accountNumber || '');

    db.get(
        `SELECT g.*, u1.account_number AS player1_number, u1.full_name AS player1_name,
                u2.account_number AS player2_number, u2.full_name AS player2_name
         FROM games g
         JOIN users u1 ON g.player1_id = u1.id
         JOIN users u2 ON g.player2_id = u2.id
         WHERE g.id = ?`,
        [gameId],
        (err, game) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (!game) {
                return res.status(404).json({ error: 'Game not found' });
            }

            // Get moves for this game
            db.all(
                'SELECT * FROM moves WHERE game_id = ? ORDER BY move_number ASC',
                [gameId],
                (err, moves) => {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to get moves' });
                    }

                    // Reconstruct board state
                    let board = initializeBoard();
                    const moveHistory = [];
                    let lastMove = null;

                    for (const move of moves) {
                        const from = notationToSquare(move.from_square);
                        const to = notationToSquare(move.to_square);
                        board = applySpecialMove(board, from, to, move.promotion, lastMove);
                        lastMove = { ...move, fromRow: from.row, fromCol: from.col, toRow: to.row, toCol: to.col, fromSquare: move.from_square, toSquare: move.to_square };
                        moveHistory.push({
                            id: move.id,
                            moveNumber: move.move_number,
                            from: move.from_square,
                            to: move.to_square,
                            piece: move.piece,
                            promotion: move.promotion || null,
                            color: move.color,
                            fen: boardToFen(board)
                        });
                    }
                    // תמיד לבן מתחיל: במשחק חדש התור הראשון שייך ללבן, ללא קשר לצבע שהוקצה לשחקן הראשון.
                    const currentTurn = moves.length === 0
                        ? WHITE
                        : (moves[moves.length - 1].color === WHITE ? BLACK : WHITE);
                    const requesterColor = requesterAccount === String(game.player1_number) ? (game.player1_color || currentTurn)
                        : requesterAccount === String(game.player2_number) ? (game.player2_color || (currentTurn === WHITE ? BLACK : WHITE)) : null;
                    const canRequestMoves = game.status === 'active' && (!requesterAccount || requesterColor === currentTurn);
                    const legalMoves = canRequestMoves ? getLegalMoves(board, currentTurn, lastMove, moves) : [];

                    res.json({
                        id: game.id,
                        player1Id: game.player1_id,
                        player2Id: game.player2_id,
                        winnerId: game.winner_id,
                        status: game.status,
                        createdAt: game.created_at,
                        completedAt: game.completed_at,
                        player1Account: game.player1_number,
                        player2Account: game.player2_number,
                        player1Name: game.player1_name,
                        player2Name: game.player2_name,
                        player1Color: game.player1_color || WHITE,
                        player2Color: game.player2_color || BLACK,
                        currentTurn,
                        board: boardToFen(board),
                        legalMoves,
                        moveHistory
                    });
                }
            );
        }
    );
});

/**
 * Make a move in a game
 * POST /api/games/:id/move
 */
router.post('/:id/move', (req, res) => {
    const gameId = parseInt(req.params.id);
    const { playerFrom, playerTo, promotion, accountNumber } = req.body;

    if (!playerFrom || !playerTo) {
        return res.status(400).json({ error: 'Move from and to squares are required' });
    }

    // Get game and moves
    db.get(
        'SELECT * FROM games WHERE id = ?',
        [gameId],
        async (err, game) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (!game) {
                return res.status(404).json({ error: 'Game not found' });
            }

            if (game.status !== 'active') {
                return res.status(409).json({ error: 'Game is not active' });
            }

            // Get all moves
            db.all(
                'SELECT * FROM moves WHERE game_id = ? ORDER BY move_number ASC',
                [gameId],
                async (err, moves) => {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to get moves' });
                    }

                    // Reconstruct current board and validate against the authoritative legal moves
                    let board = initializeBoard();
                    let lastMove = null;
                    for (const move of moves) {
                        const from = notationToSquare(move.from_square);
                        const to = notationToSquare(move.to_square);
                        board = applySpecialMove(board, from, to, move.promotion, lastMove);
                        lastMove = { ...move, fromRow: from.row, fromCol: from.col, toRow: to.row, toCol: to.col, fromSquare: move.from_square, toSquare: move.to_square };
                    }

                    // תמיד לבן מתחיל את המשחק, גם אם הוקצה לו צבע שחור.
                    const currentPlayer = moves.length === 0
                        ? WHITE
                        : (moves[moves.length - 1].color === WHITE ? BLACK : WHITE);
                    const from = notationToSquare(playerFrom);
                    const to = notationToSquare(playerTo);
                    const piece = board[from.row]?.[from.col];
                    if (!piece || piece.color !== currentPlayer) {
                        return res.status(400).json({ error: `זו תור ${currentPlayer === WHITE ? 'לבן' : 'שחור'}` });
                    }

                    const baseNotation = `${playerFrom}${playerTo}`;
                    const legalMoves = getLegalMoves(board, currentPlayer, lastMove, moves);
                    let legalMove = legalMoves.find(move => move.notation === baseNotation && !move.promotion);
                    if (piece.type === 'pawn' && (to.row === 0 || to.row === 7)) {
                        const requestedPromotion = ['queen', 'rook', 'bishop', 'knight'].includes(promotion) ? promotion : 'queen';
                        legalMove = legalMoves.find(move => move.notation === `${baseNotation}${requestedPromotion[0]}`);
                    }
                    if (!legalMove) return res.status(400).json({ error: 'המהלך אינו חוקי' });

                    if (accountNumber) {
                        const user = await dbGet('SELECT id FROM users WHERE account_number = ? AND email_verified = 1', [String(accountNumber)]);
                        if (!user || (Number(user.id) !== Number(game.player1_id) && Number(user.id) !== Number(game.player2_id))) {
                            return res.status(403).json({ error: 'רק שחקן המשחק יכול לבצע מהלך' });
                        }
                        const assignedColor = Number(user.id) === Number(game.player1_id) ? game.player1_color : game.player2_color;
                        if (assignedColor && assignedColor !== currentPlayer) {
                            return res.status(409).json({ error: 'זו לא תורך במשחק' });
                        }
                    }

                    const appliedMove = { ...legalMove, fromRow: from.row, fromCol: from.col, toRow: to.row, toCol: to.col, fromSquare: playerFrom, toSquare: playerTo };
                    board = applySpecialMove(board, from, to, legalMove.promotion || null, lastMove);
                    const nextPlayer = currentPlayer === WHITE ? BLACK : WHITE;
                    const gameState = gameStateFromMoves(board, nextPlayer, appliedMove, moves);

                    // Insert move into database
                    const nextMoveNumber = moves.length + 1;

                    db.run(
                        `INSERT INTO moves (game_id, move_number, from_square, to_square, piece, promotion, color)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [gameId, nextMoveNumber, playerFrom, playerTo, piece.type, legalMove.promotion || null, currentPlayer],
                        (err) => {
                            if (err) {
                                return res.status(500).json({ error: 'Failed to save move' });
                            }

                            // Update game status if game ended
                            if (gameState === 'checkmate' || gameState === 'stalemate') {
                                db.run(
                                    'UPDATE games SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
                                    [gameState === 'checkmate' ? 'completed' : 'completed', gameId],
                                    (updateErr) => {
                                        if (updateErr) {
                                            return res.status(500).json({ error: 'Failed to update game status' });
                                        }

                                        if (gameState === 'checkmate') {
                                            // הזוכר הוא בעל הצבע שביצע את המהלך המניח - לא "שחקן 1" בהכרח.
                                            const winnerId = (game.player1_color || WHITE) === currentPlayer
                                                ? game.player1_id
                                                : game.player2_id;
                                            db.run(
                                                'UPDATE games SET winner_id = ? WHERE id = ?',
                                                [winnerId, gameId],
                                                (winnerErr) => {
                                                    if (winnerErr) {
                                                        return res.status(500).json({ error: 'Failed to update winner' });
                                                    }
                                                    updateGameStatusAndRating(gameId, winnerId);
                                                }
                                            );
                                        } else {
                                            updateGameStatusAndRating(gameId, null);
                                        }
                                    }
                                );
                            }

                            res.json({
                                success: true,
                                move: {
                                    moveNumber: nextMoveNumber,
                                    from: playerFrom,
                                    to: playerTo,
                                    piece: piece.type,
                                    promotion: legalMove.promotion || null,
                                    color: currentPlayer
                                },
                                board: boardToFen(board),
                                gameState,
                                currentTurn: gameState === 'active' ? nextPlayer : null
                            });
                        }
                    );
                }
            );
        }
    );
});

/**
 * Complete a game with a winner
 * POST /api/games/:id/complete
 */
router.post('/:id/complete', (req, res) => {
    const gameId = parseInt(req.params.id);
    const { winnerId } = req.body;

    if (!winnerId) {
        return res.status(400).json({ error: 'Winner ID is required' });
    }

    db.get(
        'SELECT * FROM games WHERE id = ?',
        [gameId],
        (err, game) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (!game) {
                return res.status(404).json({ error: 'Game not found' });
            }

            if (game.status !== 'active') {
                return res.status(409).json({ error: 'Game is not active' });
            }

            // השוואה מספרית: game.player1_id מגיע מה-DB כמחרוזת
            if (Number(winnerId) === Number(game.player1_id) || Number(winnerId) === Number(game.player2_id)) {
                db.run(
                    'UPDATE games SET status = ?, winner_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
                    ['completed', winnerId, gameId],
                    (updateErr) => {
                        if (updateErr) {
                            return res.status(500).json({ error: 'Failed to update game' });
                        }

                        updateGameStatusAndRating(gameId, winnerId);
                        return res.json({ success: true, gameId, winnerId });
                    }
                );
            } else {
                res.status(400).json({ error: 'Winner must be one of the two players' });
            }
        }
    );
});

/**
 * Update rating after a game
 * Elo rating system (per plan.md):
 *   K-factor: 32
 *   Expected score: 1 / (1 + 10^((ratingOpponent - ratingPlayer)/400))
 *   Rating change: K * (actualScore - expectedScore)
 *   Starting rating: 1200, draw = 0.5 score for both players
 */
function updateGameStatusAndRating(gameId, winnerId) {
    db.get(
        'SELECT * FROM games WHERE id = ?',
        [gameId],
        (err, game) => {
            if (err) {
                return;
            }

            const player1Id = game.player1_id;
            const player2Id = game.player2_id;

            // Get ratings
            db.get('SELECT rating FROM ratings WHERE user_id = ?', [player1Id], (err, r1) => {
                db.get('SELECT rating FROM ratings WHERE user_id = ?', [player2Id], (err, r2) => {
                    if (!r1 || !r2) return;

                    const rating1 = r1.rating;
                    const rating2 = r2.rating;

                    // Elo rating system (K-factor: 32)
                    const K = 32;
                    const expected1 = 1 / (1 + Math.pow(10, (rating2 - rating1) / 400));
                    const expected2 = 1 / (1 + Math.pow(10, (rating1 - rating2) / 400));
                    let actual1, actual2;
                    if (winnerId === player1Id) { actual1 = 1; actual2 = 0; }
                    else if (winnerId === player2Id) { actual1 = 0; actual2 = 1; }
                    else { actual1 = 0.5; actual2 = 0.5; }
                    const change1 = Math.round(K * (actual1 - expected1));
                    const change2 = Math.round(K * (actual2 - expected2));

                    const newRating1 = rating1 + change1;
                    const newRating2 = rating2 + change2;

                    // Update ratings
                    db.run(
                        `UPDATE ratings SET rating = ?, games_played = games_played + 1,
                                 wins = wins + ?, losses = losses + ? WHERE user_id = ?`,
                        [newRating1, winnerId === player1Id ? 1 : 0, winnerId === player2Id ? 1 : 0, player1Id],
                        (err1) => {
                            db.run(
                                `UPDATE ratings SET rating = ?, games_played = games_played + 1,
                                         wins = wins + ?, losses = losses + ? WHERE user_id = ?`,
                                [newRating2, winnerId === player2Id ? 1 : 0, winnerId === player1Id ? 1 : 0, player2Id],
                                (err2) => {
                                    if (err1 || err2) {
                                        console.error('Error updating ratings:', err1 || err2);
                                    } else {
                                        console.log(`Rating updated: Player1 ${rating1} -> ${newRating1}, Player2 ${rating2} -> ${newRating2}`);
                                    }
                                }
                            );
                        }
                    );
                });
            });
        }
    );
}

module.exports = router;
module.exports.boardToFen = boardToFen;
module.exports.fenToBoard = fenToBoard;
module.exports.initializeBoard = initializeBoard;
module.exports.makeMove = makeMove;
module.exports.isValidMove = isValidMove;
module.exports.getGameState = getGameState;
