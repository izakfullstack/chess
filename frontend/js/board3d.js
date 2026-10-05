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

// fenToBoard מחזיר קיצורי FEN (r/n/b/q/k) חוץ מ-pawn — ממפה לשמות המלאים של קבצי ה-GLB.
const PIECE_TYPE_ALIASES = { r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king', p: 'pawn' };

function normalizePieceType(type) {
    return PIECE_TYPE_ALIASES[type] || type;
}

/** גובה מבוקש לכל סוג כלי, ביחידות של ריבוע אחד. */
const TARGET_HEIGHT = {
    king: 1.02,
    queen: 0.92,
    knight: 0.70,
    bishop: 0.80,
    rook: 0.60,
    pawn: 0.50,
};

const PIECES_BASE = '/assets/pieces3d/';
const BOARD_FILE = 'board.glb';

/** גובה משטח הסימון השקוף שמונח על גבי הלוח (לצביע משבצת). */
const OVERLAY_Y = 0.006;

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
    OrbitControls: null,
    renderer: null,
    scene: null,
    camera: null,
    container: null,
    canvas: null,
    raycaster: null,
    squares: [],
    pieces: [],
    models: new Map(),
    boardModel: null,
    boardLoaded: false,
    boardWidth: 8,
    currentBoard: null,
    selected: null,
    legalMoves: [],
    lastMove: null,
    flipped: false,
    animating: false,
    onSelect: null,
    clock: null,
    controls: null,
    cameraApplied: false,
    fallbackBoard: null,
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
        // בקרת מצלמה: סיבוב וzoom סביב הלוח. אם היא לא נטענת - המצלמה נשארת קבועה.
        try {
            const controlsMod = await import('three/addons/controls/OrbitControls.js');
            state.OrbitControls = controlsMod.OrbitControls;
        } catch (error) {
            console.warn('[Board3D] בקרת המצלמה לא נטענת, ממשיכים עם מבט קבוע:', error);
        }
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

    state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // רקע שקוף: צבע העמוד מה-CSS ממשיך מתחת לקנבס.
    state.renderer.setClearColor(0x000000, 0);

    state.scene = new THREE.Scene();
    state.scene.fog = new THREE.Fog(0x0b1321, 22, 42);

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

    // בקרת מצלמה: סיבוב סביב מרכז הלוח, הזזה וזום בגלגלת - מאפשר לראות
    // את הכלים העומדים מכל כיוון. אם הספרייה לא נטענת - מבט קבוע.
    if (state.OrbitControls) {
        const controls = new state.OrbitControls(state.camera, canvas);
        controls.target.set(0, 0.4, 0);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = true;
        controls.panSpeed = 0.8;
        controls.screenSpacePanning = false;
        controls.minDistance = 7;
        controls.maxDistance = 30;
        // אין ירידה מתחת לפני הלוח ואין תצוגת-על חדה מדי.
        controls.minPolarAngle = 0.15;
        controls.maxPolarAngle = Math.PI / 2 - 0.08;
        controls.rotateSpeed = 0.75;
        controls.zoomSpeed = 0.9;
        state.controls = controls;
    }

    buildFallbackBoard();
    buildSquares();
    resize();
    return true;
}

/**
 * לוח ברירת מחדל מעוצב: מסגרת עץ + 64 משבצות.
 * משמש כאשר קובץ board.glb לא קיים. המשבצות נמוכות במקצת משכבת
 * הסימון שמעליהן ומקבלות צללים מהכלים העומדים.
 */
function buildFallbackBoard() {
    const THREE = state.three;
    const group = new THREE.Group();
    group.name = 'fallback-board';

    // מסגרת עץ סביב המשבצות.
    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(9.1, 0.35, 9.1),
        new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.75, metalness: 0 })
    );
    frame.position.y = -0.175;
    frame.receiveShadow = true;
    frame.castShadow = true;
    group.add(frame);

    // 64 משבצות בזוגיות בהירה/כהה.
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const isLight = (row + col) % 2 === 0;
            const tile = new THREE.Mesh(
                new THREE.BoxGeometry(1, 0.06, 1),
                new THREE.MeshStandardMaterial({
                    color: isLight ? LIGHT_SQUARE : DARK_SQUARE,
                    roughness: 0.55,
                    metalness: 0,
                })
            );
            const p = squarePosition(row, col);
            tile.position.set(p.x, -0.03, p.z);
            tile.receiveShadow = true;
            group.add(tile);
        }
    }

    state.scene.add(group);
    state.fallbackBoard = group;
}

