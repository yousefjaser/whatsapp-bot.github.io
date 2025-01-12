const admin = require('firebase-admin');

// التحقق من الجلسة
const validateSession = async (req, res, next) => {
    try {
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

            console.log('تم التحقق من المستخدم:', req.user.email, 'للمسار:', req.path);
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