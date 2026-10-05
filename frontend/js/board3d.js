/**
 * board3d.js — לוח שחמט תלת-ממדי המבוסס Three.js.
 *
 * =========================================================================
 *  מטרת המודול
 * =========================================================================
 *  מצייר את הלוח ואת הכלים בתלת-ממד, וממיר קליק עכבר על ריבוע
 *  לקואורדינטות (row, col) שהקוד של המשחק מבין.
 *
 * --- מערכת הקואורדינטות -------------------------------------------------
 *   משבצת אחת = 1 יחידה. הלוח 8x8 יחידות, מרכזו במקור (0,0,0).
 *
 *   מרכז ריבוע:  x = col - 3.5    z = row - 3.5    y = 0
 *
 *   row 0 (ריבוע 8) נמצא ב-z שלילי, row 7 (ריבוע 1) ב-z חיובי.
 *   כך הלבן (row 7) נמצא ליד המצלמה.
 *
 * --- הכלים -------------------------------------------------------------
 *   ששה קבצים לכל צבע, בשמות: {color}-{type}.glb
 *   כל קובץ נטען פעם אחת, ואז משכפל (clone) לכל ריבוע שבו הכלי עומד.
 *
 * --- גיבוי -------------------------------------------------------------
 *   אם ספריית Three.js לא נטענה, או WebGL אינו זמין, או קובץ כלי חסר -
 *   המודול מדווח isAvailable() === false והממשק ממשיך להציג
 *   את הלוח הוותיק (SVG) ללא שינוי בהתנהגות המשחק.
 * =========================================================================
 */

const PIECE_TYPES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
const COLORS = ['white', 'black'];

/** גובה מבוקש לכל סוג כלי, ביחידות של ריבוע אחד. */
const TARGET_HEIGHT = {
    king: 1.02,
    queen: 0.92,
    knight: 0.70,
    bishop: 0.80,
    rook: 0.60,
    pawn: 0.50,
};

/** צבעי המשבצות והסימונים. */
const LIGHT_SQUARE = 0xE8DCC8;
const DARK_SQUARE = 0x9C7B54;
const COLOR_SELECTED = 0xF2C14E;
const COLOR_LEGAL = 0x4ADE80;
const COLOR_CAPTURE = 0xEF4444;
const COLOR_LAST_MOVE = 0x60A5FA;

const state = {
    ready: false,
    failed: false,
    three: null,
    GLTFLoader: null,
    renderer: null,
    scene: null,
    camera: null,
    container: null,
    canvas: null,
    raycaster: null,
    squares: [],
    pieces: [],
    models: new Map(),
    currentBoard: null,
    selected: null,
    legalMoves: [],
    lastMove: null,
    flipped: false,
    animating: false,
    onSelect: null,
    clock: null,
};

export function isAvailable() {
    return state.ready;
}

/**
 * טוען את Three.js ואת GLTFLoader דרך import דינמי.
 * כל כשל מוחזר false במקום לזרוק שגיאה - כך המשחק לא נשבר.
 */
async function loadLibrary() {
    if (state.three && state.GLTFLoader) return true;
    try {
        state.three = await import('three');
        const mod = await import('three/addons/loaders/GLTFLoader.js');
        state.GLTFLoader = mod.GLTFLoader;
        return true;
    } catch (error) {
        console.warn('[Board3D] Three.js לא נטען, ממשיכים עם הלוח הדו-ממדי:', error);
        return false;
    }
}

/**
 * יוצר את הסצנה: רנדרר, מצלמה, תאורה ו-64 ריבועי הלוח.
 */
function buildScene(container) {
    const THREE = state.three;

    const canvas = document.createElement('canvas');
    canvas.className = 'board3d-canvas';
    container.appendChild(canvas);
    state.canvas = canvas;

    state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    state.renderer.setClearColor(0x0b1321, 1);

    state.scene = new THREE.Scene();
    state.scene.fog = new THREE.Fog(0x0b1321, 18, 34);

    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    state.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff3d6, 1.15);
    sun.position.set(6, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    state.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x88aaff, 0.35);
    rim.position.set(-7, 5, -6);
    state.scene.add(rim);

    state.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    state.raycaster = new THREE.Raycaster();

    buildSquares();
    buildBase();
    resize();
    return true;
}

