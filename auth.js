require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const router = express.Router();
const rateLimit = require('express-rate-limit');

// تهيئة Firebase Admin
try {
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    admin.initializeApp({
        credential: admin.credential.cert(firebaseConfig)
    });
    console.log('تم تهيئة Firebase Admin بنجاح');
} catch (error) {
    console.error('خطأ في تهيئة Firebase Admin:', error);
}

// إعداد rate limiter
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'تم تجاوز عدد محاولات تسجيل الدخول المسموح بها. الرجاء المحاولة لاحقاً.' }
});

// التحقق من التوكن وتجديده إذا لزم الأمر
async function verifyAndRefreshToken(token) {
    try {
        console.log('جاري التحقق من التوكن:', token);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('تم فك تشفير التوكن:', decoded);
        
        // التحقق من وجود المستخدم في Firebase
        const userRecord = await admin.auth().getUser(decoded.uid);
        console.log('تم العثور على المستخدم:', userRecord.uid);
        
        return {
            success: true,
            user: userRecord,
            token: token
        };
    } catch (error) {
        console.error('خطأ في التحقق من التوكن:', error);
        
        if (error.name === 'TokenExpiredError') {
            try {
                const decoded = jwt.decode(token);
                const userRecord = await admin.auth().getUser(decoded.uid);
                
                // إنشاء توكن جديد
                const newToken = jwt.sign(
                    { uid: userRecord.uid, email: userRecord.email },
                    process.env.JWT_SECRET,
                    { expiresIn: '1h' }
                );
                
                console.log('تم إنشاء توكن جديد');
                return {
                    success: true,
                    user: userRecord,
                    token: newToken
                };
            } catch (refreshError) {
                console.error('خطأ في تجديد التوكن:', refreshError);
                throw new Error('فشل في تجديد الجلسة');
            }
        }
        throw error;
    }
}

// التحقق من حالة المصادقة
router.get('/check', async (req, res) => {
    try {
        const token = req.cookies.token;
        
        if (!token) {
            return res.json({ isAuthenticated: false });
        }
        
        const result = await verifyAndRefreshToken(token);
        
        if (result.token !== token) {
            res.cookie('token', result.token, {
                httpOnly: true,
                secure: true,
                sameSite: 'strict',
                maxAge: 3600000
            });
        }
        
        res.json({ 
            isAuthenticated: true,
            user: {
                email: result.user.email
            }
        });
    } catch (error) {
        console.error('خطأ في التحقق من المصادقة:', error);
        res.json({ isAuthenticated: false });
    }
});

// تسجيل الدخول
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'يجب إدخال البريد الإلكتروني وكلمة المرور'
            });
        }
        
        console.log('محاولة تسجيل دخول للمستخدم:', email);
        
        // البحث عن المستخدم في Firebase
        const userRecord = await admin.auth().getUserByEmail(email);
        console.log('تم العثور على المستخدم:', userRecord.uid);
        
        // إنشاء توكن
        const token = jwt.sign(
            { uid: userRecord.uid, email: userRecord.email },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        
        // حفظ التوكن في الكوكيز
        res.cookie('token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 3600000
        });
        
        res.json({
            success: true,
            user: {
                email: userRecord.email
            }
        });
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(401).json({
            success: false,
            error: 'فشل في تسجيل الدخول. تأكد من صحة البيانات المدخلة.'
        });
    }
});

// تسجيل الخروج
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

module.exports = router; 