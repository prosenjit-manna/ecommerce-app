import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { UserRow } from '../modules/users/users.repository.js';
import type { SessionRow } from '../modules/sessions/sessions.repository.js';
import type { AuthEventRow } from '../modules/events/auth-events.repository.js';
import type { GraphQLContext } from './context.js';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  DateTime: { input: Date; output: Date; }
  _FieldSet: { input: unknown; output: unknown; }
};

export type AccountDisabled = UserError & {
  __typename?: 'AccountDisabled';
  message: Scalars['String']['output'];
};

/** Security history entry: sign-ins, failed attempts, password resets, revoked sessions. */
export type AuthEvent = {
  __typename?: 'AuthEvent';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  ipAddress?: Maybe<Scalars['String']['output']>;
  location?: Maybe<Location>;
  type: AuthEventType;
  userAgent?: Maybe<Scalars['String']['output']>;
};

export type AuthEventConnection = {
  __typename?: 'AuthEventConnection';
  edges: Array<AuthEventEdge>;
  pageInfo: PageInfo;
};

export type AuthEventEdge = {
  __typename?: 'AuthEventEdge';
  cursor: Scalars['String']['output'];
  node: AuthEvent;
};

export type AuthEventType =
  | 'EMAIL_VERIFIED'
  | 'LOGIN_FAILED'
  | 'LOGIN_PASSWORD_OK'
  | 'LOGIN_SUCCESS'
  | 'LOGOUT'
  | 'OTP_FAILED'
  | 'OTP_SENT'
  | 'PASSWORD_RESET'
  | 'PASSWORD_RESET_REQUESTED'
  | 'RATE_LIMITED'
  | 'REFRESH'
  | 'REFRESH_REUSE_DETECTED'
  | 'SESSION_REVOKED'
  | 'SIGNUP';

export type AuthSuccess = {
  __typename?: 'AuthSuccess';
  session: Session;
  tokens: AuthTokens;
  user: User;
};

export type AuthTokens = {
  __typename?: 'AuthTokens';
  /** Short-lived JWT (15 min). Send as `Authorization: Bearer <token>`. */
  accessToken: Scalars['String']['output'];
  accessTokenExpiresAt: Scalars['DateTime']['output'];
  /** Single-use: every refresh returns a new one. Store it securely on the device. */
  refreshToken: Scalars['String']['output'];
  refreshTokenExpiresAt: Scalars['DateTime']['output'];
};

export type Device = {
  __typename?: 'Device';
  appVersion?: Maybe<Scalars['String']['output']>;
  browser?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  os?: Maybe<Scalars['String']['output']>;
  /** ios, android or web */
  platform?: Maybe<Scalars['String']['output']>;
  /** mobile, tablet, desktop, ... */
  type?: Maybe<Scalars['String']['output']>;
};

/** What the app knows about the device. Recommended for native apps, whose User-Agent says little. */
export type DeviceInfoInput = {
  appVersion?: InputMaybe<Scalars['String']['input']>;
  /** Stable per-install id; used to recognise returning devices. */
  deviceId?: InputMaybe<Scalars['String']['input']>;
  /** e.g. "Prosenjit's iPhone" */
  deviceName?: InputMaybe<Scalars['String']['input']>;
  /** ios, android or web */
  platform?: InputMaybe<Scalars['String']['input']>;
};

export type EmailAlreadyRegistered = UserError & {
  __typename?: 'EmailAlreadyRegistered';
  message: Scalars['String']['output'];
};

export type EmailNotVerified = UserError & {
  __typename?: 'EmailNotVerified';
  /** A fresh verification code was sent; complete it with `verifyEmail`. */
  challenge: OtpChallenge;
  message: Scalars['String']['output'];
};

export type ForgotPasswordInput = {
  email: Scalars['String']['input'];
};

export type ForgotPasswordResult = OtpChallenge | RateLimited | ValidationError;

export type InvalidCredentials = UserError & {
  __typename?: 'InvalidCredentials';
  message: Scalars['String']['output'];
};

