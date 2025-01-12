const admin = require('firebase-admin');

/**
 * تسجيل رسالة معلومات
 */
function info(message, data = {}, userId = null) {
    return saveLog('INFO', message, data, userId);
}

/**
 * تسجيل رسالة خطأ
 */
function error(message, data = {}, userId = null) {
    return saveLog('ERROR', message, data, userId);
}

/**
 * تسجيل رسالة تحذير
 */
function warning(message, data = {}, userId = null) {
    return saveLog('WARNING', message, data, userId);
}

/**
 * تسجيل حدث مصادقة
 */
function auth(message, data = {}, userId = null) {
    return saveLog('AUTH', message, data, userId);
}

/**
 * تسجيل حدث جهاز
 */
function device(message, data = {}, userId = null) {
    return saveLog('DEVICE', message, data, userId);
}

/**
 * تسجيل حدث رسالة
 */
function message(message, data = {}, userId = null) {
    return saveLog('MESSAGE', message, data, userId);
}

/**
 * تسجيل حدث مشرف
 */
function adminLog(message, data = {}, userId = null) {
    return saveLog('ADMIN', message, data, userId);
}

/**
 * حفظ السجل في قاعدة البيانات
 */
async function saveLog(type, message, data = {}, userId = null) {
    try {
        const logData = {
            type,
            message,
            data,
            userId,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };

        await admin.firestore()
            .collection('logs')
            .add(logData);

    } catch (error) {
        console.error('خطأ في حفظ السجل:', error);
    }
}

/**
 * تنظيف السجلات القديمة
 */
async function cleanOldLogs(maxAge = 30) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - maxAge);

        const snapshot = await admin.firestore()
            .collection('logs')
            .where('timestamp', '<', cutoffDate)
            .get();

        const batch = admin.firestore().batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`تم حذف ${snapshot.size} سجل قديم`);

    } catch (error) {
        console.error('خطأ في تنظيف السجلات القديمة:', error);
    }
}

module.exports = {
    info,
    error,
    warning,
    auth,
    device,
    message,
    adminLog,
    cleanOldLogs
}; 