/** יוצר שכבת סימון שקופה - 64 משטחים לצביע משבצת מעל הלוח. */
function buildSquares() {
    const THREE = state.three;
    state.squares = [];
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const isLight = (row + col) % 2 === 0;
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(1, 1),
                new THREE.MeshBasicMaterial({
                    color: 0xffffff, transparent: true, opacity: 0,
                    depthWrite: false, side: THREE.DoubleSide,
                })
            );
            mesh.rotation.x = -Math.PI / 2;
            const p = squarePosition(row, col);
            mesh.position.set(p.x, OVERLAY_Y, p.z);
            mesh.userData = { row, col, baseColor: isLight ? LIGHT_SQUARE : DARK_SQUARE };
            mesh.name = `square-${row}-${col}`;
            mesh.renderOrder = 1;
            state.scene.add(mesh);
            state.squares.push(mesh);
        }
    }
}

/**
 * מרכז ריבוע בקואורדינטות העולם.
 * row 0 (ריבוע 8) ב-z שלילי, row 7 (ריבוע 1) ב-z חיובי.
 */
function squarePosition(row, col) {
    return { x: col - 3.5, y: 0, z: row - 3.5 };
}

/**
 * טוען את קובץ הלוח (board.glb) שמודל ב-Fusion 360.
 *
 * הקוד מיישר את המודל אוטומטית לנקודות שהמשחק מצפה להן:
 * מרכז הלוח על (0,0,0), ופני המשבצות העליונות על y=0.
 * כך גם אם המודל מגיע במיקום או בגודל אחרים - הוא יושב נכון.
 *
 * מחזיר Promise שנמסר עם true רק אם הקובץ נטען בהצלחה.
 */