export type InvalidOtp = UserError & {
  __typename?: 'InvalidOtp';
  attemptsRemaining: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

export type InvalidRefreshToken = UserError & {
  __typename?: 'InvalidRefreshToken';
  message: Scalars['String']['output'];
};

export type Location = {
  __typename?: 'Location';
  city?: Maybe<Scalars['String']['output']>;
  country?: Maybe<Scalars['String']['output']>;
  countryCode?: Maybe<Scalars['String']['output']>;
  latitude?: Maybe<Scalars['Float']['output']>;
  longitude?: Maybe<Scalars['Float']['output']>;
  region?: Maybe<Scalars['String']['output']>;
};

export type LoginInput = {
  device?: InputMaybe<DeviceInfoInput>;
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};

export type LoginMethod =
  | 'EMAIL_VERIFY'
  | 'PASSWORD'
  | 'PASSWORD_OTP';

export type LoginResult = AccountDisabled | AuthSuccess | EmailNotVerified | InvalidCredentials | OtpChallenge | RateLimited | ValidationError;

export type Mutation = {
  __typename?: 'Mutation';
  /** Emails a reset code. Always succeeds, so it can't reveal which emails are registered. */
  forgotPassword: ForgotPasswordResult;
  /** Step 1 of sign-in. Returns an OtpChallenge when two-factor is on (the default). */
  login: LoginResult;
  /** Signs out the current device. */
  logout: RevokeSessionsPayload;
  /** Exchanges a refresh token for a new access + refresh token pair. */
  refreshTokens: RefreshTokensResult;
  /** Emails a new code for an open challenge. */
  resendOtp: ResendOtpResult;
  /** Sets a new password with the code from `forgotPassword` and signs out every device. */
  resetPassword: ResetPasswordResult;
  /** Signs out every device except this one. */
  revokeOtherSessions: RevokeSessionsPayload;
  /** Signs out one of the user's devices. */
  revokeSession: RevokeSessionsPayload;
  /** Turns the email OTP step on or off. */
  setTwoFactor: SetTwoFactorResult;
  /** Creates an account and emails a verification code. */
  signUp: SignUpResult;
  /** Confirms the email with the code from `signUp` and signs the user in. */
  verifyEmail: VerifyEmailResult;
  /** Step 2 of sign-in: the emailed code. */
  verifyLoginOtp: VerifyLoginOtpResult;
};


export type MutationForgotPasswordArgs = {
  input: ForgotPasswordInput;
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationRefreshTokensArgs = {
  input: RefreshTokensInput;
};


export type MutationResendOtpArgs = {
  input: ResendOtpInput;
};


export type MutationResetPasswordArgs = {
  input: ResetPasswordInput;
};


export type MutationRevokeSessionArgs = {
  input: RevokeSessionInput;
};


export type MutationSetTwoFactorArgs = {
  input: SetTwoFactorInput;
};


export type MutationSignUpArgs = {
  input: SignUpInput;
};


export type MutationVerifyEmailArgs = {
  input: VerifyEmailInput;
};


export type MutationVerifyLoginOtpArgs = {
  input: VerifyLoginOtpInput;
};

/** A code was emailed. Submit it with `challengeId`. */
export type OtpChallenge = {
  __typename?: 'OtpChallenge';
  challengeId: Scalars['ID']['output'];
  expiresAt: Scalars['DateTime']['output'];
  /** e.g. j******e@example.com */
  maskedEmail: Scalars['String']['output'];
  purpose: OtpPurpose;
  /** When `resendOtp` can be called again. */
  resendAvailableAt: Scalars['DateTime']['output'];
};

export type OtpExpired = UserError & {
  __typename?: 'OtpExpired';
  message: Scalars['String']['output'];
};

export type OtpPurpose =
  | 'EMAIL_VERIFY'
  | 'LOGIN'
  | 'PASSWORD_RESET';

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
};

export type PasswordResetSuccess = {
  __typename?: 'PasswordResetSuccess';
  message: Scalars['String']['output'];
};

export type Query = {
  __typename?: 'Query';
  /** The signed-in user. */
  me: User;
  /** Security history, newest first. */
  myAuthEvents: AuthEventConnection;
  /** Devices the user is currently signed in on, most recently used first. */
  mySessions: Array<Session>;
};


export type QueryMyAuthEventsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
};

export type RateLimited = UserError & {
  __typename?: 'RateLimited';
  message: Scalars['String']['output'];
  retryAfterSeconds: Scalars['Int']['output'];
};

export type RefreshTokensInput = {
  refreshToken: Scalars['String']['input'];
};

export type RefreshTokensResult = AuthTokens | InvalidRefreshToken | RateLimited | ValidationError;

export type ResendOtpInput = {
  challengeId: Scalars['ID']['input'];
};

export type ResendOtpResult = OtpChallenge | OtpExpired | RateLimited | ValidationError;

export type ResetPasswordInput = {
  challengeId: Scalars['ID']['input'];
  code: Scalars['String']['input'];
  newPassword: Scalars['String']['input'];
};

export type ResetPasswordResult = InvalidOtp | OtpExpired | PasswordResetSuccess | RateLimited | ValidationError | WeakPassword;

