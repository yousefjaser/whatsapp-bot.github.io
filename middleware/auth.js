const admin = require('firebase-admin');

// قائمة المسارات المسموح بها بدون تسجيل دخول
const publicPaths = [
    '/',
    '/welcome.html',
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
    '/public',
    '/404.html',
    '/500.html'
];

// التحقق من الجلسة
const validateSession = async (req, res, next) => {
    try {
        // تجاهل الملفات الثابتة
        if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg)$/)) {
            return next();
        }

        // السماح بالوصول للمسارات العامة
        if (publicPaths.some(path => req.path === path || req.path.startsWith(path + '/'))) {
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