const firebase = require('../utils/firebase');
const logger = require('../utils/logger');

/**
 * التحقق من صلاحية الجلسة
 */
async function validateSession(req, res, next) {
    try {
        logger.info('بدء التحقق من الجلسة', {
            path: req.path,
            method: req.method,
            sessionId: req.sessionID,
            userId: req.session?.userId
        });

        // التحقق من وجود جلسة
        if (!req.session) {
            logger.error('لا توجد جلسة', {
                path: req.path,
                method: req.method,
                sessionId: req.sessionID
            });
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        // التحقق من وجود معرف المستخدم
        if (!req.session.userId) {
            logger.error('لا يوجد معرف للمستخدم في الجلسة', {
                path: req.path,
                method: req.method,
                sessionId: req.sessionID
            });
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        // التحقق من وجود المستخدم في قاعدة البيانات
        const user = await firebase.getUser(req.session.userId);
        if (!user) {
            logger.error('المستخدم غير موجود في قاعدة البيانات', {
                path: req.path,
                method: req.method,
                sessionId: req.sessionID,
                userId: req.session.userId
            });
            req.session.destroy();
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        // تخزين معلومات المستخدم في الطلب
        req.user = user;
        logger.info('تم التحقق من الجلسة بنجاح', {
            path: req.path,
            method: req.method,
            sessionId: req.sessionID,
            userId: user.id
        });
        next();
    } catch (error) {
        logger.error('خطأ في التحقق من الجلسة', {
            path: req.path,
            method: req.method,
            sessionId: req.sessionID,
            userId: req.session?.userId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            }
        });
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
        logger.info('بدء التحقق من صلاحيات المشرف', {
            path: req.path,
            method: req.method,
            userId: req.user?.id
        });

        // التحقق من وجود جلسة وصلاحيات المشرف
        if (!req.user || !req.user.isAdmin) {
            logger.error('محاولة وصول غير مصرح بها للوحة المشرف', {
                path: req.path,
                method: req.method,
                userId: req.user?.id
            });
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بالوصول'
            });
        }

        // تسجيل وصول المشرف
        logger.info('وصول مشرف ناجح', {
            path: req.path,
            method: req.method,
            userId: req.user.id
        });

        next();

    } catch (error) {
        logger.error('خطأ في التحقق من صلاحيات المشرف', {
            path: req.path,
            method: req.method,
            userId: req.user?.id,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            }
        });
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

        logger.info('بدء التحقق من ملكية الجهاز', {
            path: req.path,
            method: req.method,
            deviceId,
            userId
        });

        if (!deviceId || !userId) {
            logger.error('بيانات غير مكتملة للتحقق من ملكية الجهاز', {
                path: req.path,
                method: req.method,
                deviceId,
                userId
            });
            return res.status(401).json({
                success: false,
                message: 'غير مصرح بالوصول'
            });
        }

        const device = await firebase.getDevice(deviceId);
        if (!device || device.userId !== userId) {
            logger.error('محاولة وصول غير مصرح بها للجهاز', {
                path: req.path,
                method: req.method,
                deviceId,
                userId,
                deviceOwnerId: device?.userId
            });
            return res.status(403).json({
                success: false,
                message: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        logger.info('تم التحقق من ملكية الجهاز بنجاح', {
            path: req.path,
            method: req.method,
            deviceId,
            userId
        });

        next();
    } catch (error) {
        logger.error('خطأ في التحقق من ملكية الجهاز', {
            path: req.path,
            method: req.method,
            deviceId: req.params.deviceId,
            userId: req.session?.userId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            }
        });
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