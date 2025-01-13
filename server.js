require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const firebase = require('./utils/firebase');
const logger = require('./utils/logger');
const sessionConfig = require('./utils/session').sessionConfig;

// تهيئة التطبيق
const app = express();

// إعدادات CORS
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// إعدادات الجلسة
app.use(session(sessionConfig));

// تحليل البيانات
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// تهيئة Firebase
firebase.initializeFirebase();

// تسجيل معلومات الطلب
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('طلب HTTP', {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration,
            ip: req.ip
        });
    });
    next();
});

// المسارات العامة
const publicPaths = [
    '/login.html',
    '/register.html',
    '/api-dashboard.html',
    '/docs.html',
    '/api-docs.html',
    '/css',
    '/js',
    '/images'
];

// المسارات المحمية
const protectedPaths = [
    '/home.html',
    '/send.html',
    '/profile.html'
];

// التحقق من الجلسة للمسارات المحمية
app.use((req, res, next) => {
    // تجاهل المسارات العامة
    if (publicPaths.some(path => req.path.startsWith(path))) {
        return next();
    }

    // تجاهل مسارات API العامة
    if (req.path.startsWith('/api/auth/') || req.path.startsWith('/api/v1/')) {
        return next();
    }

    // التحقق من وجود جلسة صالحة
    if (!req.session.userId) {
        if (protectedPaths.some(path => req.path === path)) {
            return res.redirect('/login.html');
        }
        if (req.path.startsWith('/api/')) {
            return res.json({
                success: false,
                error: 'يرجى تسجيل الدخول أولاً'
            });
        }
    }

    next();
});

// الملفات الثابتة
app.use(express.static('public', {
    index: false,
    extensions: ['html', 'htm'],
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// توجيه الصفحة الرئيسية
app.get('/', (req, res) => {
    res.redirect(req.session.userId ? '/home.html' : '/login.html');
});

// المسارات
app.use('/api/auth', require('./routes/auth'));
app.use('/api/devices', require('./routes/devices'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api', require('./routes/api'));

// معالجة الأخطاء
app.use((err, req, res, next) => {
    logger.error('خطأ في الخادم:', err);
    res.status(500).json({
        success: false,
        error: 'حدث خطأ في الخادم'
    });
});

// تشغيل الخادم
const port = process.env.PORT || 3001;
app.listen(port, () => {
    logger.info(`تم تشغيل الخادم على المنفذ ${port}`);
}); 