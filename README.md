# PocketWMS (KhoThôngMinh) — Hệ thống Quản lý Kho Di động & Dự báo Nhu cầu Nhập hàng

Đề tài Khóa luận Tốt nghiệp: **Xây dựng hệ thống Quản lý Kho & Tồn kho Thông minh tập trung trên thiết bị di động (Mobile-First WMS)** hỗ trợ cả cửa hàng nhỏ ít mặt hàng (**Lite Mode / Vật tư nhỏ lẻ**) lẫn vận hành kho chuyên nghiệp (**Barcode Scanner / Kiểm kê mù / Offline Sync Queue**), kết hợp **Sổ cái tồn kho bất biến (Immutable Stock Ledger)** và **AI Dự báo nhu cầu nhập hàng 3 tầng**.

---

## 1. Kiến trúc Hệ thống

- **Mobile Client (`mobile/`)**: React Native + Expo (TypeScript), TanStack Query, Zustand, `expo-camera` (quét mã vạch liên hoàn), `expo-secure-store` (lưu JWT an toàn trên iOS/Android), `AsyncStorage` (hàng đợi Offline-First Sync FIFO), hỗ trợ cả **Light Mode** & **OLED Dark Mode** theo [`DESIGN.md`](./DESIGN.md).
- **Backend & AI Forecasting (`backend/`)**: Python 3.12 + FastAPI + SQLAlchemy 2.0 + NumPy + SQLite ACID (`WAL` mode + `PRAGMA foreign_keys=ON`), có thể chuyển sang PostgreSQL (Neon/Supabase) chỉ bằng 1 dòng `WMS_DATABASE_URL` trong `.env`.

### Ba điểm nhấn kỹ thuật ăn điểm trước Hội đồng
1. **Sổ cái Tồn kho Bất biến (`stock_movements`)**:
   - Mọi thao tác Nhập/Xuất đều `INSERT` bất biến kèm `idempotency_key` (chống gửi trùng khi mạng yếu) và cập nhật nguyên tử `products.current_stock`.
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

## 2. Chạy thử & Kịch bản Demo Bảo vệ Đồ án

### Khởi chạy nhanh trên Windows
1. Chạy `start-backend.bat` (API chạy ở `http://0.0.0.0:8000`, tự động nạp dữ liệu mẫu **65 ngày** cho cửa hàng *"Tiệm Bánh & Cafe Mộc"*).
2. Chạy `start-mobile.bat` (tự động nhận diện IP LAN của máy tính để điện thoại thật dùng **Expo Go** quét QR kết nối được ngay).

### Chạy ngầm 24/7 không hiện cửa sổ CMD (Dành cho Laptop Server `i3-530` / Production)
- **Chạy ẩn hoàn toàn (`Hide CMD`):** Bấm đúp vào `start-backend-hidden.vbs` (gọi ngầm `start-backend-hidden.ps1` không bật `--reload`, ghi log vào `backend/logs/`).
- **Kiểm tra trạng thái & RAM / IP LAN:** Chạy `status-backend.bat` (xem URL API và bản Web/PWA tại `http://<LAN_IP>:8000/web`).
- **Tắt server chạy ngầm:** Chạy `stop-backend-hidden.bat`.
- **Tự bật ẩn khi mở Windows:** Chạy `install-autostart-hidden.bat` 1 lần duy nhất để cài shortcut vào thư mục `Startup`.

### Bộ mẫu Shop Mắm Tép (`MAM_TEP`) & Đa tài khoản Nhân viên
- Chọn mẫu **Shop Mắm Tép** khi tạo cửa hàng mới hoặc bấm **`+ Nạp mẫu Kho Shop Mắm Tép (Thùng & Hũ)`** trong tab **Tổng quan** (bao gồm **Thùng Mắm tép chưng thịt**, **Thùng Mắm tép Ba Làng**, chế độ xé lẻ **Thùng → Hũ/Chai**, và vật tư màng seal/xốp nổ).
- **Quản lý Nhân viên:** 1 Chủ kho (`MANAGER`) có thể tạo **không giới hạn** số lượng tài khoản nhân viên (`STAFF`) trong mục **Nhân viên kho** của tab Tổng quan, bật/tắt khóa tài khoản tức thì mà vẫn giữ nguyên dấu vết lịch sử ai đã xuất/nhập kho.

### Kịch bản Demo 5 phút trước Hội đồng
1. **Đăng nhập 1 chạm vai trò `STAFF` (Nhân viên kho)**:
   - Mở tab **Tiêu thụ**: Quét mã vạch `8934588013010` (*Sữa tươi DalatMilk*) để xuất `2 Hộp`, sau đó thử gõ `150` để Hội đồng thấy **Cảnh báo bất thường (`>10x`)** bật lên.
   - Thử bấm **Đính chính** trong lịch sử vừa tạo để xem giao dịch bù trừ `REVERSAL` khôi phục tồn kho nguyên vẹn.
   - Mở tab **Kiểm kê**: Mở phiên *"Kiểm kê mù cuối ngày"* — chứng minh nhân viên **không nhìn thấy số tồn trên máy**, chọn mức `20%` cho *Ống hút giấy*, quét thêm mặt hàng khác rồi bấm **Gửi Quản lý duyệt**.
2. **Chuyển sang vai trò `MANAGER` (Chủ kho)**:
   - Mở tab **Tổng quan**: Thấy cảnh báo **Điểm đặt hàng lại (ROP)** và nút chuyển **Lite Mode ↔ Warehouse Pro Mode**.
   - Vào **Kho hàng** → bấm **`+ Thêm nhanh (5s)`** nhập 3 trường (*Tên, Tồn, Đơn vị*) không cần mã vạch → gõ tên gần giống để chứng minh **Cảnh báo trùng tên tiếng Việt không dấu**.
   - Vào **Kiểm kê** → Mở phiên nhân viên vừa gửi: thấy đầy đủ bảng đối soát *Tồn máy / Thực đếm / Chênh lệch* và bấm **Duyệt & Cân bằng kho**.
   - Vào **Dự báo AI**: Xem xếp hạng mặt hàng sắp hết, biểu đồ **Lịch sử 30 ngày + Dự báo 14 ngày**, chỉ số **MAE / MAPE %**, và bấm **Xuất Draft PO CSV**.
