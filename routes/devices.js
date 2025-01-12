const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { validateSession } = require('../middleware/auth');

/**
 * إضافة جهاز جديد
 */
router.post('/add', validateSession, async (req, res) => {
    console.log('إضافة جهاز جديد للمستخدم:', req.user.id);
    
    try {
        const { name, description } = req.body;

        // التحقق من البيانات المطلوبة
        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'اسم الجهاز مطلوب'
            });
        }

        // إنشاء الجهاز
        const deviceData = {
            name,
            description: description || '',
            userId: req.user.id,
            status: 'disconnected',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastConnection: null,
            metadata: {
                browser: req.headers['user-agent'],
                ip: req.ip
            }
        };

        const deviceRef = await admin.firestore()
            .collection('devices')
            .add(deviceData);

        return res.json({
            success: true,
            device: {
                id: deviceRef.id,
                ...deviceData
            }
        });

    } catch (error) {
        console.error('خطأ في إضافة الجهاز:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في إضافة الجهاز'
        });
    }
});

/**
 * تحديث معلومات الجهاز
 */
router.put('/:deviceId', validateSession, async (req, res) => {
    console.log('تحديث معلومات الجهاز:', req.params.deviceId);
    
    try {
        const { deviceId } = req.params;
        const { name, description } = req.body;

        // التحقق من وجود الجهاز وملكيته
        const deviceRef = admin.firestore().collection('devices').doc(deviceId);
        const device = await deviceRef.get();

        if (!device.exists) {
            return res.status(404).json({
                success: false,
                error: 'الجهاز غير موجود'
            });
        }

        if (device.data().userId !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بتعديل هذا الجهاز'
            });
        }

        // تحديث البيانات
        const updates = {};
        if (name) updates.name = name;
        if (description !== undefined) updates.description = description;
        
        await deviceRef.update({
            ...updates,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({
            success: true,
            message: 'تم تحديث معلومات الجهاز بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تحديث الجهاز:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في تحديث الجهاز'
        });
    }
});

/**
 * حذف جهاز
 */
router.delete('/:deviceId', validateSession, async (req, res) => {
    console.log('حذف الجهاز:', req.params.deviceId);
    
    try {
        const { deviceId } = req.params;

        // التحقق من وجود الجهاز وملكيته
        const deviceRef = admin.firestore().collection('devices').doc(deviceId);
        const device = await deviceRef.get();

        if (!device.exists) {
            return res.status(404).json({
                success: false,
                error: 'الجهاز غير موجود'
            });
        }

        if (device.data().userId !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بحذف هذا الجهاز'
            });
        }

        // حذف الجهاز
        await deviceRef.delete();

        return res.json({
            success: true,
            message: 'تم حذف الجهاز بنجاح'
        });

    } catch (error) {
        console.error('خطأ في حذف الجهاز:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في حذف الجهاز'
        });
    }
});

/**
 * الحصول على قائمة الأجهزة
 */
router.get('/', validateSession, async (req, res) => {
    console.log('جلب قائمة الأجهزة للمستخدم:', req.user.id);
    
    try {
        const { limit = 10, page = 1 } = req.query;
        const skip = (page - 1) * limit;

        // جلب الأجهزة
        const snapshot = await admin.firestore()
            .collection('devices')
            .where('userId', '==', req.user.id)
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit))
            .offset(skip)
            .get();

        const devices = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate(),
            lastConnection: doc.data().lastConnection?.toDate()
        }));

        // جلب العدد الكلي
        const totalSnapshot = await admin.firestore()
            .collection('devices')
            .where('userId', '==', req.user.id)
            .count()
            .get();

        return res.json({
            success: true,
            devices,
            pagination: {
                total: totalSnapshot.data().count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalSnapshot.data().count / limit)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب قائمة الأجهزة:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب قائمة الأجهزة'
        });
    }
});

/**
 * الحصول على معلومات جهاز محدد
 */
router.get('/:deviceId', validateSession, async (req, res) => {
    console.log('جلب معلومات الجهاز:', req.params.deviceId);
    
    try {
        const { deviceId } = req.params;

        // التحقق من وجود الجهاز وملكيته
        const deviceRef = admin.firestore().collection('devices').doc(deviceId);
        const device = await deviceRef.get();

        if (!device.exists) {
            return res.status(404).json({
                success: false,
                error: 'الجهاز غير موجود'
            });
        }

        if (device.data().userId !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بعرض هذا الجهاز'
            });
        }

        // جلب آخر الرسائل المرسلة من الجهاز
        const messages = await getDeviceMessages(deviceId);

        return res.json({
            success: true,
            device: {
                id: device.id,
                ...device.data(),
                createdAt: device.data().createdAt?.toDate(),
                lastConnection: device.data().lastConnection?.toDate()
            },
            messages
        });

    } catch (error) {
        console.error('خطأ في جلب معلومات الجهاز:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب معلومات الجهاز'
        });
    }
});

/**
 * جلب آخر الرسائل المرسلة من الجهاز
 */
async function getDeviceMessages(deviceId, limit = 5) {
    const snapshot = await admin.firestore()
        .collection('messages')
        .where('deviceId', '==', deviceId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()
    }));
}

module.exports = router; 