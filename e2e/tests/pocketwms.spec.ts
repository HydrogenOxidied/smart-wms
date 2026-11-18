import { expect, Page, test } from '@playwright/test';

async function loginWithAccount(page: Page, acctName: string, pin: string) {
  await page.goto('/');
  await expect(page.getByPlaceholder('Nhập tên tài khoản')).toBeVisible();
  await page.getByPlaceholder('Nhập tên tài khoản').fill(acctName);
  await page.getByPlaceholder('Nhập mật khẩu').fill(pin);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}

test.describe.serial('PocketWMS WebApp E2E Suite', () => {
  test('TC-01: Store registration (MAM_TEP), default 1234 secret, and 5-tab mobile layout', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tạo cửa hàng mới' })).toBeVisible();
    await expect(page.getByText(/Offline:/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Tạo cửa hàng mới' }).click();
    await page.getByPlaceholder('Ví dụ: Shop Mắm Tép Ba Làng').fill('Shop Mam Tep E2E');
    await page.getByRole('button', { name: 'Chọn Shop Mắm Tép' }).click();
    await page.getByPlaceholder('chu_shop').fill('chu_e2e');
    await page.getByPlaceholder('Nguyễn Văn A').fill('Chu Kho E2E');
    await page.getByPlaceholder('nhanvien_01').fill('nv_e2e');

    await page.getByRole('button', { name: 'Hoàn tất & Tạo kho' }).click();

    await expect(page.getByText('Shop Mam Tep E2E').first()).toBeVisible();
    await expect(page.getByText('@chu_e2e')).toBeVisible();

    const managerTabs = [
      'Mở tab Tổng quan',
      'Mở tab Kho hàng',
      'Mở tab Xuất / Nhập',
      'Mở tab Kiểm kê',
      'Mở tab Dự báo',
    ];
    for (const tabLabel of managerTabs) {
      const tab = page.getByLabel(tabLabel);
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390.5);
    }
  });

  test('TC-02: Manager adds product, verifies NumberField fits 390px viewport, and records Stock-In', async ({
    page,
  }) => {
    await loginWithAccount(page, 'chu_e2e', '1234');
    await expect(page.getByText('@chu_e2e')).toBeVisible();

    await page.getByLabel('Mở tab Kho hàng').click();
    await page.getByLabel('Thêm mặt hàng mới').click();
    await page.getByPlaceholder('Ví dụ: Mắm tép chưng thịt, Túi nilon...').fill('Hộp nhựa E2E 500ml');
    await page.getByPlaceholder('0').fill('20');
    await page.getByRole('button', { name: 'Lưu mặt hàng mới' }).click();

    await expect(page.getByText('Hộp nhựa E2E 500ml').first()).toBeVisible();

    await page.getByLabel('Mở tab Xuất / Nhập').click();
    const qtyInput = page.getByLabel('Ô điền số lượng');
    const plusBtn = page.getByLabel('Tăng 1 đơn vị');
    await expect(qtyInput).toBeVisible();
    await expect(plusBtn).toBeVisible();

    const qtyBox = await qtyInput.boundingBox();
    const plusBox = await plusBtn.boundingBox();
    expect(qtyBox).not.toBeNull();
    expect(plusBox).not.toBeNull();
    expect(qtyBox!.x).toBeGreaterThanOrEqual(0);
    expect(qtyBox!.x + qtyBox!.width).toBeLessThanOrEqual(390);
    expect(plusBox!.x).toBeGreaterThanOrEqual(0);
    expect(plusBox!.x + plusBox!.width).toBeLessThanOrEqual(390);

    await page.getByRole('button', { name: 'Nhập kho (+)' }).click();
    await page.getByPlaceholder('Tìm tên hoặc mã SKU...').fill('Hộp nhựa E2E 500ml');
    await page.getByRole('button', { name: /Chọn Hộp nhựa E2E 500ml/ }).click();
    await qtyInput.fill('10');

    await page.getByRole('button', { name: /Xác nhận Nhập \+10 Cái/ }).click();
    await expect(page.getByText(/Đã lưu: "Hộp nhựa E2E 500ml".*→ 30/)).toBeVisible();
  });

  test('TC-03: Staff RBAC restrictions and stock consumption without offline queue', async ({
    page,
  }) => {
    await loginWithAccount(page, 'nv_e2e', '1234');
    await expect(page.getByText('@nv_e2e')).toBeVisible();
    await expect(page.getByText('Nhân viên').first()).toBeVisible();

    await page.getByLabel('Mở tab Kho hàng').click();
    await expect(page.getByText('Hộp nhựa E2E 500ml').first()).toBeVisible();
    await expect(page.getByLabel('Thêm mặt hàng mới')).toHaveCount(0);

    await page.getByLabel('Mở tab Xuất kho').click();
    await expect(page.getByText('Nhập kho (+)')).toHaveCount(0);

    await page.getByPlaceholder('Tìm tên hoặc mã SKU...').fill('Hộp nhựa E2E 500ml');
    await page.getByRole('button', { name: /Chọn Hộp nhựa E2E 500ml/ }).click();
    await page.getByLabel('Ô điền số lượng').fill('4');
    await page.getByRole('button', { name: /Xác nhận Xuất -4 Cái/ }).click();

    await expect(page.getByText(/Đã lưu: "Hộp nhựa E2E 500ml".*→ 26/)).toBeVisible();
    await expect(page.getByText(/Offline:/)).toHaveCount(0);
  });

  test('TC-04: Audit modification history, accurate local UTC+7 timestamp, and 15-minute reversal', async ({
    page,
  }) => {
    await loginWithAccount(page, 'nv_e2e', '1234');
    await expect(page.getByText('@nv_e2e')).toBeVisible();

    await page.getByLabel('Mở tab Kiểm kê').click();
    await expect(page.getByText(/Trước 30 → Còn 26/)).toBeVisible();
    await expect(page.getByText('NV tiêu hao').first()).toBeVisible();

    const metaLine = page.getByText(/NV: .*nv_e2e.* · \d{2}\/\d{2} \d{2}:\d{2}/).first();
    await expect(metaLine).toBeVisible();
    const metaText = (await metaLine.textContent()) || '';
    const m = metaText.match(/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/);
    expect(m).not.toBeNull();

    const now = new Date();
    const parsedLocal = new Date(
      now.getFullYear(),
      Number(m![2]) - 1,
      Number(m![1]),
      Number(m![3]),
      Number(m![4]),
    );
    expect(Math.abs(Date.now() - parsedLocal.getTime())).toBeLessThanOrEqual(5 * 60 * 1000);

    await page.getByLabel(/Hoàn tác giao dịch/).first().click();
    await expect(page.getByText('Đã hoàn tác').first()).toBeVisible();
    await expect(page.getByText(/Trước 26 → Còn 30/)).toBeVisible();
  });

  test('TC-05: Staff changes password from 1234 to 5678 and re-authenticates', async ({
    page,
  }) => {
    await loginWithAccount(page, 'nv_e2e', '1234');
    await expect(page.getByText('@nv_e2e')).toBeVisible();

    await page.getByLabel('Mở tab Tài khoản').click();
    await expect(page.getByText('Đồng bộ Offline')).toHaveCount(0);

    await page.getByPlaceholder('Mật khẩu hiện tại (mặc định: 1234)').fill('1234');
    await page.getByPlaceholder('Mật khẩu mới (tối thiểu 4 ký tự)').fill('5678');
    await page.getByPlaceholder('Nhập lại mật khẩu mới').fill('5678');
    await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();

    await expect(page.getByText('Đã đổi mật khẩu thành công.')).toBeVisible();

    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await loginWithAccount(page, 'nv_e2e', '1234');
    await expect(page.getByText('Sai tên đăng nhập hoặc mật khẩu.')).toBeVisible();

    await page.getByPlaceholder('Nhập mật khẩu').fill('5678');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByText('@nv_e2e')).toBeVisible();
  });

  test('TC-06: Manager staff CRUD and lazy Demo 3-tier demand forecasting', async ({ page }) => {
    await loginWithAccount(page, 'chu_e2e', '1234');
    await expect(page.getByText('@chu_e2e')).toBeVisible();
    await expect(page.getByText('Hộp nhựa E2E 500ml').first()).toBeVisible();

    await page.getByLabel('Mở tab Tổng quan').click();
    const addStaffBtn = page.getByRole('button', { name: '+ Thêm' });
    await addStaffBtn.scrollIntoViewIfNeeded();
    await addStaffBtn.click();

    await page.getByPlaceholder('Ví dụ: nv_casang').fill('nv_temp');
    await page.getByPlaceholder('Ví dụ: Nguyễn Minh Tâm').fill('NV Tam');
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page.getByText('@nv_temp', { exact: true })).toBeVisible();

    const delStaffBtn = page.getByLabel('Xóa nhân viên nv_temp');
    await delStaffBtn.scrollIntoViewIfNeeded();
    await delStaffBtn.click();
    await page.getByRole('button', { name: 'Xác nhận xóa' }).click();

    await expect(page.getByText('@nv_temp', { exact: true })).toHaveCount(0);

    const logoutBtn = page.getByRole('button', { name: 'Đăng xuất' });
    await logoutBtn.scrollIntoViewIfNeeded();
    await logoutBtn.click();

    await page.getByRole('button', { name: 'Chủ kho Demo' }).click();
    await expect(page.getByText('Tiệm Bánh & Cafe Mộc')).toBeVisible();

    await page.getByLabel('Mở tab Dự báo').click();
    await expect(page.getByText('Dự báo nhu cầu & Đặt hàng')).toBeVisible();

    const firstForecastCard = page.getByLabel(/Xem chi tiết dự báo/).first();
    await expect(firstForecastCard).toBeVisible();
    await firstForecastCard.click();

    await expect(page.getByLabel('Đóng chi tiết dự báo')).toBeVisible();
    await page.getByLabel('Đóng chi tiết dự báo').click();
  });

  test('TC-07: Local offline storage, optimistic deduction, offline navigation, and auto-sync to SQLite', async ({
    page,
    context,
  }) => {
    await loginWithAccount(page, 'chu_e2e', '1234');
    await expect(page.getByText('@chu_e2e')).toBeVisible();

    await page.getByLabel('Mở tab Kho hàng').click();
    await expect(page.getByText('Hộp nhựa E2E 500ml').first()).toBeVisible();
    await expect(page.getByText('30 Cái').first()).toBeVisible();

    await page.getByLabel('Mở tab Xuất / Nhập').click();
    await page.getByPlaceholder('Tìm tên hoặc mã SKU...').fill('Hộp nhựa E2E 500ml');
    await page.getByRole('button', { name: /Chọn Hộp nhựa E2E 500ml/ }).click();

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    await page.getByLabel('Ô điền số lượng').fill('3');
    await page.getByRole('button', { name: /Xác nhận Xuất -3 Cái/ }).click();

    await expect(page.getByText(/Đã lưu Offline: "Hộp nhựa E2E 500ml".*→ 27/)).toBeVisible();
    await expect(page.getByText('Chờ đồng bộ (1)')).toBeVisible();

    await page.getByLabel('Mở tab Kho hàng').click();
    await expect(page.getByText('27 Cái').first()).toBeVisible();

    await page.getByLabel('Mở tab Kiểm kê').click();
    await expect(page.getByText(/Trước 30 → Còn 27/)).toBeVisible();
    await expect(page.getByText('Chờ đồng bộ').first()).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText('Chờ đồng bộ (1)')).toHaveCount(0, { timeout: 10000 });

    await page.reload();
    await expect(page.getByText('@chu_e2e')).toBeVisible();
    await page.getByLabel('Mở tab Kho hàng').click();
    await expect(page.getByText('27 Cái').first()).toBeVisible();
  });
});
