const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// إعداد rate limiter لتسجيل الدخول
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 5, // 5 محاولات كحد أقصى
    message: { message: 'تم تجاوز عدد محاولات تسجيل الدخول المسموح بها. الرجاء المحاولة لاحقاً.' },
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true
});

// التحقق من التوكن
async function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userRecord = await admin.auth().getUser(decoded.uid);
        return { success: true, user: userRecord };
    } catch (error) {
        console.error('خطأ في التحقق من التوكن:', error);
        return { success: false, error: error.message };
    }
}

// التحقق من حالة المصادقة
router.get('/check', async (req, res) => {
    try {
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ message: 'لم يتم العثور على توكن المصادقة' });
        }

        const result = await verifyToken(token);
        if (result.success) {
            res.json({ 
                isAuthenticated: true, 
                user: {
                    uid: result.user.uid,
                    email: result.user.email,
                    displayName: result.user.displayName
                }
            });
        } else {
            res.status(401).json({ message: 'جلسة غير صالحة' });
        }
    } catch (error) {
        console.error('خطأ في التحقق من المصادقة:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم' });
    }
});

// تسجيل الدخول
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ message: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
        }

        // البحث عن المستخدم في Firebase
        const userRecord = await admin.auth().getUserByEmail(email);
        
        // إنشاء توكن JWT
        const token = jwt.sign(
            { 
                uid: userRecord.uid,
                email: userRecord.email
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // إرسال التوكن في الكوكيز
        res.cookie('token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 24 * 60 * 60 * 1000 // 24 ساعة
        });

        // إرسال استجابة النجاح
        res.json({ 
            success: true,
            user: {
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName
            }
        });

    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(401).json({ message: 'فشل تسجيل الدخول. تحقق من بيانات الدخول.' });
    }
});

// تسجيل الخروج
router.post('/logout', (req, res) => {
    try {
        res.clearCookie('token', {
            httpOnly: true,
            secure: true,
            sameSite: 'none'
        });
        res.json({ message: 'تم تسجيل الخروج بنجاح' });
    } catch (error) {
        console.error('خطأ في تسجيل الخروج:', error);
        res.status(500).json({ message: 'حدث خطأ أثناء تسجيل الخروج' });
    }
});

module.exports = router; 