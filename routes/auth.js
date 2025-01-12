const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');

/**
 * تسجيل الدخول
 */
router.post('/login', async (req, res) => {
    console.log('محاولة تسجيل دخول جديدة');
    
    try {
        const { email, password } = req.body;

        // التحقق من البيانات المطلوبة
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'البريد الإلكتروني وكلمة المرور مطلوبان'
            });
        }

        // التحقق من المستخدم المالك
        if (email.toLowerCase() === process.env.OWNER_EMAIL) {
            return handleOwnerLogin(req, res, email, password);
        }

        // البحث عن المستخدم العادي
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

        // إنشاء الجلسة
        await createUserSession(req, userDoc);

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
        console.error('خطأ في تسجيل الدخول:', error);
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
    console.log('محاولة تسجيل حساب جديد');
    
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
        const userDoc = await createUser(email, hashedPassword, name);

        // إنشاء الجلسة
        await createUserSession(req, userDoc);

        // إرسال البيانات
        return res.json({
            success: true,
            user: {
                id: userDoc.id,
                email,
                name
            }
        });

    } catch (error) {
        console.error('خطأ في إنشاء الحساب:', error);
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
    console.log('تسجيل الخروج للمستخدم:', req.session?.userId);
    
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

/**
 * التحقق من حالة المصادقة
 */
router.get('/status', async (req, res) => {
    try {
        if (!req.session?.userId) {
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
        console.error('خطأ في التحقق من حالة المصادقة:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في التحقق من حالة المصادقة'
        });
    }
});

/**
 * معالجة تسجيل دخول المالك
 */
async function handleOwnerLogin(req, res, email, password) {
    if (password !== process.env.OWNER_PASSWORD) {
        return res.status(401).json({
            success: false,
            error: 'بيانات الدخول غير صحيحة'
        });
    }

    // البحث عن حساب المالك أو إنشاؤه
    const ownerDoc = await findOrCreateOwner(email);
    
    // إنشاء الجلسة
    await createUserSession(req, ownerDoc);

    return res.json({
        success: true,
        user: {
            id: ownerDoc.id,
            email,
            name: 'المالك',
            role: 'owner'
        }
    });
}

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
        console.error('خطأ في التحقق من كلمة المرور:', error);
        return false;
    }
}

/**
 * إنشاء مستخدم جديد
 */
async function createUser(email, hashedPassword, name) {
    const userDoc = await admin.firestore()
        .collection('users')
        .add({
            email: email.toLowerCase(),
            password: hashedPassword,
            name,
            role: 'user',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

    return {
        id: userDoc.id,
        data: () => ({
            email,
            name,
            role: 'user'
        })
    };
}

/**
 * البحث عن حساب المالك أو إنشاؤه
 */
async function findOrCreateOwner(email) {
    const ownerDoc = await findUserByEmail(email);
    if (ownerDoc) return ownerDoc;

    const newOwnerDoc = await admin.firestore()
        .collection('users')
        .add({
            email: email.toLowerCase(),
            name: 'المالك',
            role: 'owner',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

    return {
        id: newOwnerDoc.id,
        data: () => ({
            email,
            name: 'المالك',
            role: 'owner'
        })
    };
}

/**
 * إنشاء جلسة للمستخدم
 */
async function createUserSession(req, userDoc) {
    req.session.userId = userDoc.id;
    await updateLastLogin(userDoc.id);
}

/**
 * تحديث آخر تسجيل دخول
 */
async function updateLastLogin(userId) {
    try {
        await admin.firestore()
            .collection('users')
            .doc(userId)
            .update({
                lastLogin: admin.firestore.FieldValue.serverTimestamp()
            });
    } catch (error) {
        console.error('خطأ في تحديث آخر تسجيل دخول:', error);
    }
}

module.exports = router; 