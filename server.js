require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');

// تهيئة Firebase Admin
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('تم الاتصال بـ Firebase بنجاح');
} catch (error) {
    console.error('خطأ في الاتصال بـ Firebase:', error);
    process.exit(1);
}

const app = express();
const port = process.env.PORT || 3001;

// إعداد trust proxy لدعم Railway
app.set('trust proxy', 1);

// إعداد CORS
app.use(cors({
    origin: process.env.BASE_URL || 'http://localhost:3001',
    credentials: true
}));

// الوسائط
app.use(express.json());
app.use(cookieParser());

// إعداد الجلسات
const sessionSecret = process.env.SESSION_SECRET || '20gkhCs61BZKI6vUO1hxlC2ydYS2';
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    },
    name: 'sessionId',
    proxy: true
}));

// تضمين المسارات
const authRoutes = require('./routes/auth');
const devicesRoutes = require('./routes/devices');
const whatsappRoutes = require('./routes/whatsapp');
const apiRoutes = require('./routes/api');
const { validateSession } = require('./middleware/auth');

// المسارات العامة
app.use('/api/auth', authRoutes);
app.use('/api/v1', apiRoutes);

// المسارات المحمية
const protectedFiles = [
    '/home.html',
    '/send.html',
    '/profile.html'
];

// middleware للتحقق من المسارات المحمية
app.use((req, res, next) => {
    if (protectedFiles.includes(req.path)) {
        return validateSession(req, res, next);
    }
    next();
});

// تكوين المسارات الثابتة
app.use(express.static('public', {
    index: false,
    extensions: ['html'],
    setHeaders: (res, path, stat) => {
        if (path.endsWith('.html')) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        }
    }
}));

// مسارات API المحمية
app.use('/api/devices', validateSession, devicesRoutes);
app.use('/api/whatsapp', validateSession, whatsappRoutes);

// التوجيه الرئيسي
app.get('/', (req, res) => {
    if (req.session && req.session.userId) {
        res.redirect('/home.html');
    } else {
        res.redirect('/welcome.html');
    }
});

// معالجة الصفحات غير الموجودة
app.use((req, res) => {
    if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            error: 'المسار غير موجود'
        });
    }
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// معالجة الأخطاء
app.use((err, req, res, next) => {
    console.error('خطأ:', err);

    if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(500).json({
            success: false,
            error: err.message || 'حدث خطأ في الخادم'
        });
    }
    
    res.status(500).sendFile(path.join(__dirname, 'public', '500.html'));
});

// إضافة معالجة الأخطاء للجلسات
app.use((err, req, res, next) => {
    if (err.name === 'SessionError') {
        console.error('خطأ في الجلسة:', err);
        return res.redirect('/login.html');
    }
    next(err);
});

// بدء الخادم
app.listen(port, '0.0.0.0', () => {
    console.log(`الخادم يعمل على المنفذ ${port}`);
    console.log(`عنوان الموقع: ${process.env.BASE_URL || `http://localhost:${port}`}`);
    console.log('حالة البيئة:', process.env.NODE_ENV);
    console.log('تم تهيئة الجلسات بنجاح');
}); 