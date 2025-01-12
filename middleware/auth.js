const admin = require('firebase-admin');

// قائمة المسارات المسموح بها بدون تسجيل دخول
const publicPaths = [
    '/',
    '/login',
    '/login.html',
    '/register',
    '/register.html',
    '/reset-password',
    '/reset-password.html',
    '/api-docs',
    '/api-docs.html',
    '/api-dashboard',
    '/api-dashboard.html',
    '/docs',
    '/docs.html',
    '/css',
    '/js',
    '/images',
    '/favicon.ico',
    '/public'
];

// التحقق من الجلسة
const validateSession = async (req, res, next) => {
    try {
        // السماح بالوصول للمسارات العامة
        if (publicPaths.some(path => req.path.startsWith(path))) {
            return next();
        }

        // التحقق من وجود جلسة
        if (!req.session || !req.session.userId) {
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(401).json({
                    success: false,
                    error: 'غير مصرح بالوصول'
                });
            }
            return res.redirect('/login.html');
        }

        next();
    } catch (error) {
        console.error('خطأ في التحقق من الجلسة:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في التحقق من الجلسة'
        });
    }
};

module.exports = { validateSession }; 