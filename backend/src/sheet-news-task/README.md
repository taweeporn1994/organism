# Google Sheets news → scheduled task component

## อ่านข้อมูลทั้งหมดจากแท็บ โดยกำหนดชื่อในโค้ด

ตั้งค่าชื่อแท็บใน `read-sheet-example.js`:

```js
import { readSheet } from './read-sheet.js';

const sheet = 'Sheet1';
const data = await readSheet(sheet);
console.log(data);
```

รัน `npm install` แล้ว `npm run read:sheet` โดยใส่ `GOOGLE_SHEET_ID` และ service account credentials ใน `.env` เหมือนเดิม ชื่อแท็บในโค้ดนี้ไม่ใช้ `GOOGLE_SHEET_TAB`

`readSheet(sheet)` คืน array ของแถว รวมแถวหัวคอลัมน์ และอ่านทุกคอลัมน์โดยไม่จำกัด A:Z ฟังก์ชันนี้ไม่ตรวจวันที่และไม่ดาวน์โหลดรูป เซลล์เป็นค่าที่แสดงในชีต; ไม่คืน formatting, formula source หรือภาพที่ฝังในเซลล์ Sheets API ไม่ส่งแถว/คอลัมน์ว่างท้ายตาราง และแต่ละแถวอาจมีความยาวต่างกัน การ import `read-sheet.js` ไม่เรียก API อัตโนมัติ

โมดูล Node.js 20.6+ (ES modules) สำหรับอ่านข่าวจาก Google Sheets แล้วเตรียมรูปในเครื่องให้ project task scheduled เรียกใช้ ไม่มีตัวตั้งเวลาในโมดูล และไม่แก้ไขข้อมูลในชีต

## ลำดับการทำงาน

1. `readLatestRow()` อ่านชีตแล้วเลือกแถวล่างสุดที่มีข้อมูล
2. `checkRowDate()` ตรวจวันที่ของแถวนั้น เทียบกับวันนี้ตาม `Asia/Bangkok`
3. `downloadImage()` ดาวน์โหลดรูปแต่ละรูป ตรวจ signature PNG/JPEG/GIF/WebP แล้วบันทึกไฟล์แบบ atomic
4. `prepareLatestNews()` รวมขั้นตอนและคืนข้อมูลให้ระบบ task ของคุณ

“ล่าสุด” หมายถึงลำดับแถวจริง ไม่ใช่วันที่มากที่สุด ถ้าแถวล่าสุดไม่ตรงวันที่ จะคืน skipped โดยไม่ย้อนหาแถวเก่า ถ้าต้องการพฤติกรรมอื่นให้ปรับขั้นตอนเลือกแถว

## ใช้โมดูลใน project ของคุณ

คัดลอก `sheet-news.js` ไปยัง project ไม่ต้องลง npm dependency สำหรับโมดูลหลัก

```js
import { prepareLatestNews } from './sheet-news.js';

// เรียกจาก handler ของ scheduler ที่คุณสร้างเอง
async function handleScheduledTask() {
  const result = await prepareLatestNews({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    sheetName: 'Sheet1', // ชื่อแท็บ ไม่ใช่ชื่อไฟล์ Google Sheets
    dateColumn: 'วันที่',
    imageColumn: 'รูป',
    headerRow: 1,
    lastColumn: 'Z',
    outputDir: './downloads/news',
    timeZone: 'Asia/Bangkok',
    getAccessToken: async () => yourAuthService.getGoogleAccessToken(),
  });

  if (result.status !== 'ready') return result;
  // result.data = ข้อมูลข่าวตามหัวคอลัมน์
  // result.images[0].localPath = พาธรูปจริงในเครื่อง (absolute path)
  // result.taskKey = key สำหรับระบบ deduplication ของคุณ
  // ต่อกับ DB / queue / project task ของคุณตรงนี้
  return result;
}
```

`yourAuthService` เป็นจุดเชื่อมต่อ auth ของ project คุณ ไม่ใช่ function ที่รวมมาในแพ็กเกจ มีตัวอย่างใช้ GoogleAuth ที่รันได้ใน `example.js`

## ตั้งค่า .env และ credentials

