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
 *   אם ספריית Three.js או WebGL אינם זמינים, הלוח מדווח על כשל
 *   והממשק אינו מציג לוח חלופי דו-ממדי.
 * =========================================================================
 */

const PIECE_TYPES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
const COLORS = ['white', 'black'];
const KNIGHT_INWARD_ANGLE = Math.PI / 12;

// fenToBoard מחזיר קיצורי FEN (r/n/b/q/k) חוץ מ-pawn — ממפה לשמות המלאים של קבצי ה-GLB.
const PIECE_TYPE_ALIASES = { r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king', p: 'pawn' };

function normalizePieceType(type) {
    return PIECE_TYPE_ALIASES[type] || type;
}

/** גובה מבוקש לכל סוג כלי, ביחידות של ריבוע אחד. */
const TARGET_HEIGHT = {
    king: 1.2,
    queen: 1.09,
    knight: 0.83,
    bishop: 0.95,
    rook: 0.71,
    pawn: 0.59,
};

const PIECES_BASE = '/assets/pieces3d/';
const THUMBNAIL_SIZE = 128;

/** גובה משטח הסימון השקוף שמונח על גבי הלוח (לצביע משבצת). */
const OVERLAY_Y = 0.006;

/** צבעי המשבצות והסימונים. */
const LIGHT_SQUARE = 0xE8DCC8;
const DARK_SQUARE = 0x9C7B54;
const COLOR_SELECTED = 0xF2C14E;
const COLOR_LEGAL = 0x60A5FA;
const COLOR_CAPTURE = 0xEF4444;
const COLOR_LAST_MOVE = 0x4ADE80;

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
    table: null,
    raycaster: null,
    squares: [],
    pieces: [],
    models: new Map(),
    thumbnails: new Map(),
    piecesLoaded: false,
    currentBoard: null,
    selected: null,
    legalMoves: [],
    lastMove: null,
    checkSquare: null,
    flipped: false,
    animating: false,
    onSelect: null,
    clock: null,
    controls: null,
    cameraApplied: false,
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
        console.error('[Board3D] טעינת Three.js נכשלה:', error);
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
    document.body.appendChild(canvas);
    state.canvas = canvas;

    state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // רקע שקוף: צבע העמוד מה-CSS ממשיך מתחת לקנבס.
    state.renderer.setClearColor(0x000000, 0);

    state.scene = new THREE.Scene();
    state.scene.fog = new THREE.Fog(0x0b1321, 75, 150);

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

    // הסיבוב וההזזה מטופלים יחד עם בקרות הלוח כדי למנוע שני מנגנוני עכבר מתחרים.
    // OrbitControls remains for camera targeting; board zoom is disabled.
    if (state.OrbitControls) {
        const controls = new state.OrbitControls(state.camera, canvas);
        controls.target.set(0, 0, 0);
        controls.enableDamping = false;
        controls.enablePan = false;
        controls.enableZoom = false;
        controls.mouseButtons.LEFT = null;
        controls.mouseButtons.RIGHT = null;
        state.controls = controls;
    }

    buildTable();
    buildFallbackBoard();
    buildSquares();
    resize();
    return true;
}

