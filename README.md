# PocketWMS (KhoThôngMinh) — Hệ thống Quản lý Kho Di động & Dự báo Nhu cầu Nhập hàng

Đề tài Khóa luận Tốt nghiệp: **Xây dựng hệ thống Quản lý Kho & Tồn kho Thông minh tập trung trên thiết bị di động (Mobile-First WMS)** hỗ trợ cả cửa hàng nhỏ ít mặt hàng (**Lite Mode / Vật tư nhỏ lẻ**) lẫn vận hành kho chuyên nghiệp (**Barcode Scanner / Kiểm kê mù / Web PWA Local Offline + Tự động đồng bộ**), kết hợp **Sổ cái tồn kho bất biến (Immutable Stock Ledger)** và **AI Dự báo nhu cầu nhập hàng 3 tầng**.

---

## 1. Kiến trúc Hệ thống

- **Mobile & Web PWA (`mobile/`)**: React Native + Expo (TypeScript), TanStack Query (`networkMode: 'always'`), Zustand, Service Worker PWA (`/sw.js` & `/manifest.json`), `expo-camera` (quét mã vạch liên hoàn), `expo-secure-store` (lưu phiên an toàn), lưu đệm đọc/ghi **Offline nội bộ trên máy** (`localStorage` / `AsyncStorage`) kèm hàng đợi tự đồng bộ `POST /api/v1/movements/batch` khi kết nối lại Server, hỗ trợ cả **Light Mode** & **OLED Dark Mode** theo [`DESIGN.md`](./DESIGN.md).
- **Backend & AI Forecasting (`backend/`)**: Python 3.12 + FastAPI + SQLAlchemy 2.0 + NumPy + SQLite ACID (`WAL` mode + `PRAGMA foreign_keys=ON`), có thể chuyển sang PostgreSQL (Neon/Supabase) chỉ bằng 1 dòng `WMS_DATABASE_URL` trong `.env`.

### Ba điểm nhấn kỹ thuật ăn điểm trước Hội đồng
1. **Sổ cái Tồn kho Bất biến & Hoạt động Offline an toàn (`stock_movements`)**:
   - Mọi thao tác Nhập/Xuất đều `INSERT` bất biến kèm `idempotency_key` (chống gửi trùng khi đồng bộ lại từ Offline) và cập nhật nguyên tử `products.current_stock`.
   - **Lưu tạm Offline & Tự đồng bộ Local**: Khi máy chủ tạm tắt hoặc mất Wi-Fi nội bộ, phiên đăng nhập và danh sách mặt hàng vẫn được giữ nguyên trên trình duyệt/thiết bị; các thao tác xuất/nhập/chốt ca được cập nhật ngay trên giao diện và tự động đồng bộ về SQLite ngay khi có mạng trở lại.
   - **Cảnh báo bất thường (Anomaly Guard)**: Chặn lỗi gõ nhầm thừa số 0 khi lượng xuất vượt `10x` mức tiêu thụ trung bình 30 ngày (`HTTP 409` xác nhận lại).
   - **Đính chính 15 phút (`REVERSAL`)**: Không cho phép `DELETE` lịch sử; nhân viên chỉ được hoàn tác bằng giao dịch bù trừ trong vòng 15 phút.
2. **Đủ 3 luồng Nhân viên nhập lượng hàng tiêu thụ**:
   - **Luồng 1 — Xuất tức thì**: Quét mã vạch hoặc bấm `-1 / -5` phân biệt rõ `OUT_CONSUMPTION` (bán/dùng thật) vs `OUT_DAMAGE_EXPIRED` (hàng hỏng/hết hạn — **tự động loại khỏi tập dữ liệu AI** để không dự báo sai).
   - **Luồng 2 — Chốt cuối ca**: Ghim các mặt hàng hay dùng nhất để chốt tiêu thụ toàn ca trong 1 giao dịch Batch.
   - **Luồng 3 — Suy ngược từ Kiểm kê mù (`Blind Stocktake`)**: Khi kiểm kê cuối ngày, nhân viên (`STAFF`) bị ẩn số tồn máy (`system_qty_snapshot = null`). Với vật tư nhỏ lẻ (`CONSUMABLE`), hỗ trợ chọn ước lượng **100% / 75% / 50% / 20% / 0%**; khi Quản lý duyệt lệch âm, hệ thống tự động sinh dòng `OUT_CONSUMPTION` suy ngược.
3. **Động cơ Dự báo Nhu cầu 3 tầng & Tối ưu Nhập hàng**:
   - **Tầng 1 (`COLD_START`, `< 7` ngày)**: Dùng ngưỡng an toàn cấu hình & trung bình sơ khởi.
   - **Tầng 2 (`EWMA_WEEKLY`, `7–29` ngày)**: Trung bình trượt mũ ($\alpha = 0.3$) nhân hệ số thứ trong tuần.
   - **Tầng 3 (`HOLT_WINTERS`, `>= 30` ngày)**: Holt-Winters cộng tính có xu hướng & chu kỳ tuần 7 ngày, tự động đánh giá **MAE / MAPE (%)** trên tập kiểm thử lùi (walk-forward).
   - **Tính điểm đặt hàng lại (ROP)**:
     $$\text{Safety Stock} = Z_{0.95} \cdot \sigma_d \cdot \sqrt{L}, \qquad \text{ROP} = \bar{D} \cdot L + \text{Safety Stock}$$
     Từ đó tính **Số ngày còn trụ được** và xuất thẳng **Phiếu đề xuất nhập hàng (Draft PO CSV)**.

