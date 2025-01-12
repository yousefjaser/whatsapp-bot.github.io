const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { validateSession } = require('../middleware/auth');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');

// تخزين مؤقت لرموز QR
const qrCodes = new Map();

// إضافة جهاز جديد
router.post('/add', validateSession, async (req, res) => {
    try {
        const { name } = req.body;
        const userId = req.session.userId;

        // إنشاء وثيقة جديدة في مجموعة الأجهزة
        const deviceRef = await admin.firestore().collection('devices').add({
            name: name || 'جهاز جديد',
            userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending',
            lastConnection: null,
            isActive: true,
            sessionData: null,
            metadata: {
                browser: req.headers['user-agent'],
                ip: req.ip,
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            }
        });

        // إنشاء عميل WhatsApp جديد
        const client = new Client({
            puppeteer: {
                args: ['--no-sandbox']
            }
        });

        // الاستماع لحدث QR
        client.on('qr', async (qr) => {
            try {
                // تحويل نص QR إلى صورة base64
                const qrImage = await qrcode.toDataURL(qr);
                qrCodes.set(deviceRef.id, qrImage);
                
                // تحديث حالة الجهاز
                await deviceRef.update({
                    qrCode: qrImage,
                    status: 'awaiting_scan'
                });
            } catch (error) {
                console.error('خطأ في إنشاء رمز QR:', error);
            }
        });

        // الاستماع لحدث الاتصال
        client.on('ready', async () => {
            try {
                // تحديث حالة الجهاز عند الاتصال
                await deviceRef.update({
                    status: 'connected',
                    lastConnection: admin.firestore.FieldValue.serverTimestamp(),
                    qrCode: null
                });
                
                // حذف رمز QR من التخزين المؤقت
                qrCodes.delete(deviceRef.id);
            } catch (error) {
                console.error('خطأ في تحديث حالة الاتصال:', error);
            }
        });

        // بدء العميل
        client.initialize();

        res.json({
            success: true,
            deviceId: deviceRef.id,
            message: 'تم إضافة الجهاز بنجاح'
        });

    } catch (error) {
        console.error('خطأ في إضافة جهاز:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في إضافة الجهاز'
        });
    }
});

// الحصول على رمز QR
router.get('/qr/:deviceId', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;

        // التحقق من ملكية الجهاز
        const deviceRef = admin.firestore().collection('devices').doc(deviceId);
        const device = await deviceRef.get();

        if (!device.exists || device.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        // الحصول على رمز QR من التخزين المؤقت
        const qrCode = qrCodes.get(deviceId);
        
        if (!qrCode) {
            return res.status(404).json({
                success: false,
                error: 'رمز QR غير متوفر حالياً'
            });
        }

        res.json({
            success: true,
            qrCode
        });

    } catch (error) {
        console.error('خطأ في جلب رمز QR:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب رمز QR'
        });
    }
});

// تحديث حالة الجهاز وبيانات الجلسة
router.post('/update-session/:deviceId', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { sessionData, status } = req.body;
        const userId = req.session.userId;

        // التحقق من ملكية الجهاز
        const deviceRef = admin.firestore().collection('devices').doc(deviceId);
        const device = await deviceRef.get();

        if (!device.exists || device.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        // تحديث بيانات الجهاز
        await deviceRef.update({
            sessionData: sessionData || admin.firestore.FieldValue.delete(),
            status: status || 'disconnected',
            lastConnection: status === 'connected' ? admin.firestore.FieldValue.serverTimestamp() : null,
            'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            message: 'تم تحديث حالة الجهاز بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تحديث حالة الجهاز:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في تحديث حالة الجهاز'
        });
    }
});

// حذف جهاز
router.delete('/:deviceId', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;

        // التحقق من ملكية الجهاز
        const deviceRef = admin.firestore().collection('devices').doc(deviceId);
        const device = await deviceRef.get();

        if (!device.exists || device.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بحذف هذا الجهاز'
            });
        }

        // تحديث الجهاز كغير نشط بدلاً من حذفه
        await deviceRef.update({
            isActive: false,
            status: 'disconnected',
            sessionData: admin.firestore.FieldValue.delete(),
            'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp(),
            'metadata.deletedAt': admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            message: 'تم حذف الجهاز بنجاح'
        });

    } catch (error) {
        console.error('خطأ في حذف الجهاز:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في حذف الجهاز'
        });
    }
});

// الحصول على قائمة الأجهزة النشطة
router.get('/', validateSession, async (req, res) => {
    try {
        const userId = req.session.userId;

        const devicesSnapshot = await admin.firestore()
            .collection('devices')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .orderBy('createdAt', 'desc')
            .get();

        const devices = [];
        devicesSnapshot.forEach(doc => {
            const device = doc.data();
            devices.push({
                id: doc.id,
                name: device.name,
                status: device.status,
                lastConnection: device.lastConnection,
                connected: device.status === 'connected',
                sessionData: device.sessionData // سيتم استخدامه لاستعادة الجلسة
            });
        });

        res.json({
            success: true,
            devices
        });

    } catch (error) {
        console.error('خطأ في جلب قائمة الأجهزة:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب قائمة الأجهزة'
        });
    }
});

// استعادة جلسة جهاز
router.get('/session/:deviceId', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;

        const deviceRef = admin.firestore().collection('devices').doc(deviceId);
        const device = await deviceRef.get();

        if (!device.exists || device.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        const deviceData = device.data();
        
        if (!deviceData.sessionData) {
            return res.status(404).json({
                success: false,
                error: 'لا توجد جلسة محفوظة لهذا الجهاز'
            });
        }

        res.json({
            success: true,
            sessionData: deviceData.sessionData
        });

    } catch (error) {
        console.error('خطأ في استعادة جلسة الجهاز:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في استعادة جلسة الجهاز'
        });
    }
});

module.exports = router; 