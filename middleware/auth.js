const firebase = require('../utils/firebase');
const logger = require('../utils/logger');

// المسارات العامة التي لا تحتاج إلى مصادقة
const publicPaths = [
    '/login.html',
    '/register.html',
    '/api-dashboard.html',
    '/docs.html',
    '/api-docs.html',
    '/css/',
    '/js/',
    '/images/',
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/status',
    '/api/v1/send'
];

/**
 * التحقق من صلاحية الجلسة
 */
async function validateSession(req, res, next) {
    try {
        // التحقق من المسارات العامة
        if (publicPaths.some(path => req.path.startsWith(path))) {
            logger.info('مسار عام - لا يحتاج إلى مصادقة', {
                path: req.path,
                method: req.method
            });
            return next();
        }

        // التحقق من وجود جلسة
        if (!req.session) {
            logger.error('لا توجد جلسة', {
                path: req.path,
                method: req.method,
                headers: req.headers
            });
            return handleAuthError(req, res, 'يجب تسجيل الدخول أولاً');
        }

        // التحقق من وجود معرف المستخدم
        if (!req.session.userId) {
            logger.error('لا يوجد معرف للمستخدم في الجلسة', {
                path: req.path,
                method: req.method,
                session: req.session
            });
            return handleAuthError(req, res, 'يجب تسجيل الدخول أولاً');
        }

        // التحقق من وجود المستخدم في قاعدة البيانات
        const user = await firebase.getUser(req.session.userId);
        if (!user) {
            logger.error('المستخدم غير موجود في قاعدة البيانات', {
                path: req.path,
                method: req.method,
                userId: req.session.userId,
                session: req.session
            });
            await destroySession(req);
            return handleAuthError(req, res, 'يجب تسجيل الدخول أولاً');
        }

        // تخزين معلومات المستخدم في الطلب
        req.user = user;
        logger.info('تم التحقق من الجلسة بنجاح', {
            path: req.path,
            method: req.method,
            userId: user.id
        });
        next();
    } catch (error) {
        logger.error('خطأ في التحقق من الجلسة', {
            path: req.path,
            method: req.method,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            session: req.session,
            headers: req.headers
        });
        return handleAuthError(req, res, 'حدث خطأ في التحقق من الجلسة');
    }
}

/**
 * معالجة أخطاء المصادقة
 */
function handleAuthError(req, res, message) {
    const isApiRequest = req.xhr || req.path.startsWith('/api/');
    
    if (isApiRequest) {
        return res.status(401).json({
            success: false,
            error: message
        });
    }

    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login.html?redirect=${returnTo}`);
}

/**
 * إنهاء الجلسة
 */
async function destroySession(req) {
    return new Promise((resolve) => {
        if (req.session) {
            req.session.destroy((err) => {
                if (err) {
                    logger.error('خطأ في إنهاء الجلسة', {
                        error: err.message,
                        session: req.session
                    });
                }
                resolve();
            });
        } else {
            resolve();
        }
    });
}

/**
 * التحقق من ملكية الجهاز
 */
async function validateDeviceOwnership(req, res, next) {
    try {
        const { deviceId } = req.params;
        const userId = req.user?.id;

        if (!deviceId || !userId) {
            logger.error('بيانات غير مكتملة للتحقق من ملكية الجهاز', {
                path: req.path,
                method: req.method,
                deviceId,
                userId,
                user: req.user
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
                deviceOwnerId: device?.userId,
                device: device
            });
            return res.status(403).json({
                success: false,
                message: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        // تخزين معلومات الجهاز في الطلب
        req.device = device;
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
            userId: req.user?.id,
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

module.exports = {
    validateSession,
    validateDeviceOwnership
}; 