export type RevokeSessionInput = {
  sessionId: Scalars['ID']['input'];
};

export type RevokeSessionsPayload = {
  __typename?: 'RevokeSessionsPayload';
  revokedSessionIds: Array<Scalars['ID']['output']>;
};

export type Role =
  | 'ADMIN'
  | 'CUSTOMER';

/** One signed-in device. Lists where and on what the user is signed in. */
export type Session = {
  __typename?: 'Session';
  createdAt: Scalars['DateTime']['output'];
  device: Device;
  expiresAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  /** IP address the session was created from. */
  ipAddress?: Maybe<Scalars['String']['output']>;
  /** True for the session making this request. */
  isCurrent: Scalars['Boolean']['output'];
  /** IP address of the most recent token refresh. */
  lastIpAddress?: Maybe<Scalars['String']['output']>;
  lastSeenAt: Scalars['DateTime']['output'];
  /** Approximate location of the sign-in, from the IP address. */
  location?: Maybe<Location>;
  loginMethod: LoginMethod;
};

export type SetTwoFactorInput = {
  enabled: Scalars['Boolean']['input'];
  /** Current password, to confirm it's really you. */
  password: Scalars['String']['input'];
};

export type SetTwoFactorResult = InvalidCredentials | User;

export type SignUpInput = {
  device?: InputMaybe<DeviceInfoInput>;
  email: Scalars['String']['input'];
  name: Scalars['String']['input'];
  password: Scalars['String']['input'];
};

export type SignUpResult = EmailAlreadyRegistered | OtpChallenge | RateLimited | ValidationError | WeakPassword;

/** A registered account. Owned by the auth subgraph; other subgraphs reference it by id. */
export type User = {
  __typename?: 'User';
  createdAt: Scalars['DateTime']['output'];
  email: Scalars['String']['output'];
  emailVerified: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  role: Role;
  /** Email OTP is required after the password on sign-in. On by default. */
  twoFactorEnabled: Scalars['Boolean']['output'];
};

export type UserError = {
  /** Human-readable; safe to show to the user. */
  message: Scalars['String']['output'];
};

