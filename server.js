require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const dotenv = require('dotenv');

// تحميل متغيرات البيئة
dotenv.config();

// تهيئة Firebase Admin
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({
    credential: admin.credential.cert(firebaseConfig)
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
app.use(session({
    secret: process.env.JWT_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    proxy: true, // إضافة دعم للبروكسي
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'none', // تحديث للعمل مع Railway
        maxAge: 24 * 60 * 60 * 1000 // 24 ساعة
    }
}));

// تضمين المسارات
const authRoutes = require('./routes/auth');
const devicesRoutes = require('./routes/devices');
const whatsappRoutes = require('./routes/whatsapp');

app.use('/api/auth', authRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// تقديم الملفات الثابتة
app.use(express.static('public'));

// معالجة الصفحات غير الموجودة
app.use((req, res) => {
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'public', '404.html'));
        return;
    }
    res.status(404).json({ error: 'الصفحة غير موجودة' });
});

// معالجة الأخطاء
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'حدث خطأ في الخادم' });
});

// بدء الخادم
app.listen(port, '0.0.0.0', () => {
    console.log(`الخادم يعمل على المنفذ ${port}`);
    console.log(`عنوان الموقع: ${process.env.BASE_URL || `http://localhost:${port}`}`);
}); 