```bash
npm install
cp .env.example .env
# แก้ค่าใน .env ให้ตรงโปรเจกต์ของคุณ
npm start
```

`npm start` ใช้ `node --env-file=.env example.js` โหลดค่าก่อนรัน ไม่มี dotenv dependency หากนำ function ไปใช้ในแอปของคุณ ให้โหลด .env ที่ entrypoint ด้วย `node --env-file=.env app.js` หรือระบบ env loader ของแอป

- `sheet-news.js` อ่านชีต ตรวจวัน และดาวน์โหลดรูป
- `google-auth.js` จัดการ credentials และ refresh access token
- `example.js` เป็น handler สำหรับต่อกับ scheduler
- `.env.example` เป็นแม่แบบ ให้คัดลอกเป็น `.env` และใส่ค่าจริง

**Service account:** ตั้ง `GOOGLE_AUTH_MODE=service-account` และ `GOOGLE_APPLICATION_CREDENTIALS` เป็นพาธไฟล์ JSON เช่น `./credentials/service-account.json` แชร์ชีตและรูปบน Drive ให้ email ของ service account อ่านได้ เปิด Google Sheets API และ Google Drive API ใน Cloud project ของคุณ ไฟล์ JSON เก็บแยกจากโค้ด; .env เก็บพาธไฟล์

**OAuth:** ตั้ง `GOOGLE_AUTH_MODE=oauth` แล้วใส่ `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` ใน .env ต้องมี refresh token ที่ได้รับอนุญาต scopes `spreadsheets.readonly` และ `drive.readonly` อยู่ก่อน ตัวอย่างนี้ไม่รวมขั้นตอน login/consent เพื่อสร้าง refresh token

การเชื่อมต่อ Google ใน ChatGPT ไม่ส่ง credentials ไปยังโปรแกรมของคุณ ต้องตั้ง auth ของโปรเจกต์เอง มี .gitignore สำหรับ .env, credentials และไฟล์รูป

## วันที่ dynamic

คำนวณวันนี้ใหม่ด้วย `new Date()` ทุกครั้งที่ scheduler เรียก function โดยใช้ timezone จาก `NEWS_TIMEZONE` (ค่าเริ่มต้น `Asia/Bangkok`) ไม่มีตัวแปรวันตายตัวหรือ `NEWS_TARGET_DATE` เมื่อข้ามเที่ยงคืนไทยจะเทียบกับวันใหม่ทันที

วันที่คงที่ในไฟล์ test เป็นข้อมูลจำลองเท่านั้น `now` เป็นจุด inject clock สำหรับทดสอบ; การเรียกใช้งานจริงไม่ต้องส่ง `now`

## รูปแบบข้อมูลในชีต

| วันที่ | หัวข้อ | เนื้อหา | แฮชแท็ก | รูป |
|---|---|---|---|---|
| 2026-10-09 | หัวข้อข่าว | เนื้อหาข่าว | #ข่าว | https://drive.google.com/file/d/FILE_ID/view |

หัวคอลัมน์ต้องไม่ซ้ำ ปรับ `dateColumn` และ `imageColumn` ให้ตรงชีตของคุณ ค่าเริ่มต้นอ่านตั้งแต่ A1 ถึง Z ของทั้งแท็บ หากมีคอลัมน์มากกว่า Z ให้ปรับ `lastColumn` เช่น `AZ`

- วันที่: เซลล์ date ของ Sheets, `2026-10-09`, `09/10/2026`, `09/10/2569` หรือ ISO เช่น `2026-10-09T06:00:00+07:00`
- วันที่แบบ timestamp ต้องระบุ timezone; ข้อความเช่น `09/10/2569 06:00` ไม่รองรับ
- รูป: HTTPS URL ของไฟล์จริง หรือ Google Drive file link `/file/d/.../view`, `/open?id=...`, `/uc?id=...`
- หลายรูป: คั่น URL ด้วยการขึ้นบรรทัดใหม่ หรือ JSON array เช่น `["https://example.com/a.png","https://example.com/b.png"]`
- เซลล์รูปต้องมี URL เป็นข้อความ ไม่รองรับรูปฝังในเซลล์, rich-text hyperlink ที่แสดงเฉพาะชื่อ หรือ `IMAGE()` ที่ไม่ได้ให้ URL เป็นค่าข้อความ
- ถ้ารูปมี resource key ให้เก็บลิงก์ที่มี `resourcekey` ครบ
- รูปไม่ถูกย่อหรือแปลงไฟล์ จำกัดขนาด 25 MiB ต่อรูปและ timeout 60 วินาที ปรับได้ผ่าน `maxBytes` / `timeoutMs`
- ตรวจชนิดด้วย file signature ไม่ใช่การ decode รูปทั้งไฟล์ ดังนั้นยังไม่รับรองว่าไฟล์ภาพที่เสียภายในจะเปิดได้ทุกโปรแกรม

