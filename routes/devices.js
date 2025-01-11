const express = require('express');
const router = express.Router();
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

// تخزين الأجهزة النشطة
const activeDevices = new Map();

// التحقق من المصادقة
const authMiddleware = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'غير مصرح' });
    }
    next();
};

// الحصول على قائمة الأجهزة
router.get('/', authMiddleware, (req, res) => {
    const userDevices = Array.from(activeDevices.entries())
        .filter(([_, device]) => device.userId === req.session.userId)
        .map(([id, device]) => ({
            id,
            name: device.name,
            connected: device.client.pupPage ? true : false
        }));
    
    res.json(userDevices);
});

// إضافة جهاز جديد
router.post('/new', authMiddleware, async (req, res) => {
    try {
        const deviceId = Date.now().toString();
        const client = new Client({
            puppeteer: {
                args: ['--no-sandbox']
            }
        });

        let qr = '';
        client.on('qr', async (qrCode) => {
            qr = await qrcode.toDataURL(qrCode);
        });

        client.on('ready', () => {
            console.log(`جهاز ${deviceId} جاهز`);
        });

        client.on('disconnected', () => {
            console.log(`جهاز ${deviceId} غير متصل`);
        });

        await client.initialize();

        activeDevices.set(deviceId, {
            client,
            userId: req.session.userId,
            name: `جهاز ${deviceId.slice(-4)}`
        });

        // انتظار توليد رمز QR
        let attempts = 0;
        while (!qr && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }

        if (!qr) {
            throw new Error('فشل توليد رمز QR');
        }

        res.json({ deviceId, qr });
    } catch (error) {
        console.error('خطأ في إضافة جهاز جديد:', error);
        res.status(500).json({ error: 'فشل إضافة جهاز جديد' });
    }
});

// التحقق من حالة الجهاز
router.get('/:deviceId/status', authMiddleware, (req, res) => {
    const device = activeDevices.get(req.params.deviceId);
    
    if (!device || device.userId !== req.session.userId) {
        return res.status(404).json({ error: 'الجهاز غير موجود' });
    }

    res.json({
        connected: device.client.pupPage ? true : false
    });
});

// إعادة اتصال الجهاز
router.post('/:deviceId/reconnect', authMiddleware, async (req, res) => {
    try {
        const device = activeDevices.get(req.params.deviceId);
        
        if (!device || device.userId !== req.session.userId) {
            return res.status(404).json({ error: 'الجهاز غير موجود' });
        }

        await device.client.destroy();
        await device.client.initialize();

        let qr = '';
        device.client.on('qr', async (qrCode) => {
            qr = await qrcode.toDataURL(qrCode);
        });

        // انتظار توليد رمز QR
        let attempts = 0;
        while (!qr && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }

        if (!qr) {
            throw new Error('فشل توليد رمز QR');
        }

        res.json({ qr });
    } catch (error) {
        console.error('خطأ في إعادة الاتصال:', error);
        res.status(500).json({ error: 'فشل إعادة الاتصال بالجهاز' });
    }
});

// حذف جهاز
router.delete('/:deviceId', authMiddleware, async (req, res) => {
    try {
        const device = activeDevices.get(req.params.deviceId);
        
        if (!device || device.userId !== req.session.userId) {
            return res.status(404).json({ error: 'الجهاز غير موجود' });
        }

        await device.client.destroy();
        activeDevices.delete(req.params.deviceId);
        
        res.json({ message: 'تم حذف الجهاز بنجاح' });
    } catch (error) {
        console.error('خطأ في حذف الجهاز:', error);
        res.status(500).json({ error: 'فشل حذف الجهاز' });
    }
});

module.exports = router; 