export type ValidationError = UserError & {
  __typename?: 'ValidationError';
  field: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

export type VerifyEmailInput = {
  challengeId: Scalars['ID']['input'];
  code: Scalars['String']['input'];
  device?: InputMaybe<DeviceInfoInput>;
};

export type VerifyEmailResult = AccountDisabled | AuthSuccess | InvalidOtp | OtpExpired | RateLimited | ValidationError;

export type VerifyLoginOtpInput = {
  challengeId: Scalars['ID']['input'];
  code: Scalars['String']['input'];
};

export type VerifyLoginOtpResult = AccountDisabled | AuthSuccess | InvalidOtp | OtpExpired | RateLimited | ValidationError;

export type WeakPassword = UserError & {
  __typename?: 'WeakPassword';
  message: Scalars['String']['output'];
  reasons: Array<Scalars['String']['output']>;
};

export type WithIndex<TObject> = TObject & Record<string, any>;
export type ResolversObject<TObject> = WithIndex<TObject>;

export type ResolverTypeWrapper<T> = Promise<T> | T;

export type ReferenceResolver<TResult, TReference, TContext> = (
      reference: TReference,
      context: TContext,
      info: GraphQLResolveInfo
    ) => Promise<TResult> | TResult;

      type ScalarCheck<T, S> = S extends true ? T : NullableCheck<T, S>;
      type NullableCheck<T, S> = Maybe<T> extends T ? Maybe<ListCheck<NonNullable<T>, S>> : ListCheck<T, S>;
      type ListCheck<T, S> = T extends (infer U)[] ? NullableCheck<U, S>[] : GraphQLRecursivePick<T, S>;
      export type GraphQLRecursivePick<T, S> = { [K in keyof T & keyof S]: ScalarCheck<T[K], S[K]> };
    

export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

/** Mapping of federation types */
export type FederationTypes = ResolversObject<{
  User: User;
}>;

/** Mapping of federation reference types */
export type FederationReferenceTypes = ResolversObject<{
  User:
    ( { __typename: 'User' }
    & GraphQLRecursivePick<FederationTypes['User'], {"id":true}> );
}>;

/** Mapping of union types */
export type ResolversUnionTypes<_RefType extends Record<string, unknown>> = ResolversObject<{
  ForgotPasswordResult:
    | ( OtpChallenge & { __typename: 'OtpChallenge' } )
    | ( RateLimited & { __typename: 'RateLimited' } )
    | ( ValidationError & { __typename: 'ValidationError' } )
  ;
  LoginResult:
    | ( AccountDisabled & { __typename: 'AccountDisabled' } )
    | ( Omit<AuthSuccess, 'session' | 'user'> & { session: _RefType['Session'], user: _RefType['User'] } & { __typename: 'AuthSuccess' } )
    | ( EmailNotVerified & { __typename: 'EmailNotVerified' } )
    | ( InvalidCredentials & { __typename: 'InvalidCredentials' } )
    | ( OtpChallenge & { __typename: 'OtpChallenge' } )
    | ( RateLimited & { __typename: 'RateLimited' } )
    | ( ValidationError & { __typename: 'ValidationError' } )
  ;
  RefreshTokensResult:
    | ( AuthTokens & { __typename: 'AuthTokens' } )
    | ( InvalidRefreshToken & { __typename: 'InvalidRefreshToken' } )
    | ( RateLimited & { __typename: 'RateLimited' } )
    | ( ValidationError & { __typename: 'ValidationError' } )
  ;
  ResendOtpResult:
    | ( OtpChallenge & { __typename: 'OtpChallenge' } )
    | ( OtpExpired & { __typename: 'OtpExpired' } )
    | ( RateLimited & { __typename: 'RateLimited' } )
    | ( ValidationError & { __typename: 'ValidationError' } )
  ;
  ResetPasswordResult:
    | ( InvalidOtp & { __typename: 'InvalidOtp' } )
    | ( OtpExpired & { __typename: 'OtpExpired' } )
    | ( PasswordResetSuccess & { __typename: 'PasswordResetSuccess' } )
    | ( RateLimited & { __typename: 'RateLimited' } )
    | ( ValidationError & { __typename: 'ValidationError' } )
    | ( WeakPassword & { __typename: 'WeakPassword' } )
  ;
  SetTwoFactorResult:
    | ( InvalidCredentials & { __typename: 'InvalidCredentials' } )
    | ( UserRow & { __typename: 'User' } )
  ;
  SignUpResult:
    | ( EmailAlreadyRegistered & { __typename: 'EmailAlreadyRegistered' } )
    | ( OtpChallenge & { __typename: 'OtpChallenge' } )
    | ( RateLimited & { __typename: 'RateLimited' } )
    | ( ValidationError & { __typename: 'ValidationError' } )
    | ( WeakPassword & { __typename: 'WeakPassword' } )
  ;
  VerifyEmailResult:
    | ( AccountDisabled & { __typename: 'AccountDisabled' } )
    | ( Omit<AuthSuccess, 'session' | 'user'> & { session: _RefType['Session'], user: _RefType['User'] } & { __typename: 'AuthSuccess' } )
    | ( InvalidOtp & { __typename: 'InvalidOtp' } )
    | ( OtpExpired & { __typename: 'OtpExpired' } )
    | ( RateLimited & { __typename: 'RateLimited' } )
    | ( ValidationError & { __typename: 'ValidationError' } )
  ;
  VerifyLoginOtpResult:
    | ( AccountDisabled & { __typename: 'AccountDisabled' } )
    | ( Omit<AuthSuccess, 'session' | 'user'> & { session: _RefType['Session'], user: _RefType['User'] } & { __typename: 'AuthSuccess' } )
    | ( InvalidOtp & { __typename: 'InvalidOtp' } )
    | ( OtpExpired & { __typename: 'OtpExpired' } )
    | ( RateLimited & { __typename: 'RateLimited' } )
    | ( ValidationError & { __typename: 'ValidationError' } )
  ;
}>;

/** Mapping of interface types */
export type ResolversInterfaceTypes<_RefType extends Record<string, unknown>> = ResolversObject<{
  UserError:
    | ( AccountDisabled )
    | ( EmailAlreadyRegistered )
    | ( EmailNotVerified )
    | ( InvalidCredentials )
    | ( InvalidOtp )
    | ( InvalidRefreshToken )
    | ( OtpExpired )
    | ( RateLimited )
    | ( ValidationError )
    | ( WeakPassword )
  ;
}>;

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = ResolversObject<{
  AccountDisabled: ResolverTypeWrapper<AccountDisabled>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  AuthEvent: ResolverTypeWrapper<AuthEventRow>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  AuthEventConnection: ResolverTypeWrapper<Omit<AuthEventConnection, 'edges'> & { edges: Array<ResolversTypes['AuthEventEdge']> }>;
  AuthEventEdge: ResolverTypeWrapper<Omit<AuthEventEdge, 'node'> & { node: ResolversTypes['AuthEvent'] }>;
  AuthEventType: AuthEventType;
  AuthSuccess: ResolverTypeWrapper<Omit<AuthSuccess, 'session' | 'user'> & { session: ResolversTypes['Session'], user: ResolversTypes['User'] }>;
  AuthTokens: ResolverTypeWrapper<AuthTokens>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  Device: ResolverTypeWrapper<Device>;
  DeviceInfoInput: DeviceInfoInput;
  EmailAlreadyRegistered: ResolverTypeWrapper<EmailAlreadyRegistered>;
  EmailNotVerified: ResolverTypeWrapper<EmailNotVerified>;
  ForgotPasswordInput: ForgotPasswordInput;
  ForgotPasswordResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['ForgotPasswordResult']>;
  InvalidCredentials: ResolverTypeWrapper<InvalidCredentials>;
  InvalidOtp: ResolverTypeWrapper<InvalidOtp>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  InvalidRefreshToken: ResolverTypeWrapper<InvalidRefreshToken>;
  Location: ResolverTypeWrapper<Location>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  LoginInput: LoginInput;
  LoginMethod: LoginMethod;
  LoginResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['LoginResult']>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  OtpChallenge: ResolverTypeWrapper<OtpChallenge>;
  OtpExpired: ResolverTypeWrapper<OtpExpired>;
  OtpPurpose: OtpPurpose;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  PasswordResetSuccess: ResolverTypeWrapper<PasswordResetSuccess>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  RateLimited: ResolverTypeWrapper<RateLimited>;
  RefreshTokensInput: RefreshTokensInput;
  RefreshTokensResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['RefreshTokensResult']>;
  ResendOtpInput: ResendOtpInput;
  ResendOtpResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['ResendOtpResult']>;
  ResetPasswordInput: ResetPasswordInput;
  ResetPasswordResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['ResetPasswordResult']>;
  RevokeSessionInput: RevokeSessionInput;
  RevokeSessionsPayload: ResolverTypeWrapper<RevokeSessionsPayload>;
  Role: Role;
  Session: ResolverTypeWrapper<SessionRow>;
  SetTwoFactorInput: SetTwoFactorInput;
  SetTwoFactorResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['SetTwoFactorResult']>;
  SignUpInput: SignUpInput;
  SignUpResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['SignUpResult']>;
  User: ResolverTypeWrapper<UserRow>;
  UserError: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['UserError']>;
  ValidationError: ResolverTypeWrapper<ValidationError>;
  VerifyEmailInput: VerifyEmailInput;
  VerifyEmailResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['VerifyEmailResult']>;
  VerifyLoginOtpInput: VerifyLoginOtpInput;
  VerifyLoginOtpResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['VerifyLoginOtpResult']>;
  WeakPassword: ResolverTypeWrapper<WeakPassword>;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  AccountDisabled: AccountDisabled;
  String: Scalars['String']['output'];
  AuthEvent: AuthEventRow;
  ID: Scalars['ID']['output'];
  AuthEventConnection: Omit<AuthEventConnection, 'edges'> & { edges: Array<ResolversParentTypes['AuthEventEdge']> };
  AuthEventEdge: Omit<AuthEventEdge, 'node'> & { node: ResolversParentTypes['AuthEvent'] };
  AuthSuccess: Omit<AuthSuccess, 'session' | 'user'> & { session: ResolversParentTypes['Session'], user: ResolversParentTypes['User'] };
  AuthTokens: AuthTokens;
  DateTime: Scalars['DateTime']['output'];
  Device: Device;
  DeviceInfoInput: DeviceInfoInput;
  EmailAlreadyRegistered: EmailAlreadyRegistered;
  EmailNotVerified: EmailNotVerified;
  ForgotPasswordInput: ForgotPasswordInput;
  ForgotPasswordResult: ResolversUnionTypes<ResolversParentTypes>['ForgotPasswordResult'];
  InvalidCredentials: InvalidCredentials;
  InvalidOtp: InvalidOtp;
  Int: Scalars['Int']['output'];
  InvalidRefreshToken: InvalidRefreshToken;
  Location: Location;
  Float: Scalars['Float']['output'];
  LoginInput: LoginInput;
  LoginResult: ResolversUnionTypes<ResolversParentTypes>['LoginResult'];
  Mutation: Record<PropertyKey, never>;
  OtpChallenge: OtpChallenge;
  OtpExpired: OtpExpired;
  PageInfo: PageInfo;
  Boolean: Scalars['Boolean']['output'];
  PasswordResetSuccess: PasswordResetSuccess;
  Query: Record<PropertyKey, never>;
  RateLimited: RateLimited;
  RefreshTokensInput: RefreshTokensInput;
  RefreshTokensResult: ResolversUnionTypes<ResolversParentTypes>['RefreshTokensResult'];
  ResendOtpInput: ResendOtpInput;
  ResendOtpResult: ResolversUnionTypes<ResolversParentTypes>['ResendOtpResult'];
  ResetPasswordInput: ResetPasswordInput;
  ResetPasswordResult: ResolversUnionTypes<ResolversParentTypes>['ResetPasswordResult'];
  RevokeSessionInput: RevokeSessionInput;
  RevokeSessionsPayload: RevokeSessionsPayload;
  Session: SessionRow;
  SetTwoFactorInput: SetTwoFactorInput;
  SetTwoFactorResult: ResolversUnionTypes<ResolversParentTypes>['SetTwoFactorResult'];
  SignUpInput: SignUpInput;
  SignUpResult: ResolversUnionTypes<ResolversParentTypes>['SignUpResult'];
  User: UserRow;
  UserError: ResolversInterfaceTypes<ResolversParentTypes>['UserError'];
  ValidationError: ValidationError;
  VerifyEmailInput: VerifyEmailInput;
  VerifyEmailResult: ResolversUnionTypes<ResolversParentTypes>['VerifyEmailResult'];
  VerifyLoginOtpInput: VerifyLoginOtpInput;
  VerifyLoginOtpResult: ResolversUnionTypes<ResolversParentTypes>['VerifyLoginOtpResult'];
  WeakPassword: WeakPassword;
}>;

export type AccountDisabledResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AccountDisabled'] = ResolversParentTypes['AccountDisabled']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type AuthEventResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuthEvent'] = ResolversParentTypes['AuthEvent']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  ipAddress?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  location?: Resolver<Maybe<ResolversTypes['Location']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['AuthEventType'], ParentType, ContextType>;
  userAgent?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type AuthEventConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuthEventConnection'] = ResolversParentTypes['AuthEventConnection']> = ResolversObject<{
  edges?: Resolver<Array<ResolversTypes['AuthEventEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
}>;

