const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const rateLimit = require('express-rate-limit');

// تعريف أنواع الأخطاء
const ErrorTypes = {
    AUTHENTICATION_REQUIRED: {
        code: 401,
        message: 'مفتاح API مطلوب للمصادقة',
        details: 'يجب إرفاق مفتاح API صالح في رأس الطلب (X-API-Key)'
    },
    INVALID_API_KEY: {
        code: 401,
        message: 'مفتاح API غير صالح',
        details: 'المفتاح المقدم غير صالح أو منتهي الصلاحية'
    },
    RATE_LIMIT_EXCEEDED: {
        code: 429,
        message: 'تم تجاوز الحد الأقصى للطلبات',
        details: 'يرجى المحاولة مرة أخرى بعد 15 دقيقة'
    },
    MISSING_REQUIRED_FIELDS: {
        code: 400,
        message: 'بيانات غير مكتملة',
        details: 'بعض الحقول المطلوبة غير موجودة'
    },
    DEVICE_NOT_FOUND: {
        code: 404,
        message: 'الجهاز غير موجود',
        details: 'معرف الجهاز المقدم غير صحيح أو غير موجود'
    },
    UNAUTHORIZED_DEVICE: {
        code: 403,
        message: 'غير مصرح بالوصول',
        details: 'لا يمكنك استخدام هذا الجهاز'
    },
    MESSAGE_NOT_FOUND: {
        code: 404,
        message: 'الرسالة غير موجودة',
        details: 'معرف الرسالة المطلوب غير موجود'
    },
    INVALID_PHONE_NUMBER: {
        code: 400,
        message: 'رقم هاتف غير صالح',
        details: 'تأكد من صحة رمز الدولة ورقم الهاتف'
    },
    SERVER_ERROR: {
        code: 500,
        message: 'خطأ في الخادم',
        details: 'حدث خطأ داخلي في الخادم'
    }
};

// دالة مساعدة لإرسال الأخطاء
function sendError(res, errorType, additionalDetails = null) {
    const error = ErrorTypes[errorType];
    const response = {
        success: false,
        error: {
            code: error.code,
            message: error.message,
            details: error.details
        }
    };
    
    if (additionalDetails) {
        response.error.additionalDetails = additionalDetails;
    }
    
    return res.status(error.code).json(response);
}

// إعداد rate limiter للـ API
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    handler: (req, res) => sendError(res, 'RATE_LIMIT_EXCEEDED')
});

// التحقق من صحة رقم الهاتف
function validatePhoneNumber(countryCode, phone) {
    const phoneRegex = /^\d{1,15}$/;
    const countryCodeRegex = /^\+\d{1,4}$/;
    
    return countryCodeRegex.test(countryCode) && phoneRegex.test(phone);
}

// التحقق من مفتاح API
async function validateApiKey(req, res, next) {
    try {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) {
            return sendError(res, 'AUTHENTICATION_REQUIRED');
        }

        const apiKeyDoc = await admin.firestore().collection('api_keys')
            .where('key', '==', apiKey)
            .where('active', '==', true)
            .get();

        if (apiKeyDoc.empty) {
            return sendError(res, 'INVALID_API_KEY');
        }

        const keyData = apiKeyDoc.docs[0].data();
        
        // إضافة معلومات المفتاح والمستخدم للطلب
        req.apiKey = {
            id: apiKeyDoc.docs[0].id,
            ...keyData,
            lastUsed: admin.firestore.FieldValue.serverTimestamp()
        };
        
        // تحديث وقت آخر استخدام للمفتاح
        await apiKeyDoc.docs[0].ref.update({
            lastUsed: admin.firestore.FieldValue.serverTimestamp(),
            requestCount: admin.firestore.FieldValue.increment(1)
        });

        next();
    } catch (error) {
        console.error('خطأ في التحقق من مفتاح API:', error);
        return sendError(res, 'SERVER_ERROR');
    }
}