/** יוצר משטח עץ רחב שמתחת ללוח ונע יחד עם זווית המצלמה. */
function buildTable() {
    const THREE = state.three;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('לא ניתן ליצור מרקם עץ לשולחן.');

    const base = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    base.addColorStop(0, '#67452c');
    base.addColorStop(0.5, '#8a6442');
    base.addColorStop(1, '#5d3b25');
    context.fillStyle = base;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < 8; row++) {
        const top = row * 64;
        const plank = context.createLinearGradient(0, top, 0, top + 64);
        plank.addColorStop(0, 'rgba(35, 20, 11, 0.2)');
        plank.addColorStop(0.16, 'rgba(205, 157, 102, 0.1)');
        plank.addColorStop(0.55, 'rgba(32, 18, 10, 0.08)');
        plank.addColorStop(1, 'rgba(20, 11, 7, 0.28)');
        context.fillStyle = plank;
        context.fillRect(0, top, canvas.width, 64);

        context.beginPath();
        context.moveTo(0, top + 1);
        context.lineTo(canvas.width, top + 1);
        context.strokeStyle = 'rgba(26, 14, 8, 0.42)';
        context.lineWidth = 2;
        context.stroke();

        for (let line = 0; line < 10; line++) {
            const y = top + 7 + line * 5;
            context.beginPath();
            context.moveTo(-8, y);
            context.bezierCurveTo(130, y + 5, 360, y - 4, canvas.width + 8, y + 2);
            context.strokeStyle = line % 3 === 0
                ? 'rgba(32, 17, 9, 0.2)'
                : 'rgba(235, 192, 137, 0.11)';
            context.lineWidth = line % 3 === 0 ? 2 : 1;
            context.stroke();
        }

        const seamX = 90 + ((row * 137) % 330);
        context.beginPath();
        context.moveTo(seamX, top + 2);
        context.lineTo(seamX, top + 62);
        context.strokeStyle = 'rgba(28, 15, 8, 0.38)';
        context.lineWidth = 2;
        context.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(32, 32);
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.78,
        metalness: 0,
    });
    const table = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), material);
    table.name = 'wooden-table';
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.26;
    table.receiveShadow = true;
    state.scene.add(table);
    state.table = table;
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

    const woodCanvas = document.createElement('canvas');
    woodCanvas.width = 512;
    woodCanvas.height = 128;
    const woodContext = woodCanvas.getContext('2d');
    if (!woodContext) throw new Error('לא ניתן ליצור מרקם עץ למסגרת הלוח.');
    const woodGradient = woodContext.createLinearGradient(0, 0, 0, woodCanvas.height);
    woodGradient.addColorStop(0, '#382318');
    woodGradient.addColorStop(0.28, '#79502f');
    woodGradient.addColorStop(0.52, '#54351f');
    woodGradient.addColorStop(0.76, '#815735');
    woodGradient.addColorStop(1, '#3d2619');
    woodContext.fillStyle = woodGradient;
    woodContext.fillRect(0, 0, woodCanvas.width, woodCanvas.height);
    for (let index = 0; index < 34; index++) {
        const y = index * 4 - 6;
        woodContext.beginPath();
        woodContext.moveTo(0, y);
        woodContext.bezierCurveTo(150, y + 7, 330, y - 6, 512, y + 2);
        woodContext.strokeStyle = index % 4 === 0
            ? 'rgba(29, 14, 7, 0.3)'
            : 'rgba(233, 184, 121, 0.12)';
        woodContext.lineWidth = index % 4 === 0 ? 2 : 1;
        woodContext.stroke();
    }
    const woodTexture = new THREE.CanvasTexture(woodCanvas);
    woodTexture.colorSpace = THREE.SRGBColorSpace;
    const woodMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: woodTexture,
        roughness: 0.68,
        metalness: 0,
    });
    const goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xc49a42,
        roughness: 0.34,
        metalness: 0.58,
    });
    const base = new THREE.Mesh(new THREE.BoxGeometry(9.3, 0.2, 9.3), woodMaterial);
    base.position.set(0, -0.16, 0);
    base.receiveShadow = true;
    group.add(base);

    const addTrim = (width, length, x, z, material) => {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, length), material);
        trim.position.set(x, -0.0175, z);
        trim.receiveShadow = true;
        group.add(trim);
    };
    const frameWidth = 0.52;
    const frameOffset = 4 + 0.055 + frameWidth / 2;
    addTrim(8.11, 0.055, 0, -4.0275, goldMaterial);
    addTrim(8.11, 0.055, 0, 4.0275, goldMaterial);
    addTrim(0.055, 8.11, -4.0275, 0, goldMaterial);
    addTrim(0.055, 8.11, 4.0275, 0, goldMaterial);
    addTrim(9.3, frameWidth, 0, -frameOffset, woodMaterial);
    addTrim(9.3, frameWidth, 0, frameOffset, woodMaterial);
    addTrim(frameWidth, 8.11, -frameOffset, 0, woodMaterial);
    addTrim(frameWidth, 8.11, frameOffset, 0, woodMaterial);

    const addCoordinate = (label, x, z, rotationY, rotateText = false) => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('לא ניתן ליצור סימוני קואורדינטות ללוח.');
        context.clearRect(0, 0, 128, 128);
        context.fillStyle = '#f2dfbd';
        context.font = 'bold 88px Georgia, serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.shadowColor = 'rgba(35, 19, 9, 0.8)';
        context.shadowBlur = 5;
        if (rotateText) {
            context.translate(128, 128);
            context.rotate(Math.PI);
        }
        context.fillText(label, 64, 68);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const orient = new THREE.Group();
        orient.position.set(x, 0.004, z);
        orient.rotation.y = rotationY;
        const marker = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.4), material);
        marker.rotation.x = -Math.PI / 2;
        marker.renderOrder = 2;
        orient.add(marker);
        group.add(orient);
    };

    for (let index = 0; index < 8; index++) {
        const file = String.fromCharCode(97 + index);
        const rank = String(8 - index);
        const coordinate = index - 3.5;
        addCoordinate(file, coordinate, frameOffset, Math.PI, true);
        addCoordinate(file, coordinate, -frameOffset, 0, true);
        addCoordinate(rank, -frameOffset, coordinate, Math.PI, true);
        addCoordinate(rank, frameOffset, coordinate, 0, true);
    }

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

