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
        console.log('بدء محاولة تسجيل الدخول للمستخدم:', email);

        if (!email || !password) {
            console.error('بيانات غير مكتملة:', { email: !!email, password: !!password });
            throw new Error('يرجى إدخال البريد الإلكتروني وكلمة المرور');
        }

        // التحقق من المستخدم في Firebase
        console.log('جاري البحث عن المستخدم في Firebase...');
        const userRecord = await auth.getUserByEmail(email)
            .catch(error => {
                console.error('خطأ في البحث عن المستخدم:', {
                    code: error.code,
                    message: error.message
                });
                throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
            });

        console.log('تم العثور على المستخدم:', {
            uid: userRecord.uid,
            email: userRecord.email,
            emailVerified: userRecord.emailVerified
        });

        // التحقق من تأكيد البريد الإلكتروني
        if (!userRecord.emailVerified) {
            console.log('البريد الإلكتروني غير مؤكد:', email);
            return res.status(400).json({ 
                success: false, 
                error: 'يرجى تأكيد بريدك الإلكتروني أولاً',
                needsEmailVerification: true
            });
        }

        try {
            // إنشاء التوكن
            console.log('جاري إنشاء التوكن...');
            const tokenData = { 
                uid: userRecord.uid, 
                email: userRecord.email,
                name: userRecord.displayName 
            };
            
            const token = jwt.sign(tokenData, process.env.JWT_SECRET, { expiresIn: '24h' });
            console.log('تم إنشاء التوكن بنجاح');

            // حفظ التوكن في الكوكيز
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 24 * 60 * 60 * 1000
            });
            console.log('تم حفظ التوكن في الكوكيز');

            // حفظ معلومات الجلسة
            await db.collection('sessions').doc(userRecord.uid).set({
                token,
                lastLogin: admin.firestore.FieldValue.serverTimestamp(),
                userAgent: req.headers['user-agent'],
                ipAddress: req.ip
            });
            console.log('تم حفظ معلومات الجلسة');

            res.json({ 
                success: true,
                token,
                user: {
                    name: userRecord.displayName,
                    email: userRecord.email,
                    uid: userRecord.uid
                },
                redirect: '/home.html'
            });
            console.log('تم تسجيل الدخول بنجاح وإرسال الاستجابة');
        } catch (tokenError) {
            console.error('خطأ في إنشاء أو حفظ التوكن:', tokenError);
            throw new Error('حدث خطأ أثناء إنشاء جلسة المستخدم');
        }
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', {
            message: error.message,
            stack: error.stack,
            originalError: error
        });
        
        res.status(401).json({ 
            success: false, 
            error: error.message || 'حدث خطأ أثناء تسجيل الدخول',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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

async function verifyAndRefreshToken(token) {
    try {
        console.log('التحقق من صلاحية التوكن:', token);
        const decodedToken = await admin.auth().verifyIdToken(token);
        console.log('التوكن صالح:', decodedToken);
        return { valid: true, uid: decodedToken.uid };
    } catch (error) {
        console.log('خطأ في التحقق من التوكن:', error.message);
        // إذا كان التوكن غير صالح، نقوم بإنشاء توكن جديد
        try {
            const user = await admin.auth().getUser(error.uid);
            const newToken = await admin.auth().createCustomToken(user.uid);
            console.log('تم إنشاء توكن جديد:', newToken);
            return { valid: false, newToken, uid: user.uid };
        } catch (createError) {
            console.log('خطأ في إنشاء توكن جديد:', createError.message);
            return { valid: false, error: createError.message };
        }
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

        const tokenStatus = await verifyAndRefreshToken(token);
        if (tokenStatus.valid) {
            const user = await auth.getUser(tokenStatus.uid);
            res.json({ 
                success: true, 
                user: {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName
                }
            });
        } else if (tokenStatus.newToken) {
            // إذا تم إنشاء توكن جديد، نقوم بتحديثه في الكوكيز
            res.cookie('token', tokenStatus.newToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'strict',
                maxAge: 24 * 60 * 60 * 1000
            });
            
            const user = await auth.getUser(tokenStatus.uid);
            res.json({ 
                success: true, 
                user: {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName
                },
                tokenRefreshed: true
            });
        } else {
            throw new Error(tokenStatus.error || 'فشل في التحقق من التوكن');
        }
    } catch (error) {
        console.error('خطأ في التحقق من المستخدم:', error);
        res.status(401).json({ 
            success: false, 
            message: 'فشل في التحقق من المستخدم: ' + error.message 
        });
    }
});

module.exports = router; 