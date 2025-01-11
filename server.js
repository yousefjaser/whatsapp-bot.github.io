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
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 ساعة
    },
    name: 'sessionId' // تغيير اسم الكوكي
}));

// التحقق من المصادقة لجميع المسارات المحمية
app.use('/api/devices', (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            error: 'غير مصرح بالوصول'
        });
    }
    next();
});

app.use('/api/whatsapp', (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            error: 'غير مصرح بالوصول'
        });
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

// معالجة الصفحات غير الموجودة
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'الصفحة غير موجودة'
    });
});

// معالجة الأخطاء
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: 'حدث خطأ في الخادم'
    });
});

// بدء الخادم
app.listen(port, '0.0.0.0', () => {
    console.log(`الخادم يعمل على المنفذ ${port}`);
    console.log(`عنوان الموقع: ${process.env.BASE_URL || `http://localhost:${port}`}`);
}); 