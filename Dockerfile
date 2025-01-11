FROM node:18

# إنشاء مجلد التطبيق
WORKDIR /app

# نسخ ملفات package.json أولاً
COPY package*.json ./

# تثبيت المتطلبات
RUN npm install

# نسخ باقي ملفات التطبيق
COPY . .

# التأكد من وجود الملف الرئيسي
RUN if [ ! -f server.js ]; then echo "Error: server.js not found"; exit 1; fi

# تعريض البورت
EXPOSE 3001

# تشغيل التطبيق
CMD ["npm", "start"] 