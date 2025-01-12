/**
 * أنواع الأخطاء
 */
const ErrorTypes = {
    VALIDATION: 'VALIDATION_ERROR',
    AUTHENTICATION: 'AUTHENTICATION_ERROR',
    AUTHORIZATION: 'AUTHORIZATION_ERROR',
    NOT_FOUND: 'NOT_FOUND_ERROR',
    CONFLICT: 'CONFLICT_ERROR',
    SERVER: 'SERVER_ERROR',
    WHATSAPP: 'WHATSAPP_ERROR',
    DEVICE: 'DEVICE_ERROR',
    API: 'API_ERROR'
};

/**
 * خطأ مخصص
 */
class CustomError extends Error {
    constructor(type, message, details = null) {
        super(message);
        this.type = type;
        this.details = details;
        this.status = this.getStatusCode();
    }

    getStatusCode() {
        switch (this.type) {
            case ErrorTypes.VALIDATION:
                return 400;
            case ErrorTypes.AUTHENTICATION:
                return 401;
            case ErrorTypes.AUTHORIZATION:
                return 403;
            case ErrorTypes.NOT_FOUND:
                return 404;
            case ErrorTypes.CONFLICT:
                return 409;
            case ErrorTypes.WHATSAPP:
            case ErrorTypes.DEVICE:
            case ErrorTypes.API:
                return 400;
            default:
                return 500;
        }
    }

    toJSON() {
        return {
            success: false,
            error: {
                type: this.type,
                message: this.message,
                details: this.details
            }
        };
    }
}

/**
 * خطأ التحقق من الصحة
 */
class ValidationError extends CustomError {
    constructor(message, details = null) {
        super(ErrorTypes.VALIDATION, message, details);
    }
}

/**
 * خطأ المصادقة
 */
class AuthenticationError extends CustomError {
    constructor(message = 'يرجى تسجيل الدخول أولاً', details = null) {
        super(ErrorTypes.AUTHENTICATION, message, details);
    }
}

/**
 * خطأ الصلاحيات
 */
class AuthorizationError extends CustomError {
    constructor(message = 'غير مصرح بالوصول', details = null) {
        super(ErrorTypes.AUTHORIZATION, message, details);
    }
}

/**
 * خطأ غير موجود
 */
class NotFoundError extends CustomError {
    constructor(message = 'العنصر غير موجود', details = null) {
        super(ErrorTypes.NOT_FOUND, message, details);
    }
}

/**
 * خطأ تعارض
 */
class ConflictError extends CustomError {
    constructor(message, details = null) {
        super(ErrorTypes.CONFLICT, message, details);
    }
}

/**
 * خطأ WhatsApp
 */
class WhatsAppError extends CustomError {
    constructor(message, details = null) {
        super(ErrorTypes.WHATSAPP, message, details);
    }
}

/**
 * خطأ الجهاز
 */
class DeviceError extends CustomError {
    constructor(message, details = null) {
        super(ErrorTypes.DEVICE, message, details);
    }
}

/**
 * خطأ API
 */
class ApiError extends CustomError {
    constructor(message, details = null) {
        super(ErrorTypes.API, message, details);
    }
}

/**
 * معالج الأخطاء
 */
function errorHandler(err, req, res, next) {
    console.error('خطأ:', err);

    // إذا كان الخطأ من النوع المخصص
    if (err instanceof CustomError) {
        return res.status(err.status).json(err.toJSON());
    }

    // إذا كان خطأ التحقق من Express-Validator
    if (Array.isArray(err)) {
        return res.status(400).json({
            success: false,
            error: {
                type: ErrorTypes.VALIDATION,
                message: 'خطأ في التحقق من الصحة',
                details: err.map(e => ({
                    field: e.param,
                    message: e.msg
                }))
            }
        });
    }

    // الأخطاء الأخرى
    return res.status(500).json({
        success: false,
        error: {
            type: ErrorTypes.SERVER,
            message: 'حدث خطأ في الخادم'
        }
    });
}

/**
 * تصدير الدوال والفئات
 */
module.exports = {
    ErrorTypes,
    CustomError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    WhatsAppError,
    DeviceError,
    ApiError,
    errorHandler
}; 