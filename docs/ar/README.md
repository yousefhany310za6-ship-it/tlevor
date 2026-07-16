# إطار عمل Tlevor (Tlevor Framework)

إطار عمل خلفي (backend) عالي الأداء مبني لـ Node.js و TypeScript. صُمّم ليجمع بين سرعة التوجيه (routing) على مستوى النواة، ونموذج تطوير قائم على الخطافات (hooks) المسطّحة، وطبقة بيانات مرنة قائمة على المحوّلات (adapters).

---

## ١. نظرة عامة

Tlevor مرتب كـ **monorepo** باستخدام `pnpm`. كل مكوّن أساسي عبارة عن حزمة (package) مستقلة ضمن `packages/`. يضم المشروع 23 حزمة مقسّمة إلى:

- **حزم النواة (core):** `types`, `router`, `core`, `validation`, `orm`, `logger`, `testing`
- **حزم المزايا (feature):** `auth`, `cache`, `config`, `di`, `graphql`, `monitoring`, `queue`, `scheduler`, `swagger`, `tracing`, `cloud`, `mailer`, `cli`, `integration`

الهدف الأساسي: تطبيق خادم HTTP كامل بأقل قدر من المرونة المفقودة وبأداء قابل للمنافسة مع أطر مثل Fastify و Hono و Express.

---

## ٢. المزايا الأساسية

| الميزة | الوصف |
|--------|-------|
| **موجّه شجري Radix Tree** | مطابقة مسارات بـ O(L) مع استخراج صفر تخصيص للمعاملات (zero-allocation). مسارات ثابتة مخزّنة مؤقتاً للوصول السريع. |
| **خط أنابيب خطافات غير متزامن (Async Hook Pipeline)** | خطافات مسطّحة بدل سلاسل middleware متكررة: `onRequest`, `preParsing`, `preValidation`, `preHandler`, `postHandler`, `onResponse`. |
| **نظام إضافات مغلّف (Encapsulated Plugin System)** | إضافات ذات نطاق (scope) ورسم بياني للاعتماديات (dependency graph). |
| **تحقق موحّد (Unified Validation)** | مخططات المسارات تُتحقّق عبر محرك `@tlevor/validation` المشترك (حقول مطلوبة، أنواع، قيود نص/رقم، enums، أنماط). |
| **طبقة ORM** | طبقة بيانات قائمة على المحوّلات (`@tlevor/orm`) مع محوّلات الذاكرة و SQLite خلف واجهة `Model`/`createAdapter` موحّدة. |
| **مسجّل مدمج (Logger)** | مسجّل منظّم خفيف بدون اعتماديات خارجية (مبني على `console` مع ربط bindings). |
| **حقن الطلب (Request Injection)** | اختبار المسارات دون تشغيل خادم حقيقي عبر `app.inject()`. |

---

## ٣. البدء السريع

```bash
pnpm install
pnpm build      # يبني كل الحزم
pnpm test       # يشغّل كامل مجموعة الاختبارات (202 اختبار)
```

مثال حد أدنى:

```typescript
import { createApp } from '@tlevor/core';
import { createAdapter, Model } from '@tlevor/orm';

const app = createApp({ bodyParser: true });

const adapter = createAdapter('memory');
await adapter.connect();
const User = new Model(adapter, { tableName: 'users', primaryKey: 'id' });

app.addRoute({
  method: 'POST',
  path: '/users',
  schema: {
    body: {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: { type: 'string', minLength: 2 },
        email: { type: 'string' },
      },
    },
  },
  handler: async (ctx) => {
    const user = await User.create(ctx.req.body);
    ctx.res.status(201);
    return user;
  },
});

app.addRoute({
  method: 'GET',
  path: '/users/:id',
  handler: async (ctx) => User.findById(ctx.req.params.id),
});

await app.listen(3000);
```

---

## ٤. حزمة `@tlevor/core`

القلب التشغيلي للإطار. يوفّر الصنف `TlevorApp` ودالة المصنع `createApp()`.

### ٤.١ دورة معالجة الطلب

عند وصول طلب HTTP:

1. يُطابَق المسار عبر `Router.findRouteByMethod`.
2. تُطبَّق ترويسات CORS (عند `OPTIONS` يُعاد 204 مباشرة).
3. تُطبَّق ترويسات الأمان (إن توفّرت `security: true`).
4. يُطبَّق محدّد المعدل (Rate Limiter) — يضبط `X-RateLimit-*` ويُعيد 429 عند التجاوز.
5. يُبنى `TlevorContext` (يضم `req`, `res`, `state`, `logger`).
6. يُحلَّل الجسم (Body) للطرق `POST/PUT/PATCH` إن فعّل `bodyParser`.
7. تُشغَّل سلسلة الخطافات: `onRequest → preParsing → [تحقق المخطط] → preValidation → preHandler → handler → postHandler → onResponse`.
8. يُكتب الرد، وإذا أعاد المعالج (handler) قيمة فتُسلسَل إلى JSON/نص.