## ผลลัพธ์

```js
// ดาวน์โหลดสำเร็จครบทุกภาพ
{
  status: 'ready',
  spreadsheetId: '...', sheetName: 'Sheet1', rowNumber: 12,
  data: { วันที่: '2026-10-09', หัวข้อ: '...', รูป: '...' },
  matches: true, rowDate: '2026-10-09', expectedDate: '2026-10-09',
  taskKey: 'sha256...',
  images: [{ localPath: '/absolute/path/news-....png',
             mimeType: 'image/png', sizeBytes: 12345,
             sha256: '...', sourceUrl: 'https://...' }]
}
// ไม่มีแถวข้อมูล
{ status: 'empty' }
// วันที่ไม่ตรง หรือเซลล์รูปว่าง
{ status: 'skipped', reason: 'date_mismatch' /* หรือ 'missing_image' */, ... }
```

API ล้มเหลว, ไม่มีคอลัมน์, วันที่ผิดรูปแบบ หรือดาวน์โหลดรูปไม่สำเร็จจะ throw error ให้ scheduler ของคุณกำหนด retry/backoff และ logging ถ้ารูปที่สองล้มเหลว จะลบรูปที่ดาวน์โหลดไว้ในการเรียกครั้งนี้ก่อน throw

## ความรับผิดชอบของ scheduler

- เรียก `prepareLatestNews()` เมื่อถึงเวลาที่คุณกำหนด
- เก็บ `taskKey` ใน DB พร้อม unique constraint หากต้องการป้องกันการประมวลผลซ้ำ แต่โมดูลนี้ไม่ได้จัดเก็บสถานะเอง
- key อิง spreadsheet/แท็บ/เลขแถว/ข้อมูลทั้งหมด ถ้าแก้ข้อมูลหรือย้ายแถวจะได้ key ใหม่; ใช้ news ID ของคุณแทนถ้าต้องการตัวระบุถาวร
- เรียกซ้ำจะดาวน์โหลดเป็นไฟล์ใหม่ จัดการ cleanup รูปหลังใช้หรือหลังพบว่า task ซ้ำ
- ถ้าระหว่างสองรอบมีหลายแถวเพิ่ม โมดูลจะเลือกเพียงแถวสุดท้าย หากต้องการเก็บทุกข่าวต้องใช้การอ่านหลายแถวพร้อม cursor
- เก็บไฟล์บน persistent volume ของเครื่องที่รัน Node; พาธที่คืนมาเป็นของเครื่องนั้น ไม่ใช่เครื่องปลายทางหรือคอมพิวเตอร์ส่วนตัวถ้ารันบน cloud
- ใช้ URL รูปจากแหล่งที่คุณควบคุม โค้ดรองรับ HTTPS แต่ไม่ได้ป้องกัน SSRF สำหรับ URL จากผู้ใช้ที่ไม่น่าเชื่อถือ

## ทดสอบ

```bash
npm test
```

ทดสอบด้วย mocked HTTP: วันไทย/พ.ศ./serial date, เลือกแถวล่าสุด, วันไม่ตรงไม่ดาวน์โหลด, รูป Drive, บันทึก bytes จริง, จำกัดขนาด, ปฏิเสธ HTML และล้างไฟล์เมื่อดาวน์โหลดบางรูปไม่สำเร็จ ไม่ได้ทดสอบกับชีตหรือ credential จริงของคุณ

เอกสาร API:
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get
- https://developers.google.com/workspace/drive/api/guides/manage-downloads
- https://github.com/googleapis/google-cloud-node-core/tree/main/packages/google-auth-library