function loadBoardModel() {
    return new Promise(resolve => {
        new state.GLTFLoader().load(
            `${PIECES_BASE}${BOARD_FILE}`,
            gltf => {
                const root = gltf.scene;
                if (!root) return resolve(false);
                const THREE = state.three;
                const box = new THREE.Box3().setFromObject(root);
                const size = new THREE.Vector3();
                box.getSize(size);
                const center = new THREE.Vector3();
                box.getCenter(center);

                root.position.x -= center.x;
                root.position.z -= center.z;
                root.position.y -= box.min.y;

                root.traverse(obj => {
                    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
                });

                state.scene.add(root);
                state.boardModel = root;
                state.boardWidth = size.x || 8;
                resolve(true);
            },
            undefined,
            () => resolve(false)
        );
    });
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
    // קובצי ה-GLB דחוסים ב-Draco — חייבים מפענח, כמו ב-pieces3d.
    try {
        const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');
        loader.setDRACOLoader(dracoLoader);
    } catch (error) {
        console.warn('[Board3D] מפענח Draco לא נטען, מנסים בלי דחיסה:', error);
    }
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

    const holder = new THREE.Group();
    holder.add(gltf.scene);

    // מודלי Fusion/Blender מגיעים עם הגובה בציר Z — מסובבים ל-Y כדי שיעמדו.
    const zUp = size.z > size.y * 1.3;
    if (zUp) holder.rotation.x = -Math.PI / 2;

    const standingHeight = zUp ? size.z : size.y;
    const scale = standingHeight > 0 ? TARGET_HEIGHT[type] / standingHeight : 1;
    holder.scale.setScalar(scale);
    holder.updateMatrixWorld(true);

    // מודדים שוב אחרי הסיבוב והסקייל וממרכזים: בסיס על Y=0, מרכז ב-XZ.
    const fixed = new THREE.Box3().setFromObject(holder);
    const fixedCenter = new THREE.Vector3();
    fixed.getCenter(fixedCenter);
    holder.position.x -= fixedCenter.x;
    holder.position.z -= fixedCenter.z;
    holder.position.y -= fixed.min.y;

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
            const mesh = makePiece(cell.color, normalizePieceType(cell.type));
            if (!mesh) continue;
            const pos = squarePosition(row, col);
            mesh.position.set(pos.x, pos.y, pos.z);
            // השחור מסובב 180° כדי שיפנה ליריב
            mesh.rotation.y = cell.color === 'black' ? Math.PI : 0;
            mesh.userData.row = row;
            mesh.userData.col = col;
            state.scene.add(mesh);
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

        // השכבה שקופה: צביעה מרובה (blending) על גבי הלוח.
        // MeshBasicMaterial אין לו emissive, ולכן משתמשים רק בצבע ובשקיפות.
        const alpha = (color === baseColor) ? 0 : 0.55;
        square.material.color.setHex(color);
        square.material.opacity = alpha;
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
 * מסובב את המצלמה 180 סביב ציר Y - רק אם הכיוון באמת השתנה,
 * כדי לא לאפס סיבוב ידני שהמשתמש ביצע בין רינדורים (polling).
 */
export function setFlip(flipped) {
    if (!state.ready) return;
    const next = Boolean(flipped);
    if (state.cameraApplied && next === state.flipped) return;
    state.flipped = next;
    updateCamera();
}

/** מחזיר אם הלוח כרגע הפוך. */
export function isFlipped() {
    return state.flipped;
}

/**
 * מחזיר את המצלמה לנקודת ההתחלה של הכיוון הנוכחי.
 * משמש את כפתור "מרכז לוח".
 */
export function resetView() {
    if (!state.ready) return;
    updateCamera();
    if (state.controls) state.controls.update();
}

function updateCamera() {
    if (!state.camera) return;
    // הלוח הגדול (עד 64rem) ממלא את המסך: מצלמה קרובה יותר ונמוכה יותר.
    const height = 8.5;
    const distance = state.flipped ? -10.5 : 10.5;
    state.camera.position.set(0, height, distance);
    state.camera.lookAt(0, 0, 0);
    if (state.controls) {
        state.controls.target.set(0, 0.4, 0);
        state.controls.update();
    }
    state.cameraApplied = true;
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
    // סיבוב/גרירה של המצלמה לא אמור לבחור ריבוע: אם הלחיצה התחילה
    // הרחק ממקום השחרור - זו היתה גרירה, לא קליק.
    if (state.dragStart) {
        const dx = event.clientX - state.dragStart.x;
        const dy = event.clientY - state.dragStart.y;
        if (Math.hypot(dx, dy) > 6) return;
    }
    const square = pickSquare(event);
    if (square) state.onSelect(square.row, square.col);
}

/** שמירת נקודת הלחיצה כדי להבחין בין קליק לסיבוב מצלמה. */
function handlePointerDown(event) {
    state.dragStart = { x: event.clientX, y: event.clientY };
}

/** לולאת הרינדור - מציירת מחדש בכל פריים. */
function animate() {
    state.clock = requestAnimationFrame(animate);
    if (state.controls) state.controls.update();
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
        state.canvas.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('resize', resize);
        updateCamera();
        animate();

        // הלוח מוכן מיד. המודל מפיוז'ן והכלים נטענים ברקע ומופיעים כשיסתיימים.
        state.ready = true;

        loadBoardModel().then(okBoard => {
            state.boardLoaded = okBoard;
            if (okBoard && state.currentBoard) sync(state.currentBoard);
        });

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
    if (state.controls) {
        state.controls.dispose();
        state.controls = null;
    }
    if (state.canvas) {
        state.canvas.removeEventListener('click', handleClick);
        state.canvas.removeEventListener('pointerdown', handlePointerDown);
        state.canvas.remove();
    }
    window.removeEventListener('resize', resize);
    if (state.renderer) state.renderer.dispose();
    state.ready = false;
    if (state.boardModel) {
        state.scene.remove(state.boardModel);
        state.boardModel = null;
    }
    if (state.fallbackBoard) {
        state.scene.remove(state.fallbackBoard);
        state.fallbackBoard = null;
    }
    state.boardLoaded = false;
    state.pieces = [];
    state.squares = [];
    state.models.clear();
}

/** מחזיר אם קבצי הכלים נטענו בהצלחה. */
export function piecesLoaded() {
    return Boolean(state.piecesLoaded);
}

/**
 * ממיר מרכז ריבוע לקואורדינטות מסך (viewport) - לבדיקות אוטומטיות
 * ולכלי עתידיים. מחזיר null אם המודול לא מוכן.
 */
export function squareToScreen(row, col) {
    if (!state.ready || !state.camera || !state.canvas) return null;
    const p = squarePosition(row, col);
    const vector = new state.three.Vector3(p.x, 0.1, p.z).project(state.camera);
    const rect = state.canvas.getBoundingClientRect();
    return {
        x: rect.left + (vector.x + 1) / 2 * rect.width,
        y: rect.top + (1 - vector.y) / 2 * rect.height,
    };
}

/** מצב המודול - לבדיקות ולניפוי שגיאות. */
export function stats() {
    return {
        ready: state.ready,
        pieces: state.pieces.length,
        models: state.models.size,
        boardLoaded: Boolean(state.boardLoaded),
        fallbackBoard: Boolean(state.fallbackBoard),
        piecesLoaded: Boolean(state.piecesLoaded),
        controls: Boolean(state.controls),
        flipped: state.flipped,
        selected: state.selected ? `${state.selected.row},${state.selected.col}` : null,
        legalMarks: state.legalMoves.length,
        camera: state.camera ? {
            x: Number(state.camera.position.x.toFixed(2)),
            y: Number(state.camera.position.y.toFixed(2)),
            z: Number(state.camera.position.z.toFixed(2)),
        } : null,
    };
}