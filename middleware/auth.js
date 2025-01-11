const admin = require('firebase-admin');

// التحقق من صحة الجلسة
const validateSession = async (req, res, next) => {
    try {
        // التحقق من وجود جلسة
        if (!req.session || !req.session.userId) {
            return res.status(401).json({
                success: false,
                error: 'غير مصرح بالوصول',
                details: 'يجب تسجيل الدخول أولاً'
            });
        }

        // التحقق من وجود المستخدم في Firebase
        const userDoc = await admin.firestore()
            .collection('users')
            .doc(req.session.userId)
            .get();

        if (!userDoc.exists) {
            return res.status(401).json({
                success: false,
                error: 'غير مصرح بالوصول',
                details: 'المستخدم غير موجود'
            });
        }

        // إضافة بيانات المستخدم للطلب
        req.user = {
            id: userDoc.id,
            ...userDoc.data()
        };

        next();
    } catch (error) {
        console.error('خطأ في التحقق من الجلسة:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في التحقق من الجلسة'
        });
    }
};

module.exports = {
    validateSession
}; 