/** יוצר את ריבועות הלוח - 64 אובייקטים נפרדים כדי שאפשר לצבוע כל אחד. */
function buildSquares() {
    const THREE = state.three;
    const geometry = new THREE.BoxGeometry(1, 0.15, 1);
    const lightMat = new THREE.MeshStandardMaterial({ color: LIGHT_SQUARE, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: DARK_SQUARE, roughness: 0.6 });

    state.squares = [];
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const isLight = (row + col) % 2 === 0;
            const mesh = new THREE.Mesh(geometry, isLight ? lightMat : darkMat);
            mesh.position.set(col - 3.5, -0.075, row - 3.5);
            mesh.receiveShadow = true;
            mesh.userData = { row, col, baseColor: isLight ? LIGHT_SQUARE : DARK_SQUARE };
            mesh.name = `square-${row}-${col}`;
            state.scene.add(mesh);
            state.squares.push(mesh);
        }
    }
}

/** בסיס עץ מתחת ללוח, למראה עומק ועוגן לתצוגה. */
function buildBase() {
    const THREE = state.three;
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(8.4, 0.3, 8.4),
        new THREE.MeshStandardMaterial({ color: 0x3A2A1E, roughness: 0.85 })
    );
    base.position.y = -0.3;
    base.receiveShadow = true;
    base.castShadow = true;
    state.scene.add(base);

    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(8.9, 0.22, 8.9),
        new THREE.MeshStandardMaterial({ color: 0x4A3728, roughness: 0.8 })
    );
    frame.position.y = -0.42;
    frame.receiveShadow = true;
    state.scene.add(frame);
}

/** מתאים את גודל הקנבס לגודל הקונטיינר. */
function resize() {
    if (!state.renderer || !state.container) return;
    const w = state.container.clientWidth || 640;
    const h = state.container.clientHeight || 640;
    state.renderer.setSize(w, h, false);
    state.camera.aspect = w / Math.max(h, 1);
    state.camera.updateProjectionMatrix();
}

/**
 * טוען את 12 קובצי הכלים ומכין אותם לשיכפול.
 * כל קובץ נטען פעם אחת; לכל ריבוע שבו הכלי עומד נוצר clone.
 */
async function loadPieces() {
    const THREE = state.three;
    const loader = new state.GLTFLoader();
    const manager = new THREE.LoadingManager();

    const results = await Promise.allSettled(
        COLORS.flatMap(color => PIECE_TYPES.map(type => loadOne(loader, color, type)))
    );

    let loaded = 0;
    results.forEach((result, index) => {
        const color = COLORS[Math.floor(index / PIECE_TYPES.length)];
        const type = PIECE_TYPES[index % PIECE_TYPES.length];
        if (result.status === 'fulfilled' && result.value) {
            state.models.set(`${color}-${type}`, prepareModel(result.value, type));
            loaded++;
        }
    });

    if (loaded === 0) {
        console.warn('[Board3D] לא נטען אף קובץ כלי - ממשיכים עם הלוח הדו-ממדי.');
        return false;
    }
    console.info(`[Board3D] נטענו ${loaded} מתוך 12 קובצי כלי.`);
    return true;
}

/** טוען קובץ כלי בודד ומחזיר את סצנת ה-GLB. */
function loadOne(loader, color, type) {
    return new Promise((resolve, reject) => {
        const url = `/assets/pieces3d/${color}-${type}.glb`;
        loader.load(url,
            gltf => resolve(gltf),
            undefined,
            error => reject(new Error(`${url}: ${error?.message || 'טעינה נכשלה'}`)));
    });
}

/**
 * מכין מודל כלי לשימוש: ממד את הגובה בפועל, מחשב סקייל כדי להגיע
 * לגובה היעד, ומרכז את המודל כך שהבסיס יושב על Y=0.
 */
function prepareModel(gltf, type) {
    const THREE = state.three;
    const root = new THREE.Group();

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // המודלים מגיעים בסקייל ובכיוון לא תקניים מ-Blender.
    // מחזירים אותם למערכת שלנו: גובה נכון, בסיס על Y=0, מרכז ב-XZ.
    const holder = new THREE.Group();
    holder.add(gltf.scene);

    const currentHeight = box.max.y - box.min.y;
    const scale = currentHeight > 0 ? TARGET_HEIGHT[type] / currentHeight : 1;
    holder.scale.setScalar(scale);

    // מוסיפים סבבוב קל אם המודל מוטה על צדו
    holder.rotation.x = 0;

    holder.position.x = -center.x * scale;
    holder.position.z = -center.z * scale;
    holder.position.y = -box.min.y * scale;

    root.add(holder);
    root.userData = { type, color: gltf.scene.userData?.color };
    root.traverse(node => {
        if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
        }
    });
    return root;
}

