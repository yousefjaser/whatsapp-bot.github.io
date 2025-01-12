const admin = require('firebase-admin');

/**
 * التحقق من صلاحية الجلسة
 */
const validateSession = async (req, res, next) => {
    const path = req.path;
    console.log('بدء التحقق من الجلسة للمسار:', path);
    
    try {
        // التحقق من وجود جلسة
        if (!req.session) {
            console.log('لا توجد جلسة للمسار:', path);
            return handleAuthError(req, res, 'يرجى تسجيل الدخول أولاً');
        }

        // التحقق من وجود معرف المستخدم
        if (!req.session.userId) {
            console.log('لا يوجد معرف مستخدم في الجلسة للمسار:', path);
            return handleAuthError(req, res, 'يرجى تسجيل الدخول أولاً');
        }

        // التحقق من صلاحية المستخدم في Firestore
        const userDoc = await getUserFromFirestore(req.session.userId);
        
        if (!userDoc) {
            console.log('المستخدم غير موجود في Firestore:', req.session.userId);
            return handleSessionDestroy(req, res);
        }

        // إضافة معلومات المستخدم للطلب
        req.user = {
            id: userDoc.id,
            ...userDoc.data()
        };

        console.log('تم التحقق من المستخدم بنجاح:', req.user.email, 'للمسار:', path);
        return next();
    } catch (error) {
        console.error('خطأ في التحقق من الجلسة:', error);
        return handleAuthError(req, res, 'حدث خطأ في التحقق من الجلسة');
    }
};

/**
 * الحصول على بيانات المستخدم من Firestore
 */
const getUserFromFirestore = async (userId) => {
    try {
        return await admin.firestore()
            .collection('users')
            .doc(userId)
            .get();
    } catch (error) {
        console.error('خطأ في جلب بيانات المستخدم من Firestore:', error);
        return null;
    }
};

/**
 * تدمير الجلسة وإعادة التوجيه
 */
const handleSessionDestroy = (req, res) => {
    return new Promise((resolve) => {
        req.session.destroy(() => {
            resolve(handleAuthError(req, res, 'انتهت صلاحية الجلسة'));
        });
    });
};

/**
 * معالجة أخطاء المصادقة
 */
const handleAuthError = (req, res, message) => {
    const path = req.path;
    console.log('معالجة خطأ المصادقة للمسار:', path, 'الرسالة:', message);

    // التعامل مع طلبات API
    if (req.xhr || path.startsWith('/api/')) {
        return res.status(401).json({
            success: false,
            error: message
        });
    }

    // إعادة التوجيه إلى صفحة تسجيل الدخول
    const redirectUrl = '/login.html' + (path !== '/' ? '?redirect=' + encodeURIComponent(path) : '');
    console.log('إعادة توجيه إلى:', redirectUrl);
    return res.redirect(redirectUrl);
};

module.exports = { validateSession }; 