### ٤.٢ الخطافات (Hooks)

```typescript
app.addHook('onRequest', async (ctx) => {
  ctx.state.start = Date.now();
});
app.addHook('preHandler', async (ctx) => {
  if (!ctx.req.headers['authorization']) return false; // يوقف المعالجة
});
```

إرجاع `false` من خطاف يوقف السلسلة ويمنع الوصول للمعالج.

### ٤.٣ التحقق (Validation)

يُمرَّر `schema` لكل مسار. يدعم `body` و `query` و `params` و `response`. عند الفشل يُعاد `400 VALIDATION_ERROR` مع تفاصيل.

### ٤.٤ المزايا المدمجة في النواة

- **Body Parsing:** JSON و `application/x-www-form-urlencoded` مع حد أقصى للحجم (`PayloadTooLargeError`).
- **CORS:** عبر `cors: true` أو كائن خيارات (`origin`, `methods`, `credentials`...).
- **الكوكيز (Cookies):** `ctx.res.cookie()`, `clearCookie()`, وقراءة `ctx.req.cookies`.
- **ترويسات الأمان:** `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` وغيرها.
- **الحد من المعدل (Rate Limiting):** `app.rateLimit({ max, window })`.
- **الملفات الثابتة:** `serveStatic({ root, prefix })`.
- **WebSockets:** `app.ws('/path', { onConnection, onMessage, onClose, onError })` (عبر `ws`).
- **حقن الطلب للاختبار:** `const res = await app.inject({ method, url, body });`.

### ٤.٥ الأخطاء المدمجة

`TlevorError` مع أصناف مشتقّة: `ValidationError` (400), `NotFoundError` (404), `UnauthorizedError` (401), `ForbiddenError` (403), `ConflictError` (409), `PayloadTooLargeError` (413). أي خطأ غير معالَج يُعاد كـ `500 INTERNAL_ERROR`.

---

## ٥. حزمة `@tlevor/router`

موجّه شجري Radix Tree. الواجهة الرئيسية `Router`:

```typescript
const router = new Router();
router.addRoute('GET', '/users/:id', handler);
const match = router.findRouteByMethod('GET', '/users/42');
// match.handler, match.params = { id: '42' }
```

- يدعم المعاملات `:name` والمطابقة الشاملة `*`.
- يخزّن المسارات الثابتة مؤقتاً في `Map` للوصول السريع.
- `getRoutes()` يُرجع قائمة كل المسارات المسجّلة (مفيد لـ Swagger).

---

## ٦. حزمة `@tlevor/orm`

طبقة بيانات قائمة على المحوّلات. البنية الحالية مقسّمة إلى وحدات:

```
packages/orm/src/
├── index.ts            # إعادة تصدير الواجهة العامة بالكامل
├── query-builder.ts   # QueryBuilder + execute()
├── model.ts           # Model, createModel
├── adapter.ts         # واجهة DatabaseAdapter
├── adapters/
│   ├── memory.ts      # MemoryAdapter (مفسّر SQL بسيط مدمج)
│   ├── sqlite.ts      # SqliteAdapter (better-sqlite3)
│   ├── prisma.ts      # PrismaAdapter
│   └── drizzle.ts     # DrizzleAdapter
├── migrations.ts      # MigrationManager
├── decorators.ts      # @Table, @Column, @PrimaryKey, syncModel
└── factory.ts         # createAdapter
```

### ٦.١ إنشاء محوّل

```typescript
import { createAdapter } from '@tlevor/orm';

const mem = createAdapter('memory');
const sqlite = createAdapter('sqlite', { sqlite: { memory: true } });
// أو: createAdapter('prisma', { prisma: client })
// أو: createAdapter('drizzle', { drizzle: db })
```

### ٦.٢ النموذج (Model)

```typescript
const User = new Model(adapter, { tableName: 'users', primaryKey: 'id' });

await User.create({ name: 'Alice' });          // يضيف timestamps تلقائياً
await User.findById(1);
await User.findMany({ where: { age: 30 }, orderBy: { age: 'asc' }, limit: 10 });
await User.update(1, { name: 'Bob' });
await User.delete(1);
await User.count({ active: true });
await User.upsert({ id: 1, name: 'X' });
```

- عند تفعيل `timestamps` (افتراضي) يضيف `createdAt`/`updatedAt` كـ **نصوص ISO** موحّدة عبر كل المحوّلات.
- `Model.sync(columns)` ينشئ الجدول على المحوّلات الداعمة لـ DDL (SQLite).

### ٦.٣ بانى الاستعلام (QueryBuilder) — الآن فعّال

