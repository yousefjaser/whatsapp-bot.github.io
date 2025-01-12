/**
 * التحقق من صحة البريد الإلكتروني
 * @param {string} email - البريد الإلكتروني
 * @returns {boolean}
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * التحقق من صحة رقم الهاتف
 * @param {string} phone - رقم الهاتف
 * @returns {boolean}
 */
function isValidPhone(phone) {
    // يقبل الأرقام والمسافات والشرط والأقواس
    const phoneRegex = /^[\d\s\-()]+$/;
    return phoneRegex.test(phone) && phone.replace(/\D/g, '').length >= 10;
}

/**
 * تنظيف رقم الهاتف
 * @param {string} phone - رقم الهاتف
 * @returns {string}
 */
function cleanPhoneNumber(phone) {
    // إزالة كل شيء ما عدا الأرقام
    return phone.replace(/\D/g, '');
}

/**
 * التحقق من صحة كلمة المرور
 * @param {string} password - كلمة المرور
 * @returns {Object} نتيجة التحقق
 */
function validatePassword(password) {
    const result = {
        isValid: false,
        errors: []
    };

    if (!password || typeof password !== 'string') {
        result.errors.push('كلمة المرور مطلوبة');
        return result;
    }

    if (password.length < 6) {
        result.errors.push('يجب أن تكون كلمة المرور 6 أحرف على الأقل');
    }

    if (password.length > 50) {
        result.errors.push('يجب أن تكون كلمة المرور أقل من 50 حرف');
    }

    if (!/\d/.test(password)) {
        result.errors.push('يجب أن تحتوي كلمة المرور على رقم واحد على الأقل');
    }

    if (!/[a-z]/.test(password)) {
        result.errors.push('يجب أن تحتوي كلمة المرور على حرف صغير واحد على الأقل');
    }

    if (!/[A-Z]/.test(password)) {
        result.errors.push('يجب أن تحتوي كلمة المرور على حرف كبير واحد على الأقل');
    }

    result.isValid = result.errors.length === 0;
    return result;
}

/**
 * التحقق من صحة الاسم
 * @param {string} name - الاسم
 * @returns {Object} نتيجة التحقق
 */
function validateName(name) {
    const result = {
        isValid: false,
        errors: []
    };

    if (!name || typeof name !== 'string') {
        result.errors.push('الاسم مطلوب');
        return result;
    }

    if (name.length < 3) {
        result.errors.push('يجب أن يكون الاسم 3 أحرف على الأقل');
    }

    if (name.length > 50) {
        result.errors.push('يجب أن يكون الاسم أقل من 50 حرف');
    }

    // التحقق من عدم وجود أرقام
    if (/\d/.test(name)) {
        result.errors.push('يجب ألا يحتوي الاسم على أرقام');
    }

    result.isValid = result.errors.length === 0;
    return result;
}

/**
 * التحقق من صحة نوع الرسالة
 * @param {string} type - نوع الرسالة
 * @returns {boolean}
 */
function isValidMessageType(type) {
    const validTypes = ['text', 'image', 'document', 'audio', 'video'];
    return validTypes.includes(type);
}

/**
 * التحقق من صحة عنوان URL
 * @param {string} url - عنوان URL
 * @returns {boolean}
 */
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * التحقق من صحة معرف الجهاز
 * @param {string} deviceId - معرف الجهاز
 * @returns {boolean}
 */
function isValidDeviceId(deviceId) {
    // يجب أن يكون المعرف سلسلة نصية تحتوي على أحرف وأرقام فقط
    const deviceIdRegex = /^[a-zA-Z0-9-_]+$/;
    return deviceIdRegex.test(deviceId);
}

/**
 * تصدير الدوال
 */
module.exports = {
    isValidEmail,
    isValidPhone,
    cleanPhoneNumber,
    validatePassword,
    validateName,
    isValidMessageType,
    isValidUrl,
    isValidDeviceId
}; 