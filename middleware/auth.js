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
    '/500.html',
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/status',
    '/api/v1/send'
];

// التحقق من الجلسة
const validateSession = async (req, res, next) => {
    try {
        // تجاهل الملفات الثابتة والمسارات العامة
        if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg)$/) ||
            publicPaths.some(path => req.path === path || req.path.startsWith(path + '/')) ||
            req.path.startsWith('/api/auth/') ||
            req.path.startsWith('/api/v1/')) {
            return next();
        }

        // التحقق من وجود جلسة صالحة
        if (!req.session || !req.session.userId) {
            console.log('جلسة غير صالحة:', req.path);
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(401).json({
                    success: false,
                    error: 'يرجى تسجيل الدخول أولاً'
                });
            }
            return res.redirect('/login.html?redirect=' + encodeURIComponent(req.path));
        }

        // التحقق من صلاحية الجلسة
        try {
            const sessionUser = await admin.auth().getUser(req.session.userId);
            if (!sessionUser) {
                throw new Error('المستخدم غير موجود');
            }
            req.user = sessionUser;
            next();
        } catch (error) {
            console.error('خطأ في التحقق من المستخدم:', error);
            req.session.destroy();
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(401).json({
                    success: false,
                    error: 'انتهت صلاحية الجلسة'
                });
            }
            res.redirect('/login.html');
        }
    } catch (error) {
        console.error('خطأ في التحقق من الجلسة:', error);
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(500).json({
                success: false,
                error: 'حدث خطأ في التحقق من الجلسة'
            });
        }
        res.redirect('/login.html');
    }
};

module.exports = { validateSession }; 