/** מתאים את גודל הקנבס לגודל הקונטיינר. */
export function resize() {
    if (!state.renderer || !state.container) return;
    const w = window.innerWidth || state.container.clientWidth || 640;
    const h = window.innerHeight || state.container.clientHeight || 640;
    state.renderer.setSize(w, h, false);
    state.camera.aspect = w / Math.max(h, 1);
    state.camera.updateProjectionMatrix();
}

/**
 * טוען את 12 קובצי הכלים ומכין אותם לשיכפול.
 * כל קובץ נטען פעם אחת; לכל ריבוע שבו הכלי עומד נוצר clone.
 */
async function loadPieces(onProgress) {
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
    const assets = COLORS.flatMap(color => PIECE_TYPES.map(type => ({
        color,
        type,
        url: `${PIECES_BASE}${color}-${type}.glb`,
    })));
    const progress = new Map(assets.map(asset => [
        asset.url,
        { loaded: 0, total: null },
    ]));
    const reportProgress = (url, loaded, total) => {
        progress.set(url, { loaded, total });
        onProgress?.({
            loadedBytes: [...progress.values()].reduce((sum, item) => sum + item.loaded, 0),
            totalBytes: progress.values().every(item => Number.isFinite(item.total))
                ? [...progress.values()].reduce((sum, item) => sum + item.total, 0)
                : null,
        });
    };
    const results = await Promise.allSettled(assets.map(asset =>
        loadOne(loader, asset.url, (loaded, total) => reportProgress(asset.url, loaded, total))
    ));

    let loaded = 0;
    const failures = [];
    results.forEach((result, index) => {
        const { color, type, url } = assets[index];
        if (result.status === 'fulfilled' && result.value) {
            state.models.set(`${color}-${type}`, prepareModel(result.value, type));
            loaded++;
        } else {
            failures.push(url);
        }
    });

    if (loaded !== assets.length) {
        console.error(`[Board3D] נטענו ${loaded} מתוך ${assets.length} מודלים.`, failures);
        return false;
    }

    buildPieceThumbnails();
    console.info(`[Board3D] נטענו ${loaded} מודלי כלים והוכנו להצגה.`);
    return true;
}

/** טוען GLB בזרם מדיד, כך שסך הבתים מתקדם לפי נתוני ההעברה בפועל. */
async function loadOne(loader, url, onProgress) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);

    const headerTotal = Number(response.headers.get('content-length'));
    const expectedBytes = Number.isFinite(headerTotal) && headerTotal > 0 ? headerTotal : null;
    const reader = response.body?.getReader();
    let loadedBytes = 0;
    let arrayBuffer;

    if (reader) {
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loadedBytes += value.byteLength;
            onProgress(loadedBytes, expectedBytes);
        }
        arrayBuffer = await new Blob(chunks).arrayBuffer();
    } else {
        arrayBuffer = await response.arrayBuffer();
        loadedBytes = arrayBuffer.byteLength;
    }

    onProgress(loadedBytes, expectedBytes ?? loadedBytes);
    return loader.parseAsync(arrayBuffer, new URL(PIECES_BASE, location.origin).href);
}

