const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// تكوين حد معدل المحاولات للتسجيل
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 5 // الحد الأقصى 5 محاولات
});

// التحقق من التوكن
async function verifyToken(token) {
    try {
        const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
        const userRecord = await admin.auth().getUser(decodedToken.uid);
        return userRecord;
    } catch (error) {
        console.error('خطأ في التحقق من التوكن:', error);
        return null;
    }
}

// التحقق من حالة المصادقة
router.get('/check', async (req, res) => {
    try {
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'غير مصرح' });
        }

        const user = await verifyToken(token);
        if (!user) {
            return res.status(401).json({ error: 'توكن غير صالح' });
        }

        res.json({ 
            email: user.email,
            displayName: user.displayName
        });
    } catch (error) {
        console.error('خطأ في التحقق من المصادقة:', error);
        res.status(500).json({ error: 'خطأ في التحقق من المصادقة' });
    }
});

// تسجيل الدخول
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
        }

        const userRecord = await admin.auth().getUserByEmail(email);
        
        // إنشاء توكن
        const token = jwt.sign(
            { uid: userRecord.uid },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // حفظ التوكن في الكوكيز
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 24 ساعة
        });

        res.json({ 
            message: 'تم تسجيل الدخول بنجاح',
            user: {
                email: userRecord.email,
                displayName: userRecord.displayName
            }
        });
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(401).json({ error: 'فشل تسجيل الدخول' });
    }
});

// تسجيل الخروج
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'تم تسجيل الخروج بنجاح' });
});

module.exports = router; 