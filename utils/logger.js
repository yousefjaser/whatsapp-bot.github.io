const admin = require('firebase-admin');

// تعريف أنواع السجلات
const LogTypes = {
    INFO: 'info',
    ERROR: 'error',
    WARNING: 'warning',
    AUTH: 'auth',
    DEVICE: 'device',
    MESSAGE: 'message',
    ADMIN: 'admin'
};

// دالة مساعدة لتنظيف البيانات
function cleanData(data) {
    if (!data) return {};
    
    // تحويل البيانات إلى كائن بسيط
    const cleanedData = {};
    Object.keys(data).forEach(key => {
        const value = data[key];
        if (value !== undefined && value !== null) {
            if (typeof value === 'object') {
                cleanedData[key] = JSON.stringify(value);
            } else {
                cleanedData[key] = value;
            }
        }
    });
    
    return cleanedData;
}

// حفظ سجل جديد
async function saveLog(type, message, data = {}, userId = null) {
    try {
        const logData = {
            type,
            message,
            data: cleanData(data),
            userId,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: global.requestIp || null,
            userAgent: global.userAgent || null
        };

        await admin.firestore().collection('logs').add(logData);
    } catch (error) {
        console.error('خطأ في حفظ السجل:', error);
    }
}

// دوال التسجيل المختلفة
const logger = {
    info: (message, data) => saveLog(LogTypes.INFO, message, data),
    error: (message, data) => saveLog(LogTypes.ERROR, message, data),
    warning: (message, data) => saveLog(LogTypes.WARNING, message, data),
    auth: (message, data, userId) => saveLog(LogTypes.AUTH, message, data, userId),
    device: (message, data, userId) => saveLog(LogTypes.DEVICE, message, data, userId),
    message: (message, data, userId) => saveLog(LogTypes.MESSAGE, message, data, userId),
    admin: (message, data, userId) => saveLog(LogTypes.ADMIN, message, data, userId)
};

module.exports = logger; 