export type AuthEventEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuthEventEdge'] = ResolversParentTypes['AuthEventEdge']> = ResolversObject<{
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['AuthEvent'], ParentType, ContextType>;
}>;

export type AuthSuccessResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuthSuccess'] = ResolversParentTypes['AuthSuccess']> = ResolversObject<{
  session?: Resolver<ResolversTypes['Session'], ParentType, ContextType>;
  tokens?: Resolver<ResolversTypes['AuthTokens'], ParentType, ContextType>;
  user?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type AuthTokensResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuthTokens'] = ResolversParentTypes['AuthTokens']> = ResolversObject<{
  accessToken?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  accessTokenExpiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  refreshToken?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  refreshTokenExpiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type DeviceResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Device'] = ResolversParentTypes['Device']> = ResolversObject<{
  appVersion?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  browser?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  os?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  platform?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  type?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type EmailAlreadyRegisteredResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['EmailAlreadyRegistered'] = ResolversParentTypes['EmailAlreadyRegistered']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type EmailNotVerifiedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['EmailNotVerified'] = ResolversParentTypes['EmailNotVerified']> = ResolversObject<{
  challenge?: Resolver<ResolversTypes['OtpChallenge'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ForgotPasswordResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ForgotPasswordResult'] = ResolversParentTypes['ForgotPasswordResult']> = ResolversObject<{
  __resolveType: TypeResolveFn<'OtpChallenge' | 'RateLimited' | 'ValidationError', ParentType, ContextType>;
}>;

export type InvalidCredentialsResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InvalidCredentials'] = ResolversParentTypes['InvalidCredentials']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type InvalidOtpResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InvalidOtp'] = ResolversParentTypes['InvalidOtp']> = ResolversObject<{
  attemptsRemaining?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type InvalidRefreshTokenResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InvalidRefreshToken'] = ResolversParentTypes['InvalidRefreshToken']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type LocationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Location'] = ResolversParentTypes['Location']> = ResolversObject<{
  city?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  country?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  countryCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  latitude?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  longitude?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  region?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type LoginResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LoginResult'] = ResolversParentTypes['LoginResult']> = ResolversObject<{
  __resolveType: TypeResolveFn<'AccountDisabled' | 'AuthSuccess' | 'EmailNotVerified' | 'InvalidCredentials' | 'OtpChallenge' | 'RateLimited' | 'ValidationError', ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  forgotPassword?: Resolver<ResolversTypes['ForgotPasswordResult'], ParentType, ContextType, RequireFields<MutationForgotPasswordArgs, 'input'>>;
  login?: Resolver<ResolversTypes['LoginResult'], ParentType, ContextType, RequireFields<MutationLoginArgs, 'input'>>;
  logout?: Resolver<ResolversTypes['RevokeSessionsPayload'], ParentType, ContextType>;
  refreshTokens?: Resolver<ResolversTypes['RefreshTokensResult'], ParentType, ContextType, RequireFields<MutationRefreshTokensArgs, 'input'>>;
  resendOtp?: Resolver<ResolversTypes['ResendOtpResult'], ParentType, ContextType, RequireFields<MutationResendOtpArgs, 'input'>>;
  resetPassword?: Resolver<ResolversTypes['ResetPasswordResult'], ParentType, ContextType, RequireFields<MutationResetPasswordArgs, 'input'>>;
  revokeOtherSessions?: Resolver<ResolversTypes['RevokeSessionsPayload'], ParentType, ContextType>;
  revokeSession?: Resolver<ResolversTypes['RevokeSessionsPayload'], ParentType, ContextType, RequireFields<MutationRevokeSessionArgs, 'input'>>;
  setTwoFactor?: Resolver<ResolversTypes['SetTwoFactorResult'], ParentType, ContextType, RequireFields<MutationSetTwoFactorArgs, 'input'>>;
  signUp?: Resolver<ResolversTypes['SignUpResult'], ParentType, ContextType, RequireFields<MutationSignUpArgs, 'input'>>;
  verifyEmail?: Resolver<ResolversTypes['VerifyEmailResult'], ParentType, ContextType, RequireFields<MutationVerifyEmailArgs, 'input'>>;
  verifyLoginOtp?: Resolver<ResolversTypes['VerifyLoginOtpResult'], ParentType, ContextType, RequireFields<MutationVerifyLoginOtpArgs, 'input'>>;
}>;

