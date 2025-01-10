require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const router = express.Router();

const auth = admin.auth();
const db = admin.firestore();

// التسجيل
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // إنشاء المستخدم في Firebase Authentication
        const userRecord = await auth.createUser({
            email,
            password,
            displayName: name,
            emailVerified: false
        });

        // إنشاء وثيقة المستخدم في Firestore
        await db.collection('users').doc(userRecord.uid).set({
            name,
            email,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // إرسال بريد تأكيد
        const actionCodeSettings = {
            url: 'http://localhost:3001/login',
            handleCodeInApp: true
        };

        await auth.generateEmailVerificationLink(email, actionCodeSettings)
            .then(async (link) => {
                console.log('رابط التحقق:', link);
            });

        res.json({ message: 'تم إنشاء الحساب بنجاح. يرجى التحقق من بريدك الإلكتروني' });
    } catch (error) {
        console.error('خطأ في التسجيل:', error);
        res.status(500).json({ error: error.message });
    }
});

// تسجيل الدخول
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // التحقق من المستخدم باستخدام Firebase Admin SDK
        const userRecord = await auth.getUserByEmail(email);

        // التحقق من تأكيد البريد الإلكتروني
        if (!userRecord.emailVerified) {
            return res.status(400).json({ error: 'يرجى تأكيد بريدك الإلكتروني أولاً' });
        }

        // إنشاء JWT token
        const token = jwt.sign(
            { uid: userRecord.uid, email: userRecord.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // حفظ التوكن في الكوكيز
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000 // 24 ساعة
        });

        res.json({ token });
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
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
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ error: 'يجب تسجيل الدخول' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userRecord = await auth.getUser(decoded.uid);

        res.json({
            name: userRecord.displayName,
            email: userRecord.email,
            emailVerified: userRecord.emailVerified
        });
    } catch (error) {
        console.error('خطأ في جلب معلومات المستخدم:', error);
        res.status(401).json({ error: 'غير مصرح' });
    }
});

module.exports = router; 