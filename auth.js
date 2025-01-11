require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const router = express.Router();
const rateLimit = require('express-rate-limit');

// التحقق من تهيئة Firebase Admin
if (!admin.apps.length) {
    try {
        console.log('بدء تهيئة Firebase Admin...');
        const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
        console.log('تم قراءة إعدادات Firebase:', {
            project_id: firebaseConfig.project_id,
            client_email: firebaseConfig.client_email
        });

        admin.initializeApp({
            credential: admin.credential.cert(firebaseConfig)
        });
        console.log('تم تهيئة Firebase Admin بنجاح');
    } catch (error) {
        console.error('خطأ في تهيئة Firebase Admin:', error);
        throw error;
    }
}

const auth = admin.auth();
const db = admin.firestore();

// دالة مساعدة للتحقق من التوكن
async function verifyToken(token) {
    try {
        console.log('بدء التحقق من التوكن:', token.substring(0, 20) + '...');
        
        // التحقق من JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('تم فك تشفير التوكن:', decoded);

        try {
            // التحقق من المستخدم في Firebase
            const userRecord = await auth.getUser(decoded.uid);
            console.log('تم التحقق من المستخدم في Firebase:', userRecord.uid);

            return { 
                valid: true, 
                user: userRecord,
                decoded
            };
        } catch (firebaseError) {
            console.error('خطأ في التحقق من المستخدم في Firebase:', firebaseError);
            return { 
                valid: false, 
                error: 'فشل التحقق من المستخدم في Firebase'
            };
        }
    } catch (jwtError) {
        console.error('خطأ في التحقق من التوكن JWT:', jwtError);
        return { 
            valid: false, 
            error: 'التوكن غير صالح'
        };
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

        // التحقق من المستخدم في Firebase
        const userRecord = await auth.getUserByEmail(email);
        console.log('تم العثور على المستخدم:', userRecord.uid);

        // إنشاء توكن مباشرة من Firebase
        const firebaseToken = await auth.createCustomToken(userRecord.uid);
        console.log('تم إنشاء توكن Firebase');

        // إنشاء توكن للجلسة
        const sessionToken = jwt.sign(
            {
                uid: userRecord.uid,
                email: userRecord.email,
                name: userRecord.displayName,
                loginTime: Date.now()
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // حفظ في الكوكيز
        res.cookie('sessionToken', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000 // صلاحية لمدة 7 أيام
        });

        // حفظ في قاعدة البيانات
        await db.collection('sessions').doc(userRecord.uid).set({
            sessionToken,
            firebaseToken,
            lastLogin: admin.firestore.FieldValue.serverTimestamp(),
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip,
            isActive: true
        });

        res.json({
            success: true,
            user: {
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName
            },
            firebaseToken,
            isAuthenticated: true
        });

    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(401).json({
            success: false,
            error: 'فشل في تسجيل الدخول: ' + error.message
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
        console.log('طلب جلب معلومات المستخدم');
        console.log('الكوكيز:', req.cookies);
        console.log('الهيدرز:', req.headers);
        
        const token = req.cookies.token || req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            console.log('لم يتم العثور على التوكن');
            return res.status(401).json({ 
                success: false,
                error: 'يجب تسجيل الدخول' 
            });
        }

        // فك تشفير التوكن
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('تم فك تشفير التوكن:', decoded);

        // التحقق من المستخدم في Firebase
        const userRecord = await auth.getUser(decoded.uid);
        console.log('تم التحقق من المستخدم في Firebase:', {
            uid: userRecord.uid,
            email: userRecord.email
        });

        // التحقق من الجلسة في Firestore
        const sessionDoc = await db.collection('sessions').doc(userRecord.uid).get();
        if (!sessionDoc.exists || sessionDoc.data().token !== token) {
            console.log('الجلسة غير صالحة');
            throw new Error('الجلسة غير صالحة');
        }

        // تجديد التوكن
        const newToken = jwt.sign(
            { 
                uid: userRecord.uid, 
                email: userRecord.email,
                name: userRecord.displayName 
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // تحديث الكوكيز والجلسة
        res.cookie('token', newToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000
        });

        await db.collection('sessions').doc(userRecord.uid).update({
            token: newToken,
            lastAccess: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            user: {
                name: userRecord.displayName,
                email: userRecord.email,
                emailVerified: userRecord.emailVerified,
                uid: userRecord.uid
            },
            token: newToken
        });
    } catch (error) {
        console.error('خطأ في جلب معلومات المستخدم:', error);
        res.clearCookie('token');
        res.status(401).json({ 
            success: false,
            error: error.message || 'غير مصرح'
        });
    }
});

// تسجيل الخروج
router.post('/logout', async (req, res) => {
    try {
        const sessionToken = req.cookies.sessionToken;
        if (sessionToken) {
            try {
                const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
                // تعطيل الجلسة في قاعدة البيانات
                await db.collection('sessions').doc(decoded.uid).update({
                    isActive: false,
                    logoutTime: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (error) {
                console.error('خطأ في تعطيل الجلسة:', error);
            }
        }

        // مسح الكوكيز
        res.clearCookie('sessionToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/'
        });

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

// تحسين دالة التحقق من التوكن
async function verifyAndRefreshToken(token) {
    try {
        console.log('بدء عملية التحقق من التوكن:', token);
        
        // محاولة فك تشفير التوكن
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('تم فك تشفير التوكن JWT بنجاح:', decoded);
        } catch (jwtError) {
            console.log('خطأ في فك تشفير JWT، محاولة التحقق من Firebase...');
            try {
                // محاولة التحقق من التوكن باستخدام Firebase
                const decodedFirebase = await admin.auth().verifyIdToken(token);
                console.log('تم التحقق من التوكن في Firebase:', decodedFirebase);
                decoded = {
                    uid: decodedFirebase.uid,
                    email: decodedFirebase.email,
                    name: decodedFirebase.name || ''
                };
            } catch (firebaseError) {
                console.error('فشل التحقق من التوكن في Firebase:', firebaseError);
                throw new Error('توكن غير صالح');
            }
        }

        // التحقق من وجود المستخدم
        console.log('جاري التحقق من المستخدم:', decoded.uid);
        const userRecord = await auth.getUser(decoded.uid);
        console.log('تم العثور على المستخدم:', userRecord.uid);

        // إنشاء توكن جديد دائماً
        const customToken = await auth.createCustomToken(userRecord.uid);
        console.log('تم إنشاء توكن Firebase مخصص');

        const tokenData = {
            uid: userRecord.uid,
            email: userRecord.email,
            name: userRecord.displayName,
            firebaseToken: customToken,
            timestamp: Date.now()
        };

        const newJwtToken = jwt.sign(tokenData, process.env.JWT_SECRET, {
            expiresIn: '24h',
            algorithm: 'HS256'
        });
        console.log('تم إنشاء توكن JWT جديد');

        return {
            valid: true,
            user: userRecord,
            token: newJwtToken,
            firebaseToken: customToken
        };
    } catch (error) {
        console.error('خطأ في عملية التحقق:', error);
        throw error;
    }
}

router.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('محاولة تسجيل الدخول:', email);

        const userRecord = await auth.getUserByEmail(email);
        const token = await auth.createCustomToken(userRecord.uid);
        
        // حفظ التوكن في الكوكيز
        res.cookie('token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // صلاحية لمدة يوم واحد
        });

        console.log('تم تسجيل الدخول بنجاح:', userRecord.uid);
        res.json({ 
            success: true, 
            message: 'تم تسجيل الدخول بنجاح',
            user: {
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName
            }
        });
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(401).json({ 
            success: false, 
            message: 'فشل في تسجيل الدخول: ' + error.message 
        });
    }
});

router.get('/api/auth/user', async (req, res) => {
    try {
        const token = req.cookies.token || req.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            throw new Error('لم يتم العثور على التوكن');
        }

        const result = await verifyAndRefreshToken(token);
        
        // تحديث الكوكيز
        res.cookie('token', result.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000
        });

        // تحديث الجلسة
        await db.collection('sessions').doc(result.user.uid).set({
            jwtToken: result.token,
            firebaseToken: result.firebaseToken,
            lastAccess: admin.firestore.FieldValue.serverTimestamp(),
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip
        });

        res.json({
            success: true,
            user: {
                uid: result.user.uid,
                email: result.user.email,
                displayName: result.user.displayName
            },
            firebaseToken: result.firebaseToken
        });

    } catch (error) {
        console.error('خطأ في التحقق من المستخدم:', error);
        res.status(401).json({
            success: false,
            error: error.message,
            shouldRetry: true
        });
    }
});

// التحقق من حالة المستخدم
router.get('/api/auth/check', async (req, res) => {
    try {
        const sessionToken = req.cookies.sessionToken;
        if (!sessionToken) {
            return res.json({ isAuthenticated: false });
        }

        // فك تشفير التوكن
        const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
        
        // التحقق من الجلسة في قاعدة البيانات
        const sessionDoc = await db.collection('sessions')
            .doc(decoded.uid)
            .get();

        if (!sessionDoc.exists || !sessionDoc.data().isActive) {
            return res.json({ isAuthenticated: false });
        }

        const sessionData = sessionDoc.data();
        if (sessionData.sessionToken !== sessionToken) {
            return res.json({ isAuthenticated: false });
        }

        // تحديث وقت آخر نشاط
        await db.collection('sessions').doc(decoded.uid).update({
            lastActivity: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            isAuthenticated: true,
            user: {
                uid: decoded.uid,
                email: decoded.email,
                name: decoded.name
            }
        });

    } catch (error) {
        console.error('خطأ في التحقق من حالة المستخدم:', error);
        res.json({ isAuthenticated: false });
    }
});

module.exports = router; 