const express = require('express');
const router = express.Router();
const firebase = require('../utils/firebase');
const logger = require('../utils/logger');
const validation = require('../utils/validation');

// إضافة جهاز جديد
router.post('/add', async (req, res) => {
    try {
        const { name, description } = req.body;
        const userId = req.session.userId;

        // التحقق من اسم الجهاز
        if (!name || name.trim().length < 3) {
            return res.json({
                success: false,
                error: 'اسم الجهاز يجب أن يكون 3 أحرف على الأقل'
            });
        }

        // إنشاء الجهاز
        const device = await firebase.saveDevice({
            name: name.trim(),
            description: description?.trim() || '',
            userId,
            status: 'disconnected',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        // تسجيل الحدث
        logger.info(`تم إضافة جهاز جديد: ${name}`, { userId, deviceId: device.id });

        return res.json({
            success: true,
            device
        });

    } catch (error) {
        logger.error('خطأ في إضافة جهاز جديد:', error);
        return res.json({
            success: false,
            error: 'حدث خطأ في إضافة الجهاز'
        });
    }
});

// الحصول على قائمة الأجهزة
router.get('/', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { limit = 10, offset = 0 } = req.query;

        // جلب الأجهزة
        const devices = await firebase.getUserDevices(userId, {
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        return res.json({
            success: true,
            devices
        });

    } catch (error) {
        logger.error('خطأ في جلب قائمة الأجهزة:', error);
        return res.json({
            success: false,
            error: 'حدث خطأ في جلب قائمة الأجهزة'
        });
    }
});

// تحديث معلومات الجهاز
router.put('/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { name, description } = req.body;
        const userId = req.session.userId;

        // التحقق من وجود الجهاز
        const device = await firebase.getDevice(deviceId);
        if (!device) {
            return res.json({
                success: false,
                error: 'الجهاز غير موجود'
            });
        }

        // التحقق من ملكية الجهاز
        if (device.userId !== userId) {
            return res.json({
                success: false,
                error: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        // التحقق من اسم الجهاز
        if (name && name.trim().length < 3) {
            return res.json({
                success: false,
                error: 'اسم الجهاز يجب أن يكون 3 أحرف على الأقل'
            });
        }

        // تحديث معلومات الجهاز
        const updates = {
            updatedAt: new Date()
        };

        if (name) updates.name = name.trim();
        if (description !== undefined) updates.description = description?.trim() || '';

        await firebase.updateDevice(deviceId, updates);

        // تسجيل الحدث
        logger.info(`تم تحديث معلومات الجهاز: ${deviceId}`, { userId });

        return res.json({
            success: true,
            message: 'تم تحديث معلومات الجهاز بنجاح'
        });

    } catch (error) {
        logger.error('خطأ في تحديث معلومات الجهاز:', error);
        return res.json({
            success: false,
            error: 'حدث خطأ في تحديث معلومات الجهاز'
        });
    }
});

// حذف جهاز
router.delete('/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;

        // التحقق من وجود الجهاز
        const device = await firebase.getDevice(deviceId);
        if (!device) {
            return res.json({
                success: false,
                error: 'الجهاز غير موجود'
            });
        }

        // التحقق من ملكية الجهاز
        if (device.userId !== userId) {
            return res.json({
                success: false,
                error: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        // حذف الجهاز
        await firebase.deleteDevice(deviceId);

        // تسجيل الحدث
        logger.info(`تم حذف الجهاز: ${deviceId}`, { userId });

        return res.json({
            success: true,
            message: 'تم حذف الجهاز بنجاح'
        });

    } catch (error) {
        logger.error('خطأ في حذف الجهاز:', error);
        return res.json({
            success: false,
            error: 'حدث خطأ في حذف الجهاز'
        });
    }
});

// الحصول على رسائل الجهاز
router.get('/:deviceId/messages', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;
        const { limit = 10, offset = 0 } = req.query;

        // التحقق من وجود الجهاز
        const device = await firebase.getDevice(deviceId);
        if (!device) {
            return res.json({
                success: false,
                error: 'الجهاز غير موجود'
            });
        }

        // التحقق من ملكية الجهاز
        if (device.userId !== userId) {
            return res.json({
                success: false,
                error: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        // جلب الرسائل
        const messages = await firebase.getUserMessages(userId, {
            deviceId,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        return res.json({
            success: true,
            messages
        });

    } catch (error) {
        logger.error('خطأ في جلب رسائل الجهاز:', error);
        return res.json({
            success: false,
            error: 'حدث خطأ في جلب رسائل الجهاز'
        });
    }
});

module.exports = router; 