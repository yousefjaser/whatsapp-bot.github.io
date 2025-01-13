const express = require('express');
const router = express.Router();
const firebase = require('../utils/firebase');
const logger = require('../utils/logger');
const { validateDeviceOwnership } = require('../middleware/auth');
const { clientSessions } = require('../utils/whatsapp');

// إضافة جهاز جديد
router.post('/add', async (req, res) => {
    try {
        const { name, description } = req.body;
        const userId = req.session.userId;

        if (!name || name.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'يجب أن يكون اسم الجهاز 3 أحرف على الأقل'
            });
        }

        const deviceData = {
            name,
            description: description || '',
            userId,
            status: 'disconnected',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const deviceId = await firebase.saveDevice(deviceData);
        logger.info('تم إضافة جهاز جديد', { deviceId, name });

        res.json({
            success: true,
            deviceId,
            message: 'تم إضافة الجهاز بنجاح'
        });
    } catch (error) {
        logger.error('خطأ في إضافة الجهاز', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'حدث خطأ أثناء إضافة الجهاز'
        });
    }
});

// الحصول على قائمة الأجهزة
router.get('/', async (req, res) => {
    try {
        const userId = req.session.userId;
        const devices = await firebase.getUserDevices(userId);

        // إضافة حالة الاتصال الحالية لكل جهاز
        const devicesWithStatus = devices.map(device => ({
            ...device,
            isConnected: clientSessions.has(device.deviceId)
        }));

        res.json({
            success: true,
            devices: devicesWithStatus
        });
    } catch (error) {
        logger.error('خطأ في جلب الأجهزة', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'حدث خطأ أثناء جلب الأجهزة'
        });
    }
});

// حذف جهاز
router.delete('/:deviceId', validateDeviceOwnership, async (req, res) => {
    try {
        const { deviceId } = req.params;
        
        // التحقق من وجود جلسة نشطة وإنهاؤها
        if (clientSessions.has(deviceId)) {
            const client = clientSessions.get(deviceId);
            await client.destroy();
            clientSessions.delete(deviceId);
        }

        // حذف الجهاز من قاعدة البيانات
        await firebase.deleteDevice(deviceId);
        logger.info('تم حذف الجهاز', { deviceId });

        res.json({
            success: true,
            message: 'تم حذف الجهاز بنجاح'
        });
    } catch (error) {
        logger.error('خطأ في حذف الجهاز', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'حدث خطأ أثناء حذف الجهاز'
        });
    }
});

module.exports = router; 