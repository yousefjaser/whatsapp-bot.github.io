const firebase = require('../utils/firebase');
const logger = require('../utils/logger');

/**
 * التحقق من صلاحية الجلسة
 */
async function validateSession(req, res, next) {
    try {
        // التحقق من وجود جلسة
        if (!req.session || !req.session.userId) {
            return handleAuthError(req, res, 'يرجى تسجيل الدخول أولاً');
        }

        // التحقق من وجود المستخدم
        const user = await firebase.getUser(req.session.userId);
        if (!user) {
            await destroySession(req);
            return handleAuthError(req, res, 'الحساب غير موجود');
        }

        // إضافة معلومات المستخدم للطلب
        req.user = user;
        
        // تسجيل الوصول
        logger.info('وصول مصرح به', {
            userId: user.id,
            path: req.path,
            method: req.method
        });

        next();

    } catch (error) {
        logger.error('خطأ في التحقق من الجلسة:', error);
        return handleAuthError(req, res, 'حدث خطأ في التحقق من الجلسة');
    }
}

/**
 * التحقق من صلاحيات المشرف
 */
async function validateAdmin(req, res, next) {
    try {
        // التحقق من وجود جلسة وصلاحيات المشرف
        if (!req.user || !req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بالوصول'
            });
        }

        // تسجيل وصول المشرف
        logger.info('وصول مشرف', {
            userId: req.user.id,
            path: req.path,
            method: req.method
        });

        next();

    } catch (error) {
        logger.error('خطأ في التحقق من صلاحيات المشرف:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في التحقق من الصلاحيات'
        });
    }
}

/**
 * التحقق من ملكية الجهاز
 */
async function validateDeviceOwnership(req, res, next) {
    try {
        const { deviceId } = req.params;
        
        // التحقق من وجود الجهاز
        const device = await firebase.getDevice(deviceId);
        if (!device) {
            return res.status(404).json({
                success: false,
                error: 'الجهاز غير موجود'
            });
        }

        // التحقق من ملكية الجهاز
        if (device.userId !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        // إضافة معلومات الجهاز للطلب
        req.device = device;

        next();

    } catch (error) {
        logger.error('خطأ في التحقق من ملكية الجهاز:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في التحقق من ملكية الجهاز'
        });
    }
}

/**
 * معالجة أخطاء المصادقة
 */
function handleAuthError(req, res, message) {
    // التحقق من نوع الطلب
    const isApiRequest = req.xhr || req.path.startsWith('/api/');
    
    if (isApiRequest) {
        return res.status(401).json({
            success: false,
            error: message
        });
    }

    // حفظ المسار الحالي للعودة إليه بعد تسجيل الدخول
    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login.html?redirect=${returnTo}`);
}

/**
 * إنهاء الجلسة
 */
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

module.exports = {
    validateSession,
    validateAdmin,
    validateDeviceOwnership
}; 