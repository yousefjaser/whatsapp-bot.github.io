FROM node:18

# إنشاء مجلد التطبيق
WORKDIR /app

# نسخ ملفات package.json أولاً
COPY package*.json ./

# تثبيت المتطلبات
RUN npm install

# نسخ server.js أولاً للتأكد من وجوده
COPY server.js ./
RUN test -f server.js || exit 1

# نسخ باقي ملفات التطبيق
COPY . .

# تعريض البورت
EXPOSE 3001

# تشغيل التطبيق
CMD ["node", "server.js"] 