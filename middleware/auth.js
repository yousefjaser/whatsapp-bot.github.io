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

// قائمة مسارات API العامة
const publicApiPaths = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/status',
    '/api/v1/send'
];

// التحقق من الجلسة
const validateSession = async (req, res, next) => {
    try {
        const path = req.path.toLowerCase();
        console.log('التحقق من المسار:', path);

        // تجاهل الملفات الثابتة
        if (path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg)$/)) {
            console.log('ملف ثابت:', path);
            return next();
        }

        // تجاهل المسارات العامة
        const isPublicPath = publicPaths.some(p => {
            const match = path === p.toLowerCase() || path.startsWith(p.toLowerCase() + '/');
            if (match) console.log('تطابق مع المسار العام:', p);
            return match;
        });

        if (isPublicPath) {
            console.log('مسار عام:', path);
            return next();
        }

        // تجاهل مسارات API العامة
        const isPublicApiPath = publicApiPaths.some(p => {
            const match = path === p.toLowerCase() || path.startsWith(p.toLowerCase() + '/');
            if (match) console.log('تطابق مع مسار API العام:', p);
            return match;
        });

        if (isPublicApiPath) {
            console.log('مسار API عام:', path);
            return next();
        }

        // التحقق من وجود جلسة صالحة
        if (!req.session || !req.session.userId) {
            console.log('جلسة غير صالحة:', path);
            if (req.xhr || path.startsWith('/api/')) {
                return res.status(401).json({
                    success: false,
                    error: 'يرجى تسجيل الدخول أولاً'
                });
            }
            const redirectUrl = '/login.html' + (path !== '/' ? '?redirect=' + encodeURIComponent(path) : '');
            console.log('إعادة توجيه إلى:', redirectUrl);
            return res.redirect(redirectUrl);
        }

        // التحقق من صلاحية الجلسة باستخدام Firestore
        try {
            const userDoc = await admin.firestore()
                .collection('users')
                .doc(req.session.userId)
                .get();

            if (!userDoc.exists) {
                console.log('المستخدم غير موجود:', req.session.userId);
                throw new Error('المستخدم غير موجود');
            }

            const userData = userDoc.data();
            req.user = {
                id: userDoc.id,
                ...userData
            };

            console.log('تم التحقق من المستخدم:', req.user.email, 'للمسار:', path);
            next();
        } catch (error) {
            console.error('خطأ في التحقق من المستخدم:', error);
            req.session.destroy();
            if (req.xhr || path.startsWith('/api/')) {
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