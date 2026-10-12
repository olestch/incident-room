import { test } from '@playwright/test';
import {
  iphoneSafariUA,
  verifyWheelCompensation,
} from '@/shared/testing/wheel-compensation-browser';

test.use({ userAgent: iphoneSafariUA, viewport: { width: 375, height: 667 } });
test('iPhone-UA repeated wheel measurements preserve the painted anchor through idle', async ({
  page,
}, testInfo) => {
  await verifyWheelCompensation(page, testInfo);
});
