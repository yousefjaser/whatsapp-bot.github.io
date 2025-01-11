require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(cookieParser());

// إعدادات CORS
app.use(cors({
    origin: process.env.BASE_URL ? `https://${process.env.BASE_URL}` : 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// تعيين الهيدرز الأمنية
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// تعيين نوع المحتوى للمسارات API فقط
app.use('/api', (req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('خطأ:', err);
    res.status(500).json({
        success: false,
        error: 'حدث خطأ في الخادم'
    });
});

// Handle 404
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            error: 'المسار غير موجود'
        });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// بدء الخادم
app.listen(PORT, '0.0.0.0', () => {
    console.log(`الخادم يعمل على المنفذ ${PORT}`);
    console.log(`عنوان الموقع: ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
}); 