/**
 * ממיר קואורדינטות לוח (row, col) למיקום תלת-ממדי.
 * מרכז הלוח הוא הנקודה (0,0,0), משבצת אחת = יחידה אחת.
 * row 0 = ריבוע 8 (הרחוק), col 0 = קובץ a (שמאל).
 */
function squarePosition(row, col) {
    return { x: col - 3.5, y: 0, z: row - 3.5 };
}

/**
 * יוצר אובייקט כלי מוכן להצבה על הלוח.
 * משתמש במודל שנטען מהקובץ התלת-ממדי; אם אין מודל, מחזיר null.
 * הכלי ממוקם כך שמרכזו במקום (0,0,0) ותחתיתו נוגעת בדיוק בפני הלוח.
 */
function makePiece(color, type) {
    const model = state.models.get(color + '-' + type);
    if (!model) return null;

    // clone כדי שכל כלי יהיה עצמאי - מאפשר גם שתי יופי של אותו כלי במשחק
    const mesh = model.clone(true);
    const box = new state.three.Box3().setFromObject(mesh);
    const center = box.getCenter(new state.three.Vector3());

    mesh.position.x -= center.x;   // מרכז הכלי על ציר הריבוע
    mesh.position.z -= center.z;
    mesh.position.y -= box.min.y;  // תחתית הכלי על גובה פני הלוח
    return mesh;
}

/**
 * מסנכרן את הכלים המוצגים לפי מערך הלוח הנוכחי.
 * board מוגן כמערך 8×8 שבו כל תא הוא {type, color} או null.
 */
export function sync(board) {
    if (!state.ready || !board) return;
    state.currentBoard = board;

    // הסרה של כל הכלים הקיימים
    state.pieces.forEach(piece => state.scene.remove(piece));
    state.pieces = [];

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const cell = board[row]?.[col];
            if (!cell) continue;
            const mesh = makePiece(cell.color, cell.type);
            if (!mesh) continue;
            const pos = squarePosition(row, col);
            mesh.position.set(pos.x, pos.y, pos.z);
            // השחור מסובב 180° כדי שיפנה ליריב
            mesh.rotation.y = cell.color === 'black' ? Math.PI : 0;
            mesh.userData.row = row;
            mesh.userData.col = col;
            state.pieces.push(mesh);
        }
    }
    paintSquares();
}

/** צוב סימוני המשבצות לפי הבחירה, המהלכים החוקיים והמהלך האחרון. */
export function setMarks({ selected, legalMoves, lastMove } = {}) {
    if (!state.ready) return;
    state.selected = selected || null;
    state.legalMoves = Array.isArray(legalMoves) ? legalMoves : [];
    state.lastMove = lastMove || null;
    paintSquares();
}

function paintSquares() {
    if (!state.squares.length) return;
    const legal = new Set(state.legalMoves.map(m => `${m.row},${m.col}`));
    const occupied = new Set();
    if (state.currentBoard) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (state.currentBoard[r]?.[c]) occupied.add(`${r},${c}`);
            }
        }
    }

    state.squares.forEach(square => {
        const { row, col, baseColor } = square.userData;
        let color = baseColor;
        let emissive = 0x000000;

        if (state.lastMove && (state.lastMove.from.row === row && state.lastMove.from.col === col
            || state.lastMove.to.row === row && state.lastMove.to.col === col)) {
            color = COLOR_LAST_MOVE;
        }
        if (legal.has(`${row},${col}`)) {
            if (occupied.has(`${row},${col}`)) color = COLOR_CAPTURE;
            else color = COLOR_LEGAL;
        }
        if (state.selected && state.selected.row === row && state.selected.col === col) {
            color = COLOR_SELECTED;
        }

        square.material.color.setHex(color);
        square.material.emissive.setHex(emissive);
    });
}

/**
 * מציג או מסתיר סימון מהלך חוקי.
 */
export function highlightMoves(moves) {
    setMarks({ selected: state.selected, legalMoves: moves, lastMove: state.lastMove });
}

/** מסמן את הריבוע הנבחר. */
export function setSelected(square) {
    state.selected = square || null;
    paintSquares();
}

/**
 * מבצע אנימציית תנועה של כלי מריבוע אחד לריבוע אחר.
 * מחזיר Promise שנמסר כאשר התנועה הסתיימה.
 */
