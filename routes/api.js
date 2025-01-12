const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { validateSession } = require('../middleware/auth');

/**
 * إرسال رسالة WhatsApp
 */
router.post('/send', async (req, res) => {
    console.log('محاولة إرسال رسالة WhatsApp جديدة');
    
    try {
        const { to, message, type = 'text' } = req.body;

        // التحقق من البيانات المطلوبة
        if (!to || !message) {
            return res.status(400).json({
                success: false,
                error: 'رقم الهاتف والرسالة مطلوبان'
            });
        }

        // التحقق من صحة رقم الهاتف
        const phoneNumber = normalizePhoneNumber(to);
        if (!isValidPhoneNumber(phoneNumber)) {
            return res.status(400).json({
                success: false,
                error: 'رقم الهاتف غير صالح'
            });
        }

        // التحقق من نوع الرسالة
        if (!isValidMessageType(type)) {
            return res.status(400).json({
                success: false,
                error: 'نوع الرسالة غير صالح'
            });
        }

        // إرسال الرسالة
        const messageId = await sendWhatsAppMessage(phoneNumber, message, type);

        // حفظ سجل الرسالة
        await saveMessageLog({
            to: phoneNumber,
            message,
            type,
            messageId,
            userId: req.session?.userId
        });

        return res.json({
            success: true,
            messageId,
            message: 'تم إرسال الرسالة بنجاح'
        });

    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في إرسال الرسالة'
        });
    }
});

/**
 * الحصول على سجل الرسائل
 */
router.get('/messages', validateSession, async (req, res) => {
    console.log('جلب سجل الرسائل للمستخدم:', req.user.id);
    
    try {
        const { limit = 50, page = 1 } = req.query;
        const skip = (page - 1) * limit;

        // جلب الرسائل
        const messages = await getMessages(req.user.id, parseInt(limit), skip);
        const total = await getMessagesCount(req.user.id);

        return res.json({
            success: true,
            messages,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب سجل الرسائل:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب سجل الرسائل'
        });
    }
});

/**
 * تنسيق رقم الهاتف
 */
function normalizePhoneNumber(phone) {
    // إزالة كل الأحرف غير الرقمية
    let normalized = phone.replace(/\D/g, '');
    
    // إضافة رمز الدولة إذا لم يكن موجوداً
    if (!normalized.startsWith('962')) {
        normalized = '962' + (normalized.startsWith('0') ? normalized.slice(1) : normalized);
    }
    
    return normalized;
}

/**
 * التحقق من صحة رقم الهاتف
 */
function isValidPhoneNumber(phone) {
    // التحقق من أن الرقم يبدأ بـ 962 ويتكون من 12 رقم
    return /^962\d{9}$/.test(phone);
}

/**
 * التحقق من نوع الرسالة
 */
function isValidMessageType(type) {
    return ['text', 'image', 'document', 'video', 'audio'].includes(type);
}

/**
 * إرسال رسالة WhatsApp
 */
async function sendWhatsAppMessage(to, message, type) {
    try {
        // هنا يتم إضافة كود إرسال الرسالة عبر WhatsApp API
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        return messageId;
    } catch (error) {
        console.error('خطأ في إرسال رسالة WhatsApp:', error);
        throw new Error('فشل في إرسال الرسالة');
    }
}

/**
 * حفظ سجل الرسالة
 */
async function saveMessageLog(messageData) {
    try {
        await admin.firestore()
            .collection('messages')
            .add({
                ...messageData,
                status: 'sent',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
    } catch (error) {
        console.error('خطأ في حفظ سجل الرسالة:', error);
    }
}

/**
 * جلب الرسائل
 */
async function getMessages(userId, limit, skip) {
    const snapshot = await admin.firestore()
        .collection('messages')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(skip)
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()
    }));
}

/**
 * جلب عدد الرسائل
 */
async function getMessagesCount(userId) {
    const snapshot = await admin.firestore()
        .collection('messages')
        .where('userId', '==', userId)
        .count()
        .get();

    return snapshot.data().count;
}

module.exports = router; 