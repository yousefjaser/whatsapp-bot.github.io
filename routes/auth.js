const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');

// تسجيل الدخول
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'البريد الإلكتروني وكلمة المرور مطلوبان'
            });
        }

        // البحث عن المستخدم
        const usersRef = admin.firestore().collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();

        if (snapshot.empty) {
            return res.status(401).json({
                success: false,
                error: 'بيانات الدخول غير صحيحة'
            });
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();

        // التحقق من كلمة المرور
        const isValid = await bcrypt.compare(password, userData.password);

        if (!isValid) {
            return res.status(401).json({
                success: false,
                error: 'بيانات الدخول غير صحيحة'
            });
        }

        // إنشاء جلسة
        req.session.userId = userDoc.id;
        
        res.json({
            success: true,
            user: {
                id: userDoc.id,
                email: userData.email,
                name: userData.name
            }
        });

    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في تسجيل الدخول'
        });
    }
});

// تسجيل حساب جديد
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({
                success: false,
                error: 'جميع الحقول مطلوبة'
            });
        }

        // التحقق من عدم وجود المستخدم
        const usersRef = admin.firestore().collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();

        if (!snapshot.empty) {
            return res.status(400).json({
                success: false,
                error: 'البريد الإلكتروني مستخدم بالفعل'
            });
        }

        // تشفير كلمة المرور
        const hashedPassword = await bcrypt.hash(password, 10);

        // إنشاء المستخدم
        const userDoc = await usersRef.add({
            email,
            password: hashedPassword,
            name,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            role: 'user'
        });

        // إنشاء جلسة
        req.session.userId = userDoc.id;

        res.json({
            success: true,
            user: {
                id: userDoc.id,
                email,
                name
            }
        });

    } catch (error) {
        console.error('خطأ في إنشاء الحساب:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في إنشاء الحساب'
        });
    }
});

// تسجيل الخروج
router.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('خطأ في تسجيل الخروج:', err);
            return res.status(500).json({
                success: false,
                error: 'حدث خطأ في تسجيل الخروج'
            });
        }

        res.json({
            success: true,
            message: 'تم تسجيل الخروج بنجاح'
        });
    });
});

// التحقق من حالة المصادقة
router.get('/status', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.json({
                success: true,
                authenticated: false
            });
        }

        const userDoc = await admin.firestore()
            .collection('users')
            .doc(req.session.userId)
            .get();

        if (!userDoc.exists) {
            return res.json({
                success: true,
                authenticated: false
            });
        }

        const userData = userDoc.data();
        res.json({
            success: true,
            authenticated: true,
            user: {
                id: userDoc.id,
                email: userData.email,
                name: userData.name
            }
        });

    } catch (error) {
        console.error('خطأ في التحقق من حالة المصادقة:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في التحقق من حالة المصادقة'
        });
    }
});

module.exports = router; 