/** מרנדר מראש תמונות ממוזערות מאותם מודלי 3D עבור משוואת הכלים שנאכלו. */
function buildPieceThumbnails() {
    const THREE = state.three;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);
    renderer.setClearColor(0x000000, 0);

    const scratchCanvas = document.createElement('canvas');
    scratchCanvas.width = THUMBNAIL_SIZE;
    scratchCanvas.height = THUMBNAIL_SIZE;
    const scratchContext = scratchCanvas.getContext('2d', { willReadFrequently: true });
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = THUMBNAIL_SIZE;
    thumbnailCanvas.height = THUMBNAIL_SIZE;
    const thumbnailContext = thumbnailCanvas.getContext('2d');
    if (!scratchContext || !thumbnailContext) {
        throw new Error('לא ניתן ליצור תמונות ממוזערות לכלי המשחק.');
    }

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);

    const camera = new THREE.OrthographicCamera(-0.72, 0.72, 0.72, -0.72, 0.1, 20);
    camera.position.set(0, 1.8, 6);
    camera.lookAt(0, 0.55, 0);

    COLORS.forEach(color => PIECE_TYPES.forEach(type => {
        const model = state.models.get(`${color}-${type}`);
        const piece = model.clone(true);
        piece.rotation.y = type === 'knight' ? Math.PI / 8 : 0;
        scene.add(piece);
        renderer.render(scene, camera);
        scratchContext.clearRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
        scratchContext.drawImage(renderer.domElement, 0, 0);
        const { data } = scratchContext.getImageData(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
        let minX = THUMBNAIL_SIZE;
        let minY = THUMBNAIL_SIZE;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < THUMBNAIL_SIZE; y++) {
            for (let x = 0; x < THUMBNAIL_SIZE; x++) {
                if (data[(y * THUMBNAIL_SIZE + x) * 4 + 3] < 16) continue;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
        if (maxX < minX || maxY < minY) {
            throw new Error(`תמונת הכלי ${color}-${type} ריקה.`);
        }

        const cropWidth = maxX - minX + 1;
        const cropHeight = maxY - minY + 1;
        const padding = Math.max(4, Math.ceil(Math.max(cropWidth, cropHeight) * 0.08));
        const scale = Math.min(
            (THUMBNAIL_SIZE - padding * 2) / cropWidth,
            (THUMBNAIL_SIZE - padding * 2) / cropHeight
        );
        const drawWidth = cropWidth * scale;
        const drawHeight = cropHeight * scale;
        thumbnailContext.clearRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
        thumbnailContext.imageSmoothingEnabled = true;
        thumbnailContext.imageSmoothingQuality = 'high';
        thumbnailContext.drawImage(
            scratchCanvas,
            minX, minY, cropWidth, cropHeight,
            (THUMBNAIL_SIZE - drawWidth) / 2,
            (THUMBNAIL_SIZE - drawHeight) / 2,
            drawWidth, drawHeight
        );
        state.thumbnails.set(`${color}-${type}`, thumbnailCanvas.toDataURL('image/png'));
        scene.remove(piece);
    }));

    renderer.dispose();
    renderer.forceContextLoss();
}

export function getPieceThumbnail(color, type) {
    return state.thumbnails.get(`${color}-${normalizePieceType(type)}`) || null;
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
            // הסוסים פונים בעיקר ליריב, עם סטייה קלה לכיוון מרכז הלוח.
            const type = normalizePieceType(cell.type);
            if (type === 'knight') {
                const inwardRotation = -Math.sign(pos.x) * KNIGHT_INWARD_ANGLE;
                mesh.rotation.y = inwardRotation + Math.PI;
            } else {
                mesh.rotation.y = cell.color === 'black' ? Math.PI : 0;
            }
            mesh.userData.row = row;
            mesh.userData.col = col;
            state.scene.add(mesh);
            state.pieces.push(mesh);
        }
    }
    paintSquares();
}

