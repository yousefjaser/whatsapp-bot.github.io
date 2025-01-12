const admin = require('firebase-admin');

/**
 * أنواع السجلات
 */
const LogTypes = {
    INFO: 'info',
    ERROR: 'error',
    WARNING: 'warning',
    AUTH: 'auth',
    DEVICE: 'device',
    MESSAGE: 'message',
    ADMIN: 'admin'
};

/**
 * إضافة سجل جديد
 * @param {string} type - نوع السجل
 * @param {string} message - الرسالة
 * @param {Object} data - بيانات إضافية
 * @param {string} [userId] - معرف المستخدم
 */
async function addLog(type, message, data = {}, userId = null) {
    try {
        if (!Object.values(LogTypes).includes(type)) {
            console.warn('نوع السجل غير صالح:', type);
            type = LogTypes.INFO;
        }

        const logData = {
            type,
            message,
            data,
            userId,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: data.ip || null,
            userAgent: data.userAgent || null
        };

        await admin.firestore()
            .collection('system_logs')
            .add(logData);

    } catch (error) {
        console.error('خطأ في إضافة السجل:', error);
    }
}

/**
 * إضافة سجل معلومات
 */
function info(message, data = {}, userId = null) {
    return addLog(LogTypes.INFO, message, data, userId);
}

/**
 * إضافة سجل خطأ
 */
function error(message, data = {}, userId = null) {
    console.error(message, data);
    return addLog(LogTypes.ERROR, message, data, userId);
}

/**
 * إضافة سجل تحذير
 */
function warning(message, data = {}, userId = null) {
    console.warn(message, data);
    return addLog(LogTypes.WARNING, message, data, userId);
}

/**
 * إضافة سجل مصادقة
 */
function auth(message, data = {}, userId = null) {
    return addLog(LogTypes.AUTH, message, data, userId);
}

/**
 * إضافة سجل جهاز
 */
function device(message, data = {}, userId = null) {
    return addLog(LogTypes.DEVICE, message, data, userId);
}

/**
 * إضافة سجل رسالة
 */
function message(message, data = {}, userId = null) {
    return addLog(LogTypes.MESSAGE, message, data, userId);
}

/**
 * إضافة سجل مشرف
 */
function admin(message, data = {}, userId = null) {
    return addLog(LogTypes.ADMIN, message, data, userId);
}

/**
 * حذف السجلات القديمة
 * @param {number} days - عدد الأيام للاحتفاظ بالسجلات
 */
async function cleanOldLogs(days = 30) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const snapshot = await admin.firestore()
            .collection('system_logs')
            .where('timestamp', '<', cutoffDate)
            .get();

        const batch = admin.firestore().batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`تم حذف ${snapshot.size} سجل قديم`);

    } catch (error) {
        console.error('خطأ في حذف السجلات القديمة:', error);
    }
}

/**
 * تصدير الدوال
 */
module.exports = {
    LogTypes,
    addLog,
    info,
    error,
    warning,
    auth,
    device,
    message,
    admin,
    cleanOldLogs
}; 