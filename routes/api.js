const express = require('express');
const router = express.Router();
const { clientSessions } = require('./whatsapp');
const firebase = require('../utils/firebase');
const logger = require('../utils/logger');
const validation = require('../utils/validation');

// إرسال رسالة
router.post('/v1/send', async (req, res) => {
    try {
        const { deviceId, to, message } = req.body;
        const userId = req.session.userId;

        // التحقق من البيانات المطلوبة
        if (!deviceId || !to || !message) {
            return res.json({
                success: false,
                error: 'جميع الحقول مطلوبة: deviceId, to, message'
            });
        }

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

        // التحقق من حالة الجهاز
        const session = clientSessions.get(deviceId);
        if (!session || session.status !== 'connected') {
            return res.json({
                success: false,
                error: 'الجهاز غير متصل'
            });
        }

        // تنظيف وتحقق من رقم الهاتف
        const cleanPhone = validation.cleanPhoneNumber(to);
        if (!validation.isValidPhone(cleanPhone)) {
            return res.json({
                success: false,
                error: 'رقم الهاتف غير صالح'
            });
        }

        // إرسال الرسالة
        const chatId = cleanPhone + '@c.us';
        await session.client.sendMessage(chatId, message);

        // حفظ سجل الرسالة
        await firebase.saveMessage({
            userId,
            deviceId,
            to: cleanPhone,
            message,
            type: 'text',
            status: 'sent',
            createdAt: new Date()
        });

        // تسجيل نجاح العملية
        logger.info(`تم إرسال رسالة بنجاح من الجهاز ${deviceId} إلى ${cleanPhone}`);

        return res.json({
            success: true,
            message: 'تم إرسال الرسالة بنجاح'
        });

    } catch (error) {
        logger.error('خطأ في إرسال الرسالة:', error);
        return res.json({
            success: false,
            error: 'حدث خطأ في إرسال الرسالة'
        });
    }
});

// الحصول على سجل الرسائل
router.get('/v1/messages', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { deviceId, limit = 10, offset = 0 } = req.query;

        // التحقق من وجود الجهاز إذا تم تحديده
        if (deviceId) {
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
        logger.error('خطأ في جلب سجل الرسائل:', error);
        return res.json({
            success: false,
            error: 'حدث خطأ في جلب سجل الرسائل'
        });
    }
});

module.exports = router; 