const admin = require('firebase-admin');
const logger = require('./logger');

let isInitialized = false;

/**
 * تهيئة Firebase Admin
 */
async function initializeFirebase() {
    try {
        // التحقق من عدم تهيئة Firebase مسبقاً
        if (!isInitialized) {
            admin.initializeApp({
                credential: admin.credential.applicationDefault()
            });
            
            // التحقق من الاتصال
            await admin.firestore().collection('users').limit(1).get();
            
            isInitialized = true;
            await logger.info('تم تهيئة Firebase Admin بنجاح');
        }
    } catch (error) {
        console.error('خطأ في تهيئة Firebase Admin:', error);
        throw error;
    }
}

/**
 * التحقق من الاتصال بـ Firebase
 */
async function checkConnection() {
    if (!isInitialized) {
        throw new Error('لم يتم تهيئة Firebase بعد');
    }

    try {
        await admin.firestore().collection('users').limit(1).get();
    } catch (error) {
        console.error('خطأ في الاتصال بـ Firebase:', error);
        throw error;
    }
}

/**
 * الحصول على مستخدم من Firestore
 */
async function getUser(userId) {
    await checkConnection();

    try {
        const userDoc = await admin.firestore()
            .collection('users')
            .doc(userId)
            .get();

        if (!userDoc.exists) {
            return null;
        }

        const userData = userDoc.data();
        return {
            id: userDoc.id,
            ...userData,
            createdAt: userData.createdAt?.toDate(),
            updatedAt: userData.updatedAt?.toDate(),
            lastActive: userData.lastActive?.toDate()
        };

    } catch (error) {
        console.error('خطأ في جلب بيانات المستخدم:', error);
        throw error;
    }
}

/**
 * تحديث بيانات المستخدم
 */
async function updateUser(userId, data) {
    await checkConnection();

    try {
        // التحقق من وجود المستخدم
        const userDoc = await admin.firestore()
            .collection('users')
            .doc(userId)
            .get();

        if (!userDoc.exists) {
            throw new Error('المستخدم غير موجود');
        }

        // تحديث البيانات
        await admin.firestore()
            .collection('users')
            .doc(userId)
            .update({
                ...data,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

        // تسجيل الحدث
        await logger.info('تم تحديث بيانات المستخدم', {
            userId,
            updatedFields: Object.keys(data)
        });

    } catch (error) {
        console.error('خطأ في تحديث بيانات المستخدم:', error);
        throw error;
    }
}

/**
 * الحصول على جهاز من Firestore
 */
async function getDevice(deviceId) {
    await checkConnection();

    try {
        const deviceDoc = await admin.firestore()
            .collection('devices')
            .doc(deviceId)
            .get();

        if (!deviceDoc.exists) {
            return null;
        }

        const deviceData = deviceDoc.data();
        return {
            id: deviceDoc.id,
            ...deviceData,
            createdAt: deviceData.createdAt?.toDate(),
            updatedAt: deviceData.updatedAt?.toDate(),
            lastActive: deviceData.lastActive?.toDate()
        };

    } catch (error) {
        console.error('خطأ في جلب بيانات الجهاز:', error);
        throw error;
    }
}

/**
 * حفظ رسالة في Firestore
 */
async function saveMessage(messageData) {
    await checkConnection();

    try {
        // التحقق من البيانات المطلوبة
        const requiredFields = ['userId', 'deviceId', 'to', 'content', 'type'];
        for (const field of requiredFields) {
            if (!messageData[field]) {
                throw new Error(`الحقل ${field} مطلوب`);
            }
        }

        // إضافة الرسالة
        const messageRef = await admin.firestore()
            .collection('messages')
            .add({
                ...messageData,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

        // تسجيل الحدث
        await logger.message('تم إنشاء رسالة جديدة', {
            messageId: messageRef.id,
            userId: messageData.userId,
            deviceId: messageData.deviceId
        });

        return messageRef.id;

    } catch (error) {
        console.error('خطأ في حفظ الرسالة:', error);
        throw error;
    }
}

/**
 * الحصول على رسائل المستخدم
 */
async function getUserMessages(userId, options = {}) {
    await checkConnection();

    try {
        const {
            limit = 10,
            page = 1,
            deviceId,
            status,
            type
        } = options;

        const skip = (page - 1) * limit;
        let query = admin.firestore()
            .collection('messages')
            .where('userId', '==', userId);

        // تصفية حسب الجهاز
        if (deviceId) {
            query = query.where('deviceId', '==', deviceId);
        }

        // تصفية حسب الحالة
        if (status) {
            query = query.where('status', '==', status);
        }

        // تصفية حسب النوع
        if (type) {
            query = query.where('type', '==', type);
        }

        // جلب الرسائل
        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .offset(skip)
            .get();

        const messages = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate()
        }));

        // جلب العدد الكلي
        const totalSnapshot = await query.count().get();

        return {
            messages,
            pagination: {
                total: totalSnapshot.data().count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalSnapshot.data().count / limit)
            }
        };

    } catch (error) {
        console.error('خطأ في جلب رسائل المستخدم:', error);
        throw error;
    }
}