export type OtpChallengeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OtpChallenge'] = ResolversParentTypes['OtpChallenge']> = ResolversObject<{
  challengeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  expiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  maskedEmail?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  purpose?: Resolver<ResolversTypes['OtpPurpose'], ParentType, ContextType>;
  resendAvailableAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type OtpExpiredResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OtpExpired'] = ResolversParentTypes['OtpExpired']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type PageInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = ResolversObject<{
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
}>;

export type PasswordResetSuccessResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PasswordResetSuccess'] = ResolversParentTypes['PasswordResetSuccess']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  me?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
  myAuthEvents?: Resolver<ResolversTypes['AuthEventConnection'], ParentType, ContextType, RequireFields<QueryMyAuthEventsArgs, 'first'>>;
  mySessions?: Resolver<Array<ResolversTypes['Session']>, ParentType, ContextType>;
}>;

export type RateLimitedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RateLimited'] = ResolversParentTypes['RateLimited']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  retryAfterSeconds?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type RefreshTokensResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RefreshTokensResult'] = ResolversParentTypes['RefreshTokensResult']> = ResolversObject<{
  __resolveType: TypeResolveFn<'AuthTokens' | 'InvalidRefreshToken' | 'RateLimited' | 'ValidationError', ParentType, ContextType>;
}>;

