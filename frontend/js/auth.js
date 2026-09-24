/**
 * מודול אימות - מטפל ברישום, כניסה וניהול משתמש
 * 
 * מושג בינה מלאכותית #5: ניהול מצב
 * 
 * בדיוק כמו רשתות נוירונים שומרות מצב בין השכבות,
 * יישומי אינטרנט צריכים לנהל מצב משתמש.
 * מודול זה מטפל ב:
 * - מצב אימות משתמש
 * - אחסון טוקן/מושב
 * - שחזור אוטומטי של מצב בטעינת עמוד
 */

// נתוני מושב משתמש נוכחי
let currentUser = null;
let authMode = 'login';

const auth = {
    get currentUser() {
        return currentUser;
    },
    set currentUser(value) {
        currentUser = value;
    },
    initAuth,
    setupAuthEvents,
    handleAuthSubmit,
    registerUser,
    loginUser,
    setAuthMode,
    handleLogout,
    updateUIForUser,
    requireAuth
};

window.auth = auth;

/**
 * אתחול מערכת האימות
 */
function initAuth() {
    // בדיקה אם המשתמש כבר מחובר (מאוחסן ב-localStorage)
    const savedUser = localStorage.getItem('chess_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        updateUIForUser();
    }

    // הגדרת מאזיני אירועים
    setupAuthEvents();
}

/**
 * הגדרת כל מאזיני האירועים הקשורים לאימות
 */
function setupAuthEvents() {
    setupAuthSwitchLabel();
    // כפתור כניסה
    const loginBtn = document.getElementById('login-open');
    if (loginBtn) {
        loginBtn.addEventListener('click', () => setAuthMode('login'));
    }

    // כפתור רישום
    const registerBtn = document.getElementById('register-open');
    if (registerBtn) {
        registerBtn.addEventListener('click', () => {
            setAuthMode('register');
        });
    }

    // כפתורים מהדף הבית
    const homeRegister = document.getElementById('home-register');
    if (homeRegister) {
        homeRegister.addEventListener('click', () => {
            setAuthMode('register');
        });
    }

    const homeLogin = document.getElementById('home-login');
    if (homeLogin) {
        homeLogin.addEventListener('click', () => {
            setAuthMode('login');
        });
    }

    const registerAccountLogin = document.getElementById('register-account-login');
    if (registerAccountLogin) registerAccountLogin.addEventListener('click', () => setAuthMode('login'));

    const loginAccountRegister = document.getElementById('login-account-register');
    if (loginAccountRegister) loginAccountRegister.addEventListener('click', () => setAuthMode('register'));

    // שליחת טופס אימות
    const authForm = document.getElementById('auth-form');
    if (authForm) {
        authForm.addEventListener('submit', handleAuthSubmit);
    }

    // כפתור יציאה
    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    const profileButton = document.getElementById('profile-open');
    if (profileButton) {
        profileButton.addEventListener('click', (event) => {
            event.stopPropagation();
            document.getElementById('profile-menu').classList.toggle('hidden');
        });
    }

    document.getElementById('profile-history')?.addEventListener('click', () => {
        if (currentUser && typeof openPlayerHistory === 'function') openPlayerHistory(currentUser.accountNumber);
        document.getElementById('profile-menu').classList.add('hidden');
    });

    document.addEventListener('click', (event) => {
        const profileMenu = document.getElementById('profile-menu');
        const profileButton = document.getElementById('profile-open');
        if (profileMenu && profileButton && !profileMenu.contains(event.target) && !profileButton.contains(event.target)) {
            profileMenu.classList.add('hidden');
        }
    });

    const authSwitch = document.getElementById('auth-switch');
    if (authSwitch) authSwitch.addEventListener('click', () => setAuthMode(authMode === 'register' ? 'login' : 'register'));

    document.getElementById('admin-login-form')?.addEventListener('submit', handleAdminLogin);
}

/**
 * טיפול בהגשת טופס אימות (רישום או כניסה)
 */
function handleAuthSubmit(e) {
    e.preventDefault();

    const accountNumber = document.getElementById('account-number').value.trim();
    const password = document.getElementById('password').value;
    const authMessage = document.getElementById('auth-message');
    const authSubmit = document.getElementById('auth-submit');

    authSubmit.disabled = true;
    authMessage.textContent = '';
    authMessage.className = 'form-message';

    if (authMode === 'register') {
        const validationError = validateRegistrationForm(e.currentTarget);
        if (validationError) {
            authMessage.textContent = validationError;
            authMessage.className = 'form-message error';
            authSubmit.disabled = false;
            return;
        }
        registerUser(new FormData(e.currentTarget));
    } else {
        if (!/^\d{6}$/.test(accountNumber)) {
            authMessage.textContent = 'שם המשתמש חייב להיות בדיוק 6 ספרות';
            authMessage.className = 'form-message error';
            authSubmit.disabled = false;
            return;
        }
        if (!password) {
            authMessage.textContent = 'יש להזין סיסמה';
            authMessage.className = 'form-message error';
            authSubmit.disabled = false;
            return;
        }
        loginUser(accountNumber, password);
    }
}

