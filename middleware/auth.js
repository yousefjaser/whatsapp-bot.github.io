const firebase = require('../utils/firebase');
const logger = require('../utils/logger');

/**
 * التحقق من صلاحية الجلسة
 */
async function validateSession(req, res, next) {
    try {
        // التحقق من وجود جلسة
        if (!req.session) {
            logger.error('لا توجد جلسة');
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        // التحقق من وجود معرف المستخدم
        if (!req.session.userId) {
            logger.error('لا يوجد معرف للمستخدم في الجلسة');
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        // التحقق من وجود المستخدم في قاعدة البيانات
        const user = await firebase.getUser(req.session.userId);
        if (!user) {
            logger.error('المستخدم غير موجود في قاعدة البيانات', { userId: req.session.userId });
            req.session.destroy();
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        // تخزين معلومات المستخدم في الطلب
        req.user = user;
        next();
    } catch (error) {
        logger.error('خطأ في التحقق من الجلسة', { error: error.message });
        return res.status(500).json({
            success: false,
            message: 'حدث خطأ في التحقق من الجلسة'
        });
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
        const userId = req.session?.userId;

        if (!deviceId || !userId) {
            return res.status(401).json({
                success: false,
                message: 'غير مصرح بالوصول'
            });
        }

        const device = await firebase.getDevice(deviceId);
        if (!device || device.userId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        next();
    } catch (error) {
        logger.error('خطأ في التحقق من ملكية الجهاز', { error: error.message });
        return res.status(500).json({
            success: false,
            message: 'حدث خطأ في التحقق من ملكية الجهاز'
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