/**
 * حفظ جهاز في Firestore
 */
async function saveDevice(deviceData) {
    await checkConnection();

    try {
        // التحقق من البيانات المطلوبة
        const requiredFields = ['userId', 'name'];
        for (const field of requiredFields) {
            if (!deviceData[field]) {
                throw new Error(`الحقل ${field} مطلوب`);
            }
        }

        // إضافة الجهاز
        const deviceRef = await admin.firestore()
            .collection('devices')
            .add({
                ...deviceData,
                status: 'disconnected',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

        // تسجيل الحدث
        await logger.device('تم إضافة جهاز جديد', {
            deviceId: deviceRef.id,
            userId: deviceData.userId,
            name: deviceData.name
        });

        return deviceRef.id;

    } catch (error) {
        console.error('خطأ في حفظ الجهاز:', error);
        throw error;
    }
}

/**
 * تحديث حالة الجهاز
 */
async function updateDeviceStatus(deviceId, status) {
    await checkConnection();

    try {
        // التحقق من وجود الجهاز
        const deviceDoc = await admin.firestore()
            .collection('devices')
            .doc(deviceId)
            .get();

        if (!deviceDoc.exists) {
            throw new Error('الجهاز غير موجود');
        }

        // تحديث الحالة
        await admin.firestore()
            .collection('devices')
            .doc(deviceId)
            .update({
                status,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

        // تسجيل الحدث
        await logger.device('تم تحديث حالة الجهاز', {
            deviceId,
            status
        });

    } catch (error) {
        console.error('خطأ في تحديث حالة الجهاز:', error);
        throw error;
    }
}

/**
 * الحصول على أجهزة المستخدم
 */
async function getUserDevices(userId, options = {}) {
    await checkConnection();

    try {
        const {
            limit = 10,
            page = 1,
            status
        } = options;

        const skip = (page - 1) * limit;
        let query = admin.firestore()
            .collection('devices')
            .where('userId', '==', userId);

        // تصفية حسب الحالة
        if (status) {
            query = query.where('status', '==', status);
        }

        // جلب الأجهزة
        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .offset(skip)
            .get();

        const devices = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate()
        }));

        // جلب العدد الكلي
        const totalSnapshot = await query.count().get();

        return {
            devices,
            pagination: {
                total: totalSnapshot.data().count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalSnapshot.data().count / limit)
            }
        };

    } catch (error) {
        console.error('خطأ في جلب أجهزة المستخدم:', error);
        throw error;
    }
}

/**
 * تصدير الدوال
 */
module.exports = {
    initializeFirebase,
    getUser,
    updateUser,
    getDevice,
    saveMessage,
    getUserMessages,
    saveDevice,
    updateDeviceStatus,
    getUserDevices
}; 