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
        if (!req.session || !req.session.user || !req.session.user.id) {
            logger.error('محاولة إضافة جهاز بدون تسجيل دخول');
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        const userId = req.session.user.id;

        if (!name || name.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'يجب أن يكون اسم الجهاز 3 أحرف على الأقل'
            });
        }

        // إنشاء معرف فريد للجهاز
        const deviceId = generateDeviceId();

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
        await firebase.saveDevice(deviceId, deviceData);
        logger.device('تم إضافة جهاز جديد', { deviceId, name }, userId);

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
        // التحقق من وجود جلسة وهوية المستخدم
        if (!req.session || !req.session.user || !req.session.user.id) {
            logger.error('محاولة جلب الأجهزة بدون تسجيل دخول');
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        const userId = req.session.user.id;
        
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
            message: 'حدث خطأ أثناء جلب الأجهزة'
        });
    }
});

// حذف جهاز
router.delete('/:deviceId', validateDeviceOwnership, async (req, res) => {
    try {
        const { deviceId } = req.params;
        
        // التحقق من وجود جلسة وهوية المستخدم
        if (!req.session || !req.session.user || !req.session.user.id) {
            logger.error('محاولة حذف جهاز بدون تسجيل دخول');
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        const userId = req.session.user.id;
        
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
            message: 'حدث خطأ أثناء حذف الجهاز'
        });
    }
});

module.exports = router; 