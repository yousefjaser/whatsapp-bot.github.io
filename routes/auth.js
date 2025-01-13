const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

/**
 * تسجيل الدخول
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // التحقق من البيانات المطلوبة
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'البريد الإلكتروني وكلمة المرور مطلوبان'
            });
        }

        // البحث عن المستخدم
        const userDoc = await findUserByEmail(email);
        if (!userDoc) {
            return res.status(401).json({
                success: false,
                error: 'بيانات الدخول غير صحيحة'
            });
        }

        // التحقق من كلمة المرور
        const isValidPassword = await verifyPassword(password, userDoc.data().password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'بيانات الدخول غير صحيحة'
            });
        }

        // تخزين معرف المستخدم في الجلسة
        req.session.userId = userDoc.id;
        logger.info('تم تسجيل الدخول بنجاح', { userId: userDoc.id });

        // إرسال البيانات
        return res.json({
            success: true,
            user: {
                id: userDoc.id,
                email: userDoc.data().email,
                name: userDoc.data().name,
                role: userDoc.data().role || 'user'
            }
        });

    } catch (error) {
        logger.error('خطأ في تسجيل الدخول:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في تسجيل الدخول'
        });
    }
});

/**
 * تسجيل حساب جديد
 */
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // التحقق من البيانات المطلوبة
        if (!email || !password || !name) {
            return res.status(400).json({
                success: false,
                error: 'جميع الحقول مطلوبة'
            });
        }

        // التحقق من عدم وجود المستخدم
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'البريد الإلكتروني مستخدم بالفعل'
            });
        }

        // إنشاء المستخدم
        const hashedPassword = await bcrypt.hash(password, 10);
        const userRef = await admin.firestore().collection('users').add({
            email: email.toLowerCase(),
            password: hashedPassword,
            name,
            role: 'user',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // تخزين معرف المستخدم في الجلسة
        req.session.userId = userRef.id;
        logger.info('تم إنشاء حساب جديد', { userId: userRef.id });

        // إرسال البيانات
        return res.json({
            success: true,
            user: {
                id: userRef.id,
                email,
                name,
                role: 'user'
            }
        });

    } catch (error) {
        logger.error('خطأ في إنشاء الحساب:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في إنشاء الحساب'
        });
    }
});

/**
 * تسجيل الخروج
 */
router.post('/logout', (req, res) => {
    const userId = req.session?.userId;
    logger.info('تسجيل الخروج للمستخدم:', { userId });
    
    req.session.destroy(err => {
        if (err) {
            logger.error('خطأ في تسجيل الخروج:', err);
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

/**
 * التحقق من حالة المصادقة
 */
router.get('/status', async (req, res) => {
    try {
        const userId = req.session?.userId;
        if (!userId) {
            return res.json({
                success: true,
                authenticated: false
            });
        }

        const userDoc = await admin.firestore()
            .collection('users')
            .doc(userId)
            .get();

        if (!userDoc.exists) {
            return res.json({
                success: true,
                authenticated: false
            });
        }

        const userData = userDoc.data();
        return res.json({
            success: true,
            authenticated: true,
            user: {
                id: userDoc.id,
                email: userData.email,
                name: userData.name,
                role: userData.role || 'user'
            }
        });

    } catch (error) {
        logger.error('خطأ في التحقق من حالة المصادقة:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في التحقق من حالة المصادقة'
        });
    }
});

/**
 * البحث عن المستخدم بالبريد الإلكتروني
 */
async function findUserByEmail(email) {
    const snapshot = await admin.firestore()
        .collection('users')
        .where('email', '==', email.toLowerCase())
        .get();

    return snapshot.empty ? null : snapshot.docs[0];
}

/**
 * التحقق من كلمة المرور
 */
async function verifyPassword(password, hashedPassword) {
    try {
        return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
        logger.error('خطأ في التحقق من كلمة المرور:', error);
        return false;
    }
}

module.exports = router; 