function setAuthMode(mode) {
    authMode = mode;
    showScreen('auth');

    const isRegister = mode === 'register';
    document.getElementById('auth-title').textContent = isRegister ? 'רישום' : 'התחברות';
    document.getElementById('auth-description').textContent = isRegister
        ? 'מלא את הפרטים ליצירת חשבון'
        : 'הזן את שם המשתמש והסיסמה שלך';
    document.getElementById('registration-fields').classList.toggle('hidden', !isRegister);
    document.getElementById('login-fields').classList.toggle('hidden', isRegister);
    document.getElementById('account-number').required = !isRegister;
    document.getElementById('password').required = true;
    document.querySelectorAll('#registration-fields input').forEach((input) => {
        input.required = isRegister;
    });
    document.getElementById('privacy-notice').classList.toggle('hidden', !isRegister);
    document.getElementById('auth-submit').textContent = isRegister ? 'הרשמה' : 'התחבר';
    document.getElementById('password').autocomplete = isRegister ? 'new-password' : 'current-password';
    document.getElementById('auth-form').reset();
    document.getElementById('auth-message').textContent = '';
    document.getElementById('auth-message').className = 'form-message';
    document.getElementById('register-account-switch').classList.toggle('hidden', !isRegister);
    document.getElementById('login-account-switch').classList.toggle('hidden', isRegister);
    const authSwitch = document.getElementById('auth-switch');
    if (authSwitch) authSwitch.textContent = isRegister ? 'כבר יש לי חשבון - כנס' : 'אין לך חשבון - הירשם';
}

function handleAdminLogin(event) {
    event.preventDefault();
    fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: document.getElementById('admin-username').value.trim(),
            password: document.getElementById('admin-password').value
        })
    }).then(response => response.json()).then(data => {
        if (data.error) throw new Error(data.error);
        localStorage.setItem('admin_token', data.token);
        localStorage.setItem('admin_username', data.username);
        // עדכון שם המנהל והאותיות בסרגל ובפרופיל
        if (typeof applyAdminIdentity === 'function') applyAdminIdentity(data.username);
        const message = document.getElementById('admin-login-message');
        message.textContent = '';
        message.className = 'form-message';
        showScreen('admin');
        loadAdminAnalytics();
    }).catch(error => {
        const message = document.getElementById('admin-login-message');
        message.textContent = error.message;
        message.className = 'form-message error';
    });
}

/**
 * רישום משתמש חדש
 */
function registerUser(formData) {
    const payload = Object.fromEntries(formData.entries());
    fetch('/api/users/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(async response => {
        const data = await response.json();
        if (!response.ok && !data.error) {
            throw new Error('Registration request failed');
        }
        return data;
    })
    .then(data => {
        if (data.error) {
            document.getElementById('auth-message').textContent = data.error;
            document.getElementById('auth-message').className = 'form-message error';
            document.getElementById('auth-submit').disabled = false;
            return;
        }

        const authMessage = document.getElementById('auth-message');
        authMessage.textContent = data.emailSent
            ? 'הרישום הצליח, נשלח אליך מייל לאימות חשבון'
            : 'הרישום הצליח, אך המייל לא נשלח. יש לבדוק את הגדרות הדואר';
        authMessage.className = 'form-message success';
        document.getElementById('auth-form').reset();
        document.getElementById('auth-submit').disabled = false;
        setTimeout(() => showScreen('home'), 2000);
    })
    .catch(error => {
        console.error('שגיאה ברישום:', error);
        document.getElementById('auth-message').textContent = 'הרשמה נכשלה. אנא נסה שוב.';
        document.getElementById('auth-message').className = 'form-message error';
        document.getElementById('auth-submit').disabled = false;
    });
}

/**
 * כניסה עם מספר חשבון
 */
function loginUser(accountNumber, password) {
    fetch('/api/users/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ accountNumber, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            document.getElementById('auth-message').textContent = data.error;
            document.getElementById('auth-message').className = 'form-message error';
            document.getElementById('auth-submit').disabled = false;
            return;
        }

        // כניסה הצליחה
        currentUser = {
            id: data.id,
            accountNumber: data.accountNumber,
            fullName: data.fullName,
            showFullName: data.showFullName === true,
            rating: data.rating,
            gamesPlayed: data.gamesPlayed,
            wins: data.wins,
            losses: data.losses
        };

        // שמירה ב-localStorage
        localStorage.setItem('chess_user', JSON.stringify(currentUser));

        if (typeof trackAnalyticsEvent === 'function') {
            trackAnalyticsEvent('login', '/auth', data.accountNumber);
        }

        // עדכון ממשק
        updateUIForUser();

        // הצגת לוח בקרה
        showScreen('home');

        // ניקוי הטופס
        document.getElementById('auth-form').reset();
        document.getElementById('auth-message').textContent = '';
        document.getElementById('auth-message').className = 'form-message';
    })
    .catch(error => {
        console.error('שגיאה בכניסה:', error);
        document.getElementById('auth-message').textContent = 'כניסה נכשלה. אנא נסה שוב.';
        document.getElementById('auth-message').className = 'form-message error';
        document.getElementById('auth-submit').disabled = false;
    });
}

