const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const firebase = require('../utils/firebase');
const logger = require('../utils/logger');
const { validateDeviceOwnership } = require('../middleware/auth');
const { clientSessions } = require('../utils/whatsapp');
const crypto = require('crypto');

// دالة لإنشاء معرف فريد من 18 حرف
function generateDeviceId() {
    return crypto.randomBytes(9).toString('hex'); // 9 bytes = 18 characters in hex
}

// إضافة جهاز جديد
router.post('/add', async (req, res) => {
    try {
        const { name, description } = req.body;
        
        // التحقق من وجود جلسة وهوية المستخدم
        if (!req.session) {
            logger.error('لا توجد جلسة');
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً - لا توجد جلسة'
            });
        }

        if (!req.session.userId) {
            logger.error('لا يوجد معرف للمستخدم في الجلسة');
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        const userId = req.session.userId;
        logger.info('بدء إضافة جهاز جديد', { userId, name });

        if (!name || name.length < 3) {
            logger.warning('محاولة إضافة جهاز باسم غير صالح', { name });
            return res.status(400).json({
                success: false,
                message: 'يجب أن يكون اسم الجهاز 3 أحرف على الأقل'
            });
        }

        // إنشاء معرف فريد للجهاز
        const deviceId = generateDeviceId();
        logger.info('تم إنشاء معرف للجهاز', { deviceId });

        const deviceData = {
            deviceId,
            name,
            description: description || '',
            userId,
            status: 'disconnected',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // حفظ الجهاز في Firestore
        logger.info('محاولة حفظ الجهاز', deviceData);
        await firebase.saveDevice(deviceId, deviceData);
        logger.device('تم إضافة جهاز جديد', { deviceId, name }, userId);

        res.json({
            success: true,
            deviceId,
            message: 'تم إضافة الجهاز بنجاح'
        });
    } catch (error) {
        logger.error('خطأ في إضافة الجهاز', { 
            error: error.message,
            stack: error.stack,
            name: error.name
        });
        res.status(500).json({
            success: false,
            message: `حدث خطأ أثناء إضافة الجهاز: ${error.message}`
        });
    }
});

// الحصول على قائمة الأجهزة
router.get('/', async (req, res) => {
    try {
        // التحقق من وجود جلسة وهوية المستخدم
        if (!req.session || !req.session.userId) {
            logger.error('محاولة جلب الأجهزة بدون تسجيل دخول');
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        const userId = req.session.userId;
        
        // جلب الأجهزة الخاصة بالمستخدم فقط
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
            message: `حدث خطأ في تحميل الأجهزة: ${error.message}`
        });
    }
});

// حذف جهاز
router.delete('/:deviceId', validateDeviceOwnership, async (req, res) => {
    try {
        const { deviceId } = req.params;
        
        // التحقق من وجود جلسة وهوية المستخدم
        if (!req.session || !req.session.userId) {
            logger.error('محاولة حذف جهاز بدون تسجيل دخول');
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        const userId = req.session.userId;
        
        // التحقق من وجود جلسة نشطة وإنهاؤها
        if (clientSessions.has(deviceId)) {
            const client = clientSessions.get(deviceId);
            await client.destroy();
            clientSessions.delete(deviceId);
        }

        // حذف الجهاز من قاعدة البيانات
        await firebase.deleteDevice(deviceId);
        logger.device('تم حذف الجهاز', { deviceId }, userId);

        res.json({
            success: true,
            message: 'تم حذف الجهاز بنجاح'
        });
    } catch (error) {
        logger.error('خطأ في حذف الجهاز', { error: error.message });
        res.status(500).json({
            success: false,
            message: `حدث خطأ أثناء حذف الجهاز: ${error.message}`
        });
    }
});

module.exports = router; 