---

## 2. Chạy thử & Vận hành trên Windows (Local / Wi-Fi LAN)

### Khởi động & Quản lý chỉ bằng 1 file duy nhất (`start-wms.bat`)
- **Tự động cài đặt Pre-install nếu máy chưa có Python:** Khi chạy `start-wms.bat` lần đầu trên máy tính chưa có Python hoặc chưa có `backend\.venv`, script sẽ tự động:
  1. Quét Python 3.10–3.13 trên máy (tự bỏ qua stub `Microsoft\WindowsApps\python.exe` của Microsoft Store).
  2. Nếu máy **chưa có Python**, tự động tải & cài đặt **Python 3.12 (per-user, không cần quyền Admin)** qua `winget` hoặc trình cài đặt có chữ ký số từ `python.org`.
  3. Tạo môi trường ảo `backend\.venv` và cài toàn bộ thư viện trong `backend\requirements.txt`.
- **`start-wms.bat`**: Bấm đúp để tự động kiểm tra pre-install, bật ngầm Backend nội bộ (cổng `8000`), tự copy địa chỉ Wi-Fi LAN `http://<LAN-IP>:8000` vào clipboard, **hiển thị sẵn mã QR độ tương phản cao** ngay trong cửa sổ console để điện thoại cùng Wi-Fi quét kết nối nhanh (hoặc mở `http://localhost:8000` trực tiếp trên máy tính để dùng full PWA Offline), và cung cấp menu thao tác nhanh:
  - **`[Enter]`**: Đóng cửa sổ (Backend tiếp tục chạy ngầm).
  - **`[1]`**: Bật Server / Hiển thị lại mã QR Wi-Fi LAN.
  - **`[2]`**: Tắt toàn bộ Backend Server.
  - **`[3]`**: Bật / Tắt tự khởi động ngầm cùng Windows (qua `scripts\start-hidden.vbs`).
  - **`[4]`**: Kiểm tra & tự động cập nhật bản `.zip` mới nhất từ GitHub Releases — **tự động `PRAGMA wal_checkpoint(TRUNCATE)`, sao lưu `smart_wms.db` vào `backend\backups\`, bỏ qua ghi đè database khi giải nén và tự kiểm tra `PRAGMA quick_check` sau cập nhật**.
- Hỗ trợ chạy nhanh qua dòng lệnh: `start-wms.bat setup`, `start-wms.bat status`, `start-wms.bat stop`, `start-wms.bat check-update`, `start-wms.bat update`, `start-wms.bat install-autostart`.

*(Để phát triển frontend Expo Metro cục bộ, chạy `npx expo start` trong thư mục `mobile/`. Để chạy kiểm thử E2E Playwright trên trình duyệt, chạy `npm test` trong thư mục `e2e/`.)*

### Bộ mẫu Shop Mắm Tép (`MAM_TEP`) & Đa tài khoản Nhân viên
- Chọn mẫu **Shop Mắm Tép** khi tạo cửa hàng mới hoặc bấm **`Nạp mẫu Shop Mắm Tép (Demo)`** trong tab **Tổng quan** (bao gồm **Thùng Mắm tép chưng thịt**, **Thùng Mắm tép Ba Làng**, chế độ xé lẻ **Thùng → Hũ/Chai**, và vật tư màng seal/xốp nổ).
- **Quản lý Nhân viên:** 1 Chủ kho (`MANAGER`) có thể tạo **không giới hạn** số lượng tài khoản nhân viên (`STAFF`) trong mục **Nhân viên** của tab Tổng quan, bật/tắt khóa tài khoản tức thì mà vẫn giữ nguyên dấu vết lịch sử ai đã xuất/nhập kho.

### Kịch bản Demo 5 phút trước Hội đồng
1. **Đăng nhập 1 chạm vai trò `STAFF` (Nhân viên kho)**:
   - Mở tab **Xuất kho**: Quét mã vạch `8934588013010` (*Sữa tươi DalatMilk*) để xuất `2 Hộp`, sau đó thử gõ `150` để Hội đồng thấy **Cảnh báo bất thường (`>10x`)** bật lên.
   - Thử tắt Wi-Fi / chế độ Offline trên trình duyệt để ghi nhận xuất kho -> thấy dữ liệu cập nhật ngay trên máy (`Chờ đồng bộ`) và **tự động đẩy lên SQLite** ngay khi có kết nối lại.
   - Thử bấm **Hoàn tác** trong lịch sử vừa tạo ở tab **Kiểm kê** để xem giao dịch bù trừ `REVERSAL` khôi phục tồn kho nguyên vẹn trong 15 phút.
2. **Chuyển sang vai trò `MANAGER` (Chủ kho)**:
   - Mở tab **Tổng quan**: Thấy cảnh báo **Điểm đặt hàng lại (ROP)** và nút chuyển **Lite Mode ↔ Warehouse Pro Mode**.
   - Vào **Kho hàng** → bấm **`+ Thêm nhanh (5s)`** nhập 3 trường (*Tên, Tồn, Đơn vị*) không cần mã vạch → gõ tên gần giống để chứng minh **Cảnh báo trùng tên tiếng Việt không dấu**.
   - Vào **Dự báo**: Xem xếp hạng mặt hàng sắp hết, biểu đồ **Lịch sử 30 ngày + Dự báo 14 ngày**, chỉ số **MAE / MAPE %**, và bấm **Xuất Draft PO CSV**.
