const admin = require('firebase-admin');

// التحقق من الجلسة
const validateSession = async (req, res, next) => {
    const path = req.path;
    console.log('بدء التحقق من الجلسة للمسار:', path);
    
    try {
        // التحقق من وجود جلسة صالحة
        if (!req.session) {
            console.log('لا توجد جلسة للمسار:', path);
            return handleAuthError(req, res, 'يرجى تسجيل الدخول أولاً');
        }

        if (!req.session.userId) {
            console.log('لا يوجد معرف مستخدم في الجلسة للمسار:', path);
            return handleAuthError(req, res, 'يرجى تسجيل الدخول أولاً');
        }

        console.log('معرف المستخدم في الجلسة:', req.session.userId, 'للمسار:', path);

        // التحقق من صلاحية الجلسة باستخدام Firestore
        try {
            const userDoc = await admin.firestore()
                .collection('users')
                .doc(req.session.userId)
                .get();

            if (!userDoc.exists) {
                console.log('المستخدم غير موجود في Firestore:', req.session.userId, 'للمسار:', path);
                throw new Error('المستخدم غير موجود');
            }

            const userData = userDoc.data();
            req.user = {
                id: userDoc.id,
                ...userData
            };

            console.log('تم التحقق من المستخدم بنجاح:', req.user.email, 'للمسار:', path);
            return next();
        } catch (error) {
            console.error('خطأ في التحقق من المستخدم في Firestore للمسار:', path, error);
            return new Promise((resolve) => {
                req.session.destroy(() => {
                    resolve(handleAuthError(req, res, 'انتهت صلاحية الجلسة'));
                });
            });
        }
    } catch (error) {
        console.error('خطأ عام في التحقق من الجلسة للمسار:', path, error);
        return handleAuthError(req, res, 'حدث خطأ في التحقق من الجلسة');
    }
};

// معالجة أخطاء المصادقة
const handleAuthError = (req, res, message) => {
    const path = req.path;
    console.log('معالجة خطأ المصادقة للمسار:', path, 'الرسالة:', message);

    if (req.xhr || path.startsWith('/api/')) {
        return res.status(401).json({
            success: false,
            error: message
        });
    }

    const redirectUrl = '/login.html?redirect=' + encodeURIComponent(path);
    console.log('إعادة توجيه إلى:', redirectUrl);
    return res.redirect(redirectUrl);
};

module.exports = { validateSession }; 