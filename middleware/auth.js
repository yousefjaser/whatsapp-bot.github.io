const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');

module.exports = async (req, res, next) => {
    try {
        // التحقق من وجود التوكن
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'غير مصرح لك بالوصول' });
        }

        try {
            // التحقق من صحة التوكن
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // التحقق من وجود المستخدم في Firebase
            const user = await admin.auth().getUser(decoded.uid);
            
            // تخزين معلومات المستخدم
            req.user = {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName
            };
            
            next();
        } catch (error) {
            console.error('خطأ في التحقق من التوكن:', error);
            return res.status(401).json({ error: 'جلسة غير صالحة' });
        }
    } catch (error) {
        console.error('خطأ في التحقق من المصادقة:', error);
        return res.status(500).json({ error: 'حدث خطأ أثناء التحقق من المصادقة' });
    }
}; 