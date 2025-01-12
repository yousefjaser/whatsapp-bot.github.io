const express = require('express');
const router = express.Router();
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const logger = require('../utils/logger');
const firebase = require('../utils/firebase');

// تخزين جلسات WhatsApp
const clientSessions = new Map();

/**
 * الحصول على حالة الاتصال
 */
router.get('/status/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const client = clientSessions.get(deviceId);

        // تسجيل محاولة الوصول
        await logger.device('محاولة التحقق من حالة الجهاز', {
            deviceId,
            userId: req.user.id
        });

        if (!client) {
            return res.json({
                status: 'disconnected',
                message: 'الجهاز غير متصل'
            });
        }

        return res.json({
            status: client.status || 'disconnected',
            message: client.statusMessage || 'الجهاز غير متصل'
        });

    } catch (error) {
        console.error('خطأ في التحقق من حالة الجهاز:', error);
        await logger.error('خطأ في التحقق من حالة الجهاز', {
            error: error.message,
            deviceId: req.params.deviceId
        });
        res.status(500).json({
            error: 'حدث خطأ أثناء التحقق من حالة الجهاز'
        });
    }
});

/**
 * بدء جلسة جديدة
 */
router.post('/session/start/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        
        // التحقق من عدم وجود جلسة نشطة
        if (clientSessions.has(deviceId)) {
            const existingClient = clientSessions.get(deviceId);
            if (existingClient.status === 'connected') {
                return res.status(400).json({
                    error: 'الجهاز متصل بالفعل'
                });
            }
            // إنهاء الجلسة القديمة
            await existingClient.destroy();
            clientSessions.delete(deviceId);
        }

        // إنشاء عميل جديد
        const client = new Client({
            puppeteer: {
                args: ['--no-sandbox']
            }
        });

        // تخزين العميل
        clientSessions.set(deviceId, client);
        client.status = 'initializing';
        client.statusMessage = 'جاري تهيئة الجلسة...';
        client.qr = null;

        // معالجة الأحداث
        client.on('qr', async (qr) => {
            try {
                client.qr = await qrcode.toDataURL(qr);
                client.status = 'qr_ready';
                client.statusMessage = 'جاري انتظار مسح رمز QR...';
                
                await logger.device('تم إنشاء رمز QR جديد', {
                    deviceId,
                    userId: req.user.id
                });
            } catch (error) {
                console.error('خطأ في إنشاء رمز QR:', error);
                await logger.error('خطأ في إنشاء رمز QR', {
                    error: error.message,
                    deviceId
                });
            }
        });

        client.on('ready', async () => {
            try {
                client.status = 'connected';
                client.statusMessage = 'متصل';
                client.qr = null;

                // تحديث حالة الجهاز في قاعدة البيانات
                await firebase.updateDeviceStatus(deviceId, 'connected');
                
                await logger.device('تم الاتصال بنجاح', {
                    deviceId,
                    userId: req.user.id
                });
            } catch (error) {
                console.error('خطأ في معالجة حدث ready:', error);
                await logger.error('خطأ في معالجة حدث ready', {
                    error: error.message,
                    deviceId
                });
            }
        });

        client.on('authenticated', async () => {
            try {
                client.status = 'authenticated';
                client.statusMessage = 'تم المصادقة';
                
                await logger.device('تم المصادقة بنجاح', {
                    deviceId,
                    userId: req.user.id
                });
            } catch (error) {
                console.error('خطأ في معالجة حدث authenticated:', error);
                await logger.error('خطأ في معالجة حدث authenticated', {
                    error: error.message,
                    deviceId
                });
            }
        });

        client.on('auth_failure', async (error) => {
            try {
                client.status = 'auth_failed';
                client.statusMessage = 'فشل المصادقة';
                
                await logger.error('فشل المصادقة', {
                    error: error.message,
                    deviceId,
                    userId: req.user.id
                });

                // تحديث حالة الجهاز في قاعدة البيانات
                await firebase.updateDeviceStatus(deviceId, 'disconnected');
            } catch (error) {
                console.error('خطأ في معالجة حدث auth_failure:', error);
                await logger.error('خطأ في معالجة حدث auth_failure', {
                    error: error.message,
                    deviceId
                });
            }
        });

        client.on('disconnected', async () => {
            try {
                client.status = 'disconnected';
                client.statusMessage = 'تم قطع الاتصال';
                client.qr = null;

                // تحديث حالة الجهاز في قاعدة البيانات
                await firebase.updateDeviceStatus(deviceId, 'disconnected');
                
                await logger.device('تم قطع الاتصال', {
                    deviceId,
                    userId: req.user.id
                });

                // إزالة العميل من الذاكرة
                clientSessions.delete(deviceId);
            } catch (error) {
                console.error('خطأ في معالجة حدث disconnected:', error);
                await logger.error('خطأ في معالجة حدث disconnected', {
                    error: error.message,
                    deviceId
                });
            }
        });

        // بدء تشغيل العميل
        await client.initialize();

        res.json({
            status: 'initializing',
            message: 'جاري تهيئة الجلسة...'
        });

    } catch (error) {
        console.error('خطأ في بدء الجلسة:', error);
        await logger.error('خطأ في بدء الجلسة', {
            error: error.message,
            deviceId: req.params.deviceId
        });
        res.status(500).json({
            error: 'حدث خطأ أثناء بدء الجلسة'
        });
    }
});

/**
 * الحصول على رمز QR
 */
router.get('/qr/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const client = clientSessions.get(deviceId);

        // تسجيل محاولة الوصول
        await logger.device('محاولة الحصول على رمز QR', {
            deviceId,
            userId: req.user.id
        });

        if (!client) {
            return res.status(404).json({
                error: 'الجهاز غير موجود'
            });
        }

        if (!client.qr) {
            return res.status(404).json({
                error: 'رمز QR غير متوفر حالياً'
            });
        }

        res.json({
            qr: client.qr
        });

    } catch (error) {
        console.error('خطأ في جلب رمز QR:', error);
        await logger.error('خطأ في جلب رمز QR', {
            error: error.message,
            deviceId: req.params.deviceId
        });
        res.status(500).json({
            error: 'حدث خطأ أثناء جلب رمز QR'
        });
    }
});

/**
 * إنهاء الجلسة
 */
router.post('/session/end/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const client = clientSessions.get(deviceId);

        if (!client) {
            return res.status(404).json({
                error: 'الجهاز غير موجود'
            });
        }

        // تسجيل الحدث
        await logger.device('جاري إنهاء الجلسة', {
            deviceId,
            userId: req.user.id
        });

        // إنهاء الجلسة
        await client.destroy();
        clientSessions.delete(deviceId);

        // تحديث حالة الجهاز في قاعدة البيانات
        await firebase.updateDeviceStatus(deviceId, 'disconnected');

        res.json({
            status: 'success',
            message: 'تم إنهاء الجلسة بنجاح'
        });

    } catch (error) {
        console.error('خطأ في إنهاء الجلسة:', error);
        await logger.error('خطأ في إنهاء الجلسة', {
            error: error.message,
            deviceId: req.params.deviceId
        });
        res.status(500).json({
            error: 'حدث خطأ أثناء إنهاء الجلسة'
        });
    }
});

module.exports = router; 