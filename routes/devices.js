const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const firebase = require('../utils/firebase');
const logger = require('../utils/logger');
const crypto = require('crypto');
const { clientSessions } = require('../utils/whatsapp');

// إنشاء معرف فريد للجهاز
function generateDeviceId() {
    return crypto.randomBytes(9).toString('hex');
}

/**
 * إضافة جهاز جديد
 */
router.post('/add', async (req, res) => {
    try {
        // تسجيل بداية العملية
        logger.info('بداية إضافة جهاز جديد', {
            body: req.body,
            session: req.session
        });

        const { name, description = '' } = req.body;
        const userId = req.session?.userId;

        // التحقق من وجود معرف المستخدم
        if (!userId) {
            logger.error('لا يوجد معرف مستخدم في الجلسة', {
                session: req.session
            });
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        // التحقق من اسم الجهاز
        if (!name || name.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'يجب أن يكون اسم الجهاز 3 أحرف على الأقل'
            });
        }

        // إنشاء معرف فريد للجهاز
        const deviceId = generateDeviceId();
        logger.info('تم إنشاء معرف للجهاز', { deviceId });

        // تجهيز بيانات الجهاز
        const deviceData = {
            deviceId,
            name,
            description,
            userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'disconnected'
        };

        // حفظ الجهاز في قاعدة البيانات
        await firebase.saveDevice(deviceId, deviceData);
        logger.info('تم حفظ الجهاز بنجاح', { deviceId, deviceData });

        res.json({
            success: true,
            message: 'تم إضافة الجهاز بنجاح',
            device: {
                ...deviceData,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        });
    } catch (error) {
        logger.error('خطأ في إضافة الجهاز', {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            body: req.body,
            session: req.session
        });
        res.status(500).json({
            success: false,
            message: 'حدث خطأ أثناء إضافة الجهاز',
            error: error.message
        });
    }
});

/**
 * الحصول على قائمة الأجهزة
 */
router.get('/', async (req, res) => {
    try {
        // تسجيل بداية العملية
        logger.info('بداية جلب الأجهزة', {
            session: req.session,
            headers: req.headers
        });

        const userId = req.session?.userId;
        
        if (!userId) {
            logger.error('لا يوجد معرف مستخدم في الجلسة عند جلب الأجهزة', {
                session: req.session
            });
            return res.status(401).json({
                success: false,
                message: 'يجب تسجيل الدخول أولاً'
            });
        }

        // جلب الأجهزة من قاعدة البيانات
        const devices = await firebase.getUserDevices(userId);
        logger.info('تم جلب الأجهزة بنجاح', { 
            userId,
            devicesCount: devices.length,
            devices: devices.map(d => ({ deviceId: d.deviceId, name: d.name }))
        });

        // إضافة حالة الاتصال لكل جهاز
        const devicesWithStatus = devices.map(device => ({
            ...device,
            isConnected: clientSessions.has(device.deviceId)
        }));

        res.json({
            success: true,
            devices: devicesWithStatus
        });
    } catch (error) {
        logger.error('خطأ في جلب الأجهزة', {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            userId: req.session?.userId,
            session: req.session
        });
        res.status(500).json({
            success: false,
            message: 'حدث خطأ أثناء جلب الأجهزة',
            error: error.message
        });
    }
});

module.exports = router; 