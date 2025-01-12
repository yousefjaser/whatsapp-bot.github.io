const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { validateSession } = require('../middleware/auth');

/**
 * التحقق من صلاحيات المشرف
 */
async function validateAdmin(req, res, next) {
    try {
        const userDoc = await admin.firestore()
            .collection('users')
            .doc(req.user.id)
            .get();

        if (!userDoc.exists || userDoc.data().role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بالوصول'
            });
        }

        next();
    } catch (error) {
        console.error('خطأ في التحقق من صلاحيات المشرف:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في التحقق من الصلاحيات'
        });
    }
}

/**
 * الحصول على إحصائيات النظام
 */
router.get('/stats', validateSession, validateAdmin, async (req, res) => {
    console.log('جلب إحصائيات النظام');
    
    try {
        // إحصائيات المستخدمين
        const usersSnapshot = await admin.firestore()
            .collection('users')
            .count()
            .get();

        // إحصائيات الأجهزة
        const devicesSnapshot = await admin.firestore()
            .collection('devices')
            .count()
            .get();

        // إحصائيات الرسائل
        const messagesSnapshot = await admin.firestore()
            .collection('messages')
            .count()
            .get();

        // إحصائيات الرسائل اليوم
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const todayMessagesSnapshot = await admin.firestore()
            .collection('messages')
            .where('createdAt', '>=', today)
            .count()
            .get();

        return res.json({
            success: true,
            stats: {
                users: usersSnapshot.data().count,
                devices: devicesSnapshot.data().count,
                messages: {
                    total: messagesSnapshot.data().count,
                    today: todayMessagesSnapshot.data().count
                }
            }
        });

    } catch (error) {
        console.error('خطأ في جلب إحصائيات النظام:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب الإحصائيات'
        });
    }
});

/**
 * الحصول على قائمة المستخدمين
 */
router.get('/users', validateSession, validateAdmin, async (req, res) => {
    console.log('جلب قائمة المستخدمين');
    
    try {
        const { limit = 10, page = 1, search } = req.query;
        const skip = (page - 1) * limit;

        let query = admin.firestore().collection('users');

        // البحث في المستخدمين
        if (search) {
            query = query.where('email', '>=', search.toLowerCase())
                        .where('email', '<=', search.toLowerCase() + '\uf8ff');
        }

        // جلب المستخدمين
        const snapshot = await query
            .orderBy('email')
            .limit(parseInt(limit))
            .offset(skip)
            .get();

        const users = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            password: undefined,
            createdAt: doc.data().createdAt?.toDate(),
            lastLogin: doc.data().lastLogin?.toDate()
        }));

        // جلب العدد الكلي
        const totalSnapshot = await query.count().get();

        return res.json({
            success: true,
            users,
            pagination: {
                total: totalSnapshot.data().count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalSnapshot.data().count / limit)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب قائمة المستخدمين:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب قائمة المستخدمين'
        });
    }
});

/**
 * تحديث حالة المستخدم
 */
router.put('/users/:userId/status', validateSession, validateAdmin, async (req, res) => {
    console.log('تحديث حالة المستخدم:', req.params.userId);
    
    try {
        const { userId } = req.params;
        const { active } = req.body;

        if (typeof active !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'يجب تحديد حالة المستخدم'
            });
        }

        const userRef = admin.firestore().collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'المستخدم غير موجود'
            });
        }

        // لا يمكن تعديل حالة المشرف
        if (userDoc.data().role === 'admin') {
            return res.status(403).json({
                success: false,
                error: 'لا يمكن تعديل حالة المشرف'
            });
        }

        // تحديث حالة المستخدم
        await userRef.update({
            active,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({
            success: true,
            message: `تم ${active ? 'تفعيل' : 'تعطيل'} المستخدم بنجاح`
        });

    } catch (error) {
        console.error('خطأ في تحديث حالة المستخدم:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في تحديث حالة المستخدم'
        });
    }
});

/**
 * حذف مستخدم
 */
router.delete('/users/:userId', validateSession, validateAdmin, async (req, res) => {
    console.log('حذف المستخدم:', req.params.userId);
    
    try {
        const { userId } = req.params;

        const userRef = admin.firestore().collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'المستخدم غير موجود'
            });
        }

        // لا يمكن حذف المشرف
        if (userDoc.data().role === 'admin') {
            return res.status(403).json({
                success: false,
                error: 'لا يمكن حذف المشرف'
            });
        }

        // حذف الأجهزة المرتبطة
        const devicesSnapshot = await admin.firestore()
            .collection('devices')
            .where('userId', '==', userId)
            .get();

        const batch = admin.firestore().batch();
        devicesSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        // حذف الرسائل المرتبطة
        const messagesSnapshot = await admin.firestore()
            .collection('messages')
            .where('userId', '==', userId)
            .get();

        messagesSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        // حذف المستخدم
        batch.delete(userRef);

        // تنفيذ عمليات الحذف
        await batch.commit();

        return res.json({
            success: true,
            message: 'تم حذف المستخدم وجميع بياناته بنجاح'
        });

    } catch (error) {
        console.error('خطأ في حذف المستخدم:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في حذف المستخدم'
        });
    }
});

/**
 * الحصول على سجل النظام
 */
router.get('/logs', validateSession, validateAdmin, async (req, res) => {
    console.log('جلب سجل النظام');
    
    try {
        const { limit = 50, page = 1, type } = req.query;
        const skip = (page - 1) * limit;

        let query = admin.firestore().collection('system_logs');

        // تصفية حسب النوع
        if (type) {
            query = query.where('type', '==', type);
        }

        // جلب السجلات
        const snapshot = await query
            .orderBy('timestamp', 'desc')
            .limit(parseInt(limit))
            .offset(skip)
            .get();

        const logs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate()
        }));

        // جلب العدد الكلي
        const totalSnapshot = await query.count().get();

        return res.json({
            success: true,
            logs,
            pagination: {
                total: totalSnapshot.data().count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalSnapshot.data().count / limit)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب سجل النظام:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب سجل النظام'
        });
    }
});

module.exports = router; 