export type ResendOtpResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ResendOtpResult'] = ResolversParentTypes['ResendOtpResult']> = ResolversObject<{
  __resolveType: TypeResolveFn<'OtpChallenge' | 'OtpExpired' | 'RateLimited' | 'ValidationError', ParentType, ContextType>;
}>;

export type ResetPasswordResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ResetPasswordResult'] = ResolversParentTypes['ResetPasswordResult']> = ResolversObject<{
  __resolveType: TypeResolveFn<'InvalidOtp' | 'OtpExpired' | 'PasswordResetSuccess' | 'RateLimited' | 'ValidationError' | 'WeakPassword', ParentType, ContextType>;
}>;

export type RevokeSessionsPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RevokeSessionsPayload'] = ResolversParentTypes['RevokeSessionsPayload']> = ResolversObject<{
  revokedSessionIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
}>;

export type SessionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Session'] = ResolversParentTypes['Session']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  device?: Resolver<ResolversTypes['Device'], ParentType, ContextType>;
  expiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  ipAddress?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  isCurrent?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  lastIpAddress?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  lastSeenAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  location?: Resolver<Maybe<ResolversTypes['Location']>, ParentType, ContextType>;
  loginMethod?: Resolver<ResolversTypes['LoginMethod'], ParentType, ContextType>;
}>;

export type SetTwoFactorResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SetTwoFactorResult'] = ResolversParentTypes['SetTwoFactorResult']> = ResolversObject<{
  __resolveType: TypeResolveFn<'InvalidCredentials' | 'User', ParentType, ContextType>;
}>;

