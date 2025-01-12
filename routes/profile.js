const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const { validateSession } = require('../middleware/auth');

/**
 * الحصول على معلومات الملف الشخصي
 */
router.get('/', validateSession, async (req, res) => {
    console.log('جلب معلومات الملف الشخصي للمستخدم:', req.user.id);
    
    try {
        const userDoc = await admin.firestore()
            .collection('users')
            .doc(req.user.id)
            .get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'المستخدم غير موجود'
            });
        }

        const userData = userDoc.data();
        
        // إخفاء البيانات الحساسة
        delete userData.password;

        return res.json({
            success: true,
            profile: {
                id: userDoc.id,
                ...userData,
                createdAt: userData.createdAt?.toDate(),
                lastLogin: userData.lastLogin?.toDate()
            }
        });

    } catch (error) {
        console.error('خطأ في جلب معلومات الملف الشخصي:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب معلومات الملف الشخصي'
        });
    }
});

/**
 * تحديث معلومات الملف الشخصي
 */
router.put('/', validateSession, async (req, res) => {
    console.log('تحديث معلومات الملف الشخصي للمستخدم:', req.user.id);
    
    try {
        const { name, email, currentPassword, newPassword } = req.body;

        const userRef = admin.firestore().collection('users').doc(req.user.id);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'المستخدم غير موجود'
            });
        }

        const updates = {};

        // تحديث الاسم
        if (name) {
            if (name.length < 3) {
                return res.status(400).json({
                    success: false,
                    error: 'يجب أن يكون الاسم 3 أحرف على الأقل'
                });
            }
            updates.name = name;
        }

        // تحديث البريد الإلكتروني
        if (email) {
            if (email.toLowerCase() !== userDoc.data().email) {
                // التحقق من عدم وجود البريد الإلكتروني مسبقاً
                const existingUser = await admin.firestore()
                    .collection('users')
                    .where('email', '==', email.toLowerCase())
                    .get();

                if (!existingUser.empty) {
                    return res.status(400).json({
                        success: false,
                        error: 'البريد الإلكتروني مستخدم بالفعل'
                    });
                }
                updates.email = email.toLowerCase();
            }
        }

        // تحديث كلمة المرور
        if (newPassword) {
            // التحقق من كلمة المرور الحالية
            if (!currentPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'يجب إدخال كلمة المرور الحالية'
                });
            }

            const isValidPassword = await bcrypt.compare(
                currentPassword,
                userDoc.data().password
            );

            if (!isValidPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'كلمة المرور الحالية غير صحيحة'
                });
            }

            // التحقق من قوة كلمة المرور الجديدة
            if (newPassword.length < 6) {
                return res.status(400).json({
                    success: false,
                    error: 'يجب أن تكون كلمة المرور 6 أحرف على الأقل'
                });
            }

            updates.password = await bcrypt.hash(newPassword, 10);
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                error: 'لم يتم تحديد أي تغييرات'
            });
        }

        // تحديث البيانات
        await userRef.update({
            ...updates,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({
            success: true,
            message: 'تم تحديث الملف الشخصي بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تحديث الملف الشخصي:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في تحديث الملف الشخصي'
        });
    }
});

/**
 * تحديث الإعدادات
 */
router.put('/settings', validateSession, async (req, res) => {
    console.log('تحديث إعدادات المستخدم:', req.user.id);
    
    try {
        const { notifications, theme, language } = req.body;

        const userRef = admin.firestore().collection('users').doc(req.user.id);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'المستخدم غير موجود'
            });
        }

        const updates = {
            settings: {
                ...userDoc.data().settings || {},
                notifications: notifications !== undefined ? notifications : userDoc.data().settings?.notifications,
                theme: theme || userDoc.data().settings?.theme || 'light',
                language: language || userDoc.data().settings?.language || 'ar'
            }
        };

        // تحديث الإعدادات
        await userRef.update({
            ...updates,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({
            success: true,
            message: 'تم تحديث الإعدادات بنجاح',
            settings: updates.settings
        });

    } catch (error) {
        console.error('خطأ في تحديث الإعدادات:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في تحديث الإعدادات'
        });
    }
});

/**
 * حذف الحساب
 */
router.delete('/', validateSession, async (req, res) => {
    console.log('حذف حساب المستخدم:', req.user.id);
    
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({
                success: false,
                error: 'يجب إدخال كلمة المرور للتأكيد'
            });
        }

        const userRef = admin.firestore().collection('users').doc(req.user.id);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'المستخدم غير موجود'
            });
        }

        // التحقق من كلمة المرور
        const isValidPassword = await bcrypt.compare(
            password,
            userDoc.data().password
        );

        if (!isValidPassword) {
            return res.status(400).json({
                success: false,
                error: 'كلمة المرور غير صحيحة'
            });
        }

        // حذف الأجهزة المرتبطة
        const devicesSnapshot = await admin.firestore()
            .collection('devices')
            .where('userId', '==', req.user.id)
            .get();

        const batch = admin.firestore().batch();
        devicesSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        // حذف الرسائل المرتبطة
        const messagesSnapshot = await admin.firestore()
            .collection('messages')
            .where('userId', '==', req.user.id)
            .get();

        messagesSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        // حذف الحساب
        batch.delete(userRef);

        // تنفيذ عمليات الحذف
        await batch.commit();

        // تدمير الجلسة
        req.session.destroy();

        return res.json({
            success: true,
            message: 'تم حذف الحساب بنجاح'
        });

    } catch (error) {
        console.error('خطأ في حذف الحساب:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في حذف الحساب'
        });
    }
});

module.exports = router; 