export function animateMove(from, to) {
    const piece = findPieceAt(from.row, from.col);
    if (!piece) return Promise.resolve();

    const target = squarePosition(to.row, to.col);
    const startY = piece.position.y;
    const duration = 260;
    const start = performance.now();

    state.animating = true;
    return new Promise(resolve => {
        function step(now) {
            const t = Math.min((now - start) / duration, 1);
            const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

            piece.position.x += ((target.x - piece.position.x) * 0.22);
            piece.position.z += ((target.z - piece.position.z) * 0.22);
            // קפיצה קלה למעלה באמצע הדרך
            piece.position.y = startY + Math.sin(eased * Math.PI) * 0.35;

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                piece.position.set(target.x, target.y, target.z);
                piece.userData.row = to.row;
                piece.userData.col = to.col;
                state.animating = false;
                resolve();
            }
        }
        requestAnimationFrame(step);
    });
}

/** מחזיר את הכלי העומד בריבוע מסוים, אם יש. */
function findPieceAt(row, col) {
    return state.pieces.find(p => p.userData.row === row && p.userData.col === col) || null;
}

/**
 * מגדיר אם הלוח מוצג מהצד של השחקן השחור.
 * מסובב את המצלמה 180 סביב ציר Y.
 */
export function setFlip(flipped) {
    if (!state.ready) return;
    state.flipped = Boolean(flipped);
    updateCamera();
}

/** מחזיר אם הלוח כרגע הפוך. */
export function isFlipped() {
    return state.flipped;
}

function updateCamera() {
    if (!state.camera) return;
    const height = 10.5;
    const distance = state.flipped ? -12.5 : 12.5;
    state.camera.position.set(0, height, distance);
    state.camera.lookAt(0, 0, 0);
}

/**
 * רושם פונקציית חזר שתקבל (row, col) בכל קליק על ריבוע.
 * זו אותה חתימה שבה משתמש הקוד של המשחק - ללא שינוי בהתנהגות.
 */
export function onSquareClick(handler) {
    state.onSelect = handler;
}

/** ממיר קליק עכבר לקואורדינטות ריבוע. */
function pickSquare(event) {
    if (!state.raycaster || !state.camera || !state.renderer) return null;

    const rect = state.canvas.getBoundingClientRect();
    const pointer = new state.three.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    state.raycaster.setFromCamera(pointer, state.camera);

    // חיתוך קרן עם מישור אופקי בגובה הלוח
    const plane = new state.three.Plane(new state.three.Vector3(0, 1, 0), 0);
    const hit = new state.three.Vector3();
    if (!state.raycaster.ray.intersectPlane(plane, hit)) return null;

    // המרה ל-(row, col)
    const col = Math.round(hit.x + 3.5);
    const row = Math.round(hit.z + 3.5);
    if (row < 0 || row > 7 || col < 0 || col > 7) return null;
    return { row, col };
}

function handleClick(event) {
    if (!state.onSelect || state.animating) return;
    const square = pickSquare(event);
    if (square) state.onSelect(square.row, square.col);
}

/** לולאת הרינדור - מציירת מחדש בכל פריים. */
function animate() {
    state.clock = requestAnimationFrame(animate);
    if (state.renderer && state.scene && state.camera) {
        state.renderer.render(state.scene, state.camera);
    }
}

/**
 * מאתחל את הלוח התלת-ממדי.
 * מחזיר Promise שנמסר כאשר המודול מוכן לשימוש, או false אם לא הצליח.
 */
export async function init(container) {
    if (state.ready) return true;
    if (state.failed) return false;

    if (!container) {
        state.failed = true;
        return false;
    }

    const ok = await loadLibrary();
    if (!ok) {
        state.failed = true;
        return false;
    }

    try {
        state.container = container;
        buildScene(container);
        state.canvas.addEventListener('click', handleClick);
        window.addEventListener('resize', resize);
        updateCamera();
        animate();

        // הלוח מוכן מיד; הכלים יטענו ברקע ויופיעו כשיסתיימו
        state.ready = true;
        loadPieces().then(okPieces => {
            if (okPieces && state.currentBoard) sync(state.currentBoard);
            state.piecesLoaded = okPieces;
        });
        return true;
    } catch (error) {
        console.warn('[Board3D] אתחול נכשל, ממשיכים עם הלוח הדו-ממדי:', error);
        state.failed = true;
        return false;
    }
}

/** משחרר את משאבי ה-GPU. */
export function destroy() {
    if (state.clock) cancelAnimationFrame(state.clock);
    state.clock = null;
    if (state.canvas) {
        state.canvas.removeEventListener('click', handleClick);
        state.canvas.remove();
    }
    window.removeEventListener('resize', resize);
    if (state.renderer) state.renderer.dispose();
    state.ready = false;
    state.pieces = [];
    state.squares = [];
    state.models.clear();
}

/** מחזיר אם קבצי הכלים נטענו בהצלחה. */
export function piecesLoaded() {
    return Boolean(state.piecesLoaded);
}