require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');

// تهيئة Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

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
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 ساعة
    },
    name: 'sessionId'
}));

// التحقق من المصادقة لجميع المسارات المحمية
const protectedPaths = [
    '/home.html',
    '/send.html',
    '/docs.html',
    '/api.html',
    '/api/devices',
    '/api/whatsapp'
];

app.use(protectedPaths, (req, res, next) => {
    if (!req.session || !req.session.userId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({
                success: false,
                error: 'غير مصرح بالوصول'
            });
        }
        return res.redirect('/login.html');
    }
    next();
});

// تضمين المسارات
const authRoutes = require('./routes/auth');
const devicesRoutes = require('./routes/devices');
const whatsappRoutes = require('./routes/whatsapp');
const apiRoutes = require('./routes/api');

app.use('/api/auth', authRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/v1', apiRoutes);

// تقديم الملفات الثابتة
app.use(express.static('public'));

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
    if (req.path.startsWith('/api/')) {
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
    
    if (req.path.startsWith('/api/')) {
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في الخادم'
        });
    }
    
    res.status(500).sendFile(path.join(__dirname, 'public', '500.html'));
});

// بدء الخادم
app.listen(port, '0.0.0.0', () => {
    console.log(`الخادم يعمل على المنفذ ${port}`);
    console.log(`عنوان الموقع: ${process.env.BASE_URL || `http://localhost:${port}`}`);
}); 