/**
 * טיפול ביציאה של משתמש
 */
function handleLogout() {
    // אם השחקן באמצע משחק פעיל — תחילה אזהרת כניעה, ורק לאחר אישור מפנים
    if (typeof shouldWarnBeforeLeavingGame === 'function' && shouldWarnBeforeLeavingGame('home')) {
        pendingLeaveScreen = '__logout__';
        document.getElementById('leave-game-dialog').classList.remove('hidden');
        return;
    }
    currentUser = null;
    localStorage.removeItem('chess_user');
    updateUIForUser();
    showScreen('home');
}

/**
 * עדכון אלמנטים בממשק בהתאם למצב האימות
 */
function updateUIForUser() {
    const authStatus = document.getElementById('auth-status');
    const loginBtn = document.getElementById('login-open');
    const registerBtn = document.getElementById('register-open');
    const logoutBtn = document.getElementById('logout');

    if (currentUser) {
        // משתמש מחובר
        authStatus.textContent = `חשבון: ${currentUser.accountNumber}`;
        authStatus.style.color = 'var(--success)';
        document.querySelector('.secondary-row')?.classList.add('hidden');
        loginBtn.classList.add('hidden');
        registerBtn.classList.add('hidden');
        document.getElementById('connected-account').classList.remove('hidden');
        document.getElementById('profile-initials').textContent = String(currentUser.accountNumber).slice(0, 2);
        document.getElementById('profile-menu-rating').textContent = currentUser.rating || 1200;
        document.getElementById('profile-menu-games').textContent = currentUser.gamesPlayed || 0;
        document.getElementById('profile-menu-wins').textContent = currentUser.wins || 0;
        document.getElementById('profile-menu-losses').textContent = currentUser.losses || 0;
    } else {
        // משתמש לא מחובר
        authStatus.textContent = 'לא מחובר';
        authStatus.style.color = 'var(--text-secondary)';
        document.querySelector('.secondary-row')?.classList.remove('hidden');
        loginBtn.classList.remove('hidden');
        registerBtn.classList.remove('hidden');
        document.getElementById('connected-account').classList.add('hidden');
        document.getElementById('profile-menu').classList.add('hidden');
    }
}

/**
 * בדיקה אם משתמש מאומת
 */
function requireAuth(message = 'יש להתחבר למערכת כדי להמשיך') {
    if (!currentUser) {
        setAuthMode('login');
        const authMessage = document.getElementById('auth-message');
        if (authMessage) {
            authMessage.textContent = message;
            authMessage.className = 'form-message error';
        }
        return false;
    }
    return true;
}

function validateRegistrationForm(form) {
    const formData = new FormData(form);
    const firstName = String(formData.get('firstName') || '').trim();
    const lastName = String(formData.get('lastName') || '').trim();
    const idNumber = String(formData.get('idNumber') || '').replace(/[\s-]/g, '');
    const dateOfBirth = String(formData.get('dateOfBirth') || '');
    const city = String(formData.get('city') || '').trim();
    const phone = String(formData.get('phone') || '').replace(/[\s-]/g, '');
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');
    const namePattern = /^[\p{L}][\p{L}\s'-]{1,39}$/u;

    if (!namePattern.test(firstName)) return 'יש להזין שם פרטי עם לפחות 2 אותיות';
    if (!/^\d{9}$/.test(idNumber) || /^([0-9])\1{8}$/.test(idNumber)) return 'מספר תעודת הזהות חייב להכיל 9 ספרות תקינות';
    if (!namePattern.test(lastName)) return 'יש להזין שם משפחה עם לפחות 2 אותיות';
    if (!dateOfBirth || new Date(`${dateOfBirth}T00:00:00`) > new Date()) return 'יש להזין תאריך לידה תקין';
    if (!/^[\p{L}\s'-]{2,50}$/u.test(city)) return 'יש להזין עיר מגורים תקינה';
    if (!/^05\d{8}$/.test(phone)) return 'מספר הטלפון חייב להיות נייד ישראלי בן 10 ספרות';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'יש להזין כתובת מייל תקינה';
    if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return 'הסיסמה חייבת להכיל 8-128 תווים, לפחות אות אחת ולפחות ספרה אחת';
    }

    return '';
}

function setupAuthSwitchLabel() {
    const authSwitch = document.getElementById('auth-switch');
    if (authSwitch) authSwitch.textContent = authMode === 'register' ? 'כבר יש לי חשבון - כנס' : 'אין לך חשבון - הירשם';
}