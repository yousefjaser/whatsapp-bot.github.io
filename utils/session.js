const session = require('express-session');
const KnexSessionStore = require('connect-session-knex')(session);
const Knex = require('knex');
const logger = require('./logger');

// تهيئة قاعدة البيانات
const knex = Knex({
    client: 'sqlite3',
    connection: {
        filename: './sessions.sqlite'
    },
    useNullAsDefault: true
});

// إعدادات الجلسة
const sessionConfig = {
    store: new KnexSessionStore({
        knex,
        tablename: 'sessions',
        createtable: true,
        clearInterval: 24 * 60 * 60 * 1000 // يوم واحد
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
        req.session.createdAt = Date.now();
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
        const deleted = await knex('sessions')
            .where('lastAccessed', '<=', Date.now() - maxAge)
            .del();

        logger.info(`تم حذف ${deleted} جلسة قديمة`);
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