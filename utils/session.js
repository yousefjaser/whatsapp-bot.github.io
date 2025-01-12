const session = require('express-session');
const FirestoreStore = require('connect-session-firestore')(session);
const admin = require('firebase-admin');
const logger = require('./logger');

// التحقق من وجود مفتاح الجلسة
if (!process.env.SESSION_SECRET) {
    console.warn('تحذير: لم يتم تعيين SESSION_SECRET. استخدام مفتاح افتراضي غير آمن.');
}

/**
 * إعدادات الجلسة
 */
const sessionConfig = {
    store: new FirestoreStore({
        database: admin.firestore(),
        collection: 'sessions',
        ttl: 24 * 60 * 60 // يوم واحد
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    name: 'sessionId',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: 24 * 60 * 60 * 1000 // يوم واحد
    }
};

// تعديل إعدادات الجلسة في بيئة التطوير
if (process.env.NODE_ENV !== 'production') {
    sessionConfig.cookie.secure = false;
}

/**
 * إنشاء جلسة جديدة
 */
async function createSession(req, userId) {
    try {
        // التحقق من وجود المستخدم
        const user = await admin.firestore().collection('users').doc(userId).get();
        if (!user.exists) {
            throw new Error('المستخدم غير موجود');
        }

        // إنهاء الجلسات القديمة للمستخدم
        await endUserSessions(userId);

        // حفظ معرف المستخدم في الجلسة
        req.session.userId = userId;
        
        // حفظ معلومات الجلسة
        req.session.createdAt = new Date();
        req.session.userAgent = req.get('user-agent');
        req.session.ip = req.ip;

        // تسجيل الحدث
        await logger.auth('تم إنشاء جلسة جديدة', {
            userId,
            sessionId: req.sessionID,
            ip: req.ip,
            userAgent: req.get('user-agent')
        }, userId);

    } catch (error) {
        console.error('خطأ في إنشاء الجلسة:', error);
        throw error;
    }
}

/**
 * إنهاء جميع جلسات المستخدم
 */
async function endUserSessions(userId) {
    try {
        const sessionsRef = admin.firestore().collection('sessions');
        const snapshot = await sessionsRef
            .where('session.userId', '==', userId)
            .get();

        const batch = admin.firestore().batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
    } catch (error) {
        console.error('خطأ في إنهاء جلسات المستخدم:', error);
        throw error;
    }
}

/**
 * إنهاء الجلسة
 */
async function destroySession(req) {
    try {
        const userId = req.session?.userId;
        const sessionId = req.sessionID;

        // تسجيل الحدث
        if (userId) {
            await logger.auth('تم إنهاء الجلسة', {
                userId,
                sessionId
            }, userId);
        }

        // تدمير الجلسة
        return new Promise((resolve, reject) => {
            req.session.destroy(err => {
                if (err) {
                    console.error('خطأ في تدمير الجلسة:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

    } catch (error) {
        console.error('خطأ في إنهاء الجلسة:', error);
        throw error;
    }
}

/**
 * تنظيف الجلسات القديمة
 */
async function cleanOldSessions(maxAge = 30) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - maxAge);

        const sessionsRef = admin.firestore().collection('sessions');
        const snapshot = await sessionsRef
            .where('session.lastAccess', '<', cutoffDate)
            .get();

        if (snapshot.empty) {
            console.log('لا توجد جلسات قديمة للحذف');
            return;
        }

        const batch = admin.firestore().batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`تم حذف ${snapshot.size} جلسة قديمة`);

        // تسجيل الحدث
        await logger.info('تم تنظيف الجلسات القديمة', {
            deletedCount: snapshot.size,
            cutoffDate
        });

    } catch (error) {
        console.error('خطأ في تنظيف الجلسات القديمة:', error);
        throw error;
    }
}

/**
 * تصدير الدوال والإعدادات
 */
module.exports = {
    sessionConfig,
    createSession,
    destroySession,
    cleanOldSessions,
    endUserSessions
}; 