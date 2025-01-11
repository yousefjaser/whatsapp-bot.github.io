require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const router = express.Router();
const rateLimit = require('express-rate-limit');

// التحقق من تهيئة Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const auth = admin.auth();
const db = admin.firestore();

// دالة مساعدة للتحقق من التوكن
async function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userRecord = await auth.getUser(decoded.uid);
        return { valid: true, user: userRecord };
    } catch (error) {
        console.error('خطأ في التحقق من التوكن:', error);
        return { valid: false, error: error.message };
    }
}

// حماية من محاولات تسجيل الدخول المتكررة
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { 
        success: false,
        error: 'تم تجاوز عدد محاولات تسجيل الدخول المسموح بها. الرجاء المحاولة بعد 15 دقيقة.'
    }
});

// التسجيل
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        console.log('محاولة تسجيل مستخدم جديد:', email);

        const userRecord = await auth.createUser({
            email,
            password,
            displayName: name,
            emailVerified: false
        });
        console.log('تم إنشاء المستخدم في Firebase:', userRecord.uid);

        await db.collection('users').doc(userRecord.uid).set({
            name,
            email,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('تم إنشاء وثيقة المستخدم في Firestore');

        const actionCodeSettings = {
            url: process.env.APP_URL + '/login.html',
            handleCodeInApp: true
        };

        const verificationLink = await auth.generateEmailVerificationLink(email, actionCodeSettings);
        console.log('تم إنشاء رابط التحقق:', verificationLink);

        res.json({ 
            success: true,
            message: 'تم إنشاء الحساب بنجاح. يرجى التحقق من بريدك الإلكتروني'
        });
    } catch (error) {
        console.error('خطأ في التسجيل:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// تسجيل الدخول
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('محاولة تسجيل دخول:', email);

        const userRecord = await auth.getUserByEmail(email);
        console.log('تم العثور على المستخدم:', userRecord.uid);

        if (!userRecord.emailVerified) {
            console.log('البريد الإلكتروني غير مؤكد:', email);
            return res.status(400).json({ 
                success: false, 
                error: 'يرجى تأكيد بريدك الإلكتروني أولاً' 
            });
        }

        // إنشاء التوكن
        const token = jwt.sign(
            { 
                uid: userRecord.uid, 
                email: userRecord.email,
                name: userRecord.displayName 
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        console.log('تم إنشاء التوكن للمستخدم:', userRecord.uid);

        // حفظ التوكن في الكوكيز
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000
        });
        console.log('تم حفظ التوكن في الكوكيز');

        res.json({ 
            success: true,
            token,
            user: {
                name: userRecord.displayName,
                email: userRecord.email
            },
            redirect: '/home.html'
        });
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(401).json({ 
            success: false, 
            error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' 
        });
    }
});

// إعادة تعيين كلمة المرور
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        const actionCodeSettings = {
            url: 'http://localhost:3001/login',
            handleCodeInApp: true
        };

        await auth.generatePasswordResetLink(email, actionCodeSettings)
            .then(async (link) => {
                console.log('رابط إعادة التعيين:', link);
            });

        res.json({ message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني' });
    } catch (error) {
        console.error('خطأ في طلب إعادة تعيين كلمة المرور:', error);
        res.status(400).json({ error: 'البريد الإلكتروني غير موجود' });
    }
});

// جلب معلومات المستخدم
router.get('/user', async (req, res) => {
    try {
        const token = req.cookies.token || req.header('Authorization')?.replace('Bearer ', '');
        console.log('محاولة جلب معلومات المستخدم');
        
        if (!token) {
            console.log('لم يتم العثور على التوكن');
            return res.status(401).json({ 
                success: false,
                error: 'يجب تسجيل الدخول' 
            });
        }

        const { valid, user, error } = await verifyToken(token);
        if (!valid) {
            console.log('التوكن غير صالح:', error);
            return res.status(401).json({ 
                success: false,
                error: 'جلسة غير صالحة' 
            });
        }

        console.log('تم جلب معلومات المستخدم بنجاح:', user.uid);
        res.json({
            success: true,
            user: {
                name: user.displayName,
                email: user.email,
                emailVerified: user.emailVerified
            }
        });
    } catch (error) {
        console.error('خطأ في جلب معلومات المستخدم:', error);
        res.status(401).json({ 
            success: false,
            error: 'غير مصرح' 
        });
    }
});

// تسجيل الخروج
router.post('/logout', async (req, res) => {
    try {
        console.log('محاولة تسجيل الخروج');
        res.clearCookie('token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });
        console.log('تم حذف التوكن من الكوكيز');
        
        res.json({ 
            success: true, 
            message: 'تم تسجيل الخروج بنجاح' 
        });
    } catch (error) {
        console.error('خطأ في تسجيل الخروج:', error);
        res.status(500).json({ 
            success: false, 
            error: 'حدث خطأ أثناء تسجيل الخروج' 
        });
    }
});

// تحديث معلومات المستخدم
router.put('/user', async (req, res) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ success: false, error: 'يجب تسجيل الدخول' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { name, password } = req.body;
        
        const updateData = {};
        if (name) updateData.displayName = name;
        if (password) updateData.password = password;

        await auth.updateUser(decoded.uid, updateData);
        
        res.json({ success: true, message: 'تم تحديث المعلومات بنجاح' });
    } catch (error) {
        console.error('خطأ في تحديث معلومات المستخدم:', error);
        res.status(500).json({ success: false, error: 'حدث خطأ أثناء تحديث المعلومات' });
    }
});

module.exports = router; 