/** צוב סימוני המשבצות לפי הבחירה, המהלכים החוקיים והמהלך האחרון. */
export function setMarks({ selected, legalMoves, lastMove, checkSquare = state.checkSquare } = {}) {
    if (!state.ready) return;
    state.selected = selected || null;
    state.legalMoves = Array.isArray(legalMoves) ? legalMoves : [];
    state.lastMove = lastMove || null;
    state.checkSquare = checkSquare || null;
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
        if (state.checkSquare?.row === row && state.checkSquare?.col === col) {
            color = COLOR_CAPTURE;
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

/** מסובב את המצלמה סביב מרכז הלוח לפי גרירת העכבר. */
export function rotateBy(deltaX, deltaY) {
    if (!state.ready || !state.camera) return;
    const target = state.controls?.target || new state.three.Vector3(0, 0, 0);
    const offset = state.camera.position.clone().sub(target);
    const spherical = new state.three.Spherical().setFromVector3(offset);
    const sensitivity = Math.PI / 720;
    spherical.theta += deltaX * sensitivity;
    spherical.phi = Math.max(0.15, Math.min(Math.PI / 2 - 0.08, spherical.phi + deltaY * sensitivity));
    state.camera.position.copy(target).add(offset.setFromSpherical(spherical));
    state.camera.lookAt(target);
    if (state.controls) state.controls.update();
}

/** מזיז את נקודת המבט מעל השולחן בלי להזיז את הלוח או את ממשק המשחק. */
export function panBy(deltaX, deltaY) {
    if (!state.ready || !state.camera || !state.canvas) return;
    const target = state.controls?.target || new state.three.Vector3(0, 0, 0);
    const width = state.canvas.clientWidth;
    const height = state.canvas.clientHeight;
    if (!width || !height) return;

    state.camera.updateMatrixWorld();
    const distance = state.camera.position.distanceTo(target);
    const worldPerPixel = (2 * distance * Math.tan(state.three.MathUtils.degToRad(state.camera.fov) / 2))
        / height;
    const right = new state.three.Vector3().setFromMatrixColumn(state.camera.matrixWorld, 0);
    const up = new state.three.Vector3().setFromMatrixColumn(state.camera.matrixWorld, 1);
    const shiftX = right.multiplyScalar(-deltaX * worldPerPixel);
    const shiftY = up.multiplyScalar(deltaY * worldPerPixel);
    const boundedShiftX = limitPanShift(shiftX, target, width, height);
    const shiftedTarget = target.clone().add(boundedShiftX);
    const boundedShiftY = limitPanShift(shiftY, shiftedTarget, width, height, boundedShiftX);
    const shift = boundedShiftX.add(boundedShiftY);
    if (shift.lengthSq() < 1e-12) return;

    state.camera.position.add(shift);
    target.add(shift);
    state.camera.lookAt(target);
    if (state.controls) state.controls.update();
}

function limitPanShift(requestedShift, target, width, height, existingShift = new state.three.Vector3()) {
    const THREE = state.three;
    const candidateCamera = state.camera.clone();
    const isVisibleEnough = fraction => {
        const shift = existingShift.clone().addScaledVector(requestedShift, fraction);
        candidateCamera.position.copy(state.camera.position).add(shift);
        candidateCamera.lookAt(target.clone().add(shift));
        candidateCamera.updateMatrixWorld(true);

        const bounds = getBoardScreenBounds(width, height, candidateCamera);
        const boardWidth = bounds.maxX - bounds.minX;
        const boardHeight = bounds.maxY - bounds.minY;
        const visibleWidth = Math.min(boardWidth / 2, width);
        const visibleHeight = Math.min(boardHeight / 2, height);
        const overlapWidth = Math.max(0, Math.min(bounds.maxX, width) - Math.max(bounds.minX, 0));
        const overlapHeight = Math.max(0, Math.min(bounds.maxY, height) - Math.max(bounds.minY, 0));
        return overlapWidth >= visibleWidth - 0.5 && overlapHeight >= visibleHeight - 0.5;
    };

    if (isVisibleEnough(1)) return requestedShift.clone();

    let min = 0;
    let max = 1;
    for (let iteration = 0; iteration < 16; iteration++) {
        const middle = (min + max) / 2;
        if (isVisibleEnough(middle)) min = middle;
        else max = middle;
    }
    return requestedShift.clone().multiplyScalar(min);
}

function getBoardScreenBounds(width, height, camera = state.camera) {
    const THREE = state.three;
    const corners = [
        [-4.65, -4.65],
        [-4.65, 4.65],
        [4.65, -4.65],
        [4.65, 4.65],
    ];
    camera.updateMatrixWorld(true);
    const points = corners.map(([x, z]) => (
        new THREE.Vector3(x, 0, z).project(camera)
    ));
    return points.reduce((bounds, point) => {
        const x = ((point.x + 1) / 2) * width;
        const y = ((1 - point.y) / 2) * height;
        return {
            minX: Math.min(bounds.minX, x),
            maxX: Math.max(bounds.maxX, x),
            minY: Math.min(bounds.minY, y),
            maxY: Math.max(bounds.maxY, y),
        };
    }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

/** Keeps horizontal rotation moving with the board side under the pointer. */
export function horizontalRotationDirection(clientY) {
    if (!state.ready || !state.camera || !state.canvas) return 1;
    state.camera.updateMatrixWorld();
    const center = new state.three.Vector3(0, 0, 0).project(state.camera);
    const rect = state.canvas.getBoundingClientRect();
    const boardCenterY = rect.top + ((1 - center.y) / 2) * rect.height;
    return clientY > boardCenterY ? -1 : 1;
}

/** True only when the pointer ray lands inside one of the 64 board squares. */
export function isBoardPoint(clientX, clientY) {
    if (!state.ready || !state.canvas || !state.raycaster || !state.camera) return false;
    const rect = state.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const pointer = new state.three.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
    );
    state.camera.updateMatrixWorld();
    state.raycaster.setFromCamera(pointer, state.camera);
    return state.raycaster.intersectObjects(state.squares, false).length > 0;
}

/** True when the pointer ray hits the wooden table surface. */
export function isTablePoint(clientX, clientY) {
    if (!state.ready || !state.canvas || !state.raycaster || !state.camera || !state.table) return false;
    const rect = state.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const pointer = new state.three.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
    );
    state.camera.updateMatrixWorld();
    state.raycaster.setFromCamera(pointer, state.camera);
    return state.raycaster.intersectObject(state.table, false).length > 0;
}

function updateCamera() {
    if (!state.camera) return;
    // הלוח הגדול (עד 64rem) ממלא את המסך: מצלמה קרובה יותר ונמוכה יותר.
    const height = 6.15;
    const distance = state.flipped ? -8 : 8;
    state.camera.position.set(0, height, distance);
    if (state.controls) {
        state.controls.target.set(0, 0, 0);
        state.controls.update();
    }
    state.camera.lookAt(0, 0, 0);
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
export async function init(container, onProgress) {
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
        state.container.addEventListener('click', handleClick);
        state.container.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('resize', resize);
        updateCamera();
        state.piecesLoaded = await loadPieces(onProgress);
        if (!state.piecesLoaded) throw new Error('חלק ממודלי הכלים לא נטענו.');
        state.ready = true;
        document.body.classList.add('board3d-scene-ready');
        if (state.currentBoard) sync(state.currentBoard);
        animate();

        return true;
    } catch (error) {
        console.error('[Board3D] אתחול הלוח נכשל:', error);
        state.failed = true;
        destroy();
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
        state.canvas.remove();
    }
    document.body.classList.remove('board3d-scene-ready');
    if (state.container) {
        state.container.removeEventListener('click', handleClick);
        state.container.removeEventListener('pointerdown', handlePointerDown);
    }
    window.removeEventListener('resize', resize);
    if (state.renderer) state.renderer.dispose();
    state.ready = false;
    if (state.fallbackBoard) {
        state.scene.remove(state.fallbackBoard);
        state.fallbackBoard = null;
    }
    if (state.table) {
        state.scene.remove(state.table);
        state.table.geometry.dispose();
        state.table.material.map?.dispose();
        state.table.material.dispose();
        state.table = null;
    }
    state.pieces = [];
    state.squares = [];
    state.models.clear();
    state.thumbnails.clear();
    state.piecesLoaded = false;
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
        thumbnails: state.thumbnails.size,
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