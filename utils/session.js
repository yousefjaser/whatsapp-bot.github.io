const session = require('express-session');
const FirebaseStore = require('connect-firebase-session')(session);
const admin = require('firebase-admin');
const logger = require('./logger');

// إعدادات الجلسة
const sessionConfig = {
    store: new FirebaseStore({
        database: admin.firestore(),
        collection: 'sessions',
        ttl: 604800 // أسبوع واحد
    }),
    secret: process.env.SESSION_SECRET || 'whatsapp-bot-secret-key',
    name: 'sessionId',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 604800000 // أسبوع واحد بالميلي ثانية
    }
};

// إنشاء جلسة جديدة
async function createSession(req, userId) {
    return new Promise((resolve) => {
        req.session.userId = userId;
        req.session.save((err) => {
            if (err) {
                logger.error('خطأ في إنشاء الجلسة:', err);
            }
            resolve();
        });
    });
}

// إنهاء الجلسة
async function destroySession(req) {
    return new Promise((resolve) => {
        req.session.destroy((err) => {
            if (err) {
                logger.error('خطأ في إنهاء الجلسة:', err);
            }
            resolve();
        });
    });
}

// تنظيف الجلسات القديمة
async function cleanOldSessions(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 يوم
    try {
        const sessionsRef = admin.firestore().collection('sessions');
        const oldSessions = await sessionsRef
            .where('lastAccess', '<=', Date.now() - maxAge)
            .get();

        const batch = admin.firestore().batch();
        oldSessions.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        logger.info(`تم حذف ${oldSessions.size} جلسة قديمة`);

    } catch (error) {
        logger.error('خطأ في تنظيف الجلسات القديمة:', error);
    }
}

module.exports = {
    sessionConfig,
    createSession,
    destroySession,
    cleanOldSessions
}; 