// إرسال رسالة عبر API
router.post('/send', [validateApiKey, apiLimiter], async (req, res) => {
    try {
        const { deviceId, countryCode, phone, message, name } = req.body;

        // التحقق من البيانات المطلوبة
        if (!deviceId || !countryCode || !phone || !message) {
            return sendError(res, 'MISSING_REQUIRED_FIELDS', {
                required: {
                    deviceId: 'معرف الجهاز (مطلوب)',
                    countryCode: 'رمز الدولة (مطلوب)',
                    phone: 'رقم الهاتف (مطلوب)',
                    message: 'الرسالة (مطلوب)',
                    name: 'اسم المستخدم (اختياري)'
                }
            });
        }

        // التحقق من صحة رقم الهاتف
        if (!validatePhoneNumber(countryCode, phone)) {
            return sendError(res, 'INVALID_PHONE_NUMBER');
        }

        // التحقق من صحة الجهاز وملكيته
        const deviceDoc = await admin.firestore().collection('devices')
            .doc(deviceId)
            .get();

        if (!deviceDoc.exists) {
            return sendError(res, 'DEVICE_NOT_FOUND');
        }

        const device = deviceDoc.data();
        if (device.userId !== req.apiKey.userId) {
            return sendError(res, 'UNAUTHORIZED_DEVICE');
        }

        // تنسيق رقم الهاتف
        const formattedPhone = `${countryCode}${phone.replace(/\D/g, '')}`;

        // إنشاء بيانات الرسالة
        const messageData = {
            phone: formattedPhone,
            message,
            name: name || 'مجهول',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending',
            deviceId,
            userId: req.apiKey.userId,
            apiKeyId: req.apiKey.id,
            metadata: {
                userAgent: req.headers['user-agent'],
                ip: req.ip,
                timestamp: new Date().toISOString()
            }
        };

        // حفظ الرسالة في قاعدة البيانات
        const messageRef = await admin.firestore().collection('messages').add(messageData);

        // إرسال الرسالة عبر Socket.IO
        req.app.get('io').to(deviceId).emit('sendMessage', {
            messageId: messageRef.id,
            ...messageData
        });

        // إرسال الاستجابة
        res.json({
            success: true,
            data: {
                messageId: messageRef.id,
                status: 'pending',
                timestamp: messageData.timestamp,
                message: 'تم إرسال الرسالة بنجاح'
            }
        });

    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        return sendError(res, 'SERVER_ERROR');
    }
});

// الحصول على حالة الرسالة
router.get('/message/:messageId', validateApiKey, async (req, res) => {
    try {
        const messageDoc = await admin.firestore().collection('messages')
            .doc(req.params.messageId)
            .get();

        if (!messageDoc.exists) {
            return sendError(res, 'MESSAGE_NOT_FOUND');
        }

        const message = messageDoc.data();
        if (message.userId !== req.apiKey.userId) {
            return sendError(res, 'UNAUTHORIZED_DEVICE');
        }

        res.json({
            success: true,
            data: {
                messageId: messageDoc.id,
                status: message.status,
                timestamp: message.timestamp,
                deliveredAt: message.deliveredAt,
                metadata: message.metadata
            }
        });

    } catch (error) {
        console.error('خطأ في جلب حالة الرسالة:', error);
        return sendError(res, 'SERVER_ERROR');
    }
});

// الحصول على إحصائيات API
router.get('/stats', validateApiKey, async (req, res) => {
    try {
        const stats = await admin.firestore().collection('messages')
            .where('apiKeyId', '==', req.apiKey.id)
            .get();

        const totalMessages = stats.size;
        const messagesByStatus = {};
        
        stats.forEach(doc => {
            const status = doc.data().status;
            messagesByStatus[status] = (messagesByStatus[status] || 0) + 1;
        });

        res.json({
            success: true,
            data: {
                totalMessages,
                messagesByStatus,
                apiKey: {
                    lastUsed: req.apiKey.lastUsed,
                    requestCount: req.apiKey.requestCount
                }
            }
        });

    } catch (error) {
        console.error('خطأ في جلب الإحصائيات:', error);
        return sendError(res, 'SERVER_ERROR');
    }
});

module.exports = router; 