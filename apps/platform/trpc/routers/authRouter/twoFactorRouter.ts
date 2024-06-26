import { z } from 'zod';
import { router, accountProcedure } from '../../trpc';
import { eq } from '@u22n/database/orm';
import { accounts } from '@u22n/database/schema';
import { decodeHex, encodeHex } from 'oslo/encoding';
import { TOTPController, createTOTPKeyURI } from 'oslo/otp';
import { TRPCError } from '@trpc/server';
import { nanoIdToken } from '@u22n/utils';
import { Argon2id } from 'oslo/password';

export const twoFactorRouter = router({
  createTwoFactorSecret: accountProcedure
    .input(z.object({}).strict())
    .mutation(async ({ ctx }) => {
      const { account, db } = ctx;
      const accountId = account.id;

      const existingData = await db.query.accounts.findFirst({
        where: eq(accounts.id, accountId),
        columns: {
          username: true,
          twoFactorSecret: true,
          twoFactorEnabled: true
        }
      });

      if (!existingData) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        });
      }

      if (existingData.twoFactorEnabled) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Two Factor Authentication (2FA) is already set up for this account'
        });
      }
      const newSecret = crypto.getRandomValues(new Uint8Array(20));
      await db
        .update(accounts)
        .set({ twoFactorSecret: encodeHex(newSecret) })
        .where(eq(accounts.id, accountId));
      const uri = createTOTPKeyURI(
        'UnInbox.com',
        existingData.username,
        newSecret
      );
      return { uri };
    }),

  verifyTwoFactor: accountProcedure
    .input(
      z
        .object({
          twoFactorCode: z.string()
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const { account, db } = ctx;
      const accountId = account.id;

      const existingData = await db.query.accounts.findFirst({
        where: eq(accounts.id, accountId),
        columns: {
          twoFactorSecret: true,
          recoveryCode: true,
          twoFactorEnabled: true
        }
      });

      if (!existingData) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        });
      }

      if (!existingData.twoFactorSecret) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Two Factor Authentication (2FA) is not set up for this account'
        });
      }

      if (existingData.recoveryCode) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Two Factor Authentication (2FA) has already been verified with this account, please disable then re-enable Two Factor Authentication (2FA) if you want to see your recovery codes again.'
        });
      }

      const secret = decodeHex(existingData.twoFactorSecret);
      const isValid = await new TOTPController().verify(
        input.twoFactorCode,
        secret
      );
      if (!isValid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid Two Factor Authentication (2FA) code'
        });
      }

      // generate and return the recovery codes
      const recoveryCode = nanoIdToken();
      const hashedRecoveryCode = await new Argon2id().hash(recoveryCode);

      await db
        .update(accounts)
        .set({ recoveryCode: hashedRecoveryCode, twoFactorEnabled: true })
        .where(eq(accounts.id, accountId));

      return { recoveryCode: recoveryCode };
    }),
  disableTwoFactor: accountProcedure
    .input(z.object({ twoFactorCode: z.string() }).strict())
    .mutation(async ({ ctx, input }) => {
      const { account, db } = ctx;
      const accountId = account.id;

      const existingData = await db.query.accounts.findFirst({
        where: eq(accounts.id, accountId),
        columns: {
          twoFactorSecret: true,
          recoveryCode: true
        }
      });

      if (!existingData) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        });
      }

      if (!existingData.twoFactorSecret) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '2FA is not set up for this account'
        });
      }
      const secret = decodeHex(existingData.twoFactorSecret);
      const isValid = await new TOTPController().verify(
        input.twoFactorCode,
        secret
      );
      if (!isValid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid 2FA code'
        });
      }

      // No need to check if twoFactorSecret exists
      await db
        .update(accounts)
        .set({
          twoFactorEnabled: false,
          twoFactorSecret: null,
          recoveryCode: null
        })
        .where(eq(accounts.id, accountId));
      return {};
    })
});