export type SignUpResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SignUpResult'] = ResolversParentTypes['SignUpResult']> = ResolversObject<{
  __resolveType: TypeResolveFn<'EmailAlreadyRegistered' | 'OtpChallenge' | 'RateLimited' | 'ValidationError' | 'WeakPassword', ParentType, ContextType>;
}>;

export type UserResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['User'] = ResolversParentTypes['User'], FederationReferenceType extends FederationReferenceTypes['User'] = FederationReferenceTypes['User']> = ResolversObject<{
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['User']> | FederationReferenceType, FederationReferenceType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  emailVerified?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['Role'], ParentType, ContextType>;
  twoFactorEnabled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type UserErrorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UserError'] = ResolversParentTypes['UserError']> = ResolversObject<{
  __resolveType: TypeResolveFn<'AccountDisabled' | 'EmailAlreadyRegistered' | 'EmailNotVerified' | 'InvalidCredentials' | 'InvalidOtp' | 'InvalidRefreshToken' | 'OtpExpired' | 'RateLimited' | 'ValidationError' | 'WeakPassword', ParentType, ContextType>;
}>;

export type ValidationErrorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ValidationError'] = ResolversParentTypes['ValidationError']> = ResolversObject<{
  field?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type VerifyEmailResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['VerifyEmailResult'] = ResolversParentTypes['VerifyEmailResult']> = ResolversObject<{
  __resolveType: TypeResolveFn<'AccountDisabled' | 'AuthSuccess' | 'InvalidOtp' | 'OtpExpired' | 'RateLimited' | 'ValidationError', ParentType, ContextType>;
}>;

export type VerifyLoginOtpResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['VerifyLoginOtpResult'] = ResolversParentTypes['VerifyLoginOtpResult']> = ResolversObject<{
  __resolveType: TypeResolveFn<'AccountDisabled' | 'AuthSuccess' | 'InvalidOtp' | 'OtpExpired' | 'RateLimited' | 'ValidationError', ParentType, ContextType>;
}>;

export type WeakPasswordResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['WeakPassword'] = ResolversParentTypes['WeakPassword']> = ResolversObject<{
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  reasons?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type Resolvers<ContextType = GraphQLContext> = ResolversObject<{
  AccountDisabled?: AccountDisabledResolvers<ContextType>;
  AuthEvent?: AuthEventResolvers<ContextType>;
  AuthEventConnection?: AuthEventConnectionResolvers<ContextType>;
  AuthEventEdge?: AuthEventEdgeResolvers<ContextType>;
  AuthSuccess?: AuthSuccessResolvers<ContextType>;
  AuthTokens?: AuthTokensResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  Device?: DeviceResolvers<ContextType>;
  EmailAlreadyRegistered?: EmailAlreadyRegisteredResolvers<ContextType>;
  EmailNotVerified?: EmailNotVerifiedResolvers<ContextType>;
  ForgotPasswordResult?: ForgotPasswordResultResolvers<ContextType>;
  InvalidCredentials?: InvalidCredentialsResolvers<ContextType>;
  InvalidOtp?: InvalidOtpResolvers<ContextType>;
  InvalidRefreshToken?: InvalidRefreshTokenResolvers<ContextType>;
  Location?: LocationResolvers<ContextType>;
  LoginResult?: LoginResultResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  OtpChallenge?: OtpChallengeResolvers<ContextType>;
  OtpExpired?: OtpExpiredResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  PasswordResetSuccess?: PasswordResetSuccessResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  RateLimited?: RateLimitedResolvers<ContextType>;
  RefreshTokensResult?: RefreshTokensResultResolvers<ContextType>;
  ResendOtpResult?: ResendOtpResultResolvers<ContextType>;
  ResetPasswordResult?: ResetPasswordResultResolvers<ContextType>;
  RevokeSessionsPayload?: RevokeSessionsPayloadResolvers<ContextType>;
  Session?: SessionResolvers<ContextType>;
  SetTwoFactorResult?: SetTwoFactorResultResolvers<ContextType>;
  SignUpResult?: SignUpResultResolvers<ContextType>;
  User?: UserResolvers<ContextType>;
  UserError?: UserErrorResolvers<ContextType>;
  ValidationError?: ValidationErrorResolvers<ContextType>;
  VerifyEmailResult?: VerifyEmailResultResolvers<ContextType>;
  VerifyLoginOtpResult?: VerifyLoginOtpResultResolvers<ContextType>;
  WeakPassword?: WeakPasswordResolvers<ContextType>;
}>;

