const admin = require('firebase-admin');

// التحقق من الجلسة
const validateSession = async (req, res, next) => {
    console.log('بدء التحقق من الجلسة للمسار:', req.path);
    
    try {
        // التحقق من وجود جلسة صالحة
        if (!req.session) {
            console.log('لا توجد جلسة');
            return handleAuthError(req, res, 'يرجى تسجيل الدخول أولاً');
        }

        if (!req.session.userId) {
            console.log('لا يوجد معرف مستخدم في الجلسة');
            return handleAuthError(req, res, 'يرجى تسجيل الدخول أولاً');
        }

        console.log('معرف المستخدم في الجلسة:', req.session.userId);

        // التحقق من صلاحية الجلسة باستخدام Firestore
        try {
            const userDoc = await admin.firestore()
                .collection('users')
                .doc(req.session.userId)
                .get();

            if (!userDoc.exists) {
                console.log('المستخدم غير موجود في Firestore:', req.session.userId);
                throw new Error('المستخدم غير موجود');
            }

            const userData = userDoc.data();
            req.user = {
                id: userDoc.id,
                ...userData
            };

            console.log('تم التحقق من المستخدم بنجاح:', req.user.email);
            next();
        } catch (error) {
            console.error('خطأ في التحقق من المستخدم في Firestore:', error);
            req.session.destroy(() => {
                handleAuthError(req, res, 'انتهت صلاحية الجلسة');
            });
        }
    } catch (error) {
        console.error('خطأ عام في التحقق من الجلسة:', error);
        handleAuthError(req, res, 'حدث خطأ في التحقق من الجلسة');
    }
};

// معالجة أخطاء المصادقة
const handleAuthError = (req, res, message) => {
    if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(401).json({
            success: false,
            error: message
        });
    }
    res.redirect('/login.html?redirect=' + encodeURIComponent(req.path));
};

module.exports = { validateSession }; 