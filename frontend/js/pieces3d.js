/**
 * pieces3d.js - אפיית ספרייטים תלת-ממדיים עבור לוח ה-2D.
 *
 * מודלי ה-GLB (ב-assets/pieces3d) נטענים פעם אחת, כל אחד מהם מרנדר
 * למצלמה משותפת ל-PNG עם רקע שקוף, והתוצאה נשמרת כ-dataURL.
 * רק תמונת הכלי מוחלפת בלוח הקיים; הדגשות וקליקים לא נוגעים.
 *
 * אם משהו נכשל (אין אינטרנט, אין WebGL, קובץ חסר) - הפונקציה מחזירה
 * null בלי לזרוק, והממשק ממשיך להשתמש ב-SVG הוותיק.
 */

const TYPES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
const COLORS = ['white', 'black'];

// פרופורציות גובה - המלך הגבוה ביותר, החייל הנמוך ביותר (כמו ב-board3d)
const TARGET_HEIGHT = {
    king: 1.02,
    queen: 0.92,
    knight: 0.70,
    bishop: 0.80,
    rook: 0.60,
    pawn: 0.50
};

const SPRITE_SIZE = 320;
const ASSET_BASE = '/assets/pieces3d/';

let cachedSprites = null;

/**
 * החזרת ספרייט מוכן (dataURL) עבור כלי, או null אם עדיין אין.
 */
export function getSprite(color, type) {
    if (!cachedSprites) return null;
    return cachedSprites[`${color}-${type}`] || null;
}

export function isReady() {
    return Boolean(cachedSprites);
}

/**
 * טוען את כל 12 המודלים, מרנדר כל אחד מהם פעם אחת,
 * ומחזיר מיפוי 'white-king' -> dataURL. נכשל - מחזיר null (בלי לזרוק).
 */
export async function bakeSprites() {
    if (cachedSprites) return cachedSprites;

    let renderer = null;
    try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');

        const canvas = document.createElement('canvas');
        canvas.width = SPRITE_SIZE;
        canvas.height = SPRITE_SIZE;
        renderer = new THREE.WebGLRenderer({
            canvas,
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true
        });
        renderer.setPixelRatio(1);
        renderer.setSize(SPRITE_SIZE, SPRITE_SIZE, false);
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const scene = new THREE.Scene();

        // סביבת חדר עדינה (בלי renderer - עוצמה נמוכה) לחומרים מבריקים,
        // ועוד תאורת עבודה. המטרה: השחורים יישארו כהים עם הדגשות עדינות.
        try {
            const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
            const pmrem = new THREE.PMREMGenerator(renderer);
            scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
            pmrem.dispose();
        } catch (environmentError) {
            console.info('[pieces3d] בלי environment - ממשיכים בתאורה בלבד');
        }

        scene.add(new THREE.AmbientLight(0xffffff, 0.35));
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
        keyLight.position.set(2.5, 5, 4);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0xfff3e0, 0.3);
        fillLight.position.set(-3, 2.5, -2);
        scene.add(fillLight);

        // מצלמה אחת לכל 12 הכלים - שומרת על היחסים האמיתיים ביניהם.
        // מבט קדמי קל (16 מעלות) שמדגיש נפח בלי לאבד את הפרופיל של הכלי.
        const camera = new THREE.PerspectiveCamera(18, 1, 0.1, 50);
        const elevation = (16 * Math.PI) / 180;
        const distance = 3.8;
        camera.position.set(0, 0.5 + distance * Math.sin(elevation), distance * Math.cos(elevation));
        camera.lookAt(0, 0.5, 0);

        // קובצי ה-GLB דחוסים ב-Draco - חייבים מפענח (מאותו CDN כמו three)
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');
        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);
        const sprites = {};

        for (const color of COLORS) {
            for (const type of TYPES) {
                const gltf = await loader.loadAsync(`${ASSET_BASE}${color}-${type}.glb`);
                const model = gltf.scene;
                normalizeModel(model, THREE, TARGET_HEIGHT[type]);
                scene.add(model);
                renderer.render(scene, camera);
                sprites[`${color}-${type}`] = canvas.toDataURL('image/png');
                scene.remove(model);
                disposeObject(model);
            }
        }

        dracoLoader.dispose();

        cachedSprites = sprites;
        return sprites;
    } catch (error) {
        console.info('[pieces3d] אפיית ספרייטים נכשלה - ממשיכים ב-SVG הוותיק:', error);
        return null;
    } finally {
        if (renderer) {
            renderer.dispose();
            // משחרר את הקשר עם כרטיס המסך - התמונות כבר נשמרו כ-dataURL
            try { renderer.forceContextLoss(); } catch (contextError) { /* אין מה לעשות */ }
        }
    }
}

/**
 * מנרמל מודל: גובה יעד, בסיס על y=0 ומרכוז בציר x/z - כמו ב-board3d.
 */
function normalizeModel(model, THREE, targetHeight) {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 0) model.scale.setScalar(targetHeight / size.y);

    const scaledBox = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    scaledBox.getCenter(center);
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= scaledBox.min.y;
}

/**
 * שחרור גיאומטריות/חומרים/טקסטורות אחרי הרינדור.
 */
function disposeObject(root) {
    root.traverse(node => {
        if (node.geometry) node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.filter(Boolean).forEach(material => {
            Object.values(material).forEach(value => {
                if (value && value.isTexture) value.dispose();
            });
            material.dispose();
        });
    });
}