```typescript
import { QueryBuilder } from '@tlevor/orm';

await new QueryBuilder('users')
  .insert({ name: 'Alice', age: 30 })
  .execute(adapter);

const adults = await new QueryBuilder('users')
  .select('id', 'name')
  .where('age', '>', 18)
  .and('active', '=', true)
  .orderBy('name', 'desc')
  .limit(10)
  .offset(20)
  .execute(adapter);   // يرجع الصفوف
```

- `execute(adapter)` يستدعي `adapter.raw()` للاستعلام/العدّ، و `adapter.execute()` للكتابة (insert/update/delete/upsert).
- يدعم: `in`, `notIn`, `like`, `between`, `isNull`, `isNotNull`, `join/leftJoin/rightJoin`, `returning`.
- `upsert` يستخدم صيغة SQLite `ON CONFLICT(id) DO UPDATE SET`.
- `MemoryAdapter` يملك مفسّر SQL داخلي يدعم نفس العبارات، فيتصرّف identically مع SQLite.

### ٦.٤ المحوّلات (Adapters)

| المحوّل | التخزين | DDL (sync) | الحالة |
|--------|---------|-----------|--------|
| `MemoryAdapter` | خريطة في الذاكرة | لا | مُختبَر |
| `SqliteAdapter` | ملف/ذاكرة (better-sqlite3) | نعم | مُختبَر |
| `PrismaAdapter` | عميل Prisma | عبر Prisma | غير مُختبَر* |
| `DrizzleAdapter` | مثيل Drizzle | عبر Drizzle | غير مُختبَر* |

\* يتطلبان عميلاً حقيقياً؛ موفّران كتطبيق جاهز لعقد `DatabaseAdapter`.

### ٦.٥ المزامنة عبر المُزيّنات (Decorators)

```typescript
@Table({ tableName: 'products' })
class Product {
  @PrimaryKey() id!: number;
  @Column({ type: 'string' }) name!: string;
  @Column({ type: 'number' }) price!: number;
}

await syncModel(Product, adapter); // ينشئ الجدول على SQLite
```

### ٦.٦ الهجرات (Migrations)

```typescript
const mm = new MigrationManager({ adapter });
mm.addMigration({ name: 'init', up: ['CREATE TABLE ...'], down: ['DROP TABLE ...'] });
await mm.up();
```

---

## ٧. الحزم المميزة (Feature Packages)

| الحزمة | الغرض | الواجهة الأساسية |
|--------|-------|------------------|
| `@tlevor/auth` | مصادقة JWT | `JwtOptions`, `sign`, `verify` |
| `@tlevor/cache` | تخزين مؤقت | `CacheAdapter`, `MemoryCache`, `cacheMiddleware` |
| `@tlevor/config` | إدارة الإعدادات | `Config`, `ConfigOptions` |
| `@tlevor/di` | حقن التبعيات | `Container`, `ServiceDefinition` |
| `@tlevor/graphql` | بناء مخطط GraphQL | `GraphQLSchemaBuilder` |
| `@tlevor/monitoring` | مقاييس | `Counter`, `Gauge`, `MetricOptions` |
| `@tlevor/queue` | طوابير مهام | `Job`, `JobProcessor`, `QueueEvents` |
| `@tlevor/scheduler` | جدولة Cron | `parseCron`, `cronMatches` |
| `@tlevor/swagger` | توثيق OpenAPI | `SwaggerOptions`, `RouteDoc` |
| `@tlevor/tracing` | تتبّع التوزيع | `Tracer`, `Span`, `SpanOptions` |
| `@tlevor/cloud` | توليد Docker | `generateDockerfile`, `writeDockerfile` |
| `@tlevor/mailer` | إرسال بريد | `Mailer`, `MailMessage` |
| `@tlevor/cli` | أداة سطر أوامر | — |
| `@tlevor/integration` | سويت اختبار تكاملي | — |

---

## ٨. الاختبارات

- تُشغَّل عبر `pnpm test` (vitest).
- ملفات الاختبارات في `packages/*/__tests__/*.test.ts`.
- الاختبارات تستورد من `../src/index` مباشرةً، لذا واجهة `index.ts` العامة مستقرة.
- مجموعة الاختبارات الحالية: **202 اختبار تمر كلها**.

---

## ٩. بنية المشروع

```
ramses/
├── packages/          # 23 حزمة (نواة + مزايا)
├── examples/basic/    # تطبيق مثال
├── benchmarks/        # مقارنات أداء (Tlevor vs Express/Fastify/Koa/Hono)
├── benchmarks-fair/   # مقارنات علمية + إجهاد
├── pnpm-workspace.yaml
├── tsconfig.json
└── vitest.config.ts
```

---

## ١٠. الترخيص

MIT
