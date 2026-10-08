import { GraphQLError } from 'graphql';

/**
 * Expected failures are modelled as GraphQL union members (see docs/backend-api.md, "Errors").
 * Services return these plain objects; `__typename` tells Apollo which union member it is.
 */
export const Result = {
  invalidCredentials: () => ({
    __typename: 'InvalidCredentials' as const,
    message: 'Email or password is incorrect.',
  }),
  invalidOtp: (attemptsRemaining: number) => ({
    __typename: 'InvalidOtp' as const,
    message: attemptsRemaining > 0 ? 'The code is incorrect.' : 'Too many wrong codes. Request a new one.',
    attemptsRemaining,
  }),
  otpExpired: () => ({
    __typename: 'OtpExpired' as const,
    message: 'This code has expired or was already used. Request a new one.',
  }),
  emailAlreadyRegistered: () => ({
    __typename: 'EmailAlreadyRegistered' as const,
    message: 'An account with this email already exists.',
  }),
  accountDisabled: () => ({
    __typename: 'AccountDisabled' as const,
    message: 'This account is disabled.',
  }),
  invalidRefreshToken: () => ({
    __typename: 'InvalidRefreshToken' as const,
    message: 'Your session has ended. Please sign in again.',
  }),
  weakPassword: (reasons: string[]) => ({
    __typename: 'WeakPassword' as const,
    message: 'Password is too weak.',
    reasons,
  }),
  validationError: (field: string, message: string) => ({
    __typename: 'ValidationError' as const,
    message,
    field,
  }),
  rateLimited: (retryAfterSeconds: number) => ({
    __typename: 'RateLimited' as const,
    message: `Too many attempts. Try again in ${retryAfterSeconds} seconds.`,
    retryAfterSeconds,
  }),
};

export type RateLimitedResult = ReturnType<typeof Result.rateLimited>;

/** Top-level errors are only for auth failures and unexpected problems. */
export function unauthenticated(message = 'You must be signed in.'): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } } });
}

export function forbidden(message = 'You are not allowed to do this.'): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'FORBIDDEN', http: { status: 403 } } });
}

export function notFound(message = 'Not found.'): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'NOT_FOUND' } });
}
