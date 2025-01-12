const { 
    AuthenticationError, 
    AuthorizationError, 
    NotFoundError 
} = require('./errors');
const firebase = require('./firebase');
const logger = require('./logger');

/**
 * المسارات العامة التي لا تحتاج إلى مصادقة
 */
const publicPaths = [
    '/',
    '/login.html',
    '/register.html',
    '/api-dashboard.html',
    '/docs.html',
    '/api-docs.html',
    '/css/',
    '/js/',
    '/images/',
    '/favicon.ico'
];

/**
 * المسارات العامة للـ API
 */
const publicApiPaths = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/status',
    '/api/v1/send'
];

/**
 * التحقق من المسار العام
 */
function isPublicPath(path) {
    path = path.toLowerCase();
    
    // التحقق من المسارات العامة
    if (publicPaths.some(p => path.startsWith(p.toLowerCase()))) {
        return true;
    }

    // التحقق من مسارات API العامة
    if (publicApiPaths.some(p => path.startsWith(p.toLowerCase()))) {
        return true;
    }

    return false;
}

/**
 * التحقق من الجلسة
 */
async function validateSession(req, res, next) {
    try {
        const path = req.path.toLowerCase();

        // تجاهل المسارات العامة
        if (isPublicPath(path)) {
            return next();
        }

        // التحقق من وجود جلسة
        if (!req.session || !req.session.userId) {
            // تجنب redirect loop في صفحة تسجيل الدخول
            if (path === '/login.html') {
                return next();
            }

            // تسجيل محاولة الوصول
            await logger.auth('محاولة وصول بدون مصادقة', {
                path: req.path,
                method: req.method,
                ip: req.ip,
                userAgent: req.get('user-agent')
            });

            // إذا كان الطلب من API
            if (path.startsWith('/api/')) {
                throw new AuthenticationError();
            }

            // إفظ المسار الأصلي للعودة إليه بعد تسجيل الدخول
            const returnTo = req.originalUrl !== '/login.html' ? req.originalUrl : '/';
            return res.redirect(`/login.html?redirect=${encodeURIComponent(returnTo)}`);
        }

        // التحقق من وجود المستخدم
        const user = await firebase.getUser(req.session.userId);
        if (!user) {
            // تدمير الجلسة
            await new Promise((resolve) => req.session.destroy(() => resolve()));
            
            // تسجيل الحدث
            await logger.auth('جلسة غير صالحة - المستخدم غير موجود', {
                userId: req.session.userId,
                path: req.path
            });

            throw new AuthenticationError('الجلسة غير صالحة');
        }

        // التحقق من حالة المستخدم
        if (!user.active) {
            // تدمير الجلسة
            await new Promise((resolve) => req.session.destroy(() => resolve()));
            throw new AuthorizationError('الحساب معطل');
        }

        // إضافة معلومات المستخدم للطلب
        req.user = user;

        // تحديث آخر نشاط
        await firebase.updateUser(user.id, {
            lastActive: new Date(),
            lastIp: req.ip,
            lastUserAgent: req.get('user-agent')
        });

        next();

    } catch (error) {
        next(error);
    }
}

/**
 * التحقق من صلاحيات المشرف
 */
async function validateAdmin(req, res, next) {
    try {
        if (!req.user) {
            throw new AuthenticationError();
        }

        if (req.user.role !== 'admin') {
            // تسجيل محاولة الوصول
            await logger.auth('محاولة وصول غير مصرح بها للوحة التحكم', {
                userId: req.user.id,
                path: req.path
            });
            
            throw new AuthorizationError();
        }

        next();
    } catch (error) {
        next(error);
    }
}

/**
 * التحقق من ملكية الجهاز
 */
async function validateDeviceOwnership(req, res, next) {
    try {
        const deviceId = req.params.deviceId;
        if (!deviceId) {
            throw new NotFoundError('معرف الجهاز مطلوب');
        }

        const device = await firebase.getDevice(deviceId);
        if (!device) {
            throw new NotFoundError('الجهاز غير موجود');
        }

        if (device.userId !== req.user.id && req.user.role !== 'admin') {
            // تسجيل محاولة الوصول
            await logger.auth('محاولة وصول غير مصرح بها للجهاز', {
                userId: req.user.id,
                deviceId,
                path: req.path
            });

            throw new AuthorizationError('لا يمكنك الوصول إلى هذا الجهاز');
        }

        // إضافة معلومات الجهاز للطلب
        req.device = device;
        next();

    } catch (error) {
        next(error);
    }
}

/**
 * إضافة معلومات الطلب
 */
function addRequestInfo(req, res, next) {
    // إضافة معلومات الطلب للتسجيل
    req.requestInfo = {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        referer: req.get('referer'),
        method: req.method,
        path: req.path,
        query: req.query,
        timestamp: new Date()
    };
    next();
}

/**
 * تصدير الدوال
 */
module.exports = {
    validateSession,
    validateAdmin,
    validateDeviceOwnership,
    addRequestInfo,
    isPublicPath
}; 