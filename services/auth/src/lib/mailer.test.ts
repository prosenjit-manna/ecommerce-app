import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AnyFn } from '../../test/helpers/fixtures.js';

const sendMailMock = jest.fn<AnyFn>();
jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

const { sendMail } = await import('./mailer.js');
const message = { to: 'jane@example.com', subject: 'Hi', text: 'Hi', html: '<p>Hi</p>' };

describe('sendMail', () => {
  beforeEach(() => {
  sendMailMock.mockReset();
});

  it('sends from MAIL_FROM', async () => {
    sendMailMock.mockResolvedValue({});
    await sendMail(message);
    expect(sendMailMock).toHaveBeenCalledWith({ from: 'Test <test@example.com>', ...message });
  });

  it('never throws when SMTP fails, so a mail outage cannot break sign-in', async () => {
    sendMailMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(sendMail(message)).